'use strict';
'require view';
'require ui';
'require uci';
'require freenetic-network as networkHelper';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). Writes go through the real 'uci' module, same as everywhere else. */
const ubusCall = rpc.call;

const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function eyeIcon() {
	const span = E('span', {});
	span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
	return span;
}

/* Minimal from-scratch reimplementation of LuCI's <div class="cbi-dropdown">
   widget (see cascade.css for the full CSS contract) — this view builds its
   own DOM instead of going through LuCI's form.js/cbi machinery, so a plain
   <select> here would render with no OS-level way to theme the open option
   list; this reuses the same markup/CSS the rest of the theme already relies
   on so the popup itself (not just the closed box) matches everywhere else. */
function buildDropdown(options, initialValue) {
	const ul = E('ul', {});
	const selectedLabel = E('span', { class: 'fn-wan-dropdown-value' });

	function renderClosed(value) {
		dom_empty(ul);
		selectedLabel.textContent = (options.find(opt => opt.value === value) || {}).label || value || '–';
		options.forEach(opt => {
			const li = E('li', { 'data-value': opt.value }, opt.label);
			if (opt.value === value) {
				li.setAttribute('display', '');
				li.setAttribute('selected', '');
			}
			ul.appendChild(li);
		});
	}

	const wrap = E('div', { class: 'cbi-dropdown', tabindex: 0 }, [ selectedLabel, ul, E('span', { class: 'open' }, '▾') ]);
	let value = initialValue;
	renderClosed(value);

	function close() {
		wrap.removeAttribute('open');
		ul.classList.remove('dropdown');
	}
	function toggleOpen() {
		if (wrap.hasAttribute('open')) {
			close();
		} else {
			wrap.setAttribute('open', '');
			ul.classList.add('dropdown');
		}
	}

	wrap.addEventListener('click', ev => {
		const li = ev.target.closest('li');
		if (wrap.hasAttribute('open') && li) {
			value = li.getAttribute('data-value');
			renderClosed(value);
			wrap.dispatchEvent(new Event('change', { bubbles: true }));
			close();
		} else {
			toggleOpen();
		}
		ev.stopPropagation();
	});
	wrap.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
	const outsideClick = ev => { if (!wrap.contains(ev.target)) close(); };
	document.addEventListener('click', outsideClick);
	wrap.__freeneticDestroy = () => document.removeEventListener('click', outsideClick);

	Object.defineProperty(wrap, 'value', {
		get: () => value,
		set: v => { value = v; renderClosed(value); }
	});

	return wrap;
}

function passwordField(value, placeholder) {
	const input = E('input', { type: 'password', class: 'fn-input', value: value || '', placeholder: placeholder || '' });
	const toggle = E('button', { type: 'button', class: 'fn-eye-toggle', 'aria-label': _('Show password') }, eyeIcon());
	toggle.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
	return { wrap: E('div', { class: 'fn-field fn-field-password fn-mn-password' }, [ input, toggle ]), input };
}

function fmtUptime(seconds) {
	seconds = seconds || 0;
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d > 0)
		return '%d d %02d:%02d:%02d'.format(d, h, m, s);
	return '%02d:%02d:%02d'.format(h, m, s);
}

function getInterfaceStatus(name) {
	return ubusCall('network.interface', 'status', { interface: name }).catch(() => null);
}

function getWanStatus() {
	return getInterfaceStatus('wan');
}

function getWan6Status() {
	return getInterfaceStatus('wan6');
}

function listValue(value) {
	return Array.isArray(value) ? value : (value ? [ value ] : []);
}

function interfaceSection(name) {
	return uci.sections('network', 'interface').find(section => section['.name'] === name);
}

const EDITED_WAN4_OPTIONS = [
	'disabled', 'proto', 'username', 'password', 'ipaddr', 'netmask', 'gateway',
	'dns', 'peerdns', 'device'
];
const EDITED_WAN6_OPTIONS = [
	'disabled', 'proto', 'device', 'ip6addr', 'ip6gw', 'ip6prefix',
	'reqaddress', 'reqprefix', 'dns', 'peerdns'
];

function advancedInterfaceOptions(section, editedOptions) {
	return Object.keys(section || {}).filter(key => key.charAt(0) !== '.' &&
		editedOptions.indexOf(key) === -1);
}

/* A VLAN'd WAN rides an explicit `config device` (type '8021q') that
   network.wan.device then points at, instead of the raw port name — see
   OpenWrt's 8021q device docs. Locate that section (if any) so the form can
   show/edit the VLAN ID without caring whether it currently exists. */
function findVlanDevice(deviceName) {
	let result = {
		vid: '',
		baseIfname: deviceName,
		sectionName: null,
		deviceName: null,
		managed: false
	};
	let explicitDevice = false;
	uci.sections('network', 'device').forEach(s => {
		if (s.name === deviceName)
			explicitDevice = true;
		if (s.type === '8021q' && s.name === deviceName) {
			result = {
				vid: s.vid || '',
				baseIfname: s.ifname || deviceName,
				sectionName: s['.name'],
				deviceName: s.name,
				managed: s.freenetic_managed === '1'
			};
		}
	});
	/* Traditional eth0.123 notation has no config-device section. */
	if (!explicitDevice) {
		const legacy = /^(.*)\.(\d{1,4})$/.exec(String(deviceName || ''));
		if (legacy && Number(legacy[2]) >= 1 && Number(legacy[2]) <= 4094) {
			result.vid = legacy[2];
			result.baseIfname = legacy[1];
			result.deviceName = deviceName;
			result.legacy = true;
		}
	}
	return result;
}

const WAN4_PROTOCOLS = [ 'dhcp', 'pppoe', 'static' ];
const WAN6_PROTOCOLS = [ 'dhcpv6', 'static' ];

function protocolOptions(protocol, ipv6) {
	const options = ipv6 ? [
		{ value: 'dhcpv6', label: _('Automatic (DHCPv6)') },
		{ value: 'static', label: _('Static IPv6') }
	] : [
		{ value: 'dhcp', label: _('Automatic (DHCP)') },
		{ value: 'pppoe', label: _('PPPoE') },
		{ value: 'static', label: _('Static IP') }
	];
	if ((ipv6 ? WAN6_PROTOCOLS : WAN4_PROTOCOLS).indexOf(protocol) === -1)
		options.push({ value: protocol, label: _('Existing protocol: %s (preserved)').format(String(protocol).toUpperCase()) });
	return options;
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('network'),
			getWanStatus(),
			getWan6Status()
		]);
	},

	hasForeignDeviceReferences(deviceName, ownSectionName) {
		if (!deviceName)
			return false;
		const interfaceReference = uci.sections('network', 'interface').some(section =>
			section['.name'] !== 'wan' && section['.name'] !== 'wan6' && section.device === deviceName);
		const bridgeReference = uci.sections('network', 'device').some(section =>
			section['.name'] !== ownSectionName && section.type === 'bridge' && listValue(section.ports).indexOf(deviceName) !== -1);
		return interfaceReference || bridgeReference;
	},

	releaseManagedVlan(sectionName) {
		const section = sectionName && uci.get('network', sectionName);
		if (!section || section.freenetic_managed !== '1')
			return;
		if (this.hasForeignDeviceReferences(section.name, sectionName))
			uci.unset('network', sectionName, 'freenetic_managed');
		else
			uci.remove('network', sectionName);
	},

	render(data) {
		this.dropdownNodes = [];
		window.__freeneticActiveView = this;

		this.status = data[1];
		this.status6 = data[2];

		const proto = uci.get('network', 'wan', 'proto') || 'dhcp';
		const disabled = uci.get('network', 'wan', 'disabled') === '1';
		const wanSection = interfaceSection('wan') || {};
		const wan6Section = interfaceSection('wan6') || {};
		const wan4Advanced = advancedInterfaceOptions(wanSection, EDITED_WAN4_OPTIONS);
		const wan6Advanced = advancedInterfaceOptions(wan6Section, EDITED_WAN6_OPTIONS);
		const currentDevice = uci.get('network', 'wan', 'device') || 'wan';
		const vlanInfo = findVlanDevice(currentDevice);
		this.baseIfname = vlanInfo.baseIfname;
		this.vlanInfo = vlanInfo;
		this.vlanSectionName = vlanInfo.managed ? vlanInfo.sectionName : null;

		const enableToggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		enableToggle.checked = !disabled;

		const protoSelect = buildDropdown(protocolOptions(proto, false), proto);

		const userInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'username') || '', placeholder: _('Provided by your ISP') });
		const pass = passwordField(uci.get('network', 'wan', 'password') || '', _('Provided by your ISP'));

		const ipInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'ipaddr') || '', placeholder: '203.0.113.4' });
		const maskInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'netmask') || '', placeholder: '255.255.255.0' });
		const gwInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'gateway') || '', placeholder: '203.0.113.1' });

		const dnsList = [].concat(uci.get('network', 'wan', 'dns') || []);
		const dns1Input = E('input', { type: 'text', class: 'fn-input', value: dnsList[0] || '', placeholder: _('Automatic') });
		const dns2Input = E('input', { type: 'text', class: 'fn-input', value: dnsList[1] || '', placeholder: _('Optional') });

		const vlanInput = E('input', { type: 'text', class: 'fn-input', value: vlanInfo.vid || '', placeholder: _('Not set') });

		const pppoeGroup = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Login')), userInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Password')), pass.wrap ])
		]);
		const staticGroup = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('IP address')), ipInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Subnet mask')), maskInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Gateway')), gwInput ])
		]);

		const updateFieldVisibility = () => {
			pppoeGroup.hidden = protoSelect.value !== 'pppoe';
			staticGroup.hidden = protoSelect.value !== 'static';
		};
		protoSelect.addEventListener('change', updateFieldVisibility);
		updateFieldVisibility();

		const wan4AdvancedNote = wan4Advanced.length ? E('div', { class: 'fn-wan-advanced-note' }, [
			E('strong', {}, _('Additional OpenWrt options detected')),
			E('span', {}, _('This connection contains additional OpenWrt parameters that Freenetic does not display. Saving preserves parameters it does not edit.'))
		]) : '';
		const settingsBody = E('div', { class: 'fn-wan-settings' }, [
			wan4AdvancedNote,
			E('div', { class: 'fn-mn-wifi-head fn-wan-enable-row' }, [
				E('label', { class: 'fn-switch' }, [ enableToggle, E('span', { class: 'fn-switch-slider' }) ]),
				E('span', {}, _('Connection enabled'))
			]),
			E('div', { class: 'fn-kn-row' }, [
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Connection type')), protoSelect ]),
				pppoeGroup,
				staticGroup,
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('VLAN ID')), vlanInput ]),
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 1')), dns1Input ]),
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 2')), dns2Input ])
			])
		]);

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' }, _('Save'));
		saveBtn.addEventListener('click', () => this.save({
			enabled: enableToggle.checked,
			proto: protoSelect.value,
			username: userInput.value.trim(),
			password: pass.input.value,
			ipaddr: ipInput.value.trim(),
			netmask: maskInput.value.trim(),
			gateway: gwInput.value.trim(),
			vlan: vlanInput.value.trim(),
			dns1: dns1Input.value.trim(),
			dns2: dns2Input.value.trim()
		}, saveBtn));

		const wan6Proto = uci.get('network', 'wan6', 'proto') || 'dhcpv6';
		const wan6Disabled = uci.get('network', 'wan6', 'disabled') === '1';
		const wan6Addr = listValue(uci.get('network', 'wan6', 'ip6addr'))[0] || '';
		const wan6Gateway = uci.get('network', 'wan6', 'ip6gw') || '';
		const wan6Prefix = listValue(uci.get('network', 'wan6', 'ip6prefix'))[0] || '';
		const wan6Dns = listValue(uci.get('network', 'wan6', 'dns'));
		const enable6Toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		enable6Toggle.checked = !wan6Disabled;

		const proto6Select = buildDropdown(protocolOptions(wan6Proto, true), wan6Proto);
		const ip6AddrInput = E('input', { type: 'text', class: 'fn-input', value: wan6Addr, placeholder: '2001:db8::2/64' });
		const ip6GatewayInput = E('input', { type: 'text', class: 'fn-input', value: wan6Gateway, placeholder: '2001:db8::1' });
		const ip6PrefixInput = E('input', { type: 'text', class: 'fn-input', value: wan6Prefix, placeholder: '2001:db8:100::/48' });
		const reqAddress6Select = buildDropdown([
			{ value: 'try', label: _('Try to request an address') },
			{ value: 'force', label: _('Require an address') },
			{ value: 'none', label: _('Do not request an address') }
		], uci.get('network', 'wan6', 'reqaddress') || 'try');
		const reqPrefix6Select = buildDropdown([
			{ value: 'auto', label: _('Automatic prefix') },
			{ value: '48', label: _('/48 prefix') },
			{ value: '56', label: _('/56 prefix') },
			{ value: '60', label: _('/60 prefix') },
			{ value: '64', label: _('/64 prefix') },
			{ value: 'no', label: _('Do not request a prefix') }
		], uci.get('network', 'wan6', 'reqprefix') || 'auto');
		const dns6Input1 = E('input', { type: 'text', class: 'fn-input', value: wan6Dns[0] || '', placeholder: _('Automatic') });
		const dns6Input2 = E('input', { type: 'text', class: 'fn-input', value: wan6Dns[1] || '', placeholder: _('Optional') });
		this.dropdownNodes = [ protoSelect, proto6Select, reqAddress6Select, reqPrefix6Select ];

		const static6Group = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('IPv6 address')), ip6AddrInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('IPv6 gateway')), ip6GatewayInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Delegated prefix')), ip6PrefixInput ])
		]);
		const dhcp6Group = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Request address')), reqAddress6Select ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Prefix delegation')), reqPrefix6Select ])
		]);
		const updateIpv6Visibility = () => {
			static6Group.hidden = proto6Select.value !== 'static';
			dhcp6Group.hidden = proto6Select.value !== 'dhcpv6';
		};
		proto6Select.addEventListener('change', updateIpv6Visibility);
		updateIpv6Visibility();

		const wan6AdvancedNote = wan6Advanced.length ? E('div', { class: 'fn-wan-advanced-note' }, [
			E('strong', {}, _('Additional OpenWrt options detected')),
			E('span', {}, _('This connection contains additional OpenWrt parameters that Freenetic does not display. Saving preserves parameters it does not edit.'))
		]) : '';
		const ipv6SettingsBody = E('div', { class: 'fn-wan-settings' }, [
			wan6AdvancedNote,
			E('div', { class: 'fn-mn-wifi-head fn-wan-enable-row' }, [
				E('label', { class: 'fn-switch' }, [ enable6Toggle, E('span', { class: 'fn-switch-slider' }) ]),
				E('span', {}, _('Connection enabled'))
			]),
			E('div', { class: 'fn-kn-row' }, [
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Connection type')), proto6Select ]),
				static6Group,
				dhcp6Group,
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 1')), dns6Input1 ]),
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 2')), dns6Input2 ])
			])
		]);
		const save6Btn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' }, _('Save'));
		save6Btn.addEventListener('click', () => this.saveIpv6({
			enabled: enable6Toggle.checked,
			proto: proto6Select.value,
			address: ip6AddrInput.value.trim(),
			gateway: ip6GatewayInput.value.trim(),
			prefix: ip6PrefixInput.value.trim(),
			reqaddress: reqAddress6Select.value,
			reqprefix: reqPrefix6Select.value,
			dns1: dns6Input1.value.trim(),
			dns2: dns6Input2.value.trim()
		}, save6Btn));

		this.statusPill = E('span', { class: 'fn-status-pill' });
		this.infoGrid = E('div', { class: 'fn-info-grid' });
		this.statusPill6 = E('span', { class: 'fn-status-pill' });
		this.infoGrid6 = E('div', { class: 'fn-info-grid' });
		this.fillStatus(this.status);
		this.fillStatus6(this.status6);

		const makeSettingsCard = (title, body, id, expanded) => {
			const bodyId = 'fn-wan-settings-' + id;
			const head = E('div', {
				class: 'fn-card-head fn-collapse-head',
				role: 'button',
				tabindex: '0',
				'aria-expanded': expanded ? 'true' : 'false',
				'aria-controls': bodyId
			}, [
				E('h3', {}, title),
				E('span', { class: 'fn-collapse-icon', 'aria-hidden': 'true' }, '▾')
			]);
			const content = E('div', { class: 'fn-card-body fn-pf-form fn-wan-settings-content', id: bodyId }, [ body ]);
			const setExpanded = value => {
				content.hidden = !value;
				head.setAttribute('aria-expanded', value ? 'true' : 'false');
			};
			const toggle = () => setExpanded(head.getAttribute('aria-expanded') !== 'true');
			head.addEventListener('click', toggle);
			head.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					toggle();
				}
			});
			setExpanded(expanded);
			return E('div', { class: 'fn-card fn-wan-settings-card', style: 'grid-column: 1 / -1' }, [ head, content ]);
		};

		return E('div', { class: 'fn-dash fn-wan-page' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					svgIcon('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', 20),
					E('h3', {}, _('Internet'))
				]),
				E('div', { class: 'fn-card-body fn-conn-list' }, [
					E('div', { class: 'fn-conn-block' }, [
						E('div', { class: 'fn-conn-head' }, [ E('h4', { class: 'fn-conn-title' }, _('IPv4')), this.statusPill ]),
						this.infoGrid
					]),
					E('div', { class: 'fn-conn-block fn-conn-block-secondary' }, [
						E('div', { class: 'fn-conn-head' }, [ E('h4', { class: 'fn-conn-title' }, _('IPv6')), this.statusPill6 ]),
						this.infoGrid6
					])
				])
			]),
			makeSettingsCard(_('IPv4 connection settings'), E('div', {}, [
				settingsBody,
				E('div', { class: 'fn-pf-actions' }, [ saveBtn ])
			]), 'ipv4', true),
			makeSettingsCard(_('IPv6 connection settings'), E('div', {}, [
				ipv6SettingsBody,
				E('div', { class: 'fn-pf-actions' }, [ save6Btn ])
			]), 'ipv6', false)
		]);
	},

	destroy() {
		(this.dropdownNodes || []).forEach(dropdown => {
			if (dropdown && typeof dropdown.__freeneticDestroy === 'function')
				dropdown.__freeneticDestroy();
		});
		this.dropdownNodes = [];
	},

	fillStatus(wan) {
		const grid = this.infoGrid;
		dom_empty(grid);

		const up = !!(wan && wan.up);
		this.statusPill.className = 'fn-status-pill ' + (up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(this.statusPill, up ? _('Connected') : _('Not connected'));

		const addrs = wan ? (wan['ipv4-address'] || []).map(a => a.address + '/' + a.mask) : [];
		const dns = (wan && wan['dns-server']) || [];
		const gw = wan ? (wan.route || []).find(r => r.target == '0.0.0.0' && r.mask == 0) : null;

		const entries = [
			[ _('Protocol'), wan && wan.proto ? String(wan.proto).toUpperCase() : '–' ],
			[ _('IP address'), addrs.length ? addrs.join(', ') : '–' ],
			[ _('Gateway'), gw ? gw.nexthop : '–' ],
			[ _('DNS'), dns.length ? dns.join(', ') : '–' ],
			[ _('Connected'), wan && wan.uptime > 0 ? fmtUptime(wan.uptime) : '–' ]
		];

		entries.forEach(([label, value]) => {
			grid.appendChild(E('div', { class: 'fn-info-item' }, [
				E('div', { class: 'fn-info-label' }, label),
				E('div', { class: 'fn-info-value' }, value)
			]));
		});
	},

	fillStatus6(wan) {
		const grid = this.infoGrid6;
		dom_empty(grid);

		const up = !!(wan && wan.up);
		this.statusPill6.className = 'fn-status-pill ' + (up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(this.statusPill6, up ? _('Connected') : _('Not connected'));

		const addrs = wan ? (wan['ipv6-address'] || []).map(a => a.address + '/' + a.mask) : [];
		const prefixes = wan ? (wan['ipv6-prefix'] || []).map(p => p.address + '/' + p.mask) : [];
		const dns = (wan && wan['dns-server']) || [];
		const gw = wan ? (wan.route || []).find(r =>
			(r.target === '::' && r.mask == 0) || r.source === '::/0') : null;

		const entries = [
			[ _('Protocol'), wan && wan.proto ? String(wan.proto).toUpperCase() : '–' ],
			[ _('IPv6 address'), addrs.length ? addrs.join(', ') : '–' ],
			[ _('Gateway'), gw ? gw.nexthop : '–' ],
			[ _('Delegated prefix'), prefixes.length ? prefixes.join(', ') : '–' ],
			[ _('DNS'), dns.length ? dns.join(', ') : '–' ],
			[ _('Connected'), wan && wan.uptime > 0 ? fmtUptime(wan.uptime) : '–' ]
		];

		entries.forEach(([label, value]) => {
			grid.appendChild(E('div', { class: 'fn-info-item' }, [
				E('div', { class: 'fn-info-label' }, label),
				E('div', { class: 'fn-info-value' }, value)
			]));
		});
	},

	save(fields, btn) {
		if (fields.proto === 'pppoe' && (!fields.username || !fields.password)) {
			notify(_('Please enter the PPPoE login and password.'), 'warning');
			return;
		}
		if (fields.proto === 'static') {
			if (!networkHelper.validIPv4(fields.ipaddr) || !networkHelper.validIPv4Netmask(fields.netmask) || !networkHelper.validIPv4(fields.gateway)) {
				notify(_('Please enter a valid IP address, subnet mask and gateway.'), 'warning');
				return;
			}
		}
		if (fields.vlan && !/^\d+$/.test(fields.vlan)) {
			notify(_('VLAN ID must be a number.'), 'warning');
			return;
		}
		if (fields.vlan && (fields.vlan < 1 || fields.vlan > 4094)) {
			notify(_('VLAN ID must be between 1 and 4094.'), 'warning');
			return;
		}
		if (fields.dns1 && !networkHelper.validIPv4(fields.dns1)) {
			notify(_('Please enter a valid DNS server address.'), 'warning');
			return;
		}
		if (fields.dns2 && !networkHelper.validIPv4(fields.dns2)) {
			notify(_('Please enter a valid DNS server address.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('network').then(() => {
			if (fields.enabled)
				uci.unset('network', 'wan', 'disabled');
			else
				uci.set('network', 'wan', 'disabled', '1');

			const editableProtocol = WAN4_PROTOCOLS.indexOf(fields.proto) !== -1;
			if (editableProtocol)
				uci.set('network', 'wan', 'proto', fields.proto);

			if (editableProtocol && fields.proto === 'pppoe') {
				uci.set('network', 'wan', 'username', fields.username);
				uci.set('network', 'wan', 'password', fields.password);
				uci.unset('network', 'wan', 'ipaddr');
				uci.unset('network', 'wan', 'netmask');
				uci.unset('network', 'wan', 'gateway');
			} else if (editableProtocol && fields.proto === 'static') {
				uci.set('network', 'wan', 'ipaddr', fields.ipaddr);
				uci.set('network', 'wan', 'netmask', fields.netmask);
				uci.set('network', 'wan', 'gateway', fields.gateway);
				uci.unset('network', 'wan', 'username');
				uci.unset('network', 'wan', 'password');
			} else if (editableProtocol) {
				uci.unset('network', 'wan', 'username');
				uci.unset('network', 'wan', 'password');
				uci.unset('network', 'wan', 'ipaddr');
				uci.unset('network', 'wan', 'netmask');
				uci.unset('network', 'wan', 'gateway');
			}
			/* Unknown protocols may carry protocol-specific credentials and device
			 * options. Only the enabled flag is safe for this compact editor. */
			if (!editableProtocol)
				return uci.save();

			const dns = [ fields.dns1, fields.dns2 ].filter(Boolean);
			if (dns.length) {
				uci.set('network', 'wan', 'dns', dns);
				uci.set('network', 'wan', 'peerdns', '0');
			} else {
				uci.unset('network', 'wan', 'dns');
				uci.unset('network', 'wan', 'peerdns');
			}

			const oldDevice = uci.get('network', 'wan', 'device') || this.baseIfname;
			let newDevice = this.baseIfname;

			if (fields.vlan) {
				const desiredDevice = this.baseIfname + '.' + fields.vlan;
				if (this.vlanInfo && this.vlanInfo.legacy && desiredDevice === this.vlanInfo.deviceName) {
					newDevice = desiredDevice;
				} else {
					const targetInfo = findVlanDevice(desiredDevice);
					const targetMatchesBase = targetInfo.sectionName &&
						targetInfo.baseIfname === this.baseIfname;

					/* A VLAN device that already exists but is not marked is foreign.
					   Reuse it when it is exactly the requested device, but never
					   rewrite its options or claim ownership. */
					if (targetMatchesBase && !targetInfo.managed) {
						if (this.vlanSectionName && this.vlanSectionName !== targetInfo.sectionName) {
							this.releaseManagedVlan(this.vlanSectionName);
						}
						this.vlanSectionName = null;
						newDevice = desiredDevice;
						this.vlanInfo = targetInfo;
					} else {
						let sectionName = this.vlanSectionName;
						const currentManaged = sectionName && uci.get('network', sectionName);
						const changesSharedDevice = currentManaged && currentManaged.freenetic_managed === '1' &&
							(currentManaged.name !== desiredDevice || currentManaged.ifname !== this.baseIfname ||
							 String(currentManaged.vid || '') !== String(fields.vlan));
						if (changesSharedDevice && this.hasForeignDeviceReferences(currentManaged.name, sectionName)) {
							uci.unset('network', sectionName, 'freenetic_managed');
							sectionName = null;
							this.vlanSectionName = null;
						}
						if (targetMatchesBase && targetInfo.managed) {
							if (sectionName && sectionName !== targetInfo.sectionName) {
								this.releaseManagedVlan(sectionName);
							}
							sectionName = targetInfo.sectionName;
						}

						const managedSection = sectionName && uci.get('network', sectionName);
						if (!managedSection || managedSection.freenetic_managed !== '1')
							sectionName = null;
						if (!sectionName)
							sectionName = uci.add('network', 'device');

						uci.set('network', sectionName, 'type', '8021q');
						uci.set('network', sectionName, 'ifname', this.baseIfname);
						uci.set('network', sectionName, 'vid', fields.vlan);
						uci.set('network', sectionName, 'name', desiredDevice);
						uci.set('network', sectionName, 'freenetic_managed', '1');
						this.vlanSectionName = sectionName;
						this.vlanInfo = {
							vid: String(fields.vlan),
							baseIfname: this.baseIfname,
							sectionName,
							deviceName: desiredDevice,
							managed: true
						};
						newDevice = desiredDevice;
					}
				}
			} else if (this.vlanSectionName) {
				this.releaseManagedVlan(this.vlanSectionName);
				this.vlanSectionName = null;
				this.vlanInfo = {
					vid: '',
					baseIfname: this.baseIfname,
					sectionName: null,
					deviceName: this.baseIfname,
					managed: false
				};
			}

			uci.set('network', 'wan', 'device', newDevice);
			if (uci.get('network', 'wan6', 'device') === oldDevice)
				uci.set('network', 'wan6', 'device', newDevice);

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('IPv4 connection settings saved.'), 'info');
			return Promise.all([ getWanStatus(), getWan6Status() ]);
		}).then(statuses => {
			this.status = statuses[0];
			this.status6 = statuses[1];
			this.fillStatus(this.status);
			this.fillStatus6(this.status6);
			btn.disabled = false;
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to save: %s').format(err.message || err), 'danger');
		});
	},

	saveIpv6(fields, btn) {
		if (fields.proto === 'static') {
			if (!networkHelper.validIPv6(fields.address, true) || (fields.gateway && !networkHelper.validIPv6(fields.gateway, false))) {
				notify(_('Please enter a valid IPv6 address with prefix and gateway.'), 'warning');
				return;
			}
			if (fields.prefix && !networkHelper.validIPv6(fields.prefix, true)) {
				notify(_('Please enter a valid delegated IPv6 prefix.'), 'warning');
				return;
			}
		}
		if (fields.dns1 && !(networkHelper.validIPv4(fields.dns1) || networkHelper.validIPv6(fields.dns1, false))) {
			notify(_('Please enter a valid IPv6 DNS server address.'), 'warning');
			return;
		}
		if (fields.dns2 && !(networkHelper.validIPv4(fields.dns2) || networkHelper.validIPv6(fields.dns2, false))) {
			notify(_('Please enter a valid IPv6 DNS server address.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('network').then(() => {
			if (!interfaceSection('wan6'))
				uci.add('network', 'interface', 'wan6');

			if (fields.enabled)
				uci.unset('network', 'wan6', 'disabled');
			else
				uci.set('network', 'wan6', 'disabled', '1');

			const editableProtocol = WAN6_PROTOCOLS.indexOf(fields.proto) !== -1;
			if (editableProtocol)
				uci.set('network', 'wan6', 'proto', fields.proto);
			if (editableProtocol && !uci.get('network', 'wan6', 'device'))
				uci.set('network', 'wan6', 'device', uci.get('network', 'wan', 'device') || this.baseIfname);

			if (editableProtocol && fields.proto === 'static') {
				uci.set('network', 'wan6', 'ip6addr', [ fields.address ]);
				if (fields.gateway)
					uci.set('network', 'wan6', 'ip6gw', fields.gateway);
				else
					uci.unset('network', 'wan6', 'ip6gw');
				if (fields.prefix)
					uci.set('network', 'wan6', 'ip6prefix', [ fields.prefix ]);
				else
					uci.unset('network', 'wan6', 'ip6prefix');
				uci.unset('network', 'wan6', 'reqaddress');
				uci.unset('network', 'wan6', 'reqprefix');
			} else if (editableProtocol) {
				uci.unset('network', 'wan6', 'ip6addr');
				uci.unset('network', 'wan6', 'ip6gw');
				uci.unset('network', 'wan6', 'ip6prefix');
				uci.set('network', 'wan6', 'reqaddress', fields.reqaddress);
				uci.set('network', 'wan6', 'reqprefix', fields.reqprefix);
			}
			if (!editableProtocol)
				return uci.save();

			const dns = [ fields.dns1, fields.dns2 ].filter(Boolean);
			if (dns.length) {
				uci.set('network', 'wan6', 'dns', dns);
				uci.set('network', 'wan6', 'peerdns', '0');
			} else {
				uci.unset('network', 'wan6', 'dns');
				uci.unset('network', 'wan6', 'peerdns');
			}

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('IPv6 connection settings saved.'), 'info');
			return getWan6Status();
		}).then(status => {
			this.status6 = status;
			this.fillStatus6(status);
			btn.disabled = false;
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to save IPv6 settings: %s').format(err.message || err), 'danger');
		});
	},

	addFooter() { return E([]); }
});
