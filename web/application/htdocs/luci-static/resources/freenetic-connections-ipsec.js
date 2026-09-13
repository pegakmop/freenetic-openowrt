'use strict';
'require ui';
'require uci';
'require fs';
'require freenetic-ui as uiHelper';
'require freenetic-connections-core as connectionCore';

/* L2TP/IPsec and IKEv2/IPsec connection editors, status and lifecycle. */
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const notifyLong = uiHelper.notifyLong;
const applyChanges = uiHelper.applyChanges;
const {
	NETWORK_RESTART_HELPER,
	WG_PROTO,
	AWG_PROTO,
	OVPN_PROTO,
	L2TP_PROTO,
	XFRM_PROTO,
	L2TP_IPSEC_PROTO,
	IKEV2_PROTO,
	WG_PEER_TYPE,
	AWG_PEER_TYPE,
	IPSEC_CONFIG,
	IPSEC_GLOBALS,
	OPENVPN_PROFILE_DIR,
	OPENVPN_PROFILE_HELPER,
	OPENVPN_PROFILE_MAX,
	IPSEC_RESTART_HELPER,
	IPSEC_STATUS_HELPER,
	L2TP_IPSEC_PACKAGES,
	IKEV2_PACKAGES,
	OPENVPN_VARIANTS,
	AWG_OPTIONS,
	EDITED_PEER_OPTIONS,
	KEY_RE,
	IPV4_RE,
	HOST_RE,
	advancedPeerOptions,
	restartNetifd,
	restartIpsec,
	listValue,
	listText,
	parseList,
	sectionName,
	sectionToken,
	managedIpsecSection,
	ipsecSection,
	ipsecList,
	validSecret,
	validSelector,
	validServer,
	ipsecProtocolLabel,
	validKey,
	validIPv4,
	validAddress,
	validHost,
	validPort,
	validNumber,
	formatBytes,
	formatAge,
	shortKey,
	svgIcon,
	getInterfaceDump,
	normalizeDumpStatus,
	getWireGuardStatus,
	normalizeKeyPair,
	generateKeyPair,
	derivePublicKey,
	generatePresharedKey,
	getInstalledPackages,
	openvpnAvailable,
	openvpnProfileName,
	openvpnProfilePath,
	managedOpenvpnProfile,
	openvpnProfileNameFromPath,
	normalizeOpenvpnProfile,
	validateOpenvpnProfile,
	storeOpenvpnProfile,
	removeOpenvpnProfile,
	getFeedStatus,
	getIpsecStatus,
	packageMap,
	peerType,
	peerSectionsFor,
	parseEndpoint,
	parseConfig,
	endpointText,
	serializeConfig
} = connectionCore;

return {
	getL2tpConnection(section) {
		const name = sectionName(section);
		const remoteName = section.freenetic_ipsec_remote || '';
		const childName = section.freenetic_ipsec_child || '';
		const remote = ipsecSection(IPSEC_CONFIG, 'remote', remoteName) || {};
		const child = ipsecSection(IPSEC_CONFIG, 'transport', childName) || {};
		const ikeName = listValue(remote.crypto_proposal)[0] || '';
		const espName = listValue(child.crypto_proposal)[0] || '';
		const server = section.server || listValue(remote.remote_addrs)[0] || '';
		const endpoint = parseEndpoint(server);
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: L2TP_IPSEC_PROTO,
			networkProto: L2TP_PROTO,
			enabled: section.disabled !== '1' && remote.enabled !== '0',
			server: server,
			serverHost: endpoint.host,
			username: section.username || '',
			password: section.password || '',
			psk: remote.pre_shared_key || '',
			localIdentifier: remote.local_identifier || '',
			remoteIdentifier: remote.remote_identifier || '',
			keepalive: section.keepalive || '',
			mtu: section.mtu || '',
			ipv6: section.ipv6 === '1',
			defaultRoute: /(?:^|\s)defaultroute(?:\s|$)/.test(String(section.pppd_options || '')),
			remoteSection: remoteName,
			childSection: childName,
			ikeProposalSection: ikeName,
			espProposalSection: espName,
			status: this.interfaceStatus(name)
		};
	},

	getIkev2Connection(section) {
		const name = sectionName(section);
		const remoteName = section.freenetic_ipsec_remote || '';
		const childName = section.freenetic_ipsec_child || '';
		const secretName = section.freenetic_ipsec_secret || '';
		const remote = ipsecSection(IPSEC_CONFIG, 'remote', remoteName) || {};
		const child = ipsecSection(IPSEC_CONFIG, 'tunnel', childName) || {};
		const secret = ipsecSection(IPSEC_CONFIG, 'mschapv2_secrets', secretName) || {};
		const ikeName = listValue(remote.crypto_proposal)[0] || '';
		const espName = listValue(child.crypto_proposal)[0] || '';
		const gateway = listValue(remote.remote_addrs)[0] || section.gateway || '';
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: IKEV2_PROTO,
			networkProto: XFRM_PROTO,
			enabled: section.disabled !== '1' && remote.enabled !== '0',
			gateway: gateway,
			authMethod: remote.authentication_method || 'psk',
			psk: remote.pre_shared_key || '',
			username: remote.eap_id || secret.id || '',
			password: secret.secret || '',
			caCert: listText(remote.remote_ca_certs),
			localIdentifier: remote.local_identifier || '',
			remoteIdentifier: remote.remote_identifier || '',
			localSelectors: ipsecList(child, 'local_subnet'),
			remoteSelectors: ipsecList(child, 'remote_subnet'),
			ifid: child.if_id || section.ifid || '',
			mtu: section.mtu || '',
			mobike: remote.mobike !== '0',
			encap: remote.encap === '1',
			autoStart: child.startaction === 'start' || child.startaction === 'route' || child.startaction === 'trap',
			remoteSection: remoteName,
			childSection: childName,
			secretSection: secretName,
			ikeProposalSection: ikeName,
			espProposalSection: espName,
			status: this.interfaceStatus(name)
		};
	},

	parseIpsecSas(value) {
		const result = {};
		String(value || '').split(/\r?\n/).forEach(line => {
			/* swanctl --list-sas --pretty starts each IKE SA with
			 * "<connection>: #<id>, <STATE>, ...".  Keep the parser strict
			 * enough to avoid mistaking child-SA detail lines for connections. */
			const match = line.match(/^\s*([^:\s]+):\s*#\d+,\s*([A-Z][A-Z_-]*)\b/);
			if (match)
				result[match[1]] = match[2];
		});
		return result;
	},

	ipsecSaState(connection) {
		const status = this.ipsecStatus || {};
		const sas = this.parseIpsecSas(status.sas);
		const names = [ connection.remoteSection, connection.section ].filter(Boolean);
		for (const name of names) {
			if (sas[name])
				return sas[name];
		}
		return '';
	},

	ipsecPresentation(connection) {
		const interfaceUp = !!(connection.status && connection.status.up);
		const state = this.ipsecSaState(connection);
		if (!connection.enabled)
			return { text: _('Disabled'), className: 'fn-status-off', state: state, interfaceUp: interfaceUp };
		if (state === 'ESTABLISHED' || state === 'INSTALLED')
			return { text: _('Connected'), className: 'fn-status-ok', state: state, interfaceUp: interfaceUp };
		if (/^(CONNECTING|REKEYING|ROUTED|TRAPPED|NEGOTIATING)$/.test(state))
			return { text: _('Negotiating'), className: 'fn-status-warn', state: state, interfaceUp: interfaceUp };
		if (interfaceUp)
			return {
				text: connection.protocol === L2TP_IPSEC_PROTO ? _('Connected') : _('Interface ready'),
				className: 'fn-status-ok',
				state: state,
				interfaceUp: interfaceUp
			};
		if (this.ipsecStatus && (this.ipsecStatus.available === false || this.ipsecStatus.ok === false))
			return { text: _('IPsec service unavailable'), className: 'fn-status-warn', state: state, interfaceUp: interfaceUp };
		return { text: _('Not connected'), className: 'fn-status-off', state: state, interfaceUp: interfaceUp };
	},

	refreshIpsecStatus() {
		return Promise.all([ getIpsecStatus(), getInterfaceDump() ]).then(data => {
			this.ipsecStatus = data[0] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
			this.interfaceDump = data[1] || {};
			this.fillConnections();
			return this.ipsecStatus;
		});
	},

	startIpsecPolling() {
		this.stopIpsecPolling();
		this.ipsecTimer = window.setInterval(() => this.refreshIpsecStatus().catch(() => null), 15000);
	},

	stopIpsecPolling() {
		if (this.ipsecTimer) {
			window.clearInterval(this.ipsecTimer);
			this.ipsecTimer = null;
		}
	},

	renderIpsecConnection(connection) {
		const status = connection.status;
		const presentation = this.ipsecPresentation(connection);
		const statusPill = E('span', { class: 'fn-status-pill ' + presentation.className }, presentation.text);
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const info = connection.protocol === L2TP_IPSEC_PROTO ? [
			[ _('Protocol'), _('L2TP/IPsec') ],
			[ _('Interface'), connection.section ],
			[ _('Server'), connection.server || '–' ],
			[ _('PPP username'), connection.username || '–' ],
			[ _('Tunnel device'), status && (status.l3_device || status.device) || 'l2tp-' + connection.section ],
			[ _('IP version'), connection.ipv6 ? _('IPv4 + IPv6') : _('IPv4') ]
		] : [
			[ _('Protocol'), _('IKEv2/IPsec') ],
			[ _('Interface'), connection.section ],
			[ _('Gateway'), connection.gateway || '–' ],
			[ _('Authentication'), connection.authMethod === 'eap-mschapv2' ? _('EAP-MSCHAPv2') : _('Pre-shared key') ],
			[ _('XFRM interface ID'), connection.ifid || '–' ],
			[ _('Traffic selectors'), (connection.localSelectors || []).join(', ') + ' → ' + (connection.remoteSelectors || []).join(', ') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value fn-oc-break-value' }, item[1])
		])));
		const hint = connection.protocol === IKEV2_PROTO
			? _('The XFRM interface is created by netifd; strongSwan establishes the IKEv2 security association on top of it.')
			: _('The PPP tunnel is carried by xl2tpd after strongSwan negotiates the IPsec transport connection.');
		const diagnostics = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openIpsecDiagnostics(connection) }, _('Diagnostics'));
		const reconnect = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', disabled: !connection.enabled, click: () => this.reconnectIpsec(connection, reconnect) }, _('Reconnect'));
		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card fn-oc-ipsec-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M12 2l8 4v5c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V6l8-4zM9 12l2 2 4-4', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, ipsecProtocolLabel(connection.protocol)) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				E('p', { class: 'fn-oc-profile-note' }, hint),
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ reconnect, diagnostics, edit, remove ])
			])
		]);
	},

	reconnectIpsec(connection, button) {
		if (!connection.enabled) {
			notify(_('Enable the connection before reconnecting it.'), 'warning');
			return Promise.resolve(false);
		}
		button.disabled = true;
		dom_content(button, _('Reconnecting…'));
		return restartIpsec()
			.then(() => this.refreshIpsecStatus())
			.then(() => {
				notify(_('Reconnect requested. The current negotiation status is shown on the connection card.'), 'info');
				return true;
			})
			.catch(error => {
				notify(_('Failed to reconnect IPsec: %s').format(error.message || error), 'danger');
				return false;
			})
			.finally(() => {
				button.disabled = !connection.enabled;
				dom_content(button, _('Reconnect'));
			});
	},

	openIpsecDiagnostics(connection) {
		if (this.modalOpen)
			ui.hideModal();

		const statusNode = E('div', { class: 'fn-oc-diagnostics-status' });
		const errorNode = E('div', { class: 'fn-oc-diagnostics-error' });
		const sasNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const connsNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const logsNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const snapshot = () => this.ipsecStatus || {};
		const update = () => {
			const current = snapshot();
			const latestConnection = this.getConnections().find(item => item.section === connection.section) || connection;
			const presentation = this.ipsecPresentation(latestConnection);
			dom_empty(statusNode);
			statusNode.appendChild(E('span', { class: 'fn-status-pill ' + presentation.className }, presentation.text));
			if (presentation.state)
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('strongSwan state: %s').format(presentation.state)));
			else if (presentation.interfaceUp)
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('The network interface is present; no IKE security association was reported.')));
			else
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('No active IKE security association was reported.')));
			dom_content(errorNode, current.error || '');
			dom_content(sasNode, current.sas || _('No security associations reported.'));
			dom_content(connsNode, current.conns || _('No loaded IPsec connections reported.'));
			dom_content(logsNode, current.logs || _('No matching IPsec log entries reported.'));
		};

		const close = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Close'));
		const refresh = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			refresh.disabled = true;
			dom_content(refresh, _('Refreshing…'));
			return this.refreshIpsecStatus().then(update).catch(error => {
				notify(_('Failed to refresh IPsec diagnostics: %s').format(error.message || error), 'danger');
			}).finally(() => {
				refresh.disabled = false;
				dom_content(refresh, _('Refresh'));
			});
		} }, _('Refresh'));

		update();
		ui.showModal(_('IPsec diagnostics: %s').format(connection.name), [
			E('p', { class: 'fn-oc-modal-description' }, _('Read-only strongSwan status, loaded connection definitions and recent relevant log entries. Private keys and passwords are not requested or displayed.')),
			statusNode,
			errorNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Security associations')),
			sasNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Loaded connections')),
			connsNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Recent IPsec logs')),
			logsNode,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ close, refresh ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-diagnostics-modal');
	},

	openL2tpForm(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New L2TP/IPsec connection'),
			protocol: L2TP_IPSEC_PROTO,
			enabled: true,
			server: '',
			username: '',
			password: '',
			psk: '',
			localIdentifier: '',
			remoteIdentifier: '',
			keepalive: '10,5',
			mtu: '1460',
			ipv6: false,
			defaultRoute: false
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const serverInput = E('input', { type: 'text', class: 'fn-input', value: connection.server || '', placeholder: 'vpn.example.com[:port]' });
		const usernameInput = E('input', { type: 'text', class: 'fn-input', value: connection.username || '', autocomplete: 'username', placeholder: _('PPP username') });
		const passwordInput = E('input', { type: 'password', class: 'fn-input', value: connection.password || '', autocomplete: 'current-password', placeholder: _('PPP password') });
		const pskInput = E('input', { type: 'password', class: 'fn-input', value: connection.psk || '', placeholder: _('IPsec pre-shared key') });
		const localIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.localIdentifier || '', placeholder: _('Optional local ID') });
		const remoteIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.remoteIdentifier || '', placeholder: _('Optional server ID') });
		const keepaliveInput = E('input', { type: 'text', class: 'fn-input', value: connection.keepalive || '', placeholder: '10,5' });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '9000', placeholder: '1460' });
		const ipv6Input = E('input', { type: 'checkbox' });
		ipv6Input.checked = !!connection.ipv6;
		const routeInput = E('input', { type: 'checkbox' });
		routeInput.checked = !!connection.defaultRoute;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveL2tpConnection({
			section: connection.section,
			name: nameInput.value.trim(),
			server: serverInput.value.trim(),
			username: usernameInput.value.trim(),
			password: passwordInput.value,
			psk: pskInput.value,
			localIdentifier: localIdInput.value.trim(),
			remoteIdentifier: remoteIdInput.value.trim(),
			keepalive: keepaliveInput.value.trim(),
			mtu: mtuInput.value.trim(),
			ipv6: ipv6Input.checked,
			defaultRoute: routeInput.checked,
			enabled: enabledInput.checked,
			remoteSection: connection.remoteSection || '',
			childSection: connection.childSection || '',
			ikeProposalSection: connection.ikeProposalSection || '',
			espProposalSection: connection.espProposalSection || ''
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit L2TP/IPsec connection') : _('Add L2TP/IPsec connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('L2TP uses xl2tpd for PPP and strongSwan for the IPsec transport protection. The router must have the matching kernel modules installed.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('L2TP server')), serverInput, E('span', { class: 'fn-oc-field-hint' }, _('Use a hostname or IP address. A custom UDP port may be appended as host:port.')) ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('PPP username')), usernameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('PPP password')), passwordInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('IPsec pre-shared key')), pskInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Local identity')), localIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Server identity')), remoteIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('LCP keepalive')), keepaliveInput, E('span', { class: 'fn-oc-field-hint' }, _('Failure count and interval, for example 10,5.')) ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ])
			]),
			E('div', { class: 'fn-oc-checkbox-row' }, [
				E('label', { class: 'fn-oc-checkbox-field' }, [ ipv6Input, E('span', {}, _('Enable IPv6 on the PPP tunnel')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ routeInput, E('span', {}, _('Install a default route through this tunnel')) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Native OpenWrt configuration')),
				E('span', {}, _('Credentials are written to network UCI. IPsec proposals use a conservative AES-256/SHA-1 baseline compatible with common L2TP providers.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	openIkev2Form(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New IKEv2/IPsec connection'),
			protocol: IKEV2_PROTO,
			enabled: true,
			gateway: '',
			authMethod: 'psk',
			psk: '',
			username: '',
			password: '',
			caCert: '',
			localIdentifier: '',
			remoteIdentifier: '',
			localSelectors: [ '0.0.0.0/0' ],
			remoteSelectors: [ '0.0.0.0/0' ],
			ifid: '',
			mtu: '1280',
			mobike: true,
			encap: false,
			autoStart: true
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const gatewayInput = E('input', { type: 'text', class: 'fn-input', value: connection.gateway || '', placeholder: 'vpn.example.com' });
		const authInput = E('select', { class: 'fn-input' }, [
			E('option', { value: 'psk' }, _('Pre-shared key')),
			E('option', { value: 'eap-mschapv2' }, _('EAP-MSCHAPv2 (username/password)'))
		]);
		authInput.value = connection.authMethod === 'eap-mschapv2' ? 'eap-mschapv2' : 'psk';
		const pskInput = E('input', { type: 'password', class: 'fn-input', value: connection.psk || '', placeholder: _('IPsec pre-shared key') });
		const usernameInput = E('input', { type: 'text', class: 'fn-input', value: connection.username || '', autocomplete: 'username', placeholder: _('VPN username') });
		const passwordInput = E('input', { type: 'password', class: 'fn-input', value: connection.password || '', autocomplete: 'current-password', placeholder: _('VPN password') });
		const caInput = E('input', { type: 'text', class: 'fn-input', value: connection.caCert || '', placeholder: 'provider-ca.pem' });
		const localIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.localIdentifier || '', placeholder: _('Optional local ID') });
		const remoteIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.remoteIdentifier || '', placeholder: _('Optional server ID') });
		const localSelectorInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.localSelectors), placeholder: '0.0.0.0/0' });
		const remoteSelectorInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.remoteSelectors), placeholder: '0.0.0.0/0' });
		const ifidInput = E('input', { type: 'number', class: 'fn-input', value: connection.ifid || '', min: '1', max: '4294967295', placeholder: '1000' });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '9000', placeholder: '1280' });
		const mobikeInput = E('input', { type: 'checkbox' });
		mobikeInput.checked = connection.mobike !== false;
		const encapInput = E('input', { type: 'checkbox' });
		encapInput.checked = !!connection.encap;
		const startInput = E('input', { type: 'checkbox' });
		startInput.checked = connection.autoStart !== false;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const pskField = E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('IPsec pre-shared key')), pskInput ]);
		const eapFields = E('div', { class: 'fn-oc-form-grid fn-oc-wide-field' }, [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('EAP username')), usernameInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('EAP password')), passwordInput ]),
			E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('CA certificate filename')), caInput, E('span', { class: 'fn-oc-field-hint' }, _('Upload this PEM file to /etc/swanctl/x509ca on the router. Leave empty only when the provider does not require CA pinning.')) ])
		]);
		const authHint = E('p', { class: 'fn-oc-field-hint' });
		const updateAuth = () => {
			const eap = authInput.value === 'eap-mschapv2';
			pskField.hidden = eap;
			eapFields.hidden = !eap;
			dom_content(authHint, eap
				? _('EAP-MSCHAPv2 is common for commercial IKEv2 providers and needs a trusted CA certificate when the server identity is verified.')
				: _('PSK authentication stores the pre-shared key in the native strongSwan secrets section.'));
		};
		authInput.addEventListener('change', updateAuth);
		updateAuth();

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveIkev2Connection({
			section: connection.section,
			name: nameInput.value.trim(),
			gateway: gatewayInput.value.trim(),
			authMethod: authInput.value,
			psk: pskInput.value,
			username: usernameInput.value.trim(),
			password: passwordInput.value,
			caCert: caInput.value.trim(),
			localIdentifier: localIdInput.value.trim(),
			remoteIdentifier: remoteIdInput.value.trim(),
			localSelectors: parseList(localSelectorInput.value),
			remoteSelectors: parseList(remoteSelectorInput.value),
			ifid: ifidInput.value.trim(),
			mtu: mtuInput.value.trim(),
			mobike: mobikeInput.checked,
			encap: encapInput.checked,
			autoStart: startInput.checked,
			enabled: enabledInput.checked,
			remoteSection: connection.remoteSection || '',
			childSection: connection.childSection || '',
			secretSection: connection.secretSection || '',
			ikeProposalSection: connection.ikeProposalSection || '',
			espProposalSection: connection.espProposalSection || ''
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit IKEv2/IPsec connection') : _('Add IKEv2/IPsec connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Use a native route-based XFRM interface with strongSwan. The IKEv2 security association carries the selectors below; applications can route traffic to the XFRM interface through Access & Routing Policy.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('VPN gateway')), gatewayInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Authentication')), authInput, authHint ]),
				pskField,
				eapFields,
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Local identity')), localIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Server identity')), remoteIdInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Local traffic selectors')), localSelectorInput, E('span', { class: 'fn-oc-field-hint' }, _('Comma-separated CIDR prefixes, for example 0.0.0.0/0.')) ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Remote traffic selectors')), remoteSelectorInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('XFRM interface ID')), ifidInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ])
			]),
			E('div', { class: 'fn-oc-checkbox-row' }, [
				E('label', { class: 'fn-oc-checkbox-field' }, [ startInput, E('span', {}, _('Start tunnel automatically')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ mobikeInput, E('span', {}, _('Enable MOBIKE')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ encapInput, E('span', {}, _('Force UDP encapsulation')) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Native strongSwan configuration')),
				E('span', {}, _('IKEv2 uses the router’s strongSwan UCI backend. The XFRM interface ID must match the child SA and is kept stable when you edit this connection.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	validateL2tpConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validServer(fields.server))
			return _('Enter a valid L2TP server hostname or IP address.');
		if (!fields.username || !validSecret(fields.username, false) || !validSecret(fields.password, false))
			return _('Enter the PPP username and password.');
		if (!validSecret(fields.psk, false))
			return _('Enter the IPsec pre-shared key.');
		if (!validNumber(fields.mtu, 576, 9000))
			return _('MTU must be between 576 and 9000.');
		if (fields.keepalive && !/^\d+\s*,\s*\d+$/.test(fields.keepalive))
			return _('LCP keepalive must use failure count,interval format, for example 10,5.');
		if (!validSecret(fields.localIdentifier, true) || !validSecret(fields.remoteIdentifier, true))
			return _('The IPsec identities contain invalid characters.');
		return null;
	},

	validateIkev2Connection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validServer(fields.gateway))
			return _('Enter a valid IKEv2 gateway hostname or IP address.');
		if (fields.authMethod === 'eap-mschapv2') {
			if (!fields.username || !validSecret(fields.username, false) || !validSecret(fields.password, false))
				return _('Enter the EAP username and password.');
			if (fields.caCert && !/^[A-Za-z0-9._-]+$/.test(fields.caCert))
				return _('CA certificate must be a filename stored in /etc/swanctl/x509ca.');
		}
		else if (!validSecret(fields.psk, false))
			return _('Enter the IPsec pre-shared key.');
		if (!fields.localSelectors.length || !fields.localSelectors.every(validSelector) ||
			!fields.remoteSelectors.length || !fields.remoteSelectors.every(validSelector))
			return _('Enter valid CIDR traffic selectors for both sides.');
		if (!validNumber(fields.ifid, 1, 4294967295))
			return _('XFRM interface ID must be between 1 and 4294967295.');
		if (!validNumber(fields.mtu, 576, 9000))
			return _('MTU must be between 576 and 9000.');
		if (!validSecret(fields.localIdentifier, true) || !validSecret(fields.remoteIdentifier, true))
			return _('The IKE identities contain invalid characters.');
		return null;
	},

	ensureIpsecSection(type, name) {
		if (!name) {
			const section = uci.add(IPSEC_CONFIG, type);
			uci.set(IPSEC_CONFIG, section, 'freenetic_managed', '1');
			return section;
		}
		if (!uci.get(IPSEC_CONFIG, name, '.type')) {
			uci.add(IPSEC_CONFIG, type, name);
			uci.set(IPSEC_CONFIG, name, 'freenetic_managed', '1');
		}
		return name;
	},

	removeIpsecSections(connection) {
		[ connection.remoteSection, connection.childSection, connection.secretSection,
			connection.ikeProposalSection, connection.espProposalSection ].forEach(name => {
			if (name && uci.get(IPSEC_CONFIG, name, '.type') &&
				uci.get(IPSEC_CONFIG, name, 'freenetic_managed') === '1')
				uci.remove(IPSEC_CONFIG, name);
		});
	},

	restartIpsecAfterApply() {
		return restartIpsec().catch(error => {
			notify(_('Network settings were saved, but strongSwan could not be restarted: %s').format(error.message || error), 'warning');
			return null;
		});
	},

	saveL2tpConnection(fields, button) {
		const error = this.validateL2tpConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!L2TP_IPSEC_PACKAGES.every(name => this.packages && this.packages[name])) {
			notify(_('Install the L2TP/IPsec packages from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let remoteName;
		let childName;
		let ikeName;
		let espName;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			const isNew = !fields.section;
			section = fields.section || uci.add('network', 'interface');
			if (isNew)
				uci.set('network', section, 'freenetic_managed', '1');
			remoteName = fields.remoteSection || managedIpsecSection('fnr_', section + ':l2tp');
			childName = fields.childSection || managedIpsecSection('fnc_', section + ':l2tp');
			ikeName = fields.ikeProposalSection || managedIpsecSection('fnp_', section + ':l2tp-ike');
			espName = fields.espProposalSection || managedIpsecSection('fne_', section + ':l2tp-esp');
			this.ensureIpsecSection('ipsec', IPSEC_GLOBALS);

			uci.set('network', section, 'proto', L2TP_PROTO);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_protocol', L2TP_IPSEC_PROTO);
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'freenetic_ipsec_remote', remoteName);
			uci.set('network', section, 'freenetic_ipsec_child', childName);
			this.setOptional('network', section, 'server', fields.server);
			this.setOptional('network', section, 'username', fields.username);
			this.setOptional('network', section, 'password', fields.password);
			this.setOptional('network', section, 'keepalive', fields.keepalive);
			this.setOptional('network', section, 'mtu', fields.mtu);
			if (fields.ipv6) uci.set('network', section, 'ipv6', '1');
			else uci.unset('network', section, 'ipv6');
			this.setOptional('network', section, 'pppd_options', fields.defaultRoute ? 'defaultroute' : '');

			uci.set(IPSEC_CONFIG, remoteName, 'enabled', fields.enabled ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'authentication_method', 'psk');
			uci.set(IPSEC_CONFIG, remoteName, 'pre_shared_key', fields.psk);
			uci.set(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev1');
			this.setOptional(IPSEC_CONFIG, remoteName, 'local_identifier', fields.localIdentifier);
			this.setOptional(IPSEC_CONFIG, remoteName, 'remote_identifier', fields.remoteIdentifier);
			uci.set(IPSEC_CONFIG, remoteName, 'remote_addrs', parseEndpoint(fields.server).host);
			uci.set(IPSEC_CONFIG, remoteName, 'encap', '1');
			uci.set(IPSEC_CONFIG, remoteName, 'mobike', '0');
			this.setList(IPSEC_CONFIG, remoteName, 'crypto_proposal', [ ikeName ]);
			this.setList(IPSEC_CONFIG, remoteName, 'transport', [ childName ]);

			this.setList(IPSEC_CONFIG, childName, 'local_subnet', [ 'dynamic[udp/l2tp]' ]);
			this.setList(IPSEC_CONFIG, childName, 'remote_subnet', [ 'dynamic[udp/l2tp]' ]);
			this.setList(IPSEC_CONFIG, childName, 'crypto_proposal', [ espName ]);
			uci.set(IPSEC_CONFIG, childName, 'startaction', 'trap');
			uci.set(IPSEC_CONFIG, childName, 'dpdaction', 'restart');
			uci.set(IPSEC_CONFIG, childName, 'closeaction', 'start');
			uci.unset(IPSEC_CONFIG, childName, 'if_id');
			uci.unset(IPSEC_CONFIG, childName, 'interface');

			uci.set(IPSEC_CONFIG, ikeName, 'is_esp', '0');
			uci.set(IPSEC_CONFIG, ikeName, 'encryption_algorithm', 'aes256');
			uci.set(IPSEC_CONFIG, ikeName, 'hash_algorithm', 'sha1');
			uci.set(IPSEC_CONFIG, ikeName, 'dh_group', 'modp2048');
			uci.set(IPSEC_CONFIG, ikeName, 'prf_algorithm', 'prfsha1');
			uci.set(IPSEC_CONFIG, espName, 'is_esp', '1');
			uci.set(IPSEC_CONFIG, espName, 'encryption_algorithm', 'aes256');
			uci.set(IPSEC_CONFIG, espName, 'hash_algorithm', 'sha1');
			uci.unset(IPSEC_CONFIG, espName, 'dh_group');
			uci.unset(IPSEC_CONFIG, espName, 'prf_algorithm');
			return uci.save();
		}).then(() => applyChanges())
			.then(() => this.restartIpsecAfterApply())
			.then(() => {
				ui.hideModal();
				this.modalOpen = false;
				notify(_('L2TP/IPsec connection saved.'), 'info');
				return this.refresh();
			})
			.catch(err => {
				notify(_('Failed to save L2TP/IPsec connection: %s').format(err.message || err), 'danger');
				button.disabled = false;
				dom_content(button, fields.section ? _('Save') : _('Add connection'));
				return false;
			});
	},

	saveIkev2Connection(fields, button) {
		const error = this.validateIkev2Connection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!IKEV2_PACKAGES.every(name => this.packages && this.packages[name])) {
			notify(_('Install the IKEv2/IPsec packages from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let remoteName;
		let childName;
		let secretName;
		let ikeName;
		let espName;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			const isNew = !fields.section;
			section = fields.section || uci.add('network', 'interface');
			if (isNew)
				uci.set('network', section, 'freenetic_managed', '1');
			remoteName = fields.remoteSection || managedIpsecSection('fnr_', section + ':ikev2');
			childName = fields.childSection || managedIpsecSection('fnc_', section + ':ikev2');
			secretName = fields.secretSection || managedIpsecSection('fns_', section + ':ikev2');
			ikeName = fields.ikeProposalSection || managedIpsecSection('fnp_', section + ':ikev2-ike');
			espName = fields.espProposalSection || managedIpsecSection('fne_', section + ':ikev2-esp');
			this.ensureIpsecSection('ipsec', IPSEC_GLOBALS);

			uci.set('network', section, 'proto', XFRM_PROTO);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_protocol', IKEV2_PROTO);
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'freenetic_ipsec_remote', remoteName);
			uci.set('network', section, 'freenetic_ipsec_child', childName);
			uci.set('network', section, 'freenetic_ipsec_secret', fields.authMethod === 'eap-mschapv2' ? secretName : '');
			uci.set('network', section, 'ifid', fields.ifid || String(1000 + (parseInt(sectionToken(section), 36) % 40000)));
			this.setOptional('network', section, 'mtu', fields.mtu);
			this.setOptional('network', section, 'freenetic_ifid', fields.ifid);
			[ 'server', 'username', 'password', 'keepalive', 'ipv6', 'pppd_options' ].forEach(option => uci.unset('network', section, option));

			uci.set(IPSEC_CONFIG, remoteName, 'enabled', fields.enabled ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev2');
			uci.set(IPSEC_CONFIG, remoteName, 'authentication_method', fields.authMethod);
			if (fields.authMethod === 'eap-mschapv2') {
				uci.unset(IPSEC_CONFIG, remoteName, 'pre_shared_key');
				uci.set(IPSEC_CONFIG, remoteName, 'eap_id', fields.username);
				this.setOptional(IPSEC_CONFIG, remoteName, 'remote_ca_certs', fields.caCert);
				this.ensureIpsecSection('mschapv2_secrets', secretName);
				uci.set(IPSEC_CONFIG, secretName, 'id', fields.username);
				uci.set(IPSEC_CONFIG, secretName, 'secret', fields.password);
			}
			else {
				uci.set(IPSEC_CONFIG, remoteName, 'pre_shared_key', fields.psk);
				[ 'eap_id', 'remote_ca_certs' ].forEach(option => uci.unset(IPSEC_CONFIG, remoteName, option));
				if (fields.secretSection && uci.get(IPSEC_CONFIG, fields.secretSection, '.type') &&
					uci.get(IPSEC_CONFIG, fields.secretSection, 'freenetic_managed') === '1')
					uci.remove(IPSEC_CONFIG, fields.secretSection);
			}
			this.setOptional(IPSEC_CONFIG, remoteName, 'local_identifier', fields.localIdentifier);
			this.setOptional(IPSEC_CONFIG, remoteName, 'remote_identifier', fields.remoteIdentifier);
			uci.set(IPSEC_CONFIG, remoteName, 'remote_addrs', parseEndpoint(fields.gateway).host);
			uci.set(IPSEC_CONFIG, remoteName, 'mobike', fields.mobike ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'encap', fields.encap ? '1' : '0');
			this.setList(IPSEC_CONFIG, remoteName, 'crypto_proposal', [ ikeName ]);
			this.setList(IPSEC_CONFIG, remoteName, 'tunnel', [ childName ]);

			this.setList(IPSEC_CONFIG, childName, 'local_subnet', fields.localSelectors);
			this.setList(IPSEC_CONFIG, childName, 'remote_subnet', fields.remoteSelectors);
			this.setList(IPSEC_CONFIG, childName, 'crypto_proposal', [ espName ]);
			uci.set(IPSEC_CONFIG, childName, 'if_id', uci.get('network', section, 'ifid'));
			uci.set(IPSEC_CONFIG, childName, 'interface', section);
			uci.set(IPSEC_CONFIG, childName, 'startaction', fields.autoStart ? 'start' : 'none');
			uci.set(IPSEC_CONFIG, childName, 'dpdaction', 'restart');
			uci.set(IPSEC_CONFIG, childName, 'closeaction', 'start');

			uci.set(IPSEC_CONFIG, ikeName, 'is_esp', '0');
			uci.set(IPSEC_CONFIG, ikeName, 'encryption_algorithm', 'aes256gcm128');
			uci.unset(IPSEC_CONFIG, ikeName, 'hash_algorithm');
			uci.set(IPSEC_CONFIG, ikeName, 'dh_group', 'modp2048');
			uci.set(IPSEC_CONFIG, ikeName, 'prf_algorithm', 'prfsha256');
			uci.set(IPSEC_CONFIG, espName, 'is_esp', '1');
			uci.set(IPSEC_CONFIG, espName, 'encryption_algorithm', 'aes256gcm128');
			uci.unset(IPSEC_CONFIG, espName, 'hash_algorithm');
			uci.unset(IPSEC_CONFIG, espName, 'dh_group');
			uci.unset(IPSEC_CONFIG, espName, 'prf_algorithm');
			return uci.save();
		}).then(() => applyChanges())
			.then(() => this.restartIpsecAfterApply())
			.then(() => {
				ui.hideModal();
				this.modalOpen = false;
				notify(_('IKEv2/IPsec connection saved.'), 'info');
				return this.refresh();
			})
			.catch(err => {
				notify(_('Failed to save IKEv2/IPsec connection: %s').format(err.message || err), 'danger');
				button.disabled = false;
				dom_content(button, fields.section ? _('Save') : _('Add connection'));
				return false;
			});
	},
};

