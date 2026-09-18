'use strict';
'require view';
'require ui';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-multiwan-data as multiwanData';
'require freenetic-ui as uiHelper';

/*
 * The status view stays deliberately small, while mode changes are
 * limited to Freenetic-owned mwan3 policies and the default IPv4/IPv6 rules.
 * Existing custom rules remain untouched and no network interface is edited.
 */
const notify = uiHelper.notify;
const ubusCall = rpc.call;
const PACKAGE_STATUS_HELPER = '/usr/libexec/freenetic-package-status';
const MULTIWAN_HELPER = '/usr/libexec/freenetic-multiwan';
const WIFI_UPLINK_HELPER = '/usr/libexec/freenetic-wifi-uplink';
const PACKAGE_NAMES = [ 'mwan3', 'luci-app-mwan3' ];

function getWirelessConfig() {
	return ubusCall('uci', 'get', { config: 'wireless' }).then(result => result.values || {}).catch(() => ({}));
}

function getWirelessStatus() {
	return ubusCall('network.wireless', 'status').catch(() => ({}));
}

function getIwinfoDevices() {
	return ubusCall('iwinfo', 'devices').then(result => result.devices || []).catch(() => []);
}

function wifiRadios(config, runtime, devices) {
	return Object.keys(config || {}).map(name => {
		const section = config[name];
		if (!section || section['.type'] !== 'wifi-device' || section.disabled === '1')
			return null;
		const live = runtime && runtime[name];
		let device = live && Array.isArray(live.interfaces) && live.interfaces[0] && live.interfaces[0].ifname;
		if (!device) {
			const index = name.match(/(\d+)$/);
			if (index)
				device = (devices || []).find(item => String(item).indexOf('phy' + index[1] + '-') === 0);
		}
		return {
			name,
			device: device || '',
			band: section.band === '2g' ? '2.4 GHz' : section.band === '5g' ? '5 GHz' : section.band || name
		};
	}).filter(radio => radio && radio.device);
}

function scanSecurity(network) {
	const encryption = network && network.encryption || {};
	if (!encryption.enabled)
		return { mode: 'none', label: _('Open network'), supported: true };
	const authentication = Array.isArray(encryption.authentication) ? encryption.authentication : [];
	const wpa = Array.isArray(encryption.wpa) ? encryption.wpa.map(Number) : [];
	const sae = authentication.indexOf('sae') !== -1;
	const psk = authentication.indexOf('psk') !== -1;
	if (!sae && !psk)
		return { mode: '', label: _('Enterprise Wi-Fi is not supported'), supported: false };
	if (sae && psk)
		return { mode: 'sae-mixed', label: 'WPA2/WPA3', supported: true };
	if (sae)
		return { mode: 'sae', label: 'WPA3', supported: true };
	if (wpa.indexOf(2) !== -1)
		return { mode: 'psk2', label: 'WPA2', supported: true };
	return { mode: 'psk-mixed', label: 'WPA/WPA2', supported: true };
}

function signalLabel(network) {
	const quality = Number(network.quality || 0);
	const maximum = Number(network.quality_max || 0);
	const percent = maximum > 0 ? Math.max(0, Math.min(100, Math.round(quality * 100 / maximum))) : 0;
	return percent + '%';
}

function statusLabel(state) {
	return {
		online: _('Online'),
		offline: _('Offline'),
		checking: _('Checking…'),
		unused: _('Not in use'),
		disabled: _('Disabled'),
		unknown: _('Unknown')
	}[state] || _('Unknown');
}

function statusClass(state) {
	return state === 'online' ? 'fn-status-ok' : state === 'offline' ? 'fn-status-warn' : 'fn-status-off';
}

function valueText(value, fallback) {
	return value == null || value === '' ? (fallback || '–') : String(value);
}

function statusPill(state) {
	return E('span', { class: 'fn-status-pill ' + statusClass(state) }, statusLabel(state));
}

function infoItem(label, value) {
	return E('div', {}, [
		E('div', { class: 'fn-info-label' }, label),
		E('div', { class: 'fn-info-value' }, valueText(value))
	]);
}

function svgIcon(path, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function cardAction(path, title) {
	const label = _('Details');
	return E('a', {
		class: 'fn-card-link',
		href: L.url.apply(L, path),
		title: label + ': ' + title,
		'aria-label': label + ': ' + title
	}, [
		E('span', { class: 'fn-card-link-text' }, label),
		E('span', { class: 'fn-card-link-arrow', 'aria-hidden': 'true' }, '→')
	]);
}

function cardHead(iconPath, title, path) {
	const children = [ svgIcon(iconPath, 20), E('h3', {}, title) ];
	if (path)
		children.push(cardAction(path, title));
	return E('div', { class: 'fn-card-head' }, children);
}

function connectionLabel(uplink) {
	if (uplink && uplink.ssid)
		return 'Wi‑Fi · ' + uplink.ssid;
	const label = valueText(uplink.label, uplink.name);
	if (label !== uplink.name)
		return label;

	return {
		wan: _('Main connection'),
		wan6: _('IPv6 connection'),
		wanb: _('Backup connection'),
		wanb6: _('IPv6 backup connection')
	}[String(uplink.name || '').toLowerCase()] || label;
}

function deviceLabel(uplink) {
	const device = valueText(uplink.device, '');
	if (device === uplink.name)
		return connectionLabel(uplink);
	return device || '–';
}

function protocolLabel(proto) {
	return {
		dhcp: 'DHCP',
		dhcpv6: 'DHCPv6',
		pppoe: 'PPPoE',
		static: _('Static IP')
	}[String(proto || '').toLowerCase()] || valueText(proto);
}

function packageStateText(model) {
	return model.package.mwan3.available
		? _('Install mwan3 from Applications to enable Multi-WAN failover and balancing.')
		: _('This firmware does not currently expose a compatible mwan3 package.');
}

function packageNotice(model) {
	if (model.package.ready)
		return null;

	const body = [ E('span', {}, packageStateText(model)) ];
	body.push(E('a', { href: L.url('admin/system/applications'), class: 'fn-oc-notice-link' }, _('Open Applications')));

	return E('section', { class: 'fn-oc-notice fn-oc-notice-warning' }, [
		E('strong', {}, _('Multi-WAN is not installed'))
	].concat(body));
}

function displayedUplinkState(uplink, state) {
	if (uplink.state === 'online' && state.mode === 'single' && state.selected && uplink !== state.selected)
		return 'unused';
	return uplink.state;
}

function renderUplink(uplink, state) {
	return E('article', { class: 'fn-multiwan-uplink' }, [
		E('div', { class: 'fn-multiwan-uplink-head' }, [
			E('div', {}, [
				E('strong', {}, connectionLabel(uplink)),
				E('div', { class: 'fn-table-sub' }, protocolLabel(uplink.proto))
			]),
			statusPill(displayedUplinkState(uplink, state))
		]),
		E('div', { class: 'fn-multiwan-uplink-summary' }, [
			E('span', {}, deviceLabel(uplink)),
			E('span', {}, protocolLabel(uplink.proto))
		])
	]);
}

function getMultiwanState(uplinks, mode, policies, policyName) {
	return multiwanData.buildTrafficState(uplinks, mode, policies, policyName);
}

function renderCurrentCard(state) {
	const checking = state.heroState === 'checking';
	const online = state.uplinks.filter(uplink => uplink.state === 'online');
	const balancing = state.mode === 'balance' && online.length > 1;
	const currentText = balancing
		? _('Traffic is distributed across %d connections.').format(online.length)
		: checking
		? _('Checking whether this connection has Internet access.')
		: state.current
		? _('Internet works through %s.').format(connectionLabel(state.current))
		: _('No active Internet connection. Check the connection settings.');

	return E('section', { class: 'fn-card fn-multiwan-summary-card' }, [
		cardHead('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', _('Internet'), [ 'admin', 'network', 'internet' ]),
		E('div', { class: 'fn-card-body fn-multiwan-summary-body' }, [
			E('div', { class: 'fn-multiwan-card-status' }, [
				statusPill(state.heroState),
				E('strong', {}, checking ? _('Checking Internet access') : state.current ? _('Internet is working') : _('Internet is unavailable'))
			]),
			E('div', { class: 'fn-multiwan-card-primary' }, balancing ? _('Load balancing') : state.fallback ? connectionLabel(state.fallback) : _('None')),
			E('p', { class: 'fn-multiwan-card-description' }, currentText),
			balancing ? E('div', { class: 'fn-multiwan-card-meta' }, [
				infoItem(_('Connections'), online.map(connectionLabel).join(', '))
			]) : state.fallback ? E('div', { class: 'fn-multiwan-card-meta' }, [
				infoItem(_('Protocol'), protocolLabel(state.fallback.proto)),
				infoItem(_('Device'), deviceLabel(state.fallback))
			]) : null
		].filter(Boolean))
	]);
}

function renderBackupCard(state, wifiUplink, openWifiWizard, removeWifiUplink) {
	const backupChecking = state.backups.find(uplink => uplink.state === 'checking') || null;
	const backupBalancing = state.mode === 'balance' && state.backupOnline;
	const backupActive = state.mode === 'single' && state.backupOnline && state.backupOnline === state.selected;
	const backupUnused = state.mode === 'single' && state.backupOnline && state.backupOnline !== state.selected;
	const backupState = backupUnused ? 'unused' : state.backupOnline ? 'online' : backupChecking ? 'checking' : state.backups.length ? 'offline' : 'disabled';
	const backupTitle = backupActive
		? _('In use now')
		: backupUnused
		? _('Not in use')
		: backupBalancing
			? _('Participates in load balancing')
		: state.backupOnline
		? _('Backup is ready')
		: backupChecking
			? _('Checking Internet access')
		: state.backups.length
			? _('Backup needs attention')
			: _('Backup is not configured');
	const backupDescription = backupActive
		? _('Internet works through %s.').format(connectionLabel(state.backupOnline))
		: backupUnused
		? _('Available, but not selected in this mode.')
		: backupBalancing
			? _('Traffic is also using %s.').format(connectionLabel(state.backupOnline))
		: state.backupOnline
		? _('Ready — %s').format(connectionLabel(state.backupOnline))
		: backupChecking
			? _('Waiting for the connection check to finish.')
		: state.backups.length
			? _('Configured, but not available')
			: _('Add a second Internet connection to keep access online if the main one fails.');

	const actions = [];
	if (!state.backups.length)
		actions.push(E('a', {
			href: L.url('admin/network/ethernet_ports'),
			class: 'fn-settings-btn fn-multiwan-card-action'
		}, _('Connect Ethernet cable')));
	if (wifiUplink && wifiUplink.configured)
		actions.push(E('button', {
			type: 'button', class: 'fn-settings-btn fn-multiwan-card-action', click: removeWifiUplink
		}, _('Remove Wi-Fi backup')));
	else
		actions.push(E('button', {
			type: 'button', class: 'fn-settings-btn fn-settings-btn-primary fn-multiwan-card-action', click: openWifiWizard
		}, _('Connect nearby Wi-Fi')));

	return E('section', { class: 'fn-card fn-multiwan-summary-card' }, [
		cardHead('M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z', _('Backup connection'), [ 'admin', 'network', 'internet' ]),
		E('div', { class: 'fn-card-body fn-multiwan-summary-body' }, [
			E('div', { class: 'fn-multiwan-card-status' }, [
				statusPill(backupState),
				E('strong', {}, backupTitle)
			]),
			E('div', { class: 'fn-multiwan-card-primary' }, state.backupOnline ? connectionLabel(state.backupOnline) : _('Not configured')),
			E('p', { class: 'fn-multiwan-card-description' }, backupDescription),
			E('div', { class: 'fn-multiwan-card-actions' }, actions)
		].filter(Boolean))
	]);
}

function flowStateClass(uplink) {
	return uplink.state === 'online' ? 'fn-flow-online' : uplink.state === 'offline' ? 'fn-flow-offline' : 'fn-flow-idle';
}

function renderFlowDiagram(state, mode, singleInterface) {
	const channels = state.uplinks.slice(0, 7);
	const single = channels.find(uplink => uplink.name === singleInterface) || state.selected || state.primary;
	const failoverCurrent = channels.find(uplink => uplink.state === 'online') || null;
	const lanes = channels.length
		? channels.map(uplink => {
				const live = uplink.state === 'online' && (mode === 'balance' ||
					(mode === 'failover' && uplink === failoverCurrent) ||
					(mode === 'single' && uplink === single));
				const shownState = mode === 'single' && uplink.state === 'online' && uplink !== single
					? 'unused' : uplink.state;
			return E('div', { class: 'fn-multiwan-flow-lane ' + flowStateClass({ state: shownState }) }, [
				E('div', { class: 'fn-multiwan-flow-source' }, [
					E('strong', {}, connectionLabel(uplink)),
					statusPill(shownState)
				]),
				E('div', { class: 'fn-multiwan-flow-wire' + (live ? ' fn-flow-live' : '') }, [
					E('span', { class: 'fn-multiwan-flow-pulse', 'aria-hidden': 'true' })
				])
			]);
		})
		: [ E('p', { class: 'fn-info-empty' }, _('No Internet connection is available for the diagram.')) ];

	const hasLiveConnection = mode === 'single'
		? !!(single && single.state === 'online')
		: mode === 'failover' ? !!failoverCurrent : channels.some(uplink => uplink.state === 'online');

	return E('div', { class: 'fn-multiwan-flow-diagram fn-flow-mode-' + mode }, [
		E('div', { class: 'fn-multiwan-flow-inputs' }, lanes),
		E('div', { class: 'fn-multiwan-flow-router' }, [
			svgIcon('M3 12h5M16 12h5M8 7h8v10H8zM10 4h4M10 20h4', 28),
			E('strong', {}, _('Freenetic router')),
			E('span', {}, _('Traffic control'))
		]),
		E('div', { class: 'fn-multiwan-flow-output' }, [
			svgIcon('M4 5h16v14H4zM8 19v2h8v-2M8 9h8M8 13h5', 24),
			E('strong', {}, _('Your devices')),
			E('span', {}, hasLiveConnection ? _('Online') : _('Waiting for connection'))
		])
	]);
}

function modeLabel(mode) {
	return {
		single: _('One connection'),
		failover: _('Backup'),
		balance: _('Load balancing')
	}[mode] || mode;
}

function renderFlowAndModes(state, model, applyModeHandler) {
	const detectedMode = state.mode || (state.backups.length ? 'failover' : 'single');
	let selectedMode = detectedMode;
	const initialSingle = state.singleInterface || state.selected && state.selected.name || state.primary && state.primary.name || '';
	const singleSelect = E('select', {}, state.uplinks.map(uplink =>
		E('option', { value: uplink.name, selected: uplink.name === initialSingle ? '' : null }, connectionLabel(uplink))));
	const singleChoice = E('div', {
		class: 'fn-multiwan-single-choice', hidden: detectedMode !== 'single' ? '' : null
	}, [
		E('label', {}, _('Use connection')),
		singleSelect
	]);
	const flowHolder = E('div', { class: 'fn-multiwan-flow-holder' }, [
		renderFlowDiagram(state, detectedMode, initialSingle)
	]);
	const refreshPreview = () => {
		while (flowHolder.firstChild)
			flowHolder.removeChild(flowHolder.firstChild);
		flowHolder.appendChild(renderFlowDiagram(state, selectedMode, singleSelect.value));
	};
	singleSelect.addEventListener('change', refreshPreview);
	const modes = [
		{ id: 'single', title: _('One connection'), text: _('Use one Internet connection.') },
		{ id: 'failover', title: _('Backup'), text: _('Switch to backup if the main connection fails.') },
		{ id: 'balance', title: _('Load balancing'), text: _('Distribute new connections across available lines.') }
	];
	const options = modes.map(mode => {
		const unavailable = mode.id !== 'single' && state.uplinks.length < 2;
		const attributes = {
			type: 'button',
			class: 'fn-multiwan-mode-option' + (mode.id === detectedMode ? ' fn-mode-selected' : ''),
			'aria-pressed': mode.id === detectedMode ? 'true' : 'false'
		};
		if (unavailable)
			attributes.disabled = '';
		const option = E('button', attributes, [
			E('strong', {}, mode.title),
			E('span', {}, mode.text)
		]);
		option.addEventListener('click', () => {
			selectedMode = mode.id;
			singleChoice.hidden = selectedMode !== 'single';
			options.forEach(item => {
				const selected = item === option;
				item.classList.toggle('fn-mode-selected', selected);
				item.setAttribute('aria-pressed', selected ? 'true' : 'false');
			});
			refreshPreview();
		});
		return option;
	});
	const applyButton = E('button', {
		type: 'button',
		class: 'fn-settings-btn fn-settings-btn-primary fn-multiwan-mode-apply',
	}, _('Apply mode'));
	applyButton.addEventListener('click', () => {
		if (!model.package.ready) {
			notify(_('Multi-WAN is not installed'), 'warning');
			return;
		}
		if (!state.uplinks.length) {
			notify(_('No active Internet connection is available.'), 'warning');
			return;
		}
		applyButton.disabled = true;
		applyButton.textContent = _('Applying…');
		Promise.resolve().then(() => applyModeHandler(selectedMode,
			selectedMode === 'single' ? singleSelect.value : '')).then(() => {
			window.location.reload();
		}).catch(error => {
			notify(_('Could not apply Multi-WAN mode: %s').format(error.message || error), 'danger');
			window.setTimeout(() => window.location.reload(), 900);
		});
	});

	return [
		E('section', { class: 'fn-card fn-multiwan-flow-card' }, [
			cardHead('M3 12h18M3 6h12M3 18h8M16 4l4 4-4 4M14 16l4 4 4-4', _('Traffic flow')),
			E('div', { class: 'fn-card-body' }, [ flowHolder ])
		]),
		E('section', { class: 'fn-card fn-multiwan-mode-selector' }, [
			cardHead('M4 6h16M4 12h16M4 18h16', _('How traffic works')),
			E('div', { class: 'fn-card-body' }, [
				E('div', { class: 'fn-multiwan-mode-options' }, options),
				E('div', { class: 'fn-multiwan-mode-actions' }, [ singleChoice, applyButton ]),
				E('p', { class: 'fn-multiwan-preview-note' }, _('Preview changes immediately. Applying the mode updates default Internet traffic; custom routing rules stay unchanged.'))
			])
		])
	];
}

return view.extend({
	multiwanErrorMessage(result) {
		return {
			'no-internet': _('The selected connection does not currently have Internet access.'),
			'invalid-interface': _('The selected Internet connection is unavailable.'),
			'uplink-limit': _('Freenetic supports up to seven Internet connections.'),
			'busy': _('Another network operation is still running.')
		}[result && result.error_code] || result && result.error || _('The Multi-WAN controller did not return a valid response.');
	},

	wifiErrorMessage(result) {
		return {
			'invalid-radio': _('The selected Wi-Fi radio is unavailable.'),
			'invalid-ssid': _('The selected Wi-Fi name is invalid.'),
			'invalid-key': _('Enter the correct Wi-Fi password.'),
			'no-dhcp': _('The Wi-Fi network did not provide an IP address. Check its password and DHCP settings.'),
			'no-internet': _('The Wi-Fi network connected, but Internet access could not be confirmed.'),
			'subnet-conflict': _('This Wi-Fi network uses the same subnet as the Home network.'),
			'ownership-conflict': _('The Wi-Fi uplink configuration is managed outside Freenetic.'),
			'busy': _('Another network operation is still running.')
		}[result && result.error_code] || result && result.error || _('The Wi-Fi uplink controller did not return a valid response.');
	},

	refreshView() {
		return this.load().then(data => {
			const current = document.querySelector('.fn-multiwan-page');
			const replacement = this.render(data);
			if (current)
				current.replaceWith(replacement);
		});
	},

	openWifiWizard() {
		const radios = this.radios || [];
		if (!radios.length) {
			notify(_('No enabled Wi-Fi radio is available for scanning.'), 'warning');
			return;
		}

		let selected = null;
		const radioSelect = E('select', {}, radios.map(radio =>
			E('option', { value: radio.name }, radio.band + ' · ' + radio.name)));
		const networkList = E('div', { class: 'fn-wifi-uplink-networks' });
		const status = E('div', { class: 'fn-backup-wizard-status' });
		const password = E('input', {
			type: 'password', autocomplete: 'new-password', placeholder: _('Wi-Fi password')
		});
		const passwordField = E('div', { class: 'fn-settings-field', hidden: true }, [
			E('label', {}, _('Password')), password
		]);
		const connect = E('button', {
			class: 'btn cbi-button-positive', disabled: ''
		}, _('Connect as backup'));

		const setBusy = busy => {
			radioSelect.disabled = busy;
			connect.disabled = busy || !selected || !selected.security.supported;
			networkList.querySelectorAll('button').forEach(button => { button.disabled = busy || button.dataset.unsupported === '1'; });
		};
		const scan = () => {
			selected = null;
			password.value = '';
			passwordField.hidden = true;
			while (networkList.firstChild)
				networkList.removeChild(networkList.firstChild);
			status.className = 'fn-backup-wizard-status spinning';
			status.textContent = _('Scanning nearby networks…');
			setBusy(true);
			const radio = radios.find(item => item.name === radioSelect.value);
			return ubusCall('iwinfo', 'scan', { device: radio.device }).then(result => {
				const networks = (result.results || []).filter(network => network.ssid).sort((a, b) => Number(b.signal) - Number(a.signal));
				status.className = 'fn-backup-wizard-status';
				status.textContent = networks.length ? _('Select the Wi-Fi network to use as backup.') : _('No nearby Wi-Fi networks were found.');
				networks.forEach(network => {
					const security = scanSecurity(network);
					const attributes = {
						type: 'button', class: 'fn-wifi-uplink-network', 'data-unsupported': security.supported ? '0' : '1'
					};
					if (!security.supported)
						attributes.disabled = '';
					const button = E('button', attributes, [
						E('span', { class: 'fn-wifi-uplink-network-name' }, network.ssid),
						E('span', { class: 'fn-wifi-uplink-network-meta' }, security.label + ' · ' + signalLabel(network))
					]);
					button.addEventListener('click', () => {
						selected = { network, security };
						networkList.querySelectorAll('button').forEach(item => item.classList.toggle('selected', item === button));
						passwordField.hidden = security.mode === 'none';
						connect.disabled = false;
						if (!passwordField.hidden)
							password.focus();
					});
					networkList.appendChild(button);
				});
			}).catch(() => {
				status.className = 'fn-backup-wizard-status fn-backup-wizard-error';
				status.textContent = _('Failed to scan nearby networks.');
			}).finally(() => setBusy(false));
		};

		radioSelect.addEventListener('change', scan);
		connect.addEventListener('click', () => {
			if (!selected)
				return;
			if (selected.security.mode !== 'none' && password.value.length < 8) {
				status.className = 'fn-backup-wizard-status fn-backup-wizard-error';
				status.textContent = _('Enter the Wi-Fi password.');
				return;
			}
			status.className = 'fn-backup-wizard-status spinning';
			status.textContent = _('Connecting and checking Internet access…');
			setBusy(true);
			fs.exec_direct(WIFI_UPLINK_HELPER, [
				'connect', radioSelect.value, selected.network.ssid,
				selected.security.mode, password.value
			], 'json').then(result => {
				if (!result || result.ok !== true)
					throw new Error(this.wifiErrorMessage(result));
				ui.hideModal();
				notify(_('Wi-Fi backup connected: %s').format(selected.network.ssid), 'info');
				return this.refreshView();
			}).catch(error => {
				status.className = 'fn-backup-wizard-status fn-backup-wizard-error';
				status.textContent = error.message || error;
				setBusy(false);
			});
		});

		ui.showModal(_('Connect backup through Wi-Fi'), [
			E('div', { class: 'fn-backup-wizard fn-wifi-uplink-wizard' }, [
				E('p', {}, _('Choose a nearby Wi-Fi network. Freenetic will connect to it as a separate Internet line.')),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Wi-Fi radio')), radioSelect ]),
				E('p', { class: 'fn-wifi-uplink-warning' }, _('The Home Wi-Fi on this radio may briefly reconnect and will use the same channel as the selected network.')),
				networkList,
				passwordField,
				status
			]),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				connect
			])
		]);
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-wifi-uplink-modal');
		scan();
	},

	removeWifiUplink() {
		if (!window.confirm(_('Remove the Freenetic Wi-Fi backup connection?')))
			return;
		notify(_('Removing the Wi-Fi backup…'), 'info');
		return fs.exec_direct(WIFI_UPLINK_HELPER, [ 'remove' ], 'json').then(result => {
			if (!result || result.ok !== true)
				throw new Error(this.wifiErrorMessage(result));
			notify(_('Wi-Fi backup removed.'), 'info');
			return this.refreshView();
		}).catch(error => notify(_('Could not remove Wi-Fi backup: %s').format(error.message || error), 'danger'));
	},

	applyMultiwanMode(mode, selectedInterface) {
		const args = [ 'apply', mode ];
		if (mode === 'single' && selectedInterface)
			args.push(selectedInterface);
		return fs.exec_direct(MULTIWAN_HELPER, args, 'json').then(result => {
			if (!result || !result.ok)
				throw new Error(this.multiwanErrorMessage(result));
			return result;
		});
	},

	load() {
		return Promise.all([
			fs.exec_direct(MULTIWAN_HELPER, [ 'status' ], 'json').catch(() => null),
			fs.exec_direct(PACKAGE_STATUS_HELPER, PACKAGE_NAMES, 'json').catch(() => null),
			fs.exec_direct(WIFI_UPLINK_HELPER, [ 'status' ], 'json').catch(() => null),
			getWirelessConfig(),
			getWirelessStatus(),
			getIwinfoDevices()
		]);
	},

	render(data) {
		const backend = data[0] && data[0].ok ? data[0] : { ready: false, interfaces: [], mode: 'single' };
		const wifiUplink = data[2] && data[2].ok ? data[2] : { configured: false };
		this.radios = wifiRadios(data[3], data[4], data[5]);
		const packageModel = multiwanData.buildModel({}, [], [], data[1] || {}, {}).package;
		const model = {
			package: Object.assign({}, packageModel, { ready: backend.ready === true }),
			uplinks: Array.isArray(backend.interfaces) ? backend.interfaces : [],
			policies: backend.mode === 'single' && backend.policy && backend.single_interface ? [ {
				name: backend.policy,
				members: [ { interface: backend.single_interface } ]
			} ] : []
		};
		const visibleUplinks = model.uplinks.filter(uplink => uplink.enabled !== false).map(uplink => {
			if (wifiUplink.configured && uplink.name === wifiUplink.name)
				return Object.assign({}, uplink, { ssid: wifiUplink.ssid || '', scope: 'wifi-uplink' });
			return uplink;
		});
		const state = getMultiwanState(visibleUplinks, backend.mode || 'single', model.policies, backend.policy || '');
		state.singleInterface = backend.single_interface || '';
		const flowAndModes = renderFlowAndModes(state, model,
			(mode, selectedInterface) => this.applyMultiwanMode(mode, selectedInterface));
		const uplinkBody = visibleUplinks.length
			? E('div', { class: 'fn-multiwan-uplinks' }, visibleUplinks.map(uplink => renderUplink(uplink, state)))
			: E('div', { class: 'fn-info-empty' }, _('No mwan3 uplinks are configured yet. Install mwan3, then the editor will let you define failover and balancing members.'));

		const page = [
			E('h1', { class: 'fn-pf-title' }, _('Multi-WAN')),
			E('p', { class: 'fn-pf-description' }, _('Connect a second Internet line and keep access online if the main one fails.')),
			packageNotice(model),
			E('div', { class: 'fn-dash fn-multiwan-dashboard' }, [
				renderCurrentCard(state),
				renderBackupCard(state, wifiUplink,
					() => this.openWifiWizard(), () => this.removeWifiUplink())
			]),
			...flowAndModes,
			E('section', { class: 'fn-card fn-multiwan-section' }, [
				cardHead('M3 12h18M3 6h12M3 18h8M16 4l4 4-4 4M14 16l4 4 4-4', _('Internet connections'), [ 'admin', 'network', 'internet' ]),
				E('div', { class: 'fn-card-body' }, [ uplinkBody ])
			])
		];

		return E('div', { class: 'fn-pf-page fn-multiwan-page' }, page.filter(Boolean));
	},

	/* Mode changes are applied immediately through the dedicated button. The
	 * global LuCI save bar would imply unrelated pending UCI changes here. */
	addFooter() { return E([]); }
});
