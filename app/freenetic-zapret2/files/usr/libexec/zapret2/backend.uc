#!/usr/bin/ucode

'use strict';

import { open, readfile } from 'fs';

/*
 * Private control-plane dispatcher. Public callers use the zapret2 rpcd
 * object; init/procd uses the same closed entry point. Configuration semantics
 * remain exclusively in compiler.sh.
 */

const compiler = '/usr/libexec/zapret2/compiler.sh';
const API_VERSION = 1;
const SCHEMA_VERSION = 2;
const MAX_CANDIDATE_SIZE = 131072;
const MAX_SECTIONS = 137;
const MAX_LIST_VALUES = 128;

function usage() {
	warn('usage: backend.uc {describe|validate|activate|stop|validate-json FILE|plan-json FILE|plan-current DIR}\n');
	exit(2);
}

function safe_candidate_dir(path) {
	return type(path) == 'string' && match(path, /^\/var\/run\/zapret2\/candidate-[A-Za-z0-9]+$/);
}

function safe_candidate_json(path) {
	return type(path) == 'string' && match(path, /^\/var\/run\/zapret2\/candidate-[A-Za-z0-9]+\/config\.json$/);
}

function safe_id(value) {
	return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9_]{0,31}$/);
}

function safe_key(value) {
	return type(value) == 'string' && match(value, /^[a-z][a-z0-9_]{0,63}$/);
}

function unsafe_uci_scalar(value) {
	for (let offset = 0; offset < length(value); offset++) {
		const code = ord(value, offset);
		if (code < 32 || code == 39 || code == 92 || code == 127) return true;
	}
	return false;
}

function safe_scalar(value, name) {
	if (type(value) == 'bool') value = value ? '1' : '0';
	else if (type(value) == 'int') value = `${value}`;
	else if (type(value) != 'string') return null;
	if (length(value) > (name == 'name' ? 255 : 1024) || unsafe_uci_scalar(value)) return null;
	return value;
}

/* Convert the versioned public candidate document to an isolated UCI file. */
function candidate_to_uci(json_path) {
	let raw = readfile(json_path, MAX_CANDIDATE_SIZE + 1), candidate;
	if (!raw || length(raw) > MAX_CANDIDATE_SIZE) return null;
	try { candidate = json(raw); } catch (e) { return null; }
	if (type(candidate) != 'object' || candidate.api_version != API_VERSION ||
	    candidate.schema_version != SCHEMA_VERSION || type(candidate.sections) != 'array' ||
	    length(candidate.sections) > MAX_SECTIONS) return null;

	let seen = {}, main_count = 0, lines = [];
	for (let section in candidate.sections) {
		if (type(section) != 'object' || !match(section.type || '', /^(zapret2|profile|step)$/) ||
		    !safe_id(section.name) || type(section.options || {}) != 'object' ||
		    type(section.lists || {}) != 'object') return null;
		if (section.type == 'zapret2' && section.name != 'main') return null;
		if (seen[section.name]) return null;
		seen[section.name] = true;
		if (section.type == 'zapret2') main_count++;
		push(lines, `config ${section.type} '${section.name}'`);

		let keys = {};
		for (let key, value in (section.options || {})) {
			if (!safe_key(key) || keys[key] || type(value) == 'array' || type(value) == 'object') return null;
			keys[key] = true;
			value = safe_scalar(value, key);
			if (value == null) return null;
			push(lines, `option ${key} '${value}'`);
		}
		for (let key, values in (section.lists || {})) {
			if (!safe_key(key) || keys[key] || type(values) != 'array' || length(values) > MAX_LIST_VALUES) return null;
			keys[key] = true;
			for (let value in values) {
				value = safe_scalar(value, key);
				if (value == null) return null;
				push(lines, `list ${key} '${value}'`);
			}
		}
		push(lines, '');
	}
	if (main_count != 1) return null;
	const output = replace(json_path, /\/config\.json$/, '/zapret2');
	const fd = open(output, 'w', 0600);
	if (!fd) return null;
	fd.write(join('\n', lines) + '\n');
	fd.close();
	return output;
}

function run(action, directory) {
	let command = compiler + ' ' + action;
	if (directory) command += ' ' + directory;
	return system(command);
}

const action = ARGV[0] ?? '';
if (action == 'describe' || action == 'validate' || action == 'activate' || action == 'stop')
	exit(run(action));
if ((action == 'validate-json' || action == 'plan-json') && safe_candidate_json(ARGV[1])) {
	const output = candidate_to_uci(ARGV[1]);
	if (!output) { warn('error: invalid candidate document\n'); exit(1); }
	const directory = replace(ARGV[1], /\/config\.json$/, '');
	exit(run(action == 'validate-json' ? 'validate-dir' : 'plan-dir', directory));
}
if (action == 'plan-current' && safe_candidate_dir(ARGV[1]))
	exit(run('plan-current', ARGV[1]));

usage();
