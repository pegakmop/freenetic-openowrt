'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const ports = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-ports.js'), 'utf8');
const menu = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic',
	'root', 'usr', 'share', 'luci', 'menu.d', 'zz-luci-freenetic.json'), 'utf8'));
const navigation = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'resources', 'freenetic-navigation.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'freenetic', 'cascade.css'), 'utf8');
const acl = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8');
const makefile = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'Makefile'), 'utf8');

assert.ok(menu['admin/network/ethernet_ports'], 'Ethernet ports need a LuCI menu entry');
assert.match(navigation, /admin\/network\/ethernet_ports/,
	'the Ethernet ports page must participate in in-place navigation');
assert.match(dashboard, /_\('Network Ports'\), \[ 'admin', 'network', 'ethernet_ports' \]/,
	'the dashboard ports card must link to the Ethernet ports page');
assert.match(ports, /getBuiltinEthernetPorts/,
	'physical ports must be discovered from the board instead of hardcoded');
assert.match(ports, /wanCards\.length !== 1/,
	'port reassignment must retain exactly one physical WAN uplink');
assert.match(ports, /applyChanges\(30\)/,
	'dangerous port changes must use an extended rollback-protected UCI apply');
assert.match(ports, /\.then\(\(\) => this\.restartPbr\(\)\)/,
	'port apply must not report success before the PBR helper succeeds');
assert.doesNotMatch(ports, /PBR_RESTART_HELPER[\s\S]{0,100}catch\(\(\) => null\)/,
	'PBR helper failures must never be swallowed');
assert.match(ports, /card\.connected && card\.role\.value !== card\.originalRole/,
	'active port changes must require an explicit confirmation');
assert.match(ports, /freenetic_scope', 'ethernet-port'/,
	'dedicated network, DHCP, and firewall sections must carry ownership metadata');
assert.match(ports, /uci\.set\('firewall', networkName, 'input', 'REJECT'\)/,
	'dedicated segments must deny access to router services by default');
assert.match(ports, /createRouterServiceRule\(networkName, 'dhcp'/,
	'dedicated segments must retain a narrow DHCP input exception');
assert.match(ports, /createRouterServiceRule\(networkName, 'dns'/,
	'dedicated segments must retain a narrow DNS input exception');
assert.match(ports, /managedPolicySection\(networkName\)/,
	'per-port policies must interoperate with Access & Routing Policy');
assert.match(ports, /Custom port assignments are shown read-only/,
	'custom network ownership must be preserved');
assert.match(ports, /adaptiveCandidates\(\)[\s\S]*role\.value === 'none'/,
	'adaptive detection must only consider unassigned ports');
assert.match(ports, /window\.confirm\(_\('Stage %s as WAN/,
	'an adaptive WAN recommendation must require confirmation before staging');
assert.match(ports, /No network changes occur until you apply the configuration/,
	'adaptive detection must remain advisory until the normal protected apply');
assert.match(ports, /oldWan6Port === oldWanPort/,
	'WAN6 must follow a reassigned WAN only when both previously shared the same device');
assert.match(ports, /sharedBridge\('lan', 'br-lan'/,
	'the editor must reuse the bridge actually attached to the LAN interface');
assert.match(ports, /rangesOverlap\(existing, range\)/,
	'subnet validation must compare real address ranges instead of assuming every network is /24');
assert.match(ports, /function probeErrorMessage\(result\)/,
	'adaptive detection must translate helper errors instead of exposing backend text');
assert.doesNotMatch(ports, /message = result\.error/,
	'adaptive detection must not render raw helper errors');
assert.match(css, /\.fn-port-selector\.fn-port-wan/,
	'the physical WAN port must have a distinct visual treatment');
assert.match(acl, /freenetic-port-probe \*/,
	'the read-only port probe helper must be exposed through the application ACL');
assert.match(makefile, /\+pppoe-discovery/,
	'PPPoE discovery support must be installed with the application');

console.log('Ethernet port assignment contract: ok');
