'use strict';
'require baseclass';
'require ui';
'require uci';
'require fs';
'require freenetic-ui as uiHelper';
'require freenetic-connections-core as connectionCore';

/* OpenVPN connection editor and managed profile lifecycle. */
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

return baseclass.extend({ mixin: {
	getOpenvpnConnection(section) {
		const name = sectionName(section);
		const profilePath = section.config || '';
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: OVPN_PROTO,
			enabled: section.disabled !== '1',
			profilePath: profilePath,
			managedProfile: section.freenetic_profile === '1' || managedOpenvpnProfile(profilePath),
			status: this.interfaceStatus(name)
		};
	},

	renderOpenvpnConnection(connection) {
		const status = connection.status;
		const up = !!(status && status.up);
		const disabled = !connection.enabled;
		const statusClass = disabled ? 'fn-status-off' : (up ? 'fn-status-ok' : 'fn-status-off');
		const statusText = disabled ? _('Disabled') : (up ? _('Connected') : _('Not connected'));
		const statusPill = E('span', { class: 'fn-status-pill ' + statusClass }, statusText);
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const device = status && (status.l3_device || status.device || status.device_name);
		const profileName = connection.profilePath ? connection.profilePath.split('/').pop() : _('Profile not set');
		const info = [
			[ _('Protocol'), 'OpenVPN' ],
			[ _('Interface'), connection.section ],
			[ _('Tunnel device'), device || '–' ],
			[ _('Profile'), profileName ],
			[ _('Profile storage'), connection.managedProfile ? _('Freenetic managed') : _('External file') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value fn-oc-break-value' }, item[1])
		])));

		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const exportButton = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.exportOpenvpnConnection(connection) }, _('Export'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card fn-oc-openvpn-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M4 7h16M7 4v3M17 4v3M6 11h4M6 15h7M4 20h16', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, _('OpenVPN profile')) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				E('p', { class: 'fn-oc-profile-note' }, _('The profile is passed to the native OpenVPN netifd protocol. Provider directives and inline certificates stay unchanged.')),
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ edit, exportButton, remove ])
			])
		]);
	},

	openOpenvpnForm(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New OpenVPN connection'),
			protocol: OVPN_PROTO,
			enabled: true,
			profilePath: '',
			profile: ''
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const profileInput = E('textarea', { class: 'fn-input fn-oc-profile-text', rows: '18', placeholder: _('Paste the complete .ovpn profile, including inline certificates when possible…'), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
		profileInput.value = connection.profile || '';
		const profileStatus = E('span', { class: 'fn-oc-field-hint' }, connection.profilePath ? _('Loading profile…') : _('Stored on the router with mode 0600.'));
		if (connection.profilePath) {
			fs.read(connection.profilePath).then(value => {
				if (!profileInput.value)
					profileInput.value = value || '';
				dom_content(profileStatus, connection.managedProfile ? _('Stored on the router with mode 0600.') : _('External profile file; saving creates a Freenetic-managed copy.'));
			}).catch(() => dom_content(profileStatus, _('The profile could not be read. Paste it again or choose a local file.')));
		}

		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.ovpn,.conf,text/plain' });
		const choose = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => fileInput.click() }, _('Choose .ovpn file'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file)
				return;
			const reader = new FileReader();
			reader.onload = event => {
				profileInput.value = event.target.result || '';
				dom_content(profileStatus, _('Local profile loaded. It will be copied to the router when saved.'));
			};
			reader.readAsText(file);
		});

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveOpenvpnConnection({
			section: connection.section,
			name: nameInput.value.trim(),
			enabled: enabledInput.checked,
			profilePath: connection.profilePath || '',
			managedProfile: !!connection.managedProfile,
			profile: profileInput.value
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit OpenVPN connection') : _('Add OpenVPN connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Use a complete OpenVPN client or server profile. The native OpenVPN netifd protocol keeps provider directives, inline certificates and routing options intact.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('OpenVPN profile')), profileInput, profileStatus, E('div', { class: 'fn-oc-key-actions' }, [ choose, fileInput ]) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Profile files and secrets')),
				E('span', {}, _('Profiles are stored only on this router. Relative certificate or auth-file paths must already exist beside the profile; inline blocks are recommended for imports.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-openvpn-modal');
	},

	validateOpenvpnConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		return validateOpenvpnProfile(fields.profile);
	},

	saveOpenvpnConnection(fields, button) {
		const error = this.validateOpenvpnConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!openvpnAvailable(this.packages)) {
			notify(_('Install an OpenVPN package from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let profileName;
		let profilePath;
		let oldManagedName = '';
		return uci.load('network').then(() => {
			const isNew = !fields.section;
			section = fields.section || uci.add('network', 'interface');
			if (isNew)
				uci.set('network', section, 'freenetic_managed', '1');
			profileName = openvpnProfileName(section);
			profilePath = openvpnProfilePath(section);
			oldManagedName = fields.managedProfile ? openvpnProfileNameFromPath(fields.profilePath) : '';
			return storeOpenvpnProfile(profileName, fields.profile);
		}).then(() => {
			uci.set('network', section, 'proto', OVPN_PROTO);
			if (fields.enabled)
				uci.unset('network', section, 'disabled');
			else
				uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'config', profilePath);
			uci.set('network', section, 'freenetic_profile', '1');
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			const cleanup = oldManagedName && oldManagedName !== profileName
				? removeOpenvpnProfile(oldManagedName).catch(() => null)
				: Promise.resolve();
			return cleanup;
		}).then(() => {
			ui.hideModal();
			this.modalOpen = false;
			notify(_('OpenVPN connection saved.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to save OpenVPN connection: %s').format(err.message || err), 'danger');
			button.disabled = false;
			dom_content(button, fields.section ? _('Save') : _('Add connection'));
			return false;
		});
	},

	exportOpenvpnConnection(connection) {
		if (!connection.profilePath) {
			notify(_('This OpenVPN connection has no profile to export.'), 'warning');
			return;
		}
		if (!window.confirm(_('The exported OpenVPN profile may contain private keys and passwords. Continue?')))
			return;
		return fs.read(connection.profilePath).then(profile => {
			const blob = new Blob([ profile || '' ], { type: 'application/x-openvpn-profile' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = (connection.section || 'openvpn') + '.ovpn';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}).catch(err => notify(_('Failed to export OpenVPN profile: %s').format(err.message || err), 'danger'));
	},

	/* Never downgrade an AWG config implicitly.  The same guard is used for an
	 * imported file and for a manually-created connection, so a user always
	 * chooses between installing the exact AWG support or deliberately removing
	 * the obfuscation fields before saving as ordinary WireGuard. */

	openOpenvpnImportDialog() {
		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.ovpn,.conf,text/plain' });
		const textInput = E('textarea', { class: 'fn-input fn-oc-import-text', placeholder: _('Paste an OpenVPN .ovpn profile here…'), rows: '16', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
		const fileName = E('span', { class: 'fn-oc-file-name' }, _('No file selected'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file)
				return;
			dom_content(fileName, file.name);
			const reader = new FileReader();
			reader.onload = event => { textInput.value = event.target.result || ''; };
			reader.readAsText(file);
		});
		const choose = E('button', { type: 'button', class: 'fn-settings-btn', click: () => fileInput.click() }, _('Choose file'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const importButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const error = validateOpenvpnProfile(textInput.value);
			if (error) {
				notify(error, 'warning');
				return;
			}
			const file = fileInput.files && fileInput.files[0];
			const name = file ? file.name.replace(/\.(ovpn|conf)$/i, '') : _('Imported OpenVPN connection');
			ui.hideModal();
			this.modalOpen = false;
			this.openOpenvpnForm({ section: null, name: name, protocol: OVPN_PROTO, enabled: true, profile: textInput.value, profilePath: '' });
		} }, _('Import profile'));

		ui.showModal(_('Import OpenVPN profile'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Import a complete .ovpn profile. Inline certificates and keys are preserved; external files must already be present on the router.')),
			E('div', { class: 'fn-oc-import-file' }, [ choose, fileName, fileInput ]),
			textInput,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, importButton ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-import-modal');
	},
} });
