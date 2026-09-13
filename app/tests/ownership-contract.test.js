'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const network = read('web/application/htdocs/luci-static/resources/freenetic-network.js');
const wan = read('web/application/htdocs/luci-static/resources/view/network/freenetic-wan.js');
const myNetworks = read('web/application/htdocs/luci-static/resources/view/network/freenetic-mynetworks.js');
const dashboard = read('web/application/htdocs/luci-static/resources/view/status/freenetic-dashboard.js');

assert.match(network, /function isManaged\(section\)/,
	'network helpers must expose one marker-based ownership predicate');
assert.match(network, /function adoptLegacyGuest\(\)/,
	'legacy guest migration must be explicit and centralized');
assert.match(network, /section\.network === 'guest'/,
	'legacy guest migration must verify the guest network binding');
assert.match(network, /section\.isolate === '1'/,
	'legacy guest migration must verify the old Freenetic isolation marker');

assert.match(wan, /managed: s\.freenetic_managed === '1'/,
	'WAN VLAN discovery must retain ownership information');
assert.match(wan, /uci\.set\('network', 'device', sectionName, 'freenetic_managed', '1'\)/,
	'new WAN VLAN devices must be marked as Freenetic-managed');
assert.match(wan, /if \(managed && managed\.freenetic_managed === '1'\)\s+uci\.remove\('network', 'device', this\.vlanSectionName\)/,
	'WAN VLAN removal must be guarded by the ownership marker');
assert.match(wan, /if \(targetMatchesBase && !targetInfo\.managed\)/,
	'foreign WAN VLAN devices must be reusable without being claimed');

const deleteGuest = myNetworks.slice(myNetworks.indexOf('\tdeleteGuestSegment('));
assert.match(deleteGuest, /if \(networkHelper\.isManaged\(s\)\)\s+uci\.remove\('wireless', s\['\.name'\]\)/,
	'guest Wi-Fi deletion must require the ownership marker');
assert.doesNotMatch(deleteGuest, /indexOf\('guest_'\)/,
	'guest Wi-Fi deletion must not infer ownership from the section name');
assert.match(myNetworks, /uci\.set\('wireless', name, 'freenetic_managed', '1'\)/,
	'guest Wi-Fi created by My Networks must be marked');
assert.match(dashboard, /uci\.set\('wireless', name, 'freenetic_managed', '1'\)/,
	'guest Wi-Fi created by Dashboard must be marked');

console.log('ownership contracts: ok');
