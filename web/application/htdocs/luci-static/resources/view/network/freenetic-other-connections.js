'use strict';
'require view';
'require ui';
'require uci';
'require fs';
'require freenetic-network as networkHelper';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';
'require freenetic-connections-core as connectionCore';

/*
 * Other Connections is intentionally a small editor over OpenWrt's native
 * network UCI model.  WireGuard, AmneziaWG and OpenVPN are native netifd
 * protocols; AWG options are never written to a regular wireguard section,
 * while OpenVPN profiles stay as provider-supplied files.  This keeps
 * configurations usable from stock LuCI and makes optional packages explicit
 * capabilities instead of hidden runtime dependencies.
 */
const ubusCall = rpc.call;
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const notifyLong = uiHelper.notifyLong;
const applyChanges = uiHelper.applyChanges;

const { NETWORK_RESTART_HELPER, WG_PROTO, AWG_PROTO, OVPN_PROTO, L2TP_PROTO, XFRM_PROTO, L2TP_IPSEC_PROTO, IKEV2_PROTO, WG_PEER_TYPE, AWG_PEER_TYPE, IPSEC_CONFIG, IPSEC_GLOBALS, OPENVPN_PROFILE_DIR, OPENVPN_PROFILE_HELPER, OPENVPN_PROFILE_MAX, IPSEC_RESTART_HELPER, IPSEC_STATUS_HELPER, L2TP_IPSEC_PACKAGES, IKEV2_PACKAGES, OPENVPN_VARIANTS, AWG_OPTIONS, EDITED_PEER_OPTIONS, KEY_RE, IPV4_RE, HOST_RE, advancedPeerOptions, restartNetifd, restartIpsec, listValue, listText, parseList, sectionName, sectionToken, managedIpsecSection, ipsecSection, ipsecList, validSecret, validSelector, validServer, ipsecProtocolLabel, validKey, validIPv4, validAddress, validHost, validPort, validNumber, formatBytes, formatAge, shortKey, svgIcon, getInterfaceDump, normalizeDumpStatus, getWireGuardStatus, normalizeKeyPair, generateKeyPair, derivePublicKey, generatePresharedKey, getInstalledPackages, openvpnAvailable, openvpnProfileName, openvpnProfilePath, managedOpenvpnProfile, openvpnProfileNameFromPath, normalizeOpenvpnProfile, validateOpenvpnProfile, storeOpenvpnProfile, removeOpenvpnProfile, getFeedStatus, getIpsecStatus, packageMap, peerType, peerSectionsFor, parseEndpoint, parseConfig, endpointText, serializeConfig } = connectionCore;

'require freenetic-connections-wireguard as wireguardView';
'require freenetic-connections-openvpn as openvpnView';
'require freenetic-connections-ipsec as ipsecView';

return view.extend(Object.assign({
	load() {
		return Promise.all([
			uci.load('network'),
			getInterfaceDump(),
			getWireGuardStatus(),
			getInstalledPackages(),
			getFeedStatus(),
			uci.load(IPSEC_CONFIG).catch(() => null),
			getIpsecStatus()
		]);
	},

	render(data) {
		window.__freeneticActiveView = this;
		this.interfaceDump = data[1] || {};
		this.wgRpc = data[2] || { available: false, data: {} };
		this.packages = packageMap(data[3]);
		this.feed = data[4];
		this.ipsecAvailable = data[5] !== null;
		this.ipsecStatus = data[6] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
		this.modalOpen = false;

		this.supportNode = E('div');
		this.listNode = E('div');
		this.renderSupport();
		this.fillConnections();
		this.startIpsecPolling();

		return E('div', { class: 'fn-pf-page fn-oc-page' }, [
			E('div', {}, [
				E('h1', { class: 'fn-pf-title' }, _('Other Connections')),
				E('p', { class: 'fn-pf-description' }, _('Manage additional VPN and tunnel connections through the OpenWrt network stack.'))
			]),
			this.supportNode,
			E('section', { class: 'fn-oc-connections' }, [ this.listNode ])
		]);
	},

	renderSupport() {
		if (!this.supportNode)
			return;
		dom_empty(this.supportNode);
		const wgTools = !!this.packages['wireguard-tools'];
		const wgKernel = !!this.packages['kmod-wireguard'];
		const wgReady = wgTools && wgKernel;
		const awgInstalled = this.awgAvailable();
		const cards = [];
		const addSupportCard = (className, title, description, statusText, statusClass, body) => {
			cards.push(E('section', { class: 'fn-oc-support-card ' + className }, [
				E('div', { class: 'fn-oc-support-head' }, [
					E('div', { class: 'fn-oc-support-title' }, [
						E('h2', {}, title),
						E('p', {}, description)
					]),
					E('span', { class: 'fn-status-pill ' + statusClass }, statusText)
				]),
				E('div', { class: 'fn-oc-support-panel' }, [
					E('div', { class: 'fn-oc-support-body' }, body)
				])
			]));
		};
		const supportButton = (label, click, primary = false) => E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-oc-support-action' + (primary ? ' fn-settings-btn-primary' : ''),
			click: click
		}, label);
		const supportActions = actions => E('div', { class: 'fn-oc-support-actions' }, actions);
		const applicationAction = () => E('a', {
			href: L.url('admin/system/applications'),
			class: 'fn-settings-btn fn-oc-support-action'
		}, _('Open Applications'));
		const wgMissing = [];
		if (!wgTools) wgMissing.push('wireguard-tools');
		if (!wgKernel) wgMissing.push('kmod-wireguard');
		const wgBody = [ E('span', {}, wgReady
			? _('Native OpenWrt kernel protocol is ready.')
			: _('Required package(s) are missing: %s.').format(wgMissing.join(', '))) ];
		if (wgReady)
			wgBody.push(supportActions([
				supportButton(_('Add WireGuard connection'), () => this.openNativeForm(WG_PROTO), true),
				supportButton(_('Import configuration'), () => this.openImportDialog())
			]));
		else
			wgBody.push(supportActions([ applicationAction() ]));
		addSupportCard('fn-oc-support-card-wireguard', _('WireGuard'),
			_('Standard kernel-based VPN protocol'),
			wgReady ? _('Ready') : _('Unavailable'),
			wgReady ? 'fn-status-ok' : 'fn-status-off', wgBody);

		const ovpnReady = openvpnAvailable(this.packages);
		const ovpnBody = [ E('span', {}, ovpnReady
			? _('OpenVPN netifd protocol is ready.')
			: _('Install an OpenVPN package to create or start an OpenVPN tunnel.')) ];
		if (ovpnReady)
			ovpnBody.push(supportActions([
				supportButton(_('Add OpenVPN connection'), () => this.openOpenvpnForm(null), true),
				supportButton(_('Import OpenVPN profile'), () => this.openOpenvpnImportDialog())
			]));
		else
			ovpnBody.push(supportActions([ applicationAction() ]));
		addSupportCard('fn-oc-support-card-openvpn', _('OpenVPN'),
			_('Profile-based VPN protocol with broad provider support'),
			ovpnReady ? _('Ready') : _('Unavailable'),
			ovpnReady ? 'fn-status-ok' : 'fn-status-off', ovpnBody);

		let feedText = awgInstalled
			? _('AWG parameters are available in the connection editor.')
			: _('Optional WireGuard-compatible obfuscation with AmneziaWG parameters.');
		if (!awgInstalled && this.feed && this.feed.ok !== false && this.feed.feed_url) {
			feedText = this.feed.configured
				? _('Signed feed for %s/%s is configured, but AmneziaWG packages are not installed.').format(this.feed.target, this.feed.subtarget)
				: _('The signed AmneziaWG feed targets %s/%s. Connect it to verify and install matching packages.').format(this.feed.target, this.feed.subtarget);
			if (this.feed.version === 'SNAPSHOT')
				feedText += ' ' + _('SNAPSHOT builds may not have a matching kernel package.');
		}
		const awgBody = [ E('span', {}, feedText) ];
		if (awgInstalled)
			awgBody.push(supportActions([
				supportButton(_('Add AmneziaWG connection'), () => this.openNativeForm(AWG_PROTO), true)
			]));
		else {
			const install = supportButton(_('Connect feed and install'), () => this.installAwg(install), true);
			awgBody.push(supportActions([ install ]));
		}
		addSupportCard('fn-oc-support-card-awg', _('AmneziaWG'),
			_('WireGuard-compatible protocol with AWG obfuscation'),
			awgInstalled ? _('Ready') : _('Optional'),
			awgInstalled ? 'fn-status-ok' : 'fn-status-off', awgBody);

		const addPackageCard = (className, title, description, packages, readyText, actionLabel, action) => {
			const missing = packages.filter(name => !this.packages[name]);
			const ready = !missing.length;
			const body = [ E('span', {}, ready
				? readyText
				: _('Required package(s) are missing: %s.').format(missing.join(', '))) ];
			if (ready)
				body.push(supportActions([ supportButton(actionLabel, action, true) ]));
			else
				body.push(supportActions([ applicationAction() ]));
			addSupportCard(className, title, description,
				ready ? _('Ready') : _('Unavailable'),
				ready ? 'fn-status-ok' : 'fn-status-off', body);
		};

		addPackageCard('fn-oc-support-card-l2tp', _('L2TP/IPsec'),
			_('Legacy PPP tunnel protected by an IPsec transport connection.'),
			L2TP_IPSEC_PACKAGES, _('xl2tpd and strongSwan are ready.'),
			_('Add L2TP/IPsec connection'), () => this.openL2tpForm(null));
		addPackageCard('fn-oc-support-card-ikev2', _('IKEv2/IPsec'),
			_('Modern IPsec VPN with PSK or EAP-MSCHAPv2 authentication.'),
			IKEV2_PACKAGES, _('strongSwan and the XFRM interface are ready.'),
			_('Add IKEv2/IPsec connection'), () => this.openIkev2Form(null));

		this.supportNode.appendChild(E('div', { class: 'fn-oc-support-grid' }, cards));
	},

	/* The helper reports a complete installation, but also recognize a
	 * manually-installed package set when the helper is unavailable or its
	 * state is stale.  A partial set is not enough: the kernel module, tools,
	 * and LuCI/netifd protocol must all be present before an AWG interface can
	 * be activated. */

	awgAvailable() {
		const packages = this.packages || {};
		return !!(this.feed && this.feed.installed) ||
			(!!packages['amneziawg-tools'] && !!packages['kmod-amneziawg'] && !!packages['luci-proto-amneziawg']);
	},

	getConnections() {
		return uci.sections('network', 'interface').filter(section => {
			const proto = String(section.proto || '').toLowerCase();
			return proto === WG_PROTO || proto === AWG_PROTO || proto === OVPN_PROTO ||
				(proto === L2TP_PROTO && section.freenetic_protocol === L2TP_IPSEC_PROTO) ||
				(proto === XFRM_PROTO && section.freenetic_protocol === IKEV2_PROTO);
		}).map(section => {
			const protocol = String(section.proto || '').toLowerCase();
			if (protocol === OVPN_PROTO)
				return this.getOpenvpnConnection(section);
			if (protocol === L2TP_PROTO)
				return this.getL2tpConnection(section);
			if (protocol === XFRM_PROTO)
				return this.getIkev2Connection(section);
			return this.getWireguardConnection(section);
		});
	},

	interfaceStatus(name) {
		return (this.interfaceDump.interface || []).find(item => item.interface === name || item.l3_device === name) || null;
	},

	wgStatus(name) {
		return this.wgRpc && this.wgRpc.data && this.wgRpc.data[name] || null;
	},

	fillConnections() {
		if (!this.listNode)
			return;
		dom_empty(this.listNode);
		const connections = this.getConnections();
		if (!connections.length)
			return;
		connections.forEach(connection => this.listNode.appendChild(this.renderConnection(connection)));
	},

	openNativeForm(protocol) {
		return this.openForm({
			section: null,
			name: _('New VPN connection'),
			protocol: protocol,
			enabled: true,
			privateKey: '',
			publicKey: '',
			addresses: [],
			dns: [],
			listenPort: '',
			mtu: '1420',
			fwmark: '',
			nohostroute: false,
			awg: {},
			peers: []
		});
	},

	openAddConnection() {
		if (this.modalOpen)
			ui.hideModal();
		const protocol = E('select', { class: 'fn-input' }, [
			E('option', { value: WG_PROTO }, _('WireGuard')),
			E('option', { value: AWG_PROTO }, _('AmneziaWG')),
			E('option', { value: OVPN_PROTO }, _('OpenVPN')),
			E('option', { value: L2TP_IPSEC_PROTO }, _('L2TP/IPsec')),
			E('option', { value: IKEV2_PROTO }, _('IKEv2/IPsec'))
		]);
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const next = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const selected = protocol.value;
			ui.hideModal();
			this.modalOpen = false;
			if (selected === OVPN_PROTO)
				this.openOpenvpnForm(null);
			else if (selected === L2TP_IPSEC_PROTO)
				this.openL2tpForm(null);
			else if (selected === IKEV2_PROTO)
				this.openIkev2Form(null);
			else
				this.openNativeForm(selected);
		} }, _('Continue'));

		ui.showModal(_('Add connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Choose the protocol for the new native OpenWrt connection. You can import a provider profile instead.')),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protocol ]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, next ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-chooser-modal');
	},

	openForm(connection) {
		if (!connection)
			return this.openAddConnection();
		if (connection.protocol === OVPN_PROTO)
			return this.openOpenvpnForm(connection);
		if (connection.protocol === L2TP_IPSEC_PROTO)
			return this.openL2tpForm(connection);
		if (connection.protocol === IKEV2_PROTO)
			return this.openIkev2Form(connection);
		return this.openWireguardForm(connection);
	},

	setList(config, section, option, values) {
		if (values && values.length)
			uci.set(config, section, option, values);
		else
			uci.unset(config, section, option);
	},

	setOptional(config, section, option, value) {
		if (value != null && value !== '')
			uci.set(config, section, option, value);
		else
			uci.unset(config, section, option);
	},

	renderConnection(connection) {
		if (connection.protocol === OVPN_PROTO)
			return this.renderOpenvpnConnection(connection);
		if (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO)
			return this.renderIpsecConnection(connection);
		return this.renderWireguardConnection(connection);
	},

	toggleConnection(connection, toggle) {
		toggle.disabled = true;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			if (toggle.checked) uci.unset('network', connection.section, 'disabled');
			else uci.set('network', connection.section, 'disabled', '1');
			if ((connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO) &&
				connection.remoteSection && uci.get(IPSEC_CONFIG, connection.remoteSection, '.type')) {
				if (toggle.checked) uci.set(IPSEC_CONFIG, connection.remoteSection, 'enabled', '1');
				else uci.set(IPSEC_CONFIG, connection.remoteSection, 'enabled', '0');
			}
			return uci.save();
		}).then(() => applyChanges())
		.then(() => (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
			? this.restartIpsecAfterApply() : null)).then(() => {
			notify(toggle.checked ? _('Connection enabled.') : _('Connection disabled.'), 'info');
			return this.refresh();
		}).catch(err => {
			toggle.checked = !toggle.checked;
			notify(_('Failed to change connection state: %s').format(err.message || err), 'danger');
		}).finally(() => { toggle.disabled = false; });
	},

	deleteConnection(connection) {
		const question = connection.protocol === OVPN_PROTO
			? _('Delete OpenVPN connection "%s" and its managed profile?').format(connection.name)
			: (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
				? _('Delete connection "%s" and its IPsec configuration?').format(connection.name)
				: _('Delete connection "%s" and all its peers?').format(connection.name));
		if (!window.confirm(question))
			return;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			if (connection.protocol !== OVPN_PROTO)
				if (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO)
					this.removeIpsecSections(connection);
				else
					peerSectionsFor(connection.section).forEach(peer => uci.remove('network', sectionName(peer)));
			uci.remove('network', connection.section);
			return uci.save();
		}).then(() => applyChanges()).then(() => (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
			? this.restartIpsecAfterApply() : null)).then(() => {
			if (connection.protocol === OVPN_PROTO && connection.managedProfile)
				return removeOpenvpnProfile(openvpnProfileNameFromPath(connection.profilePath)).catch(() => null);
			return null;
		}).then(() => {
			notify(_('Connection deleted.'), 'info');
			return this.refresh();
		}).catch(err => notify(_('Failed to delete connection: %s').format(err.message || err), 'danger'));
	},

	refresh() {
		return Promise.all([ getInterfaceDump(), getWireGuardStatus(), getInstalledPackages(), getFeedStatus(), uci.load(IPSEC_CONFIG).catch(() => null), getIpsecStatus() ]).then(data => {
			this.interfaceDump = data[0] || {};
			this.wgRpc = data[1] || { available: false, data: {} };
			this.packages = packageMap(data[2]);
			this.feed = data[3];
			this.ipsecAvailable = data[4] !== null;
			this.ipsecStatus = data[5] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
			this.renderSupport();
			this.fillConnections();
		});
	},

	destroy() {
		if (this.modalOpen)
			ui.hideModal();
		this.modalOpen = false;
		this.stopIpsecPolling();
		if (window.__freeneticActiveView === this)
			window.__freeneticActiveView = null;
	},

	addFooter() { return E([]); }
}, wireguardView, openvpnView, ipsecView));
