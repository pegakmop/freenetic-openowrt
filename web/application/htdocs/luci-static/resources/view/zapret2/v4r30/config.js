'use strict';
'require view';
'require form';
'require poll';
'require uci';
'require ui';
'require tools.widgets as widgets';
'require zapret2.v4r30.rpc as api';
'require zapret2.v4r30.strategy as model';
'require zapret2.v4r30.ui as zui';

var map, currentStatus = null, serviceBusy = false;

function listValue(option) {
	option.cfgvalue = function(section) { return L.toArray(uci.get('zapret2', section, this.option)).filter(Boolean); };
	option.write = function(section, value) { uci.set('zapret2', section, this.option, L.toArray(value).filter(Boolean)); };
}

function validator(check, message) {
	return function(section, value) { return !value || check(value) ? true : message; };
}

function statusValue(title, value) {
	return E('td', { class: 'td middle', 'data-title': title }, value);
}

function serviceActions() {
	return zui.tableActions([
		E('button', { id: 'zapret2-start', class: 'btn cbi-button-apply', click: ui.createHandlerFn(null, service, 'start') }, _('Start')),
		E('button', { id: 'zapret2-reload', class: 'btn cbi-button-reload', click: ui.createHandlerFn(null, service, 'reload') }, _('Reload')),
		E('button', { id: 'zapret2-stop', class: 'btn cbi-button-remove', click: ui.createHandlerFn(null, service, 'stop') }, _('Stop'))
	]);
}

function serviceState(status) {
	if (!status) return [ _('Unknown'), 'notice' ];
	if (status.running) return [ _('Running'), 'success' ];
	return status.enabled ? [ _('Stopped unexpectedly'), 'danger' ] : [ _('Disabled'), 'notice' ];
}

function renderStatus(status) {
	currentStatus = status || null;
	var node = document.getElementById('zapret2-status-table');
	if (node) {
		var service = serviceState(currentStatus);
		var statusData = currentStatus || {};
		node.replaceChildren(E('table', { class: 'table cbi-section-table' }, [
			E('tr', { class: 'tr table-titles' }, [
				E('th', { class: 'th top' }, _('Service')), E('th', { class: 'th top' }, _('PID')),
				E('th', { class: 'th top' }, _('Profiles')),
					E('th', { class: 'th top' }, _('TCP original / reply')), E('th', { class: 'th top' }, _('UDP original / reply')),
					E('th', { class: 'th top' }, _('Other original / reply')), E('th', { class: 'th top' }, _('Generated')),
				E('th', { class: 'th cbi-section-actions', style: 'width:1%;white-space:nowrap' }, _('Actions'))
			]),
			E('tr', { class: 'tr cbi-section-table-row' }, [
				statusValue(_('Service'), zui.badge(service[0], service[1])),
				statusValue(_('PID'), statusData.pid == null ? '-' : String(statusData.pid)),
				statusValue(_('Profiles'), currentStatus ? '%d / %d'.format(statusData.enabled_profile_count || 0, statusData.profile_count || 0) : '-'),
				statusValue(_('TCP original / reply'), currentStatus ? '%d / %d'.format(zui.counter(statusData, 'tcp_out'), zui.counter(statusData, 'tcp_in')) : '-'),
				statusValue(_('UDP original / reply'), currentStatus ? '%d / %d'.format(zui.counter(statusData, 'udp_out'), zui.counter(statusData, 'udp_in')) : '-'),
				statusValue(_('Other original / reply'), currentStatus ? '%d / %d'.format(zui.counter(statusData, 'other_out'), zui.counter(statusData, 'other_in')) : '-'),
				statusValue(_('Generated'), currentStatus ? String(zui.counter(statusData, 'generated')) : '-'),
				E('td', { class: 'td cbi-section-actions middle', style: 'width:1%;white-space:nowrap', 'data-title': _('Actions') }, serviceActions())
			])
		]));
	}
	var start = document.getElementById('zapret2-start'), reload = document.getElementById('zapret2-reload'), stop = document.getElementById('zapret2-stop');
	var statusData = currentStatus || {};
	if (start) start.disabled = serviceBusy || !currentStatus || !statusData.enabled || statusData.running || statusData.config_state === 'incompatible';
	if (reload) reload.disabled = serviceBusy || !currentStatus || !statusData.enabled || statusData.config_state === 'incompatible';
	if (stop) stop.disabled = serviceBusy || !currentStatus || (!statusData.running && !statusData.table_present);
	var error = document.getElementById('zapret2-last-error');
	if (error) { error.textContent = statusData.last_error || ''; error.hidden = !statusData.last_error; }
}

function setStatusError(error) {
	var node = document.getElementById('zapret2-status-error');
	if (!node) return;
	node.textContent = error ? _('Unable to update service status: %s').format(zui.errorText(error)) : '';
	node.hidden = !error;
}

function refreshStatus() {
	return api.status().then(function(status) {
		setStatusError(null);
		renderStatus(status);
	}).catch(function(error) {
		setStatusError(error);
		if (!currentStatus) renderStatus(null);
	});
}

function service(action) {
	if (serviceBusy) return Promise.resolve();
	serviceBusy = true; renderStatus(currentStatus);
	return api.service(action).then(renderStatus).catch(zui.notifyError).finally(function() {
		serviceBusy = false;
		return refreshStatus();
	});
}

function renderStatusSection() {
	return E('div', { class: 'cbi-section' }, [
		E('h3', {}, _('Status')),
		E('div', { id: 'zapret2-status-table' }),
		zui.alertMessage('', 'warning', { id: 'zapret2-status-error', hidden: '' }),
		zui.alertMessage('', 'error', { id: 'zapret2-last-error', hidden: '' })
	]);
}

function addFlag(section, tab, name, title, defaultValue, description) {
	var option = section.taboption(tab, form.Flag, name, title, description);
	option.default = defaultValue; option.rmempty = false; return option;
}
function addNumber(section, tab, name, title, defaultValue, datatype) {
	var option = section.taboption(tab, form.Value, name, title);
	option.default = String(defaultValue); option.datatype = datatype; option.rmempty = false; return option;
}

return view.extend({
	load: function() { return Promise.all([ uci.load('zapret2'), api.info().catch(function(error) { return { error: error }; }), api.status().catch(function(error) { return { error: error }; }) ]); },
	render: function(data) {
		if (data[1].error)
			return E('div', { class: 'cbi-map' }, [ zui.pageHeader(_('Zapret2'), _('Configure traffic interception and runtime settings.')), zui.alertMessage(zui.errorText(data[1].error), 'error') ]);
		model.setInfo(data[1]); currentStatus = data[2] && !data[2].error ? data[2] : null;
		if (uci.get('zapret2', 'main', 'schema_version') !== '2')
			return E('div', { class: 'cbi-map' }, [ zui.pageHeader(_('Zapret2'), _('Configure traffic interception and runtime settings.')), zui.alertMessage(_('This application requires Zapret2 configuration version 2. The current settings cannot be edited.'), 'error') ]);

		map = new form.Map('zapret2', _('Zapret2'), _('Configure traffic interception and runtime settings. Ordered Profiles are configured on the Profiles page.'));
		var status = map.section(form.NamedSection, '_status'); status.anonymous = true; status.render = renderStatusSection;
		var s = map.section(form.NamedSection, 'main', 'zapret2');
		s.tab('basic', _('Basic settings')); s.tab('intercept', _('Traffic interception')); s.tab('queue', _('Queue settings')); s.tab('advanced', _('Advanced runtime'));
		addFlag(s, 'basic', 'enabled', _('Enable Zapret2'), '0');
		addFlag(s, 'basic', 'ipv4', _('Process IPv4'), '1'); addFlag(s, 'basic', 'ipv6', _('Process IPv6'), '1');
		var o = s.taboption('basic', widgets.NetworkSelect, 'wan_network', _('WAN networks')); o.multiple = true; o.nocreate = true; o.rmempty = false; listValue(o);
		addFlag(s, 'basic', 'process_forwarded', _('Process forwarded traffic'), '1');
		o = s.taboption('basic', widgets.NetworkSelect, 'source_network', _('Forward source networks')); o.multiple = true; o.nocreate = true; o.depends('process_forwarded', '1'); listValue(o);
		addFlag(s, 'basic', 'process_local', _('Process router-local traffic'), '0');

		o = s.taboption('intercept', form.ListValue, 'intercept_mode', _('Interception mode'), _('All mode may include proxy or VPN tunnels unless an external mark excludes them.')); o.value('marked', _('Match packet marks')); o.value('all', _('All eligible traffic')); o.default = 'marked'; o.rmempty = false;
		o = s.taboption('intercept', form.DynamicList, 'include_mark', _('Include packet marks'), _('Packets are selected by mark before Profile matching. This is separate from domain and IP filtering.')); o.depends('intercept_mode', 'marked'); o.validate = validator(model.validMatchMark, _('Use 0xVALUE/0xMASK.')); listValue(o);
		o = s.taboption('intercept', form.DynamicList, 'exclude_mark', _('Exclude packet marks'), _('Exclusion always takes precedence.')); o.validate = validator(model.validMatchMark, _('Use 0xVALUE/0xMASK.')); listValue(o);
		[ [ 'connection_mark', _('Connection tracking mark'), '0x20000000' ], [ 'generated_mark', _('Generated packet mark'), '0x40000000' ] ].forEach(function(item) {
			var q = s.taboption('intercept', form.Value, item[0], item[1]); q.default = item[2]; q.rmempty = false; q.validate = validator(model.validSingleBitMark, _('Use one nonzero hexadecimal bit.'));
		});

		addNumber(s, 'queue', 'queue_num', _('NFQUEUE number'), 200, 'range(1,65535)');
		[ [ 'tcp_out_packets', _('TCP original-direction packets'), 20 ], [ 'tcp_in_packets', _('TCP reply-direction packets'), 10 ], [ 'udp_out_packets', _('UDP original-direction packets'), 5 ], [ 'udp_in_packets', _('UDP reply-direction packets'), 3 ], [ 'other_out_packets', _('Other protocol original-direction packets'), 5 ], [ 'other_in_packets', _('Other protocol reply-direction packets'), 3 ] ].forEach(function(item) { addNumber(s, 'queue', item[0], item[1], item[2], 'range(1,64)'); });

		o = s.taboption('advanced', form.ListValue, 'debug_mode', _('Debug logging')); o.value('off', _('Off')); o.value('syslog', _('System log')); o.default = 'off'; o.rmempty = false;
		addFlag(s, 'advanced', 'bind_fix4', _('IPv4 PBR bind fix'), '0'); addFlag(s, 'advanced', 'bind_fix6', _('IPv6 PBR bind fix'), '0');
		addFlag(s, 'advanced', 'ipcache_hostname', _('Cache hostnames by IP'), '0'); addNumber(s, 'advanced', 'ipcache_lifetime', _('IP cache lifetime (seconds)'), 7200, 'range(0,604800)');
		addFlag(s, 'advanced', 'ctrack_disable', _('Disable nfqws2 conntrack'), '0', _('Autohostlist requires conntrack and will be rejected when this is enabled.'));
		[ [ 'ctrack_syn_timeout', _('SYN timeout'), 60 ], [ 'ctrack_established_timeout', _('Established timeout'), 300 ], [ 'ctrack_fin_timeout', _('FIN timeout'), 60 ], [ 'ctrack_udp_timeout', _('UDP timeout'), 60 ] ].forEach(function(item) { addNumber(s, 'advanced', item[0], item[1], item[2], 'range(1,86400)').depends('ctrack_disable', '0'); });
		addNumber(s, 'advanced', 'lua_gc_interval', _('Lua garbage collection interval'), 300, 'range(0,86400)');
		o = s.taboption('advanced', form.MultiValue, 'payload_disable', _('Disable payload detectors')); model.info().payload.forEach(function(value) { o.value(value, value); }); listValue(o);
		o = s.taboption('advanced', form.MultiValue, 'reasm_disable', _('Disable reassembly')); o.value('tls_client_hello', 'tls_client_hello'); o.value('quic_initial', 'quic_initial'); listValue(o);

		return map.render().then(function(root) { setTimeout(function() { renderStatus(currentStatus); setStatusError(data[2] && data[2].error); poll.add(refreshStatus, 5); }, 0); return root; });
	},
	handleSave: function() {
		return map.save(function() { return api.validate(model.candidate()).then(function(result) { zui.notifyWarnings(result.diagnostics); }); });
	},
	handleSaveApply: function(event, mode) {
		return this.handleSave().then(function() { return ui.changes.apply(mode === '0'); }).then(function() { return api.service('reload'); }).then(renderStatus).catch(function(error) { zui.notifyError(error); throw error; });
	}
});
