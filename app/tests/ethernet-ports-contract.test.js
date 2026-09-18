'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const ports = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-ports.js'), 'utf8');
const multiwan = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-multiwan.js'), 'utf8');
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
const multiwanHelper = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'libexec', 'freenetic-multiwan'), 'utf8');

assert.ok(menu['admin/network/ethernet_ports'], 'Ethernet ports need a LuCI menu entry');
assert.match(navigation, /admin\/network\/ethernet_ports/,
	'the Ethernet ports page must participate in in-place navigation');
assert.match(dashboard, /_\('Network Ports'\), \[ 'admin', 'network', 'ethernet_ports' \]/,
	'the dashboard ports card must link to the Ethernet ports page');
assert.match(dashboard, /getMultiwanStatus[\s\S]*No Internet access/,
	'the dashboard must distinguish Internet reachability from merely receiving an IP address');
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
assert.match(ports, /nextRouteMetric\(this\.network, BACKUP_WAN_INTERFACE\)[\s\S]*String\(routeMetric\)/,
	'the Ethernet backup must allocate a unique route metric for reliable mwan3 tracking');
assert.match(ports, /'network', 'wan', 'metric'[\s\S]*'10'/,
	'the Ethernet backup setup must assign a primary WAN metric when absent');
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
assert.match(ports, /backupCandidates\(\)[\s\S]*\[ 'lan', 'none', 'wanb' \]/,
	'the guided backup setup must work with an ordinary Home network port');
assert.match(ports, /temporary-lan/,
	'the guided setup must explicitly request an isolated LAN probe');
assert.match(ports, /protocol === 'pppoe'[\s\S]*username[\s\S]*password/,
	'the guided setup must retain provider credentials for PPPoE');
assert.match(ports, /card\.autoFailover = true/,
	'creating WAN2 through the wizard must enable the failover policy');
assert.match(ports, /modal\.classList\.add\('fn-backup-wizard-modal'\)/,
	'the second-provider wizard must identify its modal for a wider responsive layout');
assert.match(ports, /applyManagedMultiwanMode\(multiwanModeAfterApply\)/,
	'the wizard must delegate failover policy activation to the transactional controller');
assert.match(ports, /previous\.role\.value = 'none'/,
	'a replaced provider port must stay isolated instead of being bridged into LAN');
assert.match(ports, /if \(!existing \|\| !isManaged\(existing, BACKUP_WAN_SCOPE\)\)\s*return/,
	'saving unrelated ports must preserve an externally owned network.wanb');
assert.match(ports, /existingMwan && !isManaged\(existingMwan, BACKUP_WAN_SCOPE\)/,
	'the wizard must reject an externally owned mwan3.wanb');
assert.match(ports, /multiwanModeAfterApply = 'single'/,
	'removing a managed WAN2 must ask the controller for the single-uplink policy');
assert.match(ports, /The WAN firewall zone is missing/,
	'the wizard must fail preflight when the required WAN firewall zone is absent');
assert.match(multiwan, /fs\.exec_direct\(MULTIWAN_HELPER, args, 'json'\)/,
	'a Multi-WAN mode change must be a single controller operation');
assert.doesNotMatch(multiwan, /uci\.(?:set|add|remove|save|apply)/,
	'the Multi-WAN page must not construct or apply policies in the browser');
assert.match(multiwan, /singleSelect[\s\S]*Use connection[\s\S]*selectedInterface/,
	'single-connection mode must let the user select its active uplink');
assert.doesNotMatch(multiwan, /hidden:\s*detectedMode\s*!==\s*'single'\s*[,}]/,
	'the single-uplink selector must not render the boolean hidden=false attribute');
assert.match(multiwan, /applyModeHandler[\s\S]*window\.location\.reload\(\)/,
	'applying a Multi-WAN mode must reload the page to display authoritative runtime state');
assert.match(multiwan, /catch\(error[\s\S]*setTimeout\(\(\) => window\.location\.reload\(\), 900\)/,
	'a failed Multi-WAN apply must also reload the authoritative state after showing its error');
assert.match(multiwan, /Not in use/,
	'an online connection excluded by single mode must be shown as unused instead of failed');
assert.match(multiwan, /backupActive[\s\S]*In use now/,
	'a backup uplink selected in single mode must be identified as the active connection');
assert.match(multiwan, /state\.uplinks\.slice\(0, 7\)/,
	'the traffic diagram must support all seven managed Internet connections');
assert.doesNotMatch(multiwan, /disabled: unavailable/,
	'available mode buttons must not render the boolean HTML attribute disabled=false');
assert.match(multiwanHelper, /freenetic_scope=multiwan-mode/,
	'Multi-WAN policy and member ownership must use a subsystem-specific scope');
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
assert.match(css, /\.modal\.fn-backup-wizard-modal[\s\S]*max-width: 720px/,
	'the second-provider wizard must fit both desktop fields inside its modal');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.modal\.fn-backup-wizard-modal[\s\S]*width: calc\(100% - 24px\)/,
	'the second-provider wizard must stay inside a narrow mobile viewport');
assert.match(css, /\.fn-wifi-uplink-wizard \[hidden\] \{ display: none !important; \}/,
	'the open Wi-Fi path must hide its password field despite settings-field display rules');
assert.match(css, /input\[disabled\], textarea\[disabled\], select\[disabled\] \{[\s\S]*background-color:/,
	'disabled selects must preserve the non-repeating custom chevron background');
assert.doesNotMatch(css, /input\[disabled\], textarea\[disabled\], select\[disabled\] \{\s*background:/,
	'disabled selects must not reset background-repeat through the background shorthand');
assert.match(acl, /freenetic-port-probe \*/,
	'the read-only port probe helper must be exposed through the application ACL');
assert.match(makefile, /\+pppoe-discovery/,
	'PPPoE discovery support must be installed with the application');
assert.match(multiwanHelper, /cp -a \/etc\/config\/mwan3 "\$snapshot_dir\/mwan3"/,
	'the Multi-WAN controller must snapshot the configuration before mutation');
assert.match(multiwanHelper, /restore_snapshot[\s\S]*rolled_back=1/,
	'the Multi-WAN controller must roll back a failed operation');
assert.match(multiwan, /Connect nearby Wi-Fi/,
	'the friendly Multi-WAN view must expose Wi-Fi as a backup connection');
assert.match(multiwan, /WIFI_UPLINK_HELPER[\s\S]*'connect'/,
	'the Wi-Fi backup wizard must delegate configuration to its transactional controller');
assert.match(multiwanHelper, /ethernet-port\|wifi-uplink/,
	'the mode controller must admit owned Ethernet and Wi-Fi uplinks');

console.log('Ethernet port assignment contract: ok');
