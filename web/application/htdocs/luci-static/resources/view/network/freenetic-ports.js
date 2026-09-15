'use strict';
'require view';
'require ui';
'require uci';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Physical port roles are expressed through native DSA device membership:
 * WAN points directly at one switch port, shared LANs use their bridge's
 * `ports` list, and a port with an individual policy receives a small,
 * Freenetic-owned L3 segment. No board-specific port names are hardcoded. */
const ubusCall = rpc.call;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;
const PBR_RESTART_HELPER = '/usr/libexec/freenetic-pbr-restart';
const PORT_PROBE_HELPER = '/usr/libexec/freenetic-port-probe';

function getConfig(config) {
	return ubusCall('uci', 'get', { config: config }).then(result => result.values || {}).catch(() => ({}));
}

function getBuiltinPorts() {
	return ubusCall('luci', 'getBuiltinEthernetPorts').then(result => result.result || []).catch(() => []);
}

function getDeviceStatus() {
	return ubusCall('network.device', 'status').catch(() => ({}));
}

function listValue(value) {
	if (Array.isArray(value))
		return value.slice();
	return value ? String(value).split(/[\s,]+/).filter(Boolean) : [];
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

function sections(config, type) {
	return Object.keys(config || {}).map(key => config[key]).filter(section => section['.type'] === type);
}

function safePortName(port) {
	return String(port || '').replace(/[^A-Za-z0-9_]/g, '_');
}

function portNetwork(port) {
	return 'freenetic_port_' + safePortName(port);
}

function policyHash(value) {
	let hash = 0;
	value = String(value || '');
	for (let i = 0; i < value.length; i++)
		hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
	return hash;
}

/* Keep these names identical to Access & Routing Policy so both pages edit
 * the same rules instead of creating competing policy databases. */
function policyToken(value) {
	const raw = String(value || 'network');
	const safe = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'network';
	return safe + '_' + (policyHash(raw) >>> 0).toString(36);
}

function managedPolicySection(network) {
	return 'freenetic_' + policyToken(network);
}

function managedBlockSection(network) {
	return managedPolicySection(network) + '_block';
}

function isManaged(section, scope) {
	return !!section && section.freenetic_managed === '1' && (!scope || section.freenetic_scope === scope);
}

function isVpnInterface(section) {
	const proto = String(section && section.proto || '').toLowerCase();
	return proto === 'wireguard' || proto === 'amneziawg' || proto === 'openvpn' ||
		proto === 'l2tp' || proto === 'xfrm';
}

function vpnLabel(section) {
	const proto = String(section && section.proto || '').toLowerCase();
	let protocol = 'WireGuard';
	if (section.freenetic_protocol === 'l2tp_ipsec' || proto === 'l2tp') protocol = 'L2TP/IPsec';
	else if (section.freenetic_protocol === 'ikev2' || proto === 'xfrm') protocol = 'IKEv2/IPsec';
	else if (proto === 'amneziawg') protocol = 'AmneziaWG';
	else if (proto === 'openvpn') protocol = 'OpenVPN';
	return (section.label || section.freenetic_name || sectionName(section)) + ' · ' + protocol;
}

function ipv4(value) {
	const parts = String(value || '').split('.');
	return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function ipv4ToUint(address) {
	if (!ipv4(address))
		return null;
	return String(address).split('.').reduce((value, part) =>
		(value * 256 + Number(part)) >>> 0, 0);
}

function prefixFromNetmask(netmask) {
	const value = ipv4ToUint(netmask);
	if (value == null)
		return null;
	let prefix = 0;
	let zeroSeen = false;
	for (let bit = 31; bit >= 0; bit--) {
		const set = (value & (1 << bit)) !== 0;
		if (set && zeroSeen)
			return null;
		if (set)
			prefix++;
		else
			zeroSeen = true;
	}
	return prefix;
}

function ipv4Range(address, netmask) {
	const parts = String(address || '').split('/');
	const ip = ipv4ToUint(parts[0]);
	let prefix = parts.length > 1 ? Number(parts[1]) : prefixFromNetmask(netmask || '255.255.255.0');
	if (ip == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
		return null;
	const size = Math.pow(2, 32 - prefix);
	const start = Math.floor(ip / size) * size;
	return { start: start, end: start + size - 1, prefix: prefix };
}

function rangesOverlap(left, right) {
	return !!left && !!right && left.start <= right.end && right.start <= left.end;
}

function subnet24(address) {
	const range = ipv4Range(address, '255.255.255.0');
	if (!range)
		return null;
	const start = range.start;
	return [ start >>> 24, (start >>> 16) & 255, (start >>> 8) & 255, start & 255 ].join('.') + '/24';
}

function bridgeForName(network, name) {
	return sections(network, 'device').find(device => device.type === 'bridge' && device.name === name);
}

function interfaceForDevice(network, deviceName) {
	return sections(network, 'interface').find(iface => iface.device === deviceName);
}

function assignmentFor(port, network) {
	const wan = network.wan;
	if (wan && wan.device === port)
		return { role: 'wan', network: 'wan' };

	const direct = interfaceForDevice(network, port);
	if (direct) {
		const name = sectionName(direct);
		if (name === portNetwork(port) && isManaged(direct, 'ethernet-port'))
			return { role: 'dedicated', network: name };
		return { role: 'custom', network: name };
	}

	for (const bridge of sections(network, 'device')) {
		if (bridge.type !== 'bridge' || listValue(bridge.ports).indexOf(port) === -1)
			continue;
		const iface = interfaceForDevice(network, bridge.name);
		const name = sectionName(iface);
		if (name === 'lan') return { role: 'lan', network: name };
		if (name === 'guest') return { role: 'guest', network: name };
		return { role: 'custom', network: name || bridge.name };
	}

	return { role: 'none', network: '' };
}

function currentPolicy(networkName, pbr, firewall) {
	const policy = pbr[managedPolicySection(networkName)];
	if (isManaged(policy) && policy.enabled !== '0') {
		if (policy.interface && policy.interface !== 'wan')
			return { mode: 'vpn', vpn: policy.interface };
		return { mode: 'direct', vpn: '' };
	}
	const block = firewall[managedBlockSection(networkName)];
	return isManaged(block) && block.enabled !== '0'
		? { mode: 'block', vpn: '' }
		: { mode: 'direct', vpn: '' };
}

function roleLabel(role) {
	switch (role) {
	case 'wan': return _('Internet (WAN)');
	case 'lan': return _('Home network');
	case 'guest': return _('Guest network');
	case 'dedicated': return _('Separate segment');
	case 'none': return _('Not assigned');
	default: return _('Custom configuration');
	}
}

function wanProtocolLabel(proto) {
	switch (String(proto || '').toLowerCase()) {
	case 'dhcp': return 'DHCP';
	case 'pppoe': return 'PPPoE';
	case 'static': return _('Static IP');
	default: return String(proto || '').toUpperCase() || _('Configured');
	}
}

function probeErrorMessage(result) {
	switch (result && result.error_code) {
	case 'port-assigned':
		return _('Apply the unused port assignment before scanning it.');
	case 'not-found':
		return _('The Ethernet port was not found.');
	case 'invalid-arguments':
	case 'invalid-name':
	case 'not-builtin':
		return _('The Ethernet port cannot be scanned.');
	case 'root-required':
	case 'enable-failed':
	case 'temporary-directory':
		return _('Port scanning is unavailable.');
	default:
		return _('Port scan failed');
	}
}

function portDisplayName(port, index, allPorts) {
	if (port.role === 'wan')
		return _('WAN port');
	const lanPorts = allPorts.filter(item => item.role === 'lan');
	const lanIndex = lanPorts.findIndex(item => item.device === port.device);
	return lanIndex >= 0 ? _('LAN port %d').format(lanIndex + 1) : _('Ethernet port %d').format(index + 1);
}

function setListOrUnset(config, section, option, values) {
	if (values.length)
		uci.set(config, section, option, values);
	else
		uci.unset(config, section, option);
}

return view.extend({
	load() {
		return Promise.all([
			getBuiltinPorts(), getDeviceStatus(), getConfig('network'), getConfig('dhcp'),
			getConfig('firewall'), getConfig('pbr')
		]);
	},

	render(data) {
		this.ports = data[0].filter(port => port && port.device);
		this.deviceStatus = data[1] || {};
		this.network = data[2] || {};
		this.dhcp = data[3] || {};
		this.firewall = data[4] || {};
		this.pbr = data[5] || {};
		this.hasGuest = !!this.network.guest;
		this.vpnInterfaces = sections(this.network, 'interface').filter(section => isVpnInterface(section) && section.disabled !== '1');
		this.pbrConfig = sections(this.pbr, 'pbr').concat(sections(this.pbr, 'config'))[0] || null;
		this.cards = [];

		const wanDevice = this.network.wan && this.network.wan.device;
		this.wanEditable = !wanDevice || this.ports.some(port => port.device === wanDevice);

		this.portSelectors = [];
		const portMap = E('div', { class: 'fn-port-map', role: 'tablist' });
		const editors = E('div', { class: 'fn-port-editors' });
		this.ports.forEach((port, index) => {
			const editor = this.renderPortCard(port, index);
			const record = this.cards[this.cards.length - 1];
			record.editor = editor;
			record.selector = this.renderPortSelector(record, index);
			portMap.appendChild(record.selector);
			editors.appendChild(editor);
		});
		const adaptiveAssistant = this.renderAdaptiveAssistant();
		const save = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary fn-port-save',
			disabled: !this.ports.length || !this.wanEditable ? true : null,
			click: () => this.savePorts(save)
		}, _('Apply port configuration'));

		const notices = [
			E('div', { class: 'fn-oc-notice fn-oc-notice-warning fn-port-warning' }, [
				E('strong', {}, _('A port change can interrupt the connection')),
				E('span', {}, _('All changes are applied together with automatic rollback if this browser cannot confirm the new configuration.'))
			])
		];
		if (!this.wanEditable)
			notices.push(E('div', { class: 'fn-oc-notice fn-oc-notice-warning' }, [
				E('strong', {}, _('WAN uses an advanced device')),
				E('span', {}, _('VLAN or custom WAN devices must be changed on the Internet page before physical ports can be reassigned here.'))
			]));

		return E('div', { class: 'fn-pf-page fn-port-page' }, [
			E('h1', { class: 'fn-pf-title' }, _('Ethernet Ports')),
			E('p', { class: 'fn-pf-description' }, _('Assign physical ports to the Internet, Home network, Guest network, or an independent routed segment. Independent segments can use different traffic policies.')),
			...notices,
			adaptiveAssistant,
			portMap,
			editors,
			E('div', { class: 'fn-port-actions' }, [ save ])
		]);
	},

	renderPortSelector(card, index) {
		const contacts = [];
		for (let i = 0; i < 6; i++)
			contacts.push(E('i'));
		card.roleText = E('span', { class: 'fn-port-map-role' }, roleLabel(card.role.value));
		card.selectorWanBadge = E('span', { class: 'fn-port-wan-badge', hidden: card.role.value === 'wan' ? null : true }, 'WAN');
		const button = E('button', {
			type: 'button',
			class: 'fn-port-selector' + (index === 0 ? ' fn-active' : '') +
				(card.connected ? ' fn-connected' : '') + (card.role.value === 'wan' ? ' fn-port-wan' : ''),
			role: 'tab',
			'aria-selected': index === 0 ? 'true' : 'false',
			click: () => this.selectPort(index)
		}, [
			E('span', { class: 'fn-port-map-jack', 'aria-hidden': 'true' }, contacts),
			E('span', { class: 'fn-port-map-copy' }, [
				E('span', { class: 'fn-port-map-name' }, [ E('strong', {}, card.displayName), card.selectorWanBadge ]),
				card.roleText
			]),
			E('span', { class: 'fn-port-map-link' }, card.connected ? (card.status.speed || _('Connected')) : _('No link'))
		]);
		this.portSelectors.push(button);
		card.selector = button;
		this.syncPortVisual(card);
		return button;
	},

	syncPortVisual(card) {
		const isWan = card.role.value === 'wan';
		if (card.selector) card.selector.classList.toggle('fn-port-wan', isWan);
		if (card.editor) card.editor.classList.toggle('fn-port-wan', isWan);
		if (card.selectorWanBadge) card.selectorWanBadge.hidden = !isWan;
		if (card.editorWanBadge) card.editorWanBadge.hidden = !isWan;
		if (card.roleText) card.roleText.textContent = roleLabel(card.role.value);
	},

	selectPort(index) {
		this.cards.forEach((card, cardIndex) => {
			const active = cardIndex === index;
			card.editor.hidden = !active;
			card.selector.classList.toggle('fn-active', active);
			card.selector.setAttribute('aria-selected', active ? 'true' : 'false');
		});
	},

	renderPortCard(port, index) {
		const assignment = assignmentFor(port.device, this.network);
		const status = this.deviceStatus[port.device] || {};
		const connected = !!status.carrier;
		const locked = assignment.role === 'custom';
		const displayName = portDisplayName(port, index, this.ports);
		const role = E('select', { class: 'fn-input fn-port-role', disabled: locked ? true : null }, [
			E('option', { value: 'lan' }, _('Home network (LAN)')),
			E('option', { value: 'wan' }, _('Internet (WAN)')),
			E('option', { value: 'guest', disabled: !this.hasGuest && assignment.role !== 'guest' ? true : null }, _('Guest network')),
			E('option', { value: 'dedicated' }, _('Separate segment')),
			E('option', { value: 'none' }, _('Not assigned'))
		]);
		if (locked)
			role.appendChild(E('option', { value: 'custom' }, _('Custom configuration')));
		role.value = assignment.role;

		const name = portNetwork(port.device);
		const existing = this.network[name] || {};
		const defaultAddress = '192.168.' + (10 + index) + '.1';
		const address = String(Array.isArray(existing.ipaddr) ? existing.ipaddr[0] : existing.ipaddr || defaultAddress).split('/')[0];
		const addressInput = E('input', { type: 'text', class: 'fn-input', value: address, placeholder: defaultAddress });
		const policy = currentPolicy(name, this.pbr, this.firewall);
		const policySelect = E('select', { class: 'fn-input fn-port-policy' }, [
			E('option', { value: 'direct' }, _('Direct (WAN)')),
			E('option', { value: 'vpn', disabled: !this.pbrConfig || !this.vpnInterfaces.length ? true : null }, _('VPN tunnel')),
			E('option', { value: 'block' }, _('Block Internet'))
		]);
		policySelect.value = policy.mode;
		const vpnSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: '' }, this.vpnInterfaces.length ? _('Select a VPN connection') : _('No VPN connections configured')),
			...this.vpnInterfaces.map(section => E('option', { value: sectionName(section) }, vpnLabel(section)))
		]);
		vpnSelect.value = this.vpnInterfaces.some(section => sectionName(section) === policy.vpn)
			? policy.vpn : (this.vpnInterfaces[0] && sectionName(this.vpnInterfaces[0]) || '');

		const dedicated = E('div', { class: 'fn-port-dedicated' }, [
			E('div', { class: 'fn-settings-field' }, [
				E('label', {}, _('Router address (/24)')),
				addressInput
			]),
			E('div', { class: 'fn-settings-field' }, [
				E('label', {}, _('Traffic policy')),
				policySelect
			]),
			E('div', { class: 'fn-settings-field fn-port-vpn-field' }, [
				E('label', {}, _('VPN connection')),
				vpnSelect
			])
		]);
		const hint = E('p', { class: 'fn-port-role-hint' });
		const wanBadge = E('span', { class: 'fn-port-wan-badge', hidden: assignment.role === 'wan' ? null : true }, 'WAN');
		const cardData = { port, index, role, originalRole: assignment.role, connected, status, locked, displayName,
			addressInput, policySelect, vpnSelect, editorWanBadge: wanBadge };
		const update = () => {
			dedicated.hidden = role.value !== 'dedicated';
			dedicated.querySelector('.fn-port-vpn-field').hidden = policySelect.value !== 'vpn';
			if (role.value === 'dedicated')
				hint.textContent = _('This port gets its own IPv4 subnet, DHCP server, firewall zone, and traffic policy. Router access is limited to DHCP and DNS by default.');
			else if (role.value === 'lan' || role.value === 'guest')
				hint.textContent = _('This port shares the selected network and inherits that network’s traffic policy.');
			else if (role.value === 'wan')
				hint.textContent = _('This becomes the physical Internet uplink for WAN and WAN6.');
			else if (role.value === 'custom')
				hint.textContent = _('This port belongs to a configuration not managed by Freenetic.');
			else
				hint.textContent = _('The physical port stays unused.');
			this.syncPortVisual(cardData);
		};
		role.addEventListener('change', update);
		policySelect.addEventListener('change', update);
		update();

		const card = E('article', { class: 'fn-card fn-port-card' + (connected ? ' fn-port-connected' : '') +
			(assignment.role === 'wan' ? ' fn-port-wan' : ''), hidden: index === 0 ? null : true }, [
			E('div', { class: 'fn-card-head fn-port-card-head' }, [
				E('div', { class: 'fn-port-title' }, [
					E('span', { class: 'fn-port-jack', 'aria-hidden': 'true' }, '▥'),
					E('div', {}, [
						E('h3', {}, displayName),
						E('span', {}, port.device)
					])
				]),
				E('div', { class: 'fn-port-card-status' }, [
					wanBadge,
					E('span', { class: 'fn-status-pill ' + (connected ? 'fn-status-ok' : 'fn-status-off') },
						connected ? (status.speed || _('Connected')) : _('No link'))
				])
			]),
			E('div', { class: 'fn-card-body' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Port role')), role ]),
				hint,
				locked ? E('div', { class: 'fn-wifi-policy-warning' }, _('Custom port assignments are shown read-only to protect settings created outside Freenetic.')) : E([]),
				dedicated
			])
		]);

		this.cards.push(cardData);
		return card;
	},

	renderAdaptiveAssistant() {
		const currentWan = this.cards.find(card => card.role.value === 'wan');
		const protocol = wanProtocolLabel(this.network.wan && this.network.wan.proto);
		this.adaptiveResults = E('div', { class: 'fn-port-adaptive-results' }, [
			E('div', { class: 'fn-port-adaptive-current' }, [
				E('span', { class: 'fn-port-wan-badge' }, 'WAN'),
				E('strong', {}, currentWan ? currentWan.displayName : _('Advanced WAN device')),
				E('span', {}, protocol)
			])
		]);
		const scan = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-port-adaptive-scan',
			click: () => this.scanAdaptivePorts(scan)
		}, _('Scan unassigned ports'));
		this.adaptiveScanButton = scan;

		const panel = E('section', { class: 'fn-port-adaptive' }, [
			E('div', { class: 'fn-port-adaptive-icon', 'aria-hidden': 'true' }, '↯'),
			E('div', { class: 'fn-port-adaptive-copy' }, [
				E('div', { class: 'fn-port-adaptive-heading' }, [
					E('h2', {}, _('Adaptive port detection')),
					E('span', { class: 'fn-port-adaptive-safety' }, _('Confirmation required'))
				]),
				E('p', {}, _('Freenetic can safely check connected, unassigned ports for DHCP and PPPoE. A detected service is shown as a recommendation and is never applied automatically.')),
				this.adaptiveResults
			]),
			scan
		]);
		this.adaptivePanel = panel;

		if (this.adaptiveCandidates().length)
			window.setTimeout(() => this.scanAdaptivePorts(scan), 0);
		else
			this.adaptiveResults.appendChild(E('span', { class: 'fn-port-adaptive-empty' }, _('No connected unassigned ports to scan.')));
		return panel;
	},

	adaptiveCandidates() {
		return this.cards.filter(card => !card.locked && card.connected && card.role.value === 'none');
	},

	scanAdaptivePorts(button) {
		const candidates = this.adaptiveCandidates();
		if (!candidates.length) {
			notify(_('Only connected ports assigned as unused can be scanned safely.'), 'info');
			return Promise.resolve();
		}

		button.disabled = true;
		button.textContent = _('Scanning…');
		this.adaptivePanel.classList.add('fn-port-adaptive-scanning');
		return Promise.all(candidates.map(card =>
			fs.exec_direct(PORT_PROBE_HELPER, [ card.port.device ], 'json')
				.then(result => ({ card, result: result || {} }))
				.catch(error => ({ card, result: { ok: false, error: error.message || String(error) } }))
		)).then(results => {
			this.renderAdaptiveResults(results);
		}).finally(() => {
			button.disabled = false;
			button.textContent = _('Scan again');
			this.adaptivePanel.classList.remove('fn-port-adaptive-scanning');
		});
	},

	renderAdaptiveResults(results) {
		const current = this.adaptiveResults.querySelector('.fn-port-adaptive-current');
		this.adaptiveResults.replaceChildren(current);
		results.forEach(({ card, result }) => {
			const detected = result.ok && (result.protocol === 'dhcp' || result.protocol === 'pppoe');
			const protocol = result.protocol === 'dhcp' ? 'DHCP' : (result.protocol === 'pppoe' ? 'PPPoE' : '');
			let message;
			if (detected)
				message = _('%s detected').format(protocol);
			else if (result.ok && result.link === false)
				message = _('Cable disconnected during the scan');
			else if (result.ok)
				message = _('No Internet service detected');
			else
				message = probeErrorMessage(result);

			const row = E('div', { class: 'fn-port-adaptive-result' + (detected ? ' fn-port-adaptive-found' : '') }, [
				E('span', { class: 'fn-port-adaptive-result-dot', 'aria-hidden': 'true' }),
				E('strong', {}, card.displayName),
				E('span', {}, message)
			]);
			if (detected)
				row.appendChild(E('button', {
					type: 'button', class: 'fn-settings-btn',
					click: () => this.stageWanRecommendation(card)
				}, _('Use as WAN')));
			this.adaptiveResults.appendChild(row);
		});
	},

	stageWanRecommendation(card) {
		const current = this.cards.find(item => item !== card && item.role.value === 'wan');
		if (!window.confirm(_('Stage %s as WAN and leave the current WAN port unassigned? No network changes occur until you apply the configuration.').format(card.displayName)))
			return;
		if (current) {
			current.role.value = 'none';
			current.role.dispatchEvent(new Event('change'));
		}
		card.role.value = 'wan';
		card.role.dispatchEvent(new Event('change'));
		this.selectPort(card.index);
		notify(_('WAN recommendation staged. Review it and apply the port configuration to continue.'), 'info');
	},

	ensureBridge(deviceName, suggestedSection) {
		let bridge = uci.sections('network', 'device').find(section => section.type === 'bridge' && section.name === deviceName);
		if (!bridge) {
			const name = uci.add('network', 'device', suggestedSection);
			uci.set('network', name, 'name', deviceName);
			uci.set('network', name, 'type', 'bridge');
			uci.set('network', name, 'freenetic_managed', '1');
			bridge = uci.get('network', name);
		}
		return sectionName(bridge);
	},

	sharedBridge(networkName, fallbackDevice, suggestedSection) {
		const attached = uci.get('network', networkName, 'device');
		const bridge = uci.sections('network', 'device').find(section =>
			section.type === 'bridge' && section.name === attached);
		if (bridge)
			return sectionName(bridge);
		if (attached && attached !== fallbackDevice)
			throw new Error(_('%s uses the non-bridge device %s and cannot be edited safely here.').format(networkName, attached));
		const created = this.ensureBridge(fallbackDevice, suggestedSection);
		if (!attached)
			uci.set('network', networkName, 'device', fallbackDevice);
		return created;
	},

	updateWanDevices(wanPort) {
		const oldWanPort = uci.get('network', 'wan', 'device');
		const oldWan6Port = uci.get('network', 'wan6', 'device');
		uci.set('network', 'wan', 'device', wanPort);
		if (uci.get('network', 'wan6') && oldWan6Port === oldWanPort)
			uci.set('network', 'wan6', 'device', wanPort);
	},

	removeManagedPortSegment(port) {
		const networkName = portNetwork(port);
		const remove = (config, name, scope) => {
			const section = uci.get(config, name);
			if (section && isManaged(section, scope))
				uci.remove(config, name);
		};
		remove('network', networkName, 'ethernet-port');
		remove('dhcp', networkName, 'ethernet-port');
		remove('firewall', networkName, 'ethernet-port');
		remove('firewall', networkName + '_wan', 'ethernet-port');
		remove('firewall', networkName + '_dhcp', 'ethernet-port');
		remove('firewall', networkName + '_dns', 'ethernet-port');
		if (this.pbrConfig)
			remove('pbr', managedPolicySection(networkName));
		remove('firewall', managedBlockSection(networkName));
	},

	createRouterServiceRule(networkName, suffix, label, destinationPort, protocols) {
		const ruleName = networkName + '_' + suffix;
		uci.add('firewall', 'rule', ruleName);
		uci.set('firewall', ruleName, 'name', label);
		uci.set('firewall', ruleName, 'src', networkName);
		uci.set('firewall', ruleName, 'dest_port', destinationPort);
		uci.set('firewall', ruleName, 'proto', protocols);
		uci.set('firewall', ruleName, 'target', 'ACCEPT');
		uci.set('firewall', ruleName, 'family', 'ipv4');
		uci.set('firewall', ruleName, 'freenetic_managed', '1');
		uci.set('firewall', ruleName, 'freenetic_scope', 'ethernet-port');
	},

	createPortSegment(card) {
		const networkName = portNetwork(card.port.device);
		const address = card.addressInput.value.trim();
		uci.add('network', 'interface', networkName);
		uci.set('network', networkName, 'device', card.port.device);
		uci.set('network', networkName, 'proto', 'static');
		uci.set('network', networkName, 'ipaddr', address);
		uci.set('network', networkName, 'netmask', '255.255.255.0');
		uci.set('network', networkName, 'label', _('Port %s').format(card.port.device));
		uci.set('network', networkName, 'freenetic_managed', '1');
		uci.set('network', networkName, 'freenetic_scope', 'ethernet-port');
		uci.set('network', networkName, 'freenetic_port', card.port.device);

		uci.add('dhcp', 'dhcp', networkName);
		uci.set('dhcp', networkName, 'interface', networkName);
		uci.set('dhcp', networkName, 'start', '100');
		uci.set('dhcp', networkName, 'limit', '150');
		uci.set('dhcp', networkName, 'leasetime', '12h');
		uci.set('dhcp', networkName, 'freenetic_managed', '1');
		uci.set('dhcp', networkName, 'freenetic_scope', 'ethernet-port');

		uci.add('firewall', 'zone', networkName);
		uci.set('firewall', networkName, 'name', networkName);
		uci.set('firewall', networkName, 'network', [ networkName ]);
		/* A separate segment is safe for untrusted/IoT devices by default:
		 * clients can obtain an address and resolve names, but cannot reach
		 * LuCI, SSH or other services listening on the router itself. */
		uci.set('firewall', networkName, 'input', 'REJECT');
		uci.set('firewall', networkName, 'output', 'ACCEPT');
		uci.set('firewall', networkName, 'forward', 'REJECT');
		uci.set('firewall', networkName, 'freenetic_managed', '1');
		uci.set('firewall', networkName, 'freenetic_scope', 'ethernet-port');
		this.createRouterServiceRule(networkName, 'dhcp',
			'Freenetic — Allow DHCP from ' + networkName.replace('freenetic_port_', ''),
			'67', 'udp');
		this.createRouterServiceRule(networkName, 'dns',
			'Freenetic — Allow DNS from ' + networkName.replace('freenetic_port_', ''),
			'53', [ 'tcp', 'udp' ]);

		uci.add('firewall', 'forwarding', networkName + '_wan');
		uci.set('firewall', networkName + '_wan', 'src', networkName);
		uci.set('firewall', networkName + '_wan', 'dest', 'wan');
		uci.set('firewall', networkName + '_wan', 'freenetic_managed', '1');
		uci.set('firewall', networkName + '_wan', 'freenetic_scope', 'ethernet-port');

		this.applyPortPolicy(networkName, subnet24(address), card.policySelect.value, card.vpnSelect.value);
	},

	applyPortPolicy(networkName, cidr, mode, vpnInterface) {
		const pbrName = managedPolicySection(networkName);
		const blockName = managedBlockSection(networkName);
		const oldPbr = uci.get('pbr', pbrName);
		const oldBlock = uci.get('firewall', blockName);
		if (oldPbr && isManaged(oldPbr)) uci.remove('pbr', pbrName);
		if (oldBlock && isManaged(oldBlock)) uci.remove('firewall', blockName);

		if (mode === 'vpn') {
			uci.add('pbr', 'policy', pbrName);
			uci.set('pbr', pbrName, 'name', 'Freenetic — Port ' + networkName.replace('freenetic_port_', ''));
			uci.set('pbr', pbrName, 'interface', vpnInterface);
			uci.set('pbr', pbrName, 'src_addr', cidr);
			uci.set('pbr', pbrName, 'enabled', '1');
			uci.set('pbr', pbrName, 'freenetic_managed', '1');
			uci.set('pbr', pbrName, 'freenetic_scope', 'network');
			uci.set('pbr', pbrName, 'freenetic_network', networkName);
		}
		else if (mode === 'block') {
			uci.add('firewall', 'rule', blockName);
			uci.set('firewall', blockName, 'name', 'Freenetic — Block Internet from ' + networkName.replace('freenetic_port_', ''));
			uci.set('firewall', blockName, 'src', networkName);
			uci.set('firewall', blockName, 'dest', 'wan');
			uci.set('firewall', blockName, 'target', 'REJECT');
			uci.set('firewall', blockName, 'enabled', '1');
			uci.set('firewall', blockName, 'freenetic_managed', '1');
			uci.set('firewall', blockName, 'freenetic_scope', 'network');
			uci.set('firewall', blockName, 'freenetic_network', networkName);
		}
	},

	updatePbrState() {
		if (!this.pbrConfig)
			return;
		const configName = sectionName(this.pbrConfig);
		const managed = uci.sections('pbr', 'policy').some(section => isManaged(section) && section.enabled !== '0');
		const anyEnabled = uci.sections('pbr', 'policy').some(section => section.enabled !== '0');
		if (managed) {
			uci.set('pbr', configName, 'enabled', '1');
			uci.set('pbr', configName, 'freenetic_managed', '1');
		}
		else if (uci.get('pbr', configName, 'freenetic_managed') === '1' && !anyEnabled) {
			uci.set('pbr', configName, 'enabled', '0');
			uci.unset('pbr', configName, 'freenetic_managed');
		}
	},

	restartPbr() {
		if (!this.pbrConfig)
			return Promise.resolve(null);
		return fs.exec_direct(PBR_RESTART_HELPER, [], 'json').then(result => {
			if (!result || result.ok !== true || result.installed === false)
				throw new Error(_('The policy routing service did not restart.'));
			return result;
		});
	},

	validate() {
		const wanCards = this.cards.filter(card => card.role.value === 'wan');
		if (wanCards.length !== 1)
			return _('Exactly one physical port must be assigned to Internet (WAN).');

		const usedSubnets = [];
		for (const section of sections(this.network, 'interface')) {
			const name = sectionName(section);
			if (name && name.indexOf('freenetic_port_') === 0)
				continue;
			const addresses = listValue(section.ipaddr);
			addresses.forEach(address => {
				const range = ipv4Range(address, section.netmask);
				if (range)
					usedSubnets.push(range);
			});
		}

		for (const card of this.cards) {
			if (card.locked || card.role.value !== 'dedicated')
				continue;
			const address = card.addressInput.value.trim();
			const cidr = subnet24(address);
			const range = ipv4Range(address, '255.255.255.0');
			const networkName = portNetwork(card.port.device);
			for (const collision of [
				[ this.network[networkName], 'ethernet-port' ],
				[ this.dhcp[networkName], 'ethernet-port' ],
				[ this.firewall[networkName], 'ethernet-port' ],
				[ this.firewall[networkName + '_wan'], 'ethernet-port' ],
				[ this.firewall[networkName + '_dhcp'], 'ethernet-port' ],
				[ this.firewall[networkName + '_dns'], 'ethernet-port' ],
				[ this.firewall[managedBlockSection(networkName)], null ],
				[ this.pbr[managedPolicySection(networkName)], null ]
			]) {
				if (collision[0] && !isManaged(collision[0], collision[1]))
					return _('A configuration section required by %s is already managed outside Freenetic.').format(card.port.device);
			}
			if (!cidr || !/\.1$/.test(address))
				return _('The router address for %s must be a valid IPv4 address ending in .1.').format(card.port.device);
			if (usedSubnets.some(existing => rangesOverlap(existing, range)))
				return _('The subnet %s is already used by another network.').format(cidr);
			usedSubnets.push(range);
			if (card.policySelect.value === 'vpn' && (!this.pbrConfig || !card.vpnSelect.value))
				return _('Install Policy-based routing and configure a VPN connection first.');
		}
		return null;
	},

	savePorts(button) {
		const error = this.validate();
		if (error) {
			notify(error, 'warning');
			return;
		}
		const changedConnected = this.cards.filter(card => card.connected && card.role.value !== card.originalRole);
		if (changedConnected.length && !window.confirm(_('You are changing an active Ethernet port. The connection may drop and the configuration will roll back automatically if it cannot be confirmed. Continue?')))
			return;

		button.disabled = true;
		const configs = [ 'network', 'dhcp', 'firewall' ];
		if (this.pbrConfig)
			configs.push('pbr');
		return uci.load(configs).then(() => {
			const builtin = this.cards.map(card => card.port.device);
			const lanBridge = this.sharedBridge('lan', 'br-lan', 'freenetic_br_lan');
			const guestBridge = this.hasGuest ? this.sharedBridge('guest', 'br-guest', 'freenetic_br_guest') : null;

			/* Remove built-in ports only from the shared bridges we manage here.
			 * Custom bridge membership is locked in the UI and remains untouched. */
			[ lanBridge, guestBridge ].filter(Boolean).forEach(bridge => {
				const kept = listValue(uci.get('network', bridge, 'ports')).filter(port => builtin.indexOf(port) === -1);
				setListOrUnset('network', bridge, 'ports', kept);
			});
			this.cards.forEach(card => this.removeManagedPortSegment(card.port.device));

			const wanPort = this.cards.find(card => card.role.value === 'wan').port.device;
			this.updateWanDevices(wanPort);

			const lanPorts = this.cards.filter(card => !card.locked && card.role.value === 'lan').map(card => card.port.device);
			const oldLanPorts = listValue(uci.get('network', lanBridge, 'ports'));
			setListOrUnset('network', lanBridge, 'ports', oldLanPorts.concat(lanPorts));

			if (guestBridge) {
				const guestPorts = this.cards.filter(card => !card.locked && card.role.value === 'guest').map(card => card.port.device);
				const oldGuestPorts = listValue(uci.get('network', guestBridge, 'ports'));
				setListOrUnset('network', guestBridge, 'ports', oldGuestPorts.concat(guestPorts));
			}
			this.cards.filter(card => !card.locked && card.role.value === 'dedicated').forEach(card => this.createPortSegment(card));
			this.updatePbrState();
			return uci.save();
		}).then(() => applyChanges(30)).then(() => this.restartPbr()).then(() => {
			notify(_('Ethernet port configuration applied.'), 'info');
			window.setTimeout(() => window.location.reload(), 900);
		}).catch(error => {
			notify(_('Failed to apply Ethernet port configuration: %s').format(error.message || error), 'danger');
			button.disabled = false;
		});
	},

	addFooter() { return E([]); }
});
