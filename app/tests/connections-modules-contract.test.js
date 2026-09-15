'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const resourceRoot = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources');
const read = file => fs.readFileSync(path.join(resourceRoot, file), 'utf8');
const main = read('view/network/freenetic-other-connections.js');
const wireguard = read('freenetic-connections-wireguard.js');
const openvpn = read('freenetic-connections-openvpn.js');
const ipsec = read('freenetic-connections-ipsec.js');

assert.match(main, /require freenetic-connections-wireguard as wireguardView/,
	'Other Connections must load the WireGuard view module');
assert.match(main, /require freenetic-connections-openvpn as openvpnView/,
	'Other Connections must load the OpenVPN view module');
assert.match(main, /require freenetic-connections-ipsec as ipsecView/,
	'Other Connections must load the IPsec view module');
assert.match(main, /Object\.assign\(\{[\s\S]*wireguardView\.mixin, openvpnView\.mixin, ipsecView\.mixin\)/,
	'Other Connections must compose the protocol modules through one dispatcher');

for (const [ name, source ] of Object.entries({ wireguard, openvpn, ipsec })) {
	assert.match(source, /'require baseclass'/,
		`${name} module must load the LuCI base class`);
	assert.match(source, /return baseclass\.extend\(\{ mixin: \{/,
		`${name} module must yield a LuCI constructor exposing its view mixin`);
}

assert.match(wireguard, /getWireguardConnection\(section\)/,
	'WireGuard module must own WireGuard connection mapping');
assert.match(wireguard, /openWireguardForm\(connection\)/,
	'WireGuard module must own its editor form');
assert.match(wireguard, /saveConnection\(fields, button\)/,
	'WireGuard module must own its save flow');
assert.match(openvpn, /getOpenvpnConnection\(section\)/,
	'OpenVPN module must own OpenVPN connection mapping');
assert.match(openvpn, /openOpenvpnForm\(connection\)/,
	'OpenVPN module must own its editor form');
assert.match(openvpn, /saveOpenvpnConnection\(fields, button\)/,
	'OpenVPN module must own its save flow');
assert.match(ipsec, /getL2tpConnection\(section\)/,
	'IPsec module must own L2TP/IPsec connection mapping');
assert.match(ipsec, /getIkev2Connection\(section\)/,
	'IPsec module must own IKEv2/IPsec connection mapping');
assert.match(ipsec, /saveL2tpConnection\(fields, button\)/,
	'IPsec module must own L2TP/IPsec save flow');
assert.match(ipsec, /saveIkev2Connection\(fields, button\)/,
	'IPsec module must own IKEv2/IPsec save flow');

console.log('Other Connections protocol modules: ok');
