'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-other-connections.js'), 'utf8');

assert.match(source, /'require freenetic-network as networkHelper';/,
	'VPN editor must use the shared ownership predicate');
assert.match(source, /managed: networkHelper\.isManaged\(peer\)/,
	'peer models must retain the ownership marker');
assert.match(source, /if \(!fields\.section\)\s+uci\.set\('network', section, 'freenetic_managed', '1'\)/,
	'new WireGuard interfaces must be marked as Freenetic-managed');
assert.match(source, /id = uci\.add\('network', newType\);\s+uci\.set\('network', id, 'freenetic_managed', '1'\)/,
	'new WireGuard peers must be marked as Freenetic-managed');
assert.match(source, /if \(typeChanged\)\s+oldPeerSections\.forEach\(peer => \{\s+if \(networkHelper\.isManaged\(peer\)\)/,
	'protocol changes must not remove foreign peer sections');
assert.match(source, /if \(!activePeerNames\[id\] && managedOldPeers\[id\]\)/,
	'peer reconciliation must remove only managed peers');
assert.match(source, /Changing the protocol recreates peer sections\./,
	'protocol changes must warn before peer sections are recreated');

console.log('WireGuard ownership contracts: ok');
