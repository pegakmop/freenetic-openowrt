'use strict';
'require baseclass';
'require fs';
'require uci';
'require freenetic-rpc as rpc';

/* Protocol constants, UCI normalization and provider helpers. The view
 * owns forms and user actions; this module owns protocol semantics. */
const ubusCall = rpc.call;

const NETWORK_RESTART_HELPER = '/usr/libexec/freenetic-network-restart';

const WG_PROTO = 'wireguard';
const AWG_PROTO = 'amneziawg';
const OVPN_PROTO = 'openvpn';
const L2TP_PROTO = 'l2tp';
const XFRM_PROTO = 'xfrm';
const L2TP_IPSEC_PROTO = 'l2tp_ipsec';
const IKEV2_PROTO = 'ikev2';
const WG_PEER_TYPE = 'wireguard_';
const AWG_PEER_TYPE = 'amneziawg_';
const IPSEC_CONFIG = 'ipsec';
const IPSEC_GLOBALS = 'globals';
const OPENVPN_PROFILE_DIR = '/etc/openvpn/freenetic';
const OPENVPN_PROFILE_HELPER = '/usr/libexec/freenetic-openvpn-profile';
const OPENVPN_PROFILE_MAX = 512 * 1024;
const IPSEC_RESTART_HELPER = '/usr/libexec/freenetic-ipsec-restart';
const IPSEC_STATUS_HELPER = '/usr/libexec/freenetic-ipsec-status';
const PACKAGE_STATUS_HELPER = '/usr/libexec/freenetic-package-status';
const L2TP_IPSEC_PACKAGES = [ 'xl2tpd', 'ppp-mod-pppol2tp', 'kmod-l2tp', 'kmod-pppol2tp', 'strongswan-default', 'luci-proto-ppp' ];
const IKEV2_PACKAGES = [ 'strongswan-default', 'strongswan-mod-eap-identity', 'strongswan-mod-eap-mschapv2', 'xfrm', 'kmod-xfrm-interface', 'luci-proto-xfrm' ];

const OPENVPN_VARIANTS = [ 'openvpn-openssl', 'openvpn-mbedtls', 'openvpn-wolfssl', 'openvpn' ];
const CONNECTION_PACKAGE_NAMES = Array.from(new Set([
	'wireguard-tools', 'kmod-wireguard', 'amneziawg-tools', 'kmod-amneziawg',
	'luci-proto-amneziawg', ...L2TP_IPSEC_PACKAGES, ...IKEV2_PACKAGES,
	...OPENVPN_VARIANTS
]));

const AWG_OPTIONS = [
	[ 'awg_jc', 'Jc', 0, 65535 ],
	[ 'awg_jmin', 'Jmin', 0, 65535 ],
	[ 'awg_jmax', 'Jmax', 0, 65535 ],
	[ 'awg_s1', 'S1', 0, 65535 ],
	[ 'awg_s2', 'S2', 0, 65535 ],
	[ 'awg_h1', 'H1', 0, 4294967295 ],
	[ 'awg_h2', 'H2', 0, 4294967295 ],
	[ 'awg_h3', 'H3', 0, 4294967295 ],
	[ 'awg_h4', 'H4', 0, 4294967295 ]
];

const EDITED_PEER_OPTIONS = [
	'description', 'disabled', 'public_key', 'private_key', 'preshared_key',
	'allowed_ips', 'endpoint_host', 'endpoint_port', 'persistent_keepalive',
	'route_allowed_ips', 'freenetic_managed'
];

function advancedPeerOptions(peer) {
	return Object.keys(peer || {}).filter(key => key.charAt(0) !== '.' &&
		EDITED_PEER_OPTIONS.indexOf(key) === -1);
}

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST_RE = /^[A-Za-z0-9._:[\]%~-]+$/;

function restartNetifd() {
	return fs.exec_direct(NETWORK_RESTART_HELPER, [], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('The network service did not restart.'));
		return result;
	});
}

function restartIpsec() {
	return fs.exec_direct(IPSEC_RESTART_HELPER, [], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('The IPsec service did not restart.'));
		return result;
	});
}

function listValue(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value.slice() : [ value ];
}

function listText(value) {
	return listValue(value).join(', ');
}

function parseList(value) {
	return String(value || '').replace(/[\r\n,]+/g, ' ').split(/\s+/).map(v => v.trim()).filter(Boolean);
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

/* UCI section names are intentionally short and deterministic.  Provider
 * names are user-controlled, so never use them directly as IPsec section
 * identifiers (UCI limits names to 15 characters on some releases). */
function sectionToken(value) {
	let hash = 0;
	String(value || '').split('').forEach(character => {
		hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
	});
	return (hash >>> 0).toString(36).slice(0, 7) || 'default';
}

function managedIpsecSection(prefix, value) {
	return prefix + sectionToken(value);
}

function ipsecSection(config, type, name) {
	return uci.sections(config, type).find(section => sectionName(section) === name) || null;
}

function ipsecList(section, option) {
	return listValue(section && section[option]);
}

function validSecret(value, optional) {
	value = String(value || '');
	return optional && !value || value.length > 0 && value.length <= 4096 &&
		value.indexOf('\0') === -1 && value.indexOf('\r') === -1 && value.indexOf('\n') === -1 &&
		value.indexOf('"') === -1 && value.indexOf('\\') === -1;
}

function validSelector(value) {
	value = String(value || '').trim();
	if (!value)
		return false;
	return validAddress(value);
}

function validServer(value) {
	const endpoint = parseEndpoint(value);
	return !!endpoint.host && validHost(endpoint.host) && validPort(endpoint.port, true);
}

function ipsecProtocolLabel(protocol) {
	return protocol === L2TP_IPSEC_PROTO ? _('L2TP/IPsec') : _('IKEv2/IPsec');
}

function validKey(value, optional) {
	value = String(value || '').trim();
	return optional && !value || value === 'generate' || KEY_RE.test(value);
}

function validIPv4(value) {
	if (!IPV4_RE.test(String(value || '')))
		return false;
	return String(value).split('.').every(part => +part >= 0 && +part <= 255);
}

function validAddress(value) {
	value = String(value || '').trim();
	const parts = value.split('/');
	if (parts.length > 2 || !parts[0])
		return false;
	if (parts[0].indexOf(':') !== -1) {
		if (!/^[0-9a-f:]+$/i.test(parts[0]) || (parts[0].match(/::/g) || []).length > 1)
			return false;
		const groups = parts[0].split('::');
		const count = p => p ? p.split(':').filter(Boolean).length : 0;
		if (groups.length === 1 && count(groups[0]) !== 8)
			return false;
		if (groups.length === 2 && count(groups[0]) + count(groups[1]) >= 8)
			return false;
		return parts.length === 1 || /^\d+$/.test(parts[1]) && +parts[1] <= 128;
	}
	return validIPv4(parts[0]) && (parts.length === 1 || /^\d+$/.test(parts[1]) && +parts[1] <= 32);
}

function validHost(value) {
	value = String(value || '').trim();
	return !value || HOST_RE.test(value);
}

function validPort(value, optional) {
	value = String(value || '').trim();
	return optional && !value || /^\d+$/.test(value) && +value > 0 && +value <= 65535;
}

function validNumber(value, min, max) {
	value = String(value || '').trim();
	return !value || /^\d+$/.test(value) && +value >= min && +value <= max;
}

function formatBytes(value) {
	value = +value || 0;
	if (value < 1024)
		return '%d B'.format(value);
	if (value < 1024 * 1024)
		return '%.1f KiB'.format(value / 1024);
	if (value < 1024 * 1024 * 1024)
		return '%.1f MiB'.format(value / (1024 * 1024));
	return '%.2f GiB'.format(value / (1024 * 1024 * 1024));
}

function formatAge(seconds) {
	seconds = +seconds || 0;
	if (!seconds)
		return _('Never');
	const age = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
	if (age < 60)
		return _('%d sec ago').format(age);
	if (age < 3600)
		return _('%d min ago').format(Math.floor(age / 60));
	if (age < 86400)
		return _('%d h ago').format(Math.floor(age / 3600));
	return _('%d d ago').format(Math.floor(age / 86400));
}

function shortKey(value) {
	value = String(value || '');
	return value ? value.slice(0, 8) + '…' + value.slice(-6) : '–';
}

function svgIcon(d, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function getInterfaceDump() {
	return ubusCall('network.interface', 'dump', { verbose: true }).catch(() => ({}));
}

function normalizeDumpStatus(data) {
	const result = {};
	Object.keys(data || {}).forEach(name => {
		const device = data[name] || {};
		const peers = {};
		(device.peers || []).forEach(peer => {
			if (!peer || !peer.public_key)
				return;
			peers[peer.public_key] = {
				last_handshake: +peer.latest_handshake || 0,
				rx_bytes: +peer.transfer_rx || 0,
				tx_bytes: +peer.transfer_tx || 0,
				endpoint: peer.endpoint || ''
			};
		});
		result[name] = {
			private_key: device.private_key || '',
			listen_port: device.listen_port || '',
			fwmark: device.fwmark || '',
			peers: peers
		};
	});
	return result;
}

function getWireGuardStatus() {
	return Promise.all([
		ubusCall('luci.wireguard', 'getWgInstances', {}).then(data => ({ available: true, data: normalizeDumpStatus(data) }))
			.catch(() => ({ available: false, data: {} })),
		ubusCall('wireguard', 'status', {}).then(data => ({ available: true, data: data || {} }))
			.catch(() => ({ available: false, data: {} })),
		ubusCall('luci.amneziawg', 'getWgInstances', {}).then(data => ({ available: true, data: normalizeDumpStatus(data) }))
			.catch(() => ({ available: false, data: {} }))
	]).then(results => ({
		available: results.some(item => item.available),
		data: Object.assign({}, results[0].data, results[1].data, results[2].data)
	}));
}

function normalizeKeyPair(result) {
	const value = result && result.keys || result || {};
	return { private: value.private || value.priv || '', public: value.public || value.pub || '' };
}

function generateKeyPair() {
	return ubusCall('luci.wireguard', 'generateKeyPair', {}).then(normalizeKeyPair)
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')))
		.catch(() => ubusCall('wireguard', 'genkey', {}).then(normalizeKeyPair))
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')))
		.catch(() => ubusCall('luci.amneziawg', 'generateKeyPair', {}).then(normalizeKeyPair))
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')));
}

function derivePublicKey(privateKey) {
	const normalizePublic = result => result && result.public || result && result.pub || '';
	return ubusCall('luci.wireguard', 'getPublicAndPrivateKeyFromPrivate', { private_key: privateKey }).then(result => {
		const value = result && result.keys || result || {};
		return value.public || value.pub || '';
	}).then(result => result || Promise.reject(new Error('empty public key')))
		.catch(() => ubusCall('wireguard', 'pubkey', { private: privateKey }).then(normalizePublic))
		.then(result => result || Promise.reject(new Error('empty public key')))
		.catch(() => ubusCall('luci.amneziawg', 'getPublicAndPrivateKeyFromPrivate', { private_key: privateKey })
			.then(result => {
				const value = result && result.keys || result || {};
				return value.public || value.pub || '';
			})
			.then(result => result || Promise.reject(new Error('empty public key'))));
}

function generatePresharedKey() {
	const normalizePsk = result => result && (result.preshared || result.psk) || '';
	return ubusCall('luci.wireguard', 'generatePsk', {}).then(normalizePsk)
		.then(result => result || Promise.reject(new Error('empty preshared key')))
		.catch(() => ubusCall('wireguard', 'genpsk', {}).then(normalizePsk))
		.then(result => result || Promise.reject(new Error('empty preshared key')))
		.catch(() => ubusCall('luci.amneziawg', 'generatePsk', {}).then(normalizePsk))
		.then(result => result || Promise.reject(new Error('empty preshared key')));
}

function getInstalledPackages() {
	return fs.exec_direct(PACKAGE_STATUS_HELPER, CONNECTION_PACKAGE_NAMES, 'json')
		.then(result => result && result.ok !== false && result.packages
			? Object.entries(result.packages).filter(([, state]) => state && state.installed)
				.map(([ name ]) => ({ name }))
			: [])
		.catch(() => []);
}

function openvpnAvailable(packages) {
	packages = packages || {};
	return OPENVPN_VARIANTS.some(name => !!packages[name]);
}

function openvpnProfileName(section) {
	return String(section || '').replace(/[^A-Za-z0-9_-]/g, '_') || 'connection';
}

function openvpnProfilePath(section) {
	return OPENVPN_PROFILE_DIR + '/' + openvpnProfileName(section) + '.ovpn';
}

function managedOpenvpnProfile(path) {
	return String(path || '').indexOf(OPENVPN_PROFILE_DIR + '/') === 0 &&
		/\/[-A-Za-z0-9_]+\.ovpn$/.test(String(path || ''));
}

function openvpnProfileNameFromPath(path) {
	const prefix = OPENVPN_PROFILE_DIR + '/';
	const filename = String(path || '').indexOf(prefix) === 0 ? String(path || '').slice(prefix.length) : '';
	return /^[-A-Za-z0-9_]+\.ovpn$/.test(filename) ? filename.slice(0, -5) : '';
}

function normalizeOpenvpnProfile(value) {
	return String(value || '').replace(/\r\n?/g, '\n').trim() + '\n';
}

function validateOpenvpnProfile(value) {
	const profile = String(value || '').replace(/\r\n?/g, '\n').trim();
	if (!profile)
		return _('Paste or choose an OpenVPN profile first.');
	if (profile.indexOf('\0') !== -1)
		return _('The OpenVPN profile contains an invalid NUL character.');
	if (profile.length > OPENVPN_PROFILE_MAX)
		return _('The OpenVPN profile is too large (maximum %d KiB).').format(Math.floor(OPENVPN_PROFILE_MAX / 1024));
	/* A profile can be a client, server or provider bundle.  Do not try to
	 * rewrite directives here: OpenVPN's own parser remains the source of
	 * truth, while this check catches an accidental empty/text upload. */
	if (!/(^|\n)\s*(client|server|remote|dev|proto)\b/im.test(profile))
		return _('The file does not look like an OpenVPN profile.');
	return null;
}

function storeOpenvpnProfile(name, profile) {
	const temporary = '/tmp/freenetic-openvpn-' + name + '.ovpn';
	return fs.write(temporary, normalizeOpenvpnProfile(profile), 384 /* 0600 */)
		.then(() => fs.exec_direct(OPENVPN_PROFILE_HELPER, [ 'install', name ], 'json'))
		.then(result => {
			if (!result || result.ok !== true)
				throw new Error(result && result.error || _('Unable to install the OpenVPN profile.'));
			return result;
		});
}

function removeOpenvpnProfile(name) {
	if (!name)
		return Promise.resolve({ ok: true });
	return fs.exec_direct(OPENVPN_PROFILE_HELPER, [ 'remove', name ], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('Unable to remove the OpenVPN profile.'));
		return result;
	});
}

function getFeedStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-awg-feed', [ 'status' ], 'json')
		.then(result => result && typeof result === 'object' ? result : null).catch(() => null);
}

function getIpsecStatus() {
	return fs.exec_direct(IPSEC_STATUS_HELPER, [], 'json')
		.then(result => result && typeof result === 'object' ? result : {
			ok: false,
			available: false,
			error: _('The IPsec status helper is unavailable.')
		})
		.catch(error => ({
			ok: false,
			available: false,
			error: error && (error.message || error) || _('The IPsec status helper is unavailable.')
		}));
}

function packageMap(list) {
	const result = {};
	(list || []).forEach(item => {
		if (item && item.name)
			result[item.name] = true;
	});
	return result;
}

function peerType(protocol) {
	return protocol === AWG_PROTO ? AWG_PEER_TYPE : WG_PEER_TYPE;
}

function peerSectionsFor(name) {
	const result = [];
	const seen = {};
	[ WG_PEER_TYPE + name, AWG_PEER_TYPE + name ].forEach(type => {
		uci.sections('network', type).forEach(section => {
			const id = sectionName(section);
			if (id && !seen[id]) {
				seen[id] = true;
				result.push(section);
			}
		});
	});
	return result;
}

function parseEndpoint(value) {
	value = String(value || '').trim();
	if (!value)
		return { host: '', port: '' };
	let match = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
	if (!match) {
		const colon = value.lastIndexOf(':');
		if (colon > -1 && /^\d+$/.test(value.slice(colon + 1)))
			match = [ value, value.slice(0, colon), value.slice(colon + 1) ];
	}
	return match ? { host: match[1], port: match[2] || '' } : { host: value, port: '' };
}

function parseConfig(text) {
	const lines = String(text || '').split(/\r?\n/);
	let section = '';
	const config = { peers: [], awg: {} };
	let currentPeer = null;
	const knownAwg = {};
	AWG_OPTIONS.forEach(item => { knownAwg[item[1].toLowerCase()] = item[0]; });

	lines.forEach(raw => {
		const line = raw.replace(/\s*[#;].*$/, '').trim();
		if (!line)
			return;
		const header = line.match(/^\[\s*(interface|peer)\s*\]$/i);
		if (header) {
			section = header[1].toLowerCase();
			currentPeer = section === 'peer' ? {} : null;
			if (currentPeer)
				config.peers.push(currentPeer);
			return;
		}
		const item = line.match(/^([^=]+?)\s*=\s*(.*)$/);
		if (!item || !section)
			return;
		const key = item[1].trim().toLowerCase();
		const value = item[2].trim();
		const target = section === 'peer' ? currentPeer : config;
		if (!target)
			return;
		if (section === 'interface') {
			if (key === 'privatekey') target.privateKey = value;
			else if (key === 'address' || key === 'addresses') target.addresses = parseList(value);
			else if (key === 'listenport') target.listenPort = value;
			else if (key === 'mtu') target.mtu = value;
			else if (key === 'fwmark') target.fwmark = value;
			else if (key === 'dns') target.dns = parseList(value);
			else if (knownAwg[key]) { target.awg[knownAwg[key]] = value; target.protocol = AWG_PROTO; }
		}
		else if (key === 'publickey') target.publicKey = value;
		else if (key === 'privatekey') target.privateKey = value;
		else if (key === 'presharedkey') target.presharedKey = value;
		else if (key === 'allowedips') target.allowedIps = parseList(value);
		else if (key === 'endpoint') {
			target.endpoint = value;
			Object.assign(target, parseEndpoint(value));
		}
		else if (key === 'persistentkeepalive') target.keepalive = value;
		else if (key === 'routeallowedips') target.routeAllowed = value === '1' || value.toLowerCase() === 'true';
	});

	if (!config.privateKey || !validKey(config.privateKey, false))
		return { error: _('PrivateKey is missing or invalid.') };
	if (!config.addresses || !config.addresses.every(validAddress))
		return { error: _('Address contains an invalid IP or prefix.') };
	for (const peer of config.peers) {
		if (!peer.publicKey || !validKey(peer.publicKey, false))
			return { error: _('A peer is missing a valid PublicKey.') };
		if (peer.presharedKey && !validKey(peer.presharedKey, true))
			return { error: _('A peer has an invalid PresharedKey.') };
		if (peer.allowedIps && !peer.allowedIps.every(validAddress))
			return { error: _('A peer has an invalid AllowedIPs value.') };
		if (peer.endpoint && (!peer.host || !validHost(peer.host) || !validPort(peer.port, true)))
			return { error: _('A peer has an invalid Endpoint.') };
	}

	return {
		section: null,
		name: _('Imported connection'),
		protocol: config.protocol || WG_PROTO,
		enabled: true,
		privateKey: config.privateKey,
		publicKey: '',
		addresses: config.addresses || [],
		dns: config.dns || [],
		listenPort: config.listenPort || '',
		mtu: config.mtu || '',
		fwmark: config.fwmark || '',
		nohostroute: false,
		awg: config.awg || {},
		peers: config.peers.map(peer => ({
			section: null,
			description: '',
			disabled: false,
			privateKey: peer.privateKey || '',
			presharedKey: peer.presharedKey || '',
			publicKey: peer.publicKey || '',
			allowedIps: peer.allowedIps || [],
			endpointHost: peer.host || '',
			endpointPort: peer.port || '',
			keepalive: peer.keepalive || '',
			routeAllowed: !!peer.routeAllowed
		}))
	};
}

function endpointText(host, port) {
	if (!host)
		return port ? '*:%s'.format(port) : '–';
	const displayed = host.indexOf(':') !== -1 && host[0] !== '[' ? '[' + host + ']' : host;
	return port ? displayed + ':' + port : displayed;
}

function serializeConfig(connection) {
	const lines = [ '[Interface]' ];
	if (connection.privateKey)
		lines.push('PrivateKey = ' + connection.privateKey);
	if (connection.addresses && connection.addresses.length)
		lines.push('Address = ' + connection.addresses.join(', '));
	if (connection.listenPort)
		lines.push('ListenPort = ' + connection.listenPort);
	if (connection.mtu)
		lines.push('MTU = ' + connection.mtu);
	if (connection.fwmark)
		lines.push('FwMark = ' + connection.fwmark);
	if (connection.dns && connection.dns.length)
		lines.push('DNS = ' + connection.dns.join(', '));
	if (connection.protocol === AWG_PROTO) {
		AWG_OPTIONS.forEach(item => {
			const value = connection.awg && connection.awg[item[0]];
			if (value)
				lines.push(item[1] + ' = ' + value);
		});
	}

	(connection.peers || []).forEach(peer => {
		lines.push('', '[Peer]');
		if (peer.publicKey) lines.push('PublicKey = ' + peer.publicKey);
		if (peer.privateKey) lines.push('PrivateKey = ' + peer.privateKey);
		if (peer.presharedKey) lines.push('PresharedKey = ' + peer.presharedKey);
		if (peer.allowedIps && peer.allowedIps.length) lines.push('AllowedIPs = ' + peer.allowedIps.join(', '));
		if (peer.endpointHost) lines.push('Endpoint = ' + endpointText(peer.endpointHost, peer.endpointPort));
		if (peer.keepalive) lines.push('PersistentKeepalive = ' + peer.keepalive);
	});

	return lines.join('\n') + '\n';
}

return baseclass.extend({
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
});
