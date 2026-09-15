'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const resource = relative => fs.readFileSync(path.join(root, 'web', 'application',
	'htdocs', 'luci-static', 'resources', relative), 'utf8');

const wan = resource('view/network/freenetic-wan.js');
const networks = resource('view/network/freenetic-mynetworks.js');
const apps = resource('view/system/freenetic-apps.js');
const system = resource('view/system/freenetic-system.js');
const clients = resource('view/status/freenetic-clients.js');
const routing = resource('view/network/freenetic-routing.js');
const ddns = resource('view/network/freenetic-ddns.js');
const wifiMonitor = resource('view/status/freenetic-wifimonitor.js');

assert.match(wan, /Existing protocol: %s \(preserved\)/,
	'WAN must expose and preserve protocols outside its compact editor');
assert.match(wan, /if \(!editableProtocol\)\s+return uci\.save\(\)/,
	'WAN must not rewrite protocol-specific fields for unknown protocols');
assert.match(networks, /card\.adv\.channelSelect\.value !== original\.channel/,
	'radio-wide settings must only be written after an explicit change');
assert.match(networks, /const currentHtmode = configuredHtmode \|\| defaultHtmodeForBand\(radio\.band, htmodes\)/,
	'unset channel width must receive a band-specific hardware-backed default');
assert.match(networks, /\[ 'HE80', 'VHT80',[\s\S]*?\[ 'HE20', 'HT20'/,
	'5 GHz and 2.4 GHz must not share the same default channel-width policy');
assert.match(networks, /original: \{ channel: currentChannel, htmode: configuredHtmode/,
	'a generated channel-width default must be persisted on Save');
assert.match(networks, /Channel settings remain independent/,
	'the credentials link must explicitly keep radio settings independent');
assert.match(networks, /uci\.set\('network', ifaceName, 'proto', 'none'\)/,
	'the IPv4 switch must actually disable IPv4 on the home segment');
assert.match(networks, /freenetic-avahi-reflector/,
	'the mDNS switch must have a real backend');
assert.match(apps, /removablePackages\(item\)/,
	'application removal must account for shared packages');
assert.match(apps, /operationPackages\.length && item\.restartNetifdOnInstall/,
	'network protocol removals must restart netifd too');
const flashHandler = system.slice(system.indexOf('\thandleSysupgrade()'));
assert.ok(flashHandler.lastIndexOf("fs.exec('/sbin/sysupgrade'") < flashHandler.lastIndexOf('awaitReconnectToDashboard('),
	'reconnect polling must be started without waiting for sysupgrade to return');
assert.match(clients, /this\.blockClient\(row\.mac, zone\)/,
	'client blocking must pass the detected firewall zone');
assert.match(clients, /sourceZone === 'guest' \? 'guest' : 'lan'/,
	'guest clients must be blocked from the guest zone');
assert.match(routing, /section\.disabled !== '1'/,
	'route automatic state must use netifd disabled semantics');
assert.match(routing, /uci\.unset\('dhcp', dns\.section, 'server'\)/,
	'deleting the last DNS route must unset the UCI list');
assert.match(ddns, /result\.code !== 0/,
	'DDNS commands must reject non-zero exit codes');
assert.match(wifiMonitor, /ubusCall\('iwinfo', 'scan'/,
	'the Wi-Fi air map must use the router scan data');
assert.match(wifiMonitor, /disabled: true[\s\S]*?_\('Apply'\)/,
	'the preview must not allow channel changes');
assert.match(wifiMonitor, /class: 'fn-wifi-band-loading'/,
	'band changes must hide stale Wi-Fi data behind a loading state');
assert.match(wifiMonitor, /Promise\.all\(\[ update, animationFloor \]\)/,
	'band loading must wait for both fresh data and the transition floor');
assert.match(wifiMonitor, /const placedLabels = \[\]/,
	'air-map SSID labels must use collision-aware placement');
assert.doesNotMatch(wifiMonitor, /frequencies\.length < 18 \|\| i % 2/,
	'the 5 GHz axis must not hide every other channel label');
assert.match(wifiMonitor, /const broadcasting = currentChannel > 0 && currentFrequency > 0/,
	'the air map must distinguish configured radios from radios that are actually broadcasting');
assert.match(wifiMonitor, /Configured: %s, %d MHz/,
	'an inactive radio must show its configured channel and width instead of invented live values');
assert.match(wifiMonitor, /ownChannel \? channelFrequency\(ownChannel, radio\.band\) : 0/,
	'the air map must not draw an inactive radio from its configured channel');

const helper = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-avahi-reflector');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];
assert.ok(fs.statSync(helper).mode & 0o111, 'mDNS reflector helper must be executable');
assert.ok(acl.read.file['/usr/libexec/freenetic-avahi-reflector status']);
assert.ok(acl.write.file['/usr/libexec/freenetic-avahi-reflector enable']);
assert.ok(acl.write.file['/usr/libexec/freenetic-avahi-reflector disable']);
assert.ok(acl.read.ubus.iwinfo.includes('scan'), 'Wi-Fi scans must be granted read-only');

console.log('audit regression contracts: ok');
