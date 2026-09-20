#!/usr/bin/env ucode

'use strict';

import { mkstemp, open, popen, readfile, unlink } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';

const API_VERSION = 1;
const SCHEMA_VERSION = 2;
const MAX_CANDIDATE = 131072;
const MAX_LOG_LINES = 100;
const MAX_LOG_BYTES = 32768;
const backend = '/usr/libexec/zapret2/backend.uc';
const list_helper = '/usr/libexec/zapret2-list';
const error_file = '/var/run/zapret2/last_error';
const ubus = connect();

function envelope(data) {
	return { api_version: API_VERSION, schema_version: SCHEMA_VERSION, ok: true, data: data || {} };
}

function failure(code, message, location) {
	let error = { code: code, message: message || 'Zapret2 operation failed.' };
	if (location?.section) error.section = location.section;
	if (location?.option) error.option = location.option;
	if (location?.step) error.step = location.step;
	if (location?.line) error.line = location.line;
	return { api_version: API_VERSION, schema_version: SCHEMA_VERSION, ok: false, error: error };
}

function require_api(request) {
	if (request?.args?.api_version != API_VERSION)
		return failure('[REDACTED-SECRET:generic-api-key]is required.');
	if (request?.args?.schema_version != SCHEMA_VERSION)
		return failure('unsupported_schema_version', 'schema_version=2 is required.');
	return null;
}

function read_command(command) {
	const fd = popen(command, 'r');
	if (!fd) return null;
	const output = fd.read('all') || '';
	const rc = fd.close() || 0;
	return { output: output, rc: rc };
}

function run_capture(command, limit) {
	const outfd = mkstemp(), errfd = mkstemp();
	const rc = system(`${command} >&${outfd.fileno()} 2>&${errfd.fileno()}`);
	outfd.seek(0); errfd.seek(0);
	const output = outfd.read(limit || MAX_CANDIDATE) || '';
	const error = errfd.read(32768) || '';
	outfd.close(); errfd.close();
	return { rc: rc, output: output, error: error };
}

function valid_id(value) {
	return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9_]{0,31}$/);
}

function valid_list_type(value) {
	return value == 'domain' || value == 'ip' || value == 'auto_domain';
}

function safe_candidate_dir(path) {
	return type(path) == 'string' && match(path, /^\/var\/run\/zapret2\/candidate-[A-Za-z0-9]+$/);
}

function stage_candidate(candidate) {
	let serialized;
	try { serialized = sprintf('%J', candidate); } catch (e) { return null; }
	if (type(candidate) != 'object' || length(serialized) > MAX_CANDIDATE || system('mkdir -m 700 -p /var/run/zapret2') != 0) return null;
	const created = read_command('mktemp -d /var/run/zapret2/candidate-XXXXXX');
	const dir = trim(created?.output || '');
	if (!created || created.rc != 0 || !safe_candidate_dir(dir)) return null;
	const fd = open(`${dir}/config.json`, 'w', 0600);
	if (!fd) { system(`rmdir ${dir} >/dev/null 2>&1`); return null; }
	fd.write(serialized); fd.close();
	return dir;
}

function stage_current() {
	if (system('mkdir -m 700 -p /var/run/zapret2') != 0) return null;
	const created = read_command('mktemp -d /var/run/zapret2/candidate-XXXXXX');
	const dir = trim(created?.output || '');
	return created && created.rc == 0 && safe_candidate_dir(dir) ? dir : null;
}

function cleanup_candidate(dir) {
	if (!safe_candidate_dir(dir)) return;
	for (let name in [ 'argv', 'rules.nft', 'wan_devices', 'source_devices', 'summary', 'manifest.json', 'diagnostics.json' ]) unlink(`${dir}/plan/${name}`);
	system(`rmdir ${dir}/plan >/dev/null 2>&1`);
	unlink(`${dir}/zapret2`); unlink(`${dir}/config.json`);
	system(`rmdir ${dir} >/dev/null 2>&1`);
}

function compiler_error(result, fallback) {
	let message = trim(result?.error || result?.output || fallback || 'Configuration validation failed.');
	message = replace(message, /^error:\s*/, '');
	let location = {}, found = match(message, /unsupported option in [a-z]+ ([a-z0-9_]+): ([a-z0-9_]+)/);
	if (found) { location.section = found[1]; location.option = found[2]; }
	else if ((found = match(message, /step ([a-z0-9_]+)/))) location.step = found[1];
	else if ((found = match(message, /profile ([a-z0-9_]+)/))) location.section = found[1];
	else if ((found = match(message, /line ([0-9]+)/))) location.line = int(found[1]);
	return failure('invalid_configuration', message, location);
}

function parse_json_file(path, limit) {
	const raw = readfile(path, limit || MAX_CANDIDATE);
	if (!raw) return null;
	try { return json(raw); } catch (e) { return null; }
}

function collect_argv(path) {
	let argv = [];
	const raw = readfile(path, 65536) || '';
	for (let line in split(raw, '\n')) if (length(line)) push(argv, line);
	return argv;
}

function compile_plan(candidate, include_rules) {
	const dir = candidate == null ? stage_current() : stage_candidate(candidate);
	if (!dir) return failure('candidate_rejected', 'Candidate configuration exceeds the public contract or could not be staged.');
	const result = candidate == null
		? run_capture(`/usr/bin/ucode ${backend} plan-current ${dir}`)
		: run_capture(`/usr/bin/ucode ${backend} plan-json ${dir}/config.json`);
	if (result.rc != 0) {
		const response = compiler_error(result);
		cleanup_candidate(dir);
		return response;
	}
	const manifest = parse_json_file(`${dir}/plan/manifest.json`, 65536);
	const diagnostics = parse_json_file(`${dir}/plan/diagnostics.json`, 65536);
	if (!manifest || !diagnostics) {
		cleanup_candidate(dir);
		return failure('invalid_compiler_output', 'Compiler returned incomplete plan metadata.');
	}
	let data = { manifest: manifest, diagnostics: diagnostics, argv: collect_argv(`${dir}/plan/argv`) };
	if (include_rules === true) data.rules = readfile(`${dir}/plan/rules.nft`, 262144) || '';
	cleanup_candidate(dir);
	return envelope(data);
}

function service_instance() {
	let services;
	try { services = ubus.call('service', 'list', { name: 'zapret2' }); } catch (e) { services = null; }
	for (let name, instance in (services?.zapret2?.instances || {}))
		if (instance?.running) return { running: true, pid: int(instance.pid) || null };
	return { running: false, pid: null };
}

function as_array(value) { return type(value) == 'array' ? value : (value == null || value == '' ? [] : [ value ]); }
function as_bool(value) { return value == '1' || value === true; }
function as_int(value, fallback) { const number = int(value); return number == null ? fallback : number; }
function words_file(path) {
	let values = [];
	for (let value in split(trim(readfile(path, 4096) || ''), /\s+/)) if (length(value)) push(values, value);
	return values;
}

function chain_counter(chain, comment) {
	const result = run_capture(`nft list chain inet zapret2 ${chain}`, 32768);
	let packets = 0, bytes = 0;
	if (result.rc != 0) return { packets: packets, bytes: bytes };
	for (let line in split(result.output, '\n')) {
		if (index(line, comment) < 0) continue;
		const found = match(line, /counter packets ([0-9]+) bytes ([0-9]+)/);
		if (found) { packets += int(found[1]) || 0; bytes += int(found[2]) || 0; }
	}
	return { packets: packets, bytes: bytes };
}

function config_hash() {
	const result = run_capture("uci -q show zapret2 | sha256sum | awk '{print $1}'", 256);
	return result.rc == 0 ? trim(result.output) : '';
}

function status_data() {
	const config = cursor(), main = config.get_all('zapret2', 'main') || {}, service = service_instance();
	let profiles = 0, enabled_profiles = 0;
	config.foreach('zapret2', 'profile', function(profile) { profiles++; if (as_bool(profile.enabled)) enabled_profiles++; });
	const enabled = as_bool(main.enabled), current = config_hash(), applied = trim(readfile('/var/run/zapret2/applied_hash', 256) || '');
	const table = run_capture('nft list table inet zapret2', 1);
	let state = main.schema_version != `${SCHEMA_VERSION}` ? 'incompatible' : (!enabled ? 'disabled' : (!service.running ? 'stopped' : (current == applied ? 'applied' : 'reload_required')));
	const tcp_out = chain_counter('queue_tcp', 'zapret2 tcp outbound'), tcp_in = chain_counter('prerouting', 'zapret2 tcp reply');
	const udp_out = chain_counter('queue_udp', 'zapret2 udp outbound'), udp_in = chain_counter('prerouting', 'zapret2 udp reply');
	const other_out = chain_counter('queue_other', 'zapret2 other outbound'), other_in = chain_counter('prerouting', 'zapret2 other reply');
	const generated = chain_counter('predefrag', 'zapret2 generated packet');
	return {
		enabled: enabled, running: service.running, pid: service.pid, table_present: table.rc == 0, config_state: state,
		intercept_mode: main.intercept_mode || 'marked', ipv4: as_bool(main.ipv4 ?? '1'), ipv6: as_bool(main.ipv6 ?? '1'),
		queue_num: as_int(main.queue_num, 200), connection_mark: main.connection_mark || '0x20000000', generated_mark: main.generated_mark || '0x40000000',
		wan_networks: as_array(main.wan_network), source_networks: as_array(main.source_network),
		wan_devices: words_file('/var/run/zapret2/wan_devices'), source_devices: words_file('/var/run/zapret2/source_devices'),
		include_marks: as_array(main.include_mark), exclude_marks: as_array(main.exclude_mark),
		profile_count: profiles, enabled_profile_count: enabled_profiles,
		counters: { tcp_out: tcp_out, tcp_in: tcp_in, udp_out: udp_out, udp_in: udp_in, other_out: other_out, other_in: other_in, generated: generated },
		manifest: parse_json_file('/var/run/zapret2/manifest.json', 65536),
		last_error: trim(readfile(error_file, 4096) || '') || null
	};
}

function helper_json(result, code) {
	if (!result || result.rc != 0) {
		const message = trim(result?.error || result?.output || 'Zapret2 helper failed.');
		const found = match(message, /line ([0-9]+)/);
		return failure(code, message, found ? { line: int(found[1]) } : null);
	}
	let data;
	try { data = json(result.output); } catch (e) { data = null; }
	return data ? envelope(data) : failure('invalid_helper_output', 'Zapret2 helper returned invalid JSON.');
}

function reload_lists() {
	try { ubus.call('service', 'signal', { name: 'zapret2', signal: 1 }); } catch (e) { }
}

function checked(request) { return require_api(request); }

const methods = {
	info: { args: { api_version: 0, schema_version: 0 }, call: function(request) {
		let error = checked(request); if (error) return error;
		return helper_json(run_capture(`/usr/bin/ucode ${backend} describe`, 131072), 'info_failed');
	} },
	status: { args: { api_version: 0, schema_version: 0 }, call: function(request) {
		let error = checked(request); if (error) return error; return envelope(status_data());
	} },
	runtime: { args: { api_version: 0, schema_version: 0, include_argv: false, include_rules: false }, call: function(request) {
		let error = checked(request); if (error) return error;
		let data = { manifest: parse_json_file('/var/run/zapret2/manifest.json', 65536), diagnostics: parse_json_file('/var/run/zapret2/diagnostics.json', 65536) };
		if (request.args?.include_argv === true) data.argv = collect_argv('/var/run/zapret2/argv');
		if (request.args?.include_rules === true) data.rules = readfile('/var/run/zapret2/rules.nft', 262144) || '';
		return envelope(data);
	} },
	validate: { args: { api_version: 0, schema_version: 0, candidate: {} }, call: function(request) {
		let error = checked(request); if (error) return error;
		const supplied = request.args?.candidate;
		if (type(supplied) == 'object' && length(supplied) && type(supplied.sections) != 'array') return failure('candidate_rejected', 'candidate must use the versioned sections document.');
		const candidate = type(supplied?.sections) == 'array' ? supplied : null;
		const result = compile_plan(candidate, false);
		if (!result.ok) return result;
		return envelope({ valid: true, diagnostics: result.data.diagnostics, manifest: result.data.manifest });
	} },
	plan: { args: { api_version: 0, schema_version: 0, candidate: {}, include_rules: false }, call: function(request) {
		let error = checked(request); if (error) return error;
		const supplied = request.args?.candidate;
		if (type(supplied) == 'object' && length(supplied) && type(supplied.sections) != 'array') return failure('candidate_rejected', 'candidate must use the versioned sections document.');
		const candidate = type(supplied?.sections) == 'array' ? supplied : null;
		return compile_plan(candidate, request.args?.include_rules === true);
	} },
	service: { args: { api_version: 0, schema_version: 0, action: '' }, call: function(request) {
		let error = checked(request); if (error) return error;
		const action = request.args?.action;
		if (action != 'start' && action != 'stop' && action != 'reload' && action != 'restart') return failure('invalid_action', 'Action must be start, stop, reload, or restart.');
		if (action != 'stop') { const valid = compile_plan(null, false); if (!valid.ok) return valid; }
		const result = run_capture(`/etc/init.d/zapret2 ${action}`, 8192);
		if (result.rc != 0) return failure('service_failed', trim(result.error || result.output || 'Zapret2 service action failed.'));
		return envelope(status_data());
	} },
	list_index: { args: { api_version: 0, schema_version: 0 }, call: function(request) {
		let error = checked(request); if (error) return error; return helper_json(run_capture(`${list_helper} index`, 131072), 'list_index_failed');
	} },
	list_get: { args: { api_version: 0, schema_version: 0, id: '', type: '' }, call: function(request) {
		let error = checked(request); if (error) return error;
		const id = request.args?.id, list_type = request.args?.type;
		if (!valid_id(id) || !valid_list_type(list_type)) return failure('invalid_list', 'Invalid list ID or type.');
		return helper_json(run_capture(`${list_helper} get ${id} ${list_type}`, 1100000), 'list_get_failed');
	} },
	list_put: { args: { api_version: 0, schema_version: 0, id: '', type: '', content: '', old_id: '', old_type: '' }, call: function(request) {
		let error = checked(request); if (error) return error;
		const id = request.args?.id, list_type = request.args?.type, content = request.args?.content;
		const old_id = request.args?.old_id || '', old_type = request.args?.old_type || '';
		if (!valid_id(id) || (list_type != 'domain' && list_type != 'ip') || type(content) != 'string' || length(content) > 1048576) return failure('invalid_list', 'Invalid static list ID, type, or content.');
		if ((old_id || old_type) && (!valid_id(old_id) || (old_type != 'domain' && old_type != 'ip'))) return failure('invalid_old_list', 'Invalid original list identity.');
		system('mkdir -m 700 -p /var/run/zapret2'); const created = read_command('mktemp /var/run/zapret2/list-upload-XXXXXX'); const path = trim(created?.output || '');
		if (!created || created.rc != 0 || !match(path, /^\/var\/run\/zapret2\/list-upload-[A-Za-z0-9]+$/)) return failure('stage_failed', 'Unable to stage list content.');
		const fd = open(path, 'w', 0600); if (!fd) { unlink(path); return failure('stage_failed', 'Unable to stage list content.'); }
		fd.write(content); fd.close();
		const suffix = old_id ? ` ${old_id} ${old_type}` : ''; const response = helper_json(run_capture(`${list_helper} put ${id} ${list_type} ${path}${suffix}`, 1100000), 'list_put_failed'); unlink(path);
		if (response.ok) reload_lists(); return response;
	} },
	list_delete: { args: { api_version: 0, schema_version: 0, id: '', type: '' }, call: function(request) {
		let error = checked(request); if (error) return error; const id = request.args?.id, list_type = request.args?.type;
		if (!valid_id(id) || (list_type != 'domain' && list_type != 'ip')) return failure('invalid_list', 'Only static domain/IP lists can be deleted.');
		const response = helper_json(run_capture(`${list_helper} delete ${id} ${list_type}`), 'list_delete_failed'); if (response.ok) reload_lists(); return response;
	} },
	list_clear: { args: { api_version: 0, schema_version: 0, id: '', type: '' }, call: function(request) {
		let error = checked(request); if (error) return error; const id = request.args?.id, list_type = request.args?.type;
		if (!valid_id(id) || list_type != 'auto_domain') return failure('invalid_list', 'Only automatic domain lists can be cleared.');
		const response = helper_json(run_capture(`${list_helper} clear ${id} ${list_type}`), 'list_clear_failed'); if (response.ok) reload_lists(); return response;
	} },
	log: { args: { api_version: 0, schema_version: 0, limit: 100 }, call: function(request) {
		let error = checked(request); if (error) return error; let limit = int(request.args?.limit); if (limit == null) limit = MAX_LOG_LINES; limit = limit < 1 ? 1 : (limit > MAX_LOG_LINES ? MAX_LOG_LINES : limit);
		const result = read_command(`logread -e zapret2 | tail -n ${limit}`); let output = result?.output || ''; if (length(output) > MAX_LOG_BYTES) output = substr(output, length(output) - MAX_LOG_BYTES);
		return envelope({ text: output, limit: limit });
	} }
};

return { zapret2: methods };
