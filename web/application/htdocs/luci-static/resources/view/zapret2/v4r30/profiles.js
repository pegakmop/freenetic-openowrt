'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require zapret2.v4r30.rpc as api';
'require zapret2.v4r30.strategy as model';
'require zapret2.v4r30.ui as zui';
'require zapret2.v4r30.fields as fields';
var map,
	profileGrid,
	stepGrid,
	lists = [],
	activeProfileId = null;
var notValidatedMessage = _(
	'Changes have not been validated. Saving validates them before writing.',
);
var candidateStatus = { kind: 'notice', message: notValidatedMessage };
var LABELS = {
	payload: _('Payload filter'),
	out_range: _('Outbound range'),
	in_range: _('Inbound range'),
	drop: _('Drop packet'),
	send: _('Send packet'),
	pktmod: _('Modify packet'),
	rst: _('TCP reset'),
	http_hostcase: _('HTTP Host header case'),
	http_domcase: _('HTTP domain case'),
	http_methodeol: _('HTTP method line break'),
	http_unixeol: _('HTTP Unix line endings'),
	wsize: _('SYN/ACK window size'),
	wssize: _('Flow window size'),
	syndata: _('SYN payload'),
	tls_client_hello_clone: _('Clone TLS ClientHello'),
	fake: _('Fake packet'),
	multisplit: _('Multiple split'),
	multidisorder: _('Multiple disorder'),
	multidisorder_legacy: _('Legacy multiple disorder'),
	fakedsplit: _('Fake split'),
	fakeddisorder: _('Fake disorder'),
	hostfakesplit: _('Fake host split'),
	tcpseg: _('TCP segment'),
	oob: _('TCP out-of-band'),
	udplen: _('UDP length'),
	dht_dn: _('DHT directory number'),
	synack: _('Synthetic SYN/ACK'),
	synack_split: _('Split SYN/ACK'),
};
var STEP_PARAMETER_COLUMNS = fields.columns();
var STEP_ORDER_DESCRIPTION = _(
	'Payload and range conditions apply only to actions that follow them in this Profile.',
);
function label(type) {
	return LABELS[type] || type || _('Unknown step');
}
function order(section) {
	var value = +(section.order || 100);
	return isNaN(value) ? 100 : value;
}
function profileId(section) {
	return section && (section.id || section['.name']);
}
function sections(type, profile) {
	return uci
		.sections('zapret2', type)
		.filter(function (section) {
			return profile == null || section.profile === profile;
		})
		.sort(function (a, b) {
			return order(a) - order(b) || String(a['.name']).localeCompare(String(b['.name']));
		});
}
function nextOrder(type, profile) {
	var items = sections(type, profile);
	return items.length ? Math.min(9999, order(items[items.length - 1]) + 10) : 10;
}
function uniqueId(prefix) {
	var seed = Date.now(),
		id;
	do {
		id = (prefix + '_' + (seed++).toString(36))
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_')
			.slice(0, 32);
	} while (uci.get('zapret2', id));
	return id;
}
function listValue(option) {
	option.cfgvalue = function (section) {
		return L.toArray(uci.get('zapret2', section, this.option)).filter(Boolean);
	};
	option.write = function (section, value) {
		uci.set('zapret2', section, this.option, L.toArray(value).filter(Boolean));
	};
}
function validator(check, message) {
	return function (section, value) {
		return !value || check(value) ? true : message;
	};
}
function dependsTypes(option, types) {
	types.forEach(function (type) {
		option.depends('type', type);
	});
}
function supporting(option) {
	return model.info().actions.filter(function (type) {
		return model.supports(type, option);
	});
}
function setCandidateStatus(kind, message) {
	candidateStatus = { kind: kind, message: message };
	var node = document.getElementById('zapret2-candidate-status');
	if (!node) return;
	node.className = 'alert-message ' + kind;
	node.textContent = message;
}
function validateCandidate() {
	return api.validate(model.candidate()).then(function (result) {
		var warnings = (result.diagnostics && result.diagnostics.warnings) || [];
		setCandidateStatus(
			warnings.length ? 'warning' : 'success',
			warnings.length
				? _(
						'Validation passed with %d warnings. Changes have not been saved or applied.',
					).format(warnings.length)
				: _('Validation passed. Changes have not been saved or applied.'),
		);
		zui.notifyWarnings(result.diagnostics);
		return result;
	});
}
function validateCurrentChanges() {
	setCandidateStatus('warning', _('Validating changes…'));
	return map
		.parse()
		.then(validateCandidate)
		.catch(function (error) {
			setCandidateStatus(
				'error',
				_('Validation failed: %s').format(error.message || _('Unknown error')),
			);
			zui.notifyError(error);
		});
}
function invalidateCandidateStatus() {
	if (candidateStatus.kind !== 'notice' || candidateStatus.message !== notValidatedMessage)
		setCandidateStatus('notice', notValidatedMessage);
}
function modalSave(section, modalMap, event) {
	modalMap.checkDepends();
	return modalMap
		.save(validateCandidate, true)
		.then(function () {
			return section.handleModalCancel(modalMap, event, true);
		})
		.then(function () {
			return rerender();
		})
		.catch(function (error) {
			zui.notifyError(error);
			return false;
		});
}
function rerender() {
	return map.reset().catch(zui.notifyError);
}
function mutate(callback) {
	return map
		.parse()
		.then(callback)
		.then(function (result) {
			invalidateCandidateStatus();
			return rerender().then(function () {
				return result;
			});
		})
		.catch(zui.notifyError);
}
function toggleProfile(sectionId, enabled) {
	return mutate(function () {
		uci.set('zapret2', sectionId, 'enabled', enabled ? '1' : '0');
	});
}
function addStep(profile, type, values) {
	var id = uniqueId(type);
	uci.add('zapret2', 'step', id);
	uci.set('zapret2', id, 'id', id);
	uci.set('zapret2', id, 'profile', profile);
	uci.set('zapret2', id, 'order', String(nextOrder('step', profile)));
	uci.set('zapret2', id, 'type', type);
	Object.keys(values || {}).forEach(function (key) {
		uci.set('zapret2', id, key, values[key]);
	});
	return id;
}
function addPreset(kind) {
	return mutate(function () {
		if (sections('profile').length >= +(model.info().limits.profiles || 8))
			throw new Error(_('The maximum number of Profiles has been reached.'));
		var id = uniqueId(kind);
		activeProfileId = id;
		uci.add('zapret2', 'profile', id);
		uci.set('zapret2', id, 'id', id);
		uci.set('zapret2', id, 'order', String(nextOrder('profile')));
		uci.set('zapret2', id, 'family', 'dual');
		uci.set('zapret2', id, 'queue_mode', 'initial');
		if (kind === 'blank') {
			uci.set('zapret2', id, 'name', 'New profile');
			uci.set('zapret2', id, 'enabled', '0');
		} else if (kind === 'http') {
			uci.set('zapret2', id, 'name', 'HTTP conservative');
			uci.set('zapret2', id, 'enabled', '1');
			uci.set('zapret2', id, 'tcp_port', ['80']);
			uci.set('zapret2', id, 'l7', ['http']);
			addStep(id, 'payload', { value: ['http_req'] });
			addStep(id, 'multisplit', { position: '1' });
		} else if (kind === 'tls') {
			uci.set('zapret2', id, 'name', 'TLS conservative');
			uci.set('zapret2', id, 'enabled', '1');
			uci.set('zapret2', id, 'tcp_port', ['443']);
			uci.set('zapret2', id, 'l7', ['tls']);
			addStep(id, 'payload', { value: ['tls_client_hello'] });
			addStep(id, 'multisplit', { position: '1' });
		} else {
			uci.set('zapret2', id, 'name', 'QUIC standard');
			uci.set('zapret2', id, 'enabled', '0');
			uci.set('zapret2', id, 'udp_port', ['443']);
			uci.set('zapret2', id, 'l7', ['quic']);
			addStep(id, 'payload', { value: ['quic_initial'] });
			addStep(id, 'fake', { blob: 'fake_default_quic', repeats: '6' });
		}
	});
}
function move(sectionId, type, direction) {
	return mutate(function () {
		var current = uci.get('zapret2', sectionId),
			items = sections(type, type === 'step' ? current && current.profile : null),
			index = -1;
		items.forEach(function (item, i) {
			if (item['.name'] === sectionId) index = i;
		});
		var target = index + direction;
		if (index < 0 || target < 0 || target >= items.length) return;
		items.splice(index, 1);
		items.splice(target, 0, current);
		items.forEach(function (item, i) {
			uci.set('zapret2', item['.name'], 'order', String((i + 1) * 10));
		});
	});
}
function removeProfile(id) {
	zui.confirm(
		_('Delete Profile'),
		_('Delete this Profile and all of its ordered steps?'),
		_('Delete'),
		function () {
			return mutate(function () {
				var profiles = sections('profile'),
					index = profiles.findIndex(function (profile) {
						return profile['.name'] === id;
					}),
					next = profiles[index + 1] || profiles[index - 1];
				sections('step', profileId(uci.get('zapret2', id))).forEach(function (step) {
					uci.remove('zapret2', step['.name']);
				});
				uci.remove('zapret2', id);
				if (activeProfileId === id) activeProfileId = next ? profileId(next) : null;
			});
		},
	);
	return Promise.resolve(false);
}
function profileTraffic(profile) {
	var parts = [
		profile.family === 'ipv4' ? 'IPv4' : profile.family === 'ipv6' ? 'IPv6' : _('IPv4 + IPv6'),
	];
	var tcp = L.toArray(profile.tcp_port),
		udp = L.toArray(profile.udp_port),
		icmp = L.toArray(profile.icmp),
		proto = L.toArray(profile.ip_protocol),
		l7 = L.toArray(profile.l7);
	if (tcp.length) parts.push('TCP ' + tcp.join(','));
	if (udp.length) parts.push('UDP ' + udp.join(','));
	if (icmp.length) parts.push('ICMP ' + icmp.join(','));
	if (proto.length) parts.push(_('IP protocols %s').format(proto.join(',')));
	if (l7.length) parts.push('L7 ' + l7.join(','));
	return parts.join(' · ');
}
function filterSummary(profile) {
	var domainIn = L.toArray(profile.include_domain).length + L.toArray(profile.domain_list).length;
	var domainOut =
		L.toArray(profile.exclude_domain).length + L.toArray(profile.domain_exclude_list).length;
	var ipIn = L.toArray(profile.include_ip).length + L.toArray(profile.ip_list).length;
	var ipOut = L.toArray(profile.exclude_ip).length + L.toArray(profile.ip_exclude_list).length;
	var parts = [];
	if (domainIn || domainOut) parts.push(_('Domains +%d / −%d').format(domainIn, domainOut));
	if (ipIn || ipOut) parts.push(_('IPs +%d / −%d').format(ipIn, ipOut));
	if (profile.autohostlist === '1') parts.push(_('Automatic hostlist'));
	return parts.length ? parts.join(' · ') : _('No domain or IP filter');
}
function pipelineOverview(profile) {
	var values = sections('step', profileId(profile)).map(function (step) {
		return label(step.type);
	});
	if (!values.length) return _('No processing steps');
	return _('%d steps').format(values.length) + ' · ' + values.slice(0, 3).join(' → ') +
		(values.length > 3 ? ' …' : '');
}
function overviewLines(primary, secondary) {
	return E('div', { class: 'left' }, [
		E('div', {}, primary),
		secondary ? E('div', { class: 'cbi-value-description' }, secondary) : E([]),
	]);
}
function editProfile(id) {
	return map
		.parse()
		.then(function () {
			return profileGrid.renderMoreOptionsModal(id);
		})
		.catch(function (error) {
			zui.notifyError(error);
			return false;
		});
}
function editStep(id) {
	return map
		.parse()
		.then(function () {
			return stepGrid.renderMoreOptionsModal(id);
		})
		.catch(function (error) {
			zui.notifyError(error);
			return false;
		});
}
function removeStep(id) {
	zui.confirm(_('Delete step'), _('Delete this processing step?'), _('Delete'), function () {
		return mutate(function () {
			uci.remove('zapret2', id);
		});
	});
	return Promise.resolve(false);
}
function stepContext(step) {
	var context = { payload: [], outRange: '', inRange: '' },
		id = step && step['.name'];
	sections('step', step && step.profile).some(function (item) {
		if (item['.name'] === id) return true;
		if (item.type === 'payload') context.payload = L.toArray(item.value);
		else if (item.type === 'out_range') context.outRange = item.range || '';
		else if (item.type === 'in_range') context.inRange = item.range || '';
		return false;
	});
	return context;
}
function stepContextSummary(step) {
	if (step.type === 'payload' || step.type === 'out_range' || step.type === 'in_range')
		return _('Updates following steps');
	var context = stepContext(step),
		parts = [];
	if (context.payload.length) parts.push('Payload=' + context.payload.join(','));
	if (context.outRange) parts.push('out=' + context.outRange);
	if (context.inRange) parts.push('in=' + context.inRange);
	return parts.length ? parts.join(' · ') : '—';
}
function stepParameterValue(step, column) {
	var key = column[0],
		kind = column[2],
		supported;
	if (key === 'value') supported = step.type === 'payload';
	else if (key === 'range') supported = step.type === 'out_range' || step.type === 'in_range';
	else supported = model.supports(step.type, key);
	if (!supported) return '—';
	if (kind === 'flag') return step[key] === '1' ? _('Yes') : _('No');
	var value = step[key];
	if (kind === 'list') value = L.toArray(value).join(', ');
	return value == null || value === '' ? '—' : String(value);
}
function stepActions(step, steps) {
	return zui.tableActions([
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-action',
				click: ui.createHandlerFn(null, editStep, step['.name']),
			},
			_('Edit'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-up',
				disabled: steps[0] === step ? true : null,
				click: ui.createHandlerFn(null, move, step['.name'], 'step', -1),
			},
			_('Up'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-down',
				disabled: steps[steps.length - 1] === step ? true : null,
				click: ui.createHandlerFn(null, move, step['.name'], 'step', 1),
			},
			_('Down'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-negative',
				click: ui.createHandlerFn(null, removeStep, step['.name']),
			},
			_('Delete'),
		),
	]);
}
function renderProfileSteps(profile, steps) {
	var rows = steps.map(function (step) {
		return [
			String(order(step)),
			label(step.type) + ' (' + step.type + ')',
			stepContextSummary(step),
		].concat(
			STEP_PARAMETER_COLUMNS.map(function (column) {
				return stepParameterValue(step, column);
			}),
			[stepActions(step, steps)],
		);
	});
	var content = steps.length
		? E('table', { class: 'table cbi-section-table' }, [
				E(
					'tr',
					{ class: 'tr table-titles' },
					[
						E('th', { class: 'th' }, _('Order')),
						E('th', { class: 'th' }, _('Step')),
						E('th', { class: 'th' }, _('Effective context')),
					].concat(
						STEP_PARAMETER_COLUMNS.map(function (column) {
							return E('th', { class: 'th' }, column[1]);
						}),
							[E('th', { class: 'th center cbi-section-actions', style: 'width:1%;min-width:max-content;text-align:center;white-space:nowrap' }, _('Actions'))],
					),
				),
			])
		: E('em', {}, _('No processing steps'));
	if (steps.length) {
		cbi_update_table(content, rows);
		content.querySelectorAll('th.cbi-section-actions, td.cbi-section-actions').forEach(function (cell) {
			cell.style.width = '1%';
			cell.style.minWidth = 'max-content';
			cell.style.textAlign = 'center';
			cell.style.whiteSpace = 'nowrap';
			cell.style.position = 'sticky';
			cell.style.right = '0';
			cell.style.zIndex = cell.tagName === 'TH' ? '3' : '2';
			if (cell.tagName !== 'TH') cell.style.backgroundColor = 'inherit';
		});
	}
	return E('div', { class: 'cbi-section-node' }, [
		steps.length
			? E('div', { style: 'max-width:100%;overflow-x:auto;overflow-y:visible' }, content)
			: content,
		E('div', { class: 'cbi-section-create' }, [
			E(
				'button',
				{
					type: 'button',
					class: 'btn cbi-button-add',
					click: ui.createHandlerFn(null, addStepDialog, profile),
				},
				_('Add step'),
			),
		]),
	]);
}
function selectProfile(id) {
	activeProfileId = id;
	return rerender();
}
function profileState(profile) {
	var enabled = profile.enabled === '1';
	return zui.badge(enabled ? _('Enabled') : _('Disabled'), enabled ? 'success' : 'notice');
}
function profileToggleButton(profile) {
	var enabled = profile.enabled === '1';
	return E(
		'button',
		{
			type: 'button',
			class: 'btn cbi-button-neutral enable-disable',
			title: enabled ? _('Disable this Profile') : _('Enable this Profile'),
			click: ui.createHandlerFn(null, toggleProfile, profile['.name'], !enabled),
		},
		enabled ? _('Disable') : _('Enable'),
	);
}
function profileOverviewActions(profile, index, profiles, selected) {
	return zui.tableActions([
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-action',
				disabled: selected ? true : null,
				click: ui.createHandlerFn(null, selectProfile, profile['.name']),
			},
			_('View'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-action',
				click: ui.createHandlerFn(null, editProfile, profile['.name']),
			},
			_('Edit'),
		),
		profileToggleButton(profile),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-up',
				disabled: index === 0 ? true : null,
				click: ui.createHandlerFn(null, move, profile['.name'], 'profile', -1),
			},
			_('Up'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-down',
				disabled: index === profiles.length - 1 ? true : null,
				click: ui.createHandlerFn(null, move, profile['.name'], 'profile', 1),
			},
			_('Down'),
		),
		E(
			'button',
			{
				type: 'button',
				class: 'btn cbi-button-negative',
				click: ui.createHandlerFn(null, removeProfile, profile['.name']),
			},
			_('Delete'),
		),
	]);
}
function addProfileDialog() {
	var selector = E('select', { class: 'cbi-input-select' }, [
		E('option', { value: 'blank' }, _('Empty Profile (disabled)')),
		E('option', { value: 'http' }, _('HTTP conservative (enabled)')),
		E('option', { value: 'tls' }, _('TLS conservative (enabled)')),
		E('option', { value: 'quic' }, _('QUIC standard (disabled)')),
	]);
	ui.showModal(_('Add Profile'), [
		zui.sectionDescription(_('Choose a template. All generated fields and steps remain editable before saving.')),
		E('div', { class: 'cbi-value' }, [
			E('label', { class: 'cbi-value-title' }, _('Template')),
			E('div', { class: 'cbi-value-field' }, selector),
		]),
		zui.actionRow([
			E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
			E(
				'button',
				{
					class: 'btn cbi-button-positive',
					click: function () {
						ui.hideModal();
						return addPreset(selector.value);
					},
				},
				_('Add'),
			),
		], 'right'),
	]);
	return Promise.resolve(false);
}
function renderProfileOverview(profiles) {
	var table = E('table', { class: 'table cbi-section-table' }, [
		E('tr', { class: 'tr table-titles' }, [
			E('th', { class: 'th' }, _('Order')),
			E('th', { class: 'th left top' }, _('Profile')),
			E('th', { class: 'th left top' }, _('Traffic match')),
			E('th', { class: 'th left top' }, _('Filters and steps')),
			E('th', { class: 'th' }, _('Status')),
			E('th', { class: 'th cbi-section-actions', style: 'width:1%;white-space:nowrap' }, _('Actions')),
		]),
	]);
	if (profiles.length) {
		cbi_update_table(
			table,
			profiles.map(function (profile, index) {
				var id = profileId(profile),
					selected = profile['.name'] === activeProfileId;
				return [
					String(index + 1),
					overviewLines(profile.name || id, id),
					E('div', { class: 'left' }, profileTraffic(profile)),
					overviewLines(filterSummary(profile), pipelineOverview(profile)),
					profileState(profile),
					profileOverviewActions(profile, index, profiles, selected),
				];
			}),
		);
	} else {
		cbi_update_table(table, [], E('em', {}, _('No Profiles are configured.')));
	}
	return E('div', { class: 'cbi-section' }, [
		E('h3', {}, _('Profile order')),
		zui.sectionDescription(_('The first enabled matching Profile is used. Later Profiles are not evaluated.')),
		table,
		E('div', { class: 'cbi-section-create' }, [
			E(
				'button',
				{
					type: 'button',
					class: 'btn cbi-button-add',
					click: ui.createHandlerFn(null, addProfileDialog),
				},
				_('Add Profile'),
			),
		]),
	]);
}
function renderProfileWorkspace(profile) {
	if (!profile)
		return E('div', { class: 'cbi-section' }, [
			E('h3', {}, _('Profile workspace')),
			E('em', {}, _('Add a Profile to configure its filters and processing steps.')),
		]);
	var id = profileId(profile),
		steps = sections('step', id);
	return E('div', { class: 'cbi-section' }, [
		E('h3', {}, profile.name || id),
		zui.sectionDescription(STEP_ORDER_DESCRIPTION),
		renderProfileSteps(id, steps),
	]);
}
function renderCards() {
	var profiles = sections('profile');
	if (!profiles.some(function (profile) { return profile['.name'] === activeProfileId; }))
		activeProfileId = profiles.length ? profiles[0]['.name'] : null;
	var active = profiles.find(function (profile) {
		return profile['.name'] === activeProfileId;
	});
	return E('div', {}, [
		renderProfileOverview(profiles),
		renderProfileWorkspace(active),
	]);
}
function addStepDialog(profile) {
	return map
		.parse()
		.then(function () {
			if (!uci.get('zapret2', profile))
				throw new Error(_('Create a Profile before adding a step.'));
			if (
				sections('step').length >= +(model.info().limits.steps || 128) ||
				sections('step', profile).length >= +(model.info().limits.profile_steps || 32)
			)
				throw new Error(_('The step limit has been reached.'));
			var selector = E(
				'select',
				{ class: 'cbi-input-select' },
				model.stepTypes().map(function (type) {
					return E('option', { value: type }, label(type) + ' (' + type + ')');
				}),
			);
			ui.showModal(_('Add ordered step'), [
				zui.sectionDescription(STEP_ORDER_DESCRIPTION),
				E('div', { class: 'cbi-value' }, [
					E('label', { class: 'cbi-value-title' }, _('Step type')),
					E('div', { class: 'cbi-value-field' }, selector),
				]),
				zui.actionRow([
					E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
					E(
						'button',
						{
							class: 'btn cbi-button-positive',
							click: function () {
								ui.hideModal();
								var id = addStep(profile, selector.value, {});
								stepGrid.map.addedSection = id;
								invalidateCandidateStatus();
								return stepGrid.renderMoreOptionsModal(id).catch(function (error) {
									uci.remove('zapret2', id);
									delete stepGrid.map.addedSection;
									throw error;
								});
							},
						},
						_('Add'),
					),
				], 'right'),
			]);
		})
		.catch(zui.notifyError);
}
function stepSummary(step) {
	if (step.type === 'payload') return L.toArray(step.value).join(', ') || _('Not configured');
	if (step.type === 'out_range' || step.type === 'in_range')
		return step.range || _('Not configured');
	var parts = [];
	['direction', 'position', 'blob', 'host', 'repeats', 'increment', 'mode'].forEach(function (key) {
		if (step[key]) parts.push(key + '=' + step[key]);
	});
	return parts.join(' · ') || _('Function defaults');
}
function addDependent(option, parameter) {
	dependsTypes(option, supporting(parameter));
}
function addValue(section, tab, name, title, datatype, validate) {
	var option = section.taboption(tab, form.Value, name, title);
	if (datatype) option.datatype = datatype;
	if (validate) option.validate = validate;
	addDependent(option, name);
	return option;
}
function addFlag(section, tab, name, title) {
	var option = section.taboption(tab, form.Flag, name, title);
	option.rmempty = true;
	addDependent(option, name);
	return option;
}
function addList(section, tab, name, title, values) {
	var option = section.taboption(tab, form.ListValue, name, title);
	option.value('', _('Function default'));
	values.forEach(function (value) {
		option.value(value[0], value[1]);
	});
	addDependent(option, name);
	return option;
}
function addMulti(section, tab, name, title, values) {
	var option = section.taboption(tab, form.MultiValue, name, title);
	values.forEach(function (value) {
		option.value(value, value);
	});
	listValue(option);
	addDependent(option, name);
	return option;
}
function configureStepOptions(a) {
	a.tab(
		'condition',
		_('Payload and ranges'),
		STEP_ORDER_DESCRIPTION,
	);
	a.tab('action', _('Main action'));
	a.tab('packet', _('Packet headers and sending'));
	a.tab('fragment', _('IP fragmentation'));
	var type = a.taboption('action', form.ListValue, 'type', _('Step type'));
	model.stepTypes().forEach(function (value) {
		type.value(value, label(value));
	});
	type.readonly = true;
	type.rmempty = false;
	var value = a.taboption('condition', form.MultiValue, 'value', _('Payload values'));
	model.info().payload.forEach(function (item) {
		value.value(item, item);
	});
	value.depends('type', 'payload');
	listValue(value);
	var range = a.taboption('condition', form.Value, 'range', _('Range expression'));
	range.placeholder = 'n1-n20';
	range.validate = validator(
		model.validRange,
		_('Use a valid nfqws2 n/a/d/s/p/b/x range expression.'),
	);
	range.depends('type', 'out_range');
	range.depends('type', 'in_range');
	addList(a, 'action', 'direction', _('Direction'), [
		['out', _('Original direction')],
		['in', _('Reply direction')],
		['any', _('Any direction')],
	]);
	addValue(a, 'action', 'delay', _('Delay (milliseconds)'), 'range(0,60000)');
	addValue(a, 'action', 'repeats', _('Repeats'), 'range(1,20)');
	addValue(
		a,
		'action',
		'spell',
		_('HTTP Host spelling'),
		null,
		validator(function (v) {
			return /^[A-Za-z]{4}$/.test(v);
		}, _('Enter exactly four ASCII letters.')),
	);
	addValue(a, 'action', 'size', _('Window size'), 'range(0,65535)');
	addValue(a, 'action', 'scale', _('Window scale'), 'range(0,14)');
	addMulti(
		a,
		'action',
		'forced_cutoff',
		_('Forced cutoff payloads'),
		['no'].concat(model.info().payload),
	);
	var blob = addValue(a, 'action', 'blob', _('Blob or clone ID'));
	['fake_default_http', 'fake_default_tls', 'fake_default_quic'].forEach(function (item) {
		blob.value(item, item);
	});
	addList(a, 'action', 'fallback', _('Clone fallback blob'), [
		['fake_default_http', 'fake_default_http'],
		['fake_default_tls', 'fake_default_tls'],
		['fake_default_quic', 'fake_default_quic'],
	]);
	[
		'sni_del_ext',
		'sni_del',
		'sni_first',
		'sni_last',
		'optional',
		'nodrop',
		'nofake1',
		'nofake2',
		'nofake3',
		'nofake4',
		'rstack',
	].forEach(function (name) {
		addFlag(a, 'action', name, fields.label(name));
	});
	addValue(a, 'action', 'sni_snt', _('Existing SNI name type'), 'range(0,255)');
	addValue(a, 'action', 'sni_snt_new', _('New SNI name type'), 'range(0,255)');
	addMulti(a, 'action', 'tls_mod', _('TLS modifications'), ['rnd', 'rndsni', 'dupsid', 'padencap']);
	addValue(
		a,
		'action',
		'tls_sni',
		_('TLS SNI hostname'),
		null,
		validator(model.validHostname, _('Enter a hostname without ^.')),
	);
	addValue(
		a,
		'action',
		'position',
		_('Position expression'),
		null,
		validator(model.validPosition, _('Use a safe nfqws2 position expression.')),
	);
	addValue(
		a,
		'action',
		'host',
		_('Host template'),
		null,
		validator(model.validHostname, _('Enter a hostname without ^.')),
	);
	addValue(
		a,
		'action',
		'disorder_after',
		_('Disorder-after position'),
		null,
		validator(model.validPosition, _('Use a safe nfqws2 position expression.')),
	);
	['seqovl_pattern', 'pattern'].forEach(function (name) {
		var option = addValue(a, 'action', name, fields.label(name));
		['fake_default_http', 'fake_default_tls', 'fake_default_quic'].forEach(function (item) {
			option.value(item, item);
		});
	});
	addValue(a, 'action', 'seqovl', _('Sequence overlap'));
	addValue(a, 'action', 'byte', _('OOB byte'), 'range(0,255)');
	addValue(a, 'action', 'urp', _('OOB urgent pointer'));
	addValue(a, 'action', 'increment', _('UDP length increment'), 'range(-1500,1500)');
	addValue(a, 'action', 'min', _('Minimum UDP length'), 'uinteger');
	addValue(a, 'action', 'max', _('Maximum UDP length'), 'uinteger');
	addValue(a, 'action', 'pattern_offset', _('Pattern offset'), 'range(0,1048576)');
	addValue(a, 'action', 'dn', _('DHT directory number'), 'range(0,255)');
	addList(a, 'action', 'mode', _('SYN/ACK split mode'), [
		['syn', 'syn'],
		['synack', 'synack'],
		['acksyn', 'acksyn'],
	]);
	[
		['ip_ttl', _('IPv4 TTL'), 'range(0,255)'],
		['ip6_ttl', _('IPv6 Hop Limit'), 'range(0,255)'],
		['tcp_seq', _('TCP sequence offset'), 'range(-1000000,1000000)'],
		['tcp_ack', _('TCP acknowledgement offset'), 'range(-1000000,1000000)'],
		['tcp_ts', _('TCP timestamp offset'), 'range(-1000000,1000000)'],
		['ipfrag_next', _('Next-header value'), 'range(0,255)'],
	].forEach(function (item) {
		addValue(a, item[0] === 'ipfrag_next' ? 'fragment' : 'packet', item[0], item[1], item[2]);
	});
	[
		['ip_autottl', _('IPv4 automatic TTL')],
		['ip6_autottl', _('IPv6 automatic Hop Limit')],
	].forEach(function (item) {
		addValue(
			a,
			'packet',
			item[0],
			item[1],
			null,
			validator(model.validAutottl, _('Use delta,min-max within valid TTL bounds.')),
		);
	});
	['badsum', 'tcp_md5', 'tcp_ts_up', 'tcp_nop_del', 'ip_id_conn'].forEach(function (name) {
		addFlag(a, 'packet', name, fields.label(name));
	});
	addList(a, 'packet', 'ip_id', _('IPv4 IP ID policy'), [
		['seq', _('Sequential')],
		['rnd', _('Random')],
		['zero', _('Zero')],
		['none', _('Unchanged')],
	]);
	addFlag(a, 'fragment', 'ipfrag', _('Enable IP fragmentation'));
	addFlag(a, 'fragment', 'ipfrag_disorder', _('Reverse fragment order'));
	['ipfrag_pos_tcp', 'ipfrag_pos_udp', 'ipfrag_pos_icmp', 'ipfrag_pos'].forEach(function (name) {
		addValue(
			a,
			'fragment',
			name,
			fields.label(name),
			null,
			validator(model.validFragPos, _('Use a multiple of 8 from 8 to 1480.')),
		);
	});
}
function renderValidation() {
	return E('div', { class: 'cbi-section' }, [
		E('h3', {}, _('Validate changes')),
		zui.sectionDescription(
			_(
				'Validate the current changes with the same compiler used when the service starts. This does not save or apply the configuration.',
			),
		),
		zui.actionRow([
			E(
				'button',
				{ class: 'btn cbi-button-action', click: ui.createHandlerFn(null, validateCurrentChanges) },
				_('Validate'),
			),
		]),
		zui.alertMessage(candidateStatus.message, candidateStatus.kind, { id: 'zapret2-candidate-status' }),
		zui.sectionDescription(
			_(
				'Save validates the changes before writing them. Save & Apply also reloads the service.',
			),
		),
	]);
}
return view.extend({
	load: function () {
		return Promise.all([
			uci.load('zapret2'),
			api.info().catch(function (error) {
				return { error: error };
			}),
			api.listIndex().catch(function () {
				return { lists: [] };
			}),
		]);
	},
	render: function (data) {
		if (data[1].error)
			return E('div', { class: 'cbi-map' }, [
				zui.pageHeader(_('Profiles'), _('Configure ordered traffic-matching Profiles and processing steps.')),
				zui.alertMessage(zui.errorText(data[1].error), 'error'),
			]);
		model.setInfo(data[1]);
		lists = (data[2] && data[2].lists) || [];
		if (uci.get('zapret2', 'main', 'schema_version') !== '2')
			return E('div', { class: 'cbi-map' }, [
				zui.pageHeader(_('Profiles'), _('Configure ordered traffic-matching Profiles and processing steps.')),
				zui.alertMessage(_('This page requires Zapret2 configuration version 2.'), 'error'),
			]);
		map = new form.Map(
			'zapret2',
			_('Profiles'),
			_('Packets use the first enabled matching Profile, then follow its ordered steps.'),
		);
		var cards = map.section(form.NamedSection, '_cards');
		cards.anonymous = true;
		cards.render = renderCards;
		profileGrid = map.section(form.GridSection, 'profile');
		profileGrid.anonymous = true;
		profileGrid.addremove = false;
		profileGrid.render = function () {
			return E([]);
		};
		profileGrid.tab('match', _('Matching conditions'));
		profileGrid.tab('domains', _('Domain filtering'));
		profileGrid.tab('addresses', _('IP filtering'));
		profileGrid.tab('auto', _('Automatic hostlist'));
		var o = profileGrid.taboption('match', form.Value, 'id', _('Profile ID'));
		o.readonly = true;
		o.rmempty = false;
		o = profileGrid.taboption('match', form.Value, 'name', _('Name'));
		o.rmempty = false;
		o = profileGrid.taboption('match', form.Flag, 'enabled', _('Enabled'));
		o.rmempty = false;
		o = profileGrid.taboption('match', form.ListValue, 'family', _('Address family'));
		o.value('dual', _('IPv4 + IPv6'));
		o.value('ipv4', 'IPv4');
		o.value('ipv6', 'IPv6');
		o.rmempty = false;
		o = profileGrid.taboption('match', form.ListValue, 'queue_mode', _('Queue mode'));
		o.value('initial', _('Initial packets'));
		o.value('keepalive', _('Keep matching packets queued'));
		o.rmempty = false;
		[
			['tcp_port', _('TCP ports'), model.validPort, _('Use a port, range, *, or ~ exclusion.')],
			['udp_port', _('UDP ports'), model.validPort, _('Use a port, range, *, or ~ exclusion.')],
			['icmp', _('ICMP type and code'), model.validIcmp, _('Use *, TYPE or TYPE:CODE.')],
			[
				'ip_protocol',
				_('IP protocols'),
				model.validProtocol,
				_('Use * or protocol number 0..255.'),
			],
		].forEach(function (item) {
			var q = profileGrid.taboption('match', form.DynamicList, item[0], item[1]);
			q.validate = validator(item[2], item[3]);
			listValue(q);
		});
		o = profileGrid.taboption('match', form.MultiValue, 'l7', _('Layer-7 protocols'));
		model.info().l7.forEach(function (value) {
			o.value(value, value);
		});
		listValue(o);
		[
			['domains', 'include_domain', _('Included domains'), model.validDomain],
			['domains', 'exclude_domain', _('Excluded domains'), model.validDomain],
			['addresses', 'include_ip', _('Included IP addresses'), model.validIp],
			['addresses', 'exclude_ip', _('Excluded IP addresses'), model.validIp],
		].forEach(function (item) {
			var q = profileGrid.taboption(item[0], form.DynamicList, item[1], item[2]);
			q.validate = validator(
				item[3],
				item[0] === 'domains'
					? _('Enter a domain or ^exact.domain.')
					: _('Enter an IPv4/IPv6 address or CIDR.'),
			);
			listValue(q);
		});
		[
			['domains', 'domain_list', _('Included domain lists'), 'domain'],
			['domains', 'domain_exclude_list', _('Excluded domain lists'), 'domain'],
			['addresses', 'ip_list', _('Included IP lists'), 'ip'],
			['addresses', 'ip_exclude_list', _('Excluded IP lists'), 'ip'],
		].forEach(function (item) {
			var q = profileGrid.taboption(item[0], form.MultiValue, item[1], item[2]);
			var available = lists.filter(function (list) {
				return list.type === item[3];
			});
			if (!available.length) {
				q.value('', _('No local lists available'));
				q.readonly = true;
			}
			available.forEach(function (list) {
				q.value(list.id, list.id);
			});
			listValue(q);
		});
		o = profileGrid.taboption(
			'auto',
			form.Flag,
			'autohostlist',
			_('Enable managed automatic hostlist'),
		);
		o.rmempty = false;
		[
			['auto_fail_threshold', _('Failure threshold'), 'range(1,20)'],
			['auto_fail_time', _('Failure window (seconds)'), 'range(1,86400)'],
			['auto_retrans_threshold', _('Retransmission threshold'), 'range(2,10)'],
			['auto_retrans_maxseq', _('Maximum retransmission sequence'), 'range(1,16777216)'],
			['auto_incoming_maxseq', _('Maximum incoming sequence'), 'range(1,16777216)'],
			['auto_udp_out', _('UDP original-direction packets'), 'range(1,64)'],
			['auto_udp_in', _('UDP reply-direction packets'), 'range(0,64)'],
		].forEach(function (item) {
			var q = profileGrid.taboption('auto', form.Value, item[0], item[1]);
			q.datatype = item[2];
			q.depends('autohostlist', '1');
		});
		o = profileGrid.taboption(
			'auto',
			form.Flag,
			'auto_retrans_reset',
			_('Reset retransmission counter'),
		);
		o.default = '1';
		o.depends('autohostlist', '1');
		o = profileGrid.taboption(
			'auto',
			form.Flag,
			'auto_debug',
			_('Log automatic hostlist decisions'),
		);
		o.depends('autohostlist', '1');
		profileGrid.handleModalSave = function (modalMap, event) {
			return modalSave(this, modalMap, event);
		};
		stepGrid = map.section(form.GridSection, 'step');
		stepGrid.anonymous = true;
		stepGrid.addremove = false;
		stepGrid.sortable = false;
		stepGrid.nodescriptions = true;
		stepGrid.cfgsections = function () {
			return sections('step').map(function (item) {
				return item['.name'];
			});
		};
		stepGrid.render = function () {
			return E([]);
		};
		configureStepOptions(stepGrid);
		var inheritedStepCancel = stepGrid.handleModalCancel;
		stepGrid.handleModalCancel = function (modalMap, event, isSaving) {
			return inheritedStepCancel.apply(this, arguments).then(function () {
				return isSaving ? null : rerender();
			});
		};
		stepGrid.handleModalSave = function (modalMap, event) {
			return modalSave(this, modalMap, event);
		};
		var validation = map.section(form.NamedSection, '_validation');
		validation.anonymous = true;
		validation.render = renderValidation;
		return map.render().then(function (node) {
			node.addEventListener('input', invalidateCandidateStatus, true);
			node.addEventListener('change', invalidateCandidateStatus, true);
			return node;
		});
	},
	handleSave: function () {
		return map.save(validateCandidate);
	},
	handleSaveApply: function (event, mode) {
		return this.handleSave()
			.then(function () {
				return ui.changes.apply(mode === '0');
			})
			.then(function () {
				return api.service('reload');
			})
			.then(function (result) {
				setCandidateStatus(
					'success',
					_('Configuration saved and applied. Zapret2 was reloaded.'),
				);
				return result;
			})
			.catch(function (error) {
				zui.notifyError(error);
				throw error;
			});
	},
});
