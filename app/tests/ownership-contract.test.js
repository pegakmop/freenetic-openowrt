'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const network = read('web/application/htdocs/luci-static/resources/freenetic-network.js');
const wan = read('web/application/htdocs/luci-static/resources/view/network/freenetic-wan.js');
const myNetworks = read('web/application/htdocs/luci-static/resources/view/network/freenetic-mynetworks.js');
const routing = read('web/application/htdocs/luci-static/resources/view/network/freenetic-routing.js');
const firewall = read('web/application/htdocs/luci-static/resources/view/network/freenetic-firewall.js');
const portforward = read('web/application/htdocs/luci-static/resources/view/network/freenetic-portforward.js');
const ddns = read('web/application/htdocs/luci-static/resources/view/network/freenetic-ddns.js');
const clients = read('web/application/htdocs/luci-static/resources/view/status/freenetic-clients.js');
const connections = read('web/application/htdocs/luci-static/resources/view/network/freenetic-other-connections.js');
const dashboard = read('web/application/htdocs/luci-static/resources/view/status/freenetic-dashboard.js');

assert.match(network, /function isManaged\(section\)/,
	'network helpers must expose one marker-based ownership predicate');
assert.match(network, /function adoptLegacyGuest\(\)/,
	'legacy guest migration must be explicit and centralized');
assert.match(network, /function ensureGuestWifi\(sectionName, radioName, networkName\)/,
	'guest Wi-Fi creation must have one marker-aware helper');
assert.match(network, /existing\['\.type'\] !== 'wifi-iface' \|\| !isManaged\(existing\)/,
	'guest Wi-Fi helper must reject foreign sections with reserved names');
assert.match(network, /section\.network === 'guest'/,
	'legacy guest migration must verify the guest network binding');
assert.match(network, /section\.isolate === '1'/,
	'legacy guest migration must verify the old Freenetic isolation marker');

assert.match(wan, /managed: s\.freenetic_managed === '1'/,
	'WAN VLAN discovery must retain ownership information');
assert.match(wan, /uci\.set\('network', sectionName, 'type', '8021q'\)/,
	'new WAN VLAN devices must be written as native 8021q device sections');
assert.match(wan, /uci\.set\('network', sectionName, 'freenetic_managed', '1'\)/,
	'new WAN VLAN devices must be marked as Freenetic-managed');
assert.match(wan, /if \(managed && managed\.freenetic_managed === '1'\)\s+uci\.remove\('network', this\.vlanSectionName\)/,
	'WAN VLAN removal must be guarded by the ownership marker');
assert.match(wan, /if \(targetMatchesBase && !targetInfo\.managed\)/,
	'foreign WAN VLAN devices must be reusable without being claimed');

const deleteGuest = myNetworks.slice(myNetworks.indexOf('\tdeleteGuestSegment('));
assert.match(deleteGuest, /if \(networkHelper\.isManaged\(s\)\)\s+uci\.remove\('wireless', s\['\.name'\]\)/,
	'guest Wi-Fi deletion must require the ownership marker');
assert.doesNotMatch(deleteGuest, /indexOf\('guest_'\)/,
	'guest Wi-Fi deletion must not infer ownership from the section name');
assert.match(myNetworks, /networkHelper\.ensureGuestWifi\(name, card\.radioName, ifaceName\)/,
	'My Networks must use the marker-aware guest Wi-Fi helper');
assert.match(dashboard, /networkHelper\.ensureGuestWifi\(name, dev\['\.name'\], 'guest'\)/,
	'Dashboard must use the marker-aware guest Wi-Fi helper');

assert.match(routing, /const section = uci\.add\('network', route\.family === 'ipv6' \? 'route6' : 'route'\);\s+uci\.set\('network', section, 'freenetic_managed', '1'\)/,
	'imported routes must be marked as Freenetic-managed');
assert.match(routing, /const isNew = !this\.editingSection;[\s\S]*?if \(isNew\)\s+uci\.set\('network', section, 'freenetic_managed', '1'\)/,
	'new routes must be marked without claiming edited foreign routes');
assert.match(firewall, /const isNew = !this\.editingSection;[\s\S]*?uci\.set\('firewall', section, 'freenetic_managed', '1'\)/,
	'new firewall rules must be marked without claiming edited foreign rules');
assert.match(portforward, /const isNew = !this\.editingSection;[\s\S]*?uci\.set\('firewall', section, 'freenetic_managed', '1'\)/,
	'new port forwards must be marked without claiming edited foreign rules');
assert.match(ddns, /uci\.set\('ddns', section, 'freenetic_managed', '1'\)/,
	'new DDNS profiles must be marked as Freenetic-managed');
assert.match(clients, /const section = uci\.add\('dhcp', 'host'\);\s+uci\.set\('dhcp', section, 'freenetic_managed', '1'\)/,
	'registered DHCP hosts must be marked as Freenetic-managed');
assert.match(connections, /if \(!uci\.get\(IPSEC_CONFIG, name, '\.type'\)\)\s+\{[\s\S]*?uci\.set\(IPSEC_CONFIG, name, 'freenetic_managed', '1'\)/,
	'new IPsec sections must be marked as Freenetic-managed');
assert.match(connections, /uci\.get\(IPSEC_CONFIG, name, 'freenetic_managed'\) === '1'/,
	'IPsec cleanup must require the ownership marker');

console.log('ownership contracts: ok');
