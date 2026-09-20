'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-network-restart');
const tailscaleRecoveryPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-tailscale-recover');
const appsPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'system', 'freenetic-apps.js');
const connectionsPath = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-other-connections.js');
const connectionsCorePath = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'freenetic-connections-core.js');
const connectionsWireguardPath = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'freenetic-connections-wireguard.js');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json');

const helper = fs.readFileSync(helperPath, 'utf8');
const tailscaleRecovery = fs.readFileSync(tailscaleRecoveryPath, 'utf8');
const apps = fs.readFileSync(appsPath, 'utf8');
const connections = fs.readFileSync(connectionsCorePath, 'utf8') + '\n' +
	fs.readFileSync(connectionsWireguardPath, 'utf8') + '\n' +
	fs.readFileSync(connectionsPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'network restart helper must be executable');
assert.match(helper, /\/etc\/init\.d\/network restart/, 'helper must restart the OpenWrt network service');
assert.match(helper, /pidof netifd/, 'helper must wait for netifd to return');
assert.match(apps, /restartNetifdOnInstall:\s*true/, 'WireGuard install must request a netifd restart');
assert.match(apps, /id: 'openvpn',[\s\S]*restartNetifdOnInstall:\s*true/, 'OpenVPN install must request a netifd restart');
const mwanEntry = apps.match(/\{ id: 'mwan3'[\s\S]*?\},/);
assert.ok(mwanEntry, 'Applications must retain the Multi-WAN catalog entry');
assert.doesNotMatch(mwanEntry[0], /restartNetifdOnInstall/,
	'Multi-WAN installation must not restart the complete network service');
assert.match(apps, /freenetic-network-restart/, 'Applications must call the network restart helper');
assert.match(apps, /item\.id === 'mwan3'[\s\S]*fs\.exec_direct\(TAILSCALE_RECOVERY_HELPER/,
	'Multi-WAN removal must prepare Tailscale recovery before invoking apk');
assert.match(apps, /confirmMwanInstall[\s\S]*After installation you will be signed out once/,
	'Multi-WAN installation must warn about its unavoidable rpcd session restart');
assert.match(apps, /item\.id === 'mwan3'[\s\S]*window\.setTimeout\(\(\) => window\.location\.reload\(\), 10000\)/,
	'Multi-WAN installation must recover from the expected rpcd disconnect');
assert.match(tailscaleRecovery, /sleep 8[\s\S]*\/etc\/init\.d\/tailscale restart/,
	'Tailscale recovery must run after mwan3 deinstall hooks have completed');
assert.doesNotMatch(tailscaleRecovery, /sleep 8[\s\S]*pidof tailscaled/,
	'Tailscale recovery must restart a service that package hooks stopped after scheduling');
assert.match(tailscaleRecovery, /<\/dev\/null >\/dev\/null 2>&1 &/,
	'Tailscale recovery must survive the initiating RPC connection');
assert.match(connections, /freenetic-network-restart/, 'AWG installation must call the network restart helper');
assert.ok(acl.write.file['/usr/libexec/freenetic-network-restart'],
	'network restart helper must be covered by the rpcd ACL');
assert.ok(acl.write.file['/usr/libexec/freenetic-tailscale-recover schedule'],
	'Tailscale recovery helper must be covered by the rpcd ACL');

console.log('network package restart contract: ok');
