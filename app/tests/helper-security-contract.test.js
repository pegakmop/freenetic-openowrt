'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const applicationHelpers = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec');
const themeHelpers = path.join(root, 'app', 'luci-theme-freenetic', 'root', 'usr', 'libexec');

function read(directory, name) {
	return fs.readFileSync(path.join(directory, name), 'utf8');
}

function run(directory, name, args) {
	return childProcess.spawnSync('/bin/sh', [ path.join(directory, name), ...args ], {
		encoding: 'utf8'
	});
}

const helpers = [
	...fs.readdirSync(applicationHelpers).map(name => [ applicationHelpers, name ]),
	...fs.readdirSync(themeHelpers).map(name => [ themeHelpers, name ])
];

for (const [ directory, name ] of helpers) {
	const helperPath = path.join(directory, name);
	const source = read(directory, name);
	assert.ok(fs.statSync(helperPath).mode & 0o111, `${name} must be executable`);
	assert.ok(source.startsWith('#!/bin/sh'), `${name} must be POSIX sh`);
	assert.doesNotMatch(source, /\beval\b|\bsh\s+-c\b/,
		`${name} must not evaluate browser input through a shell`);
}

const diagnostics = read(applicationHelpers, 'freenetic-diagnostics-call');
assert.ok(diagnostics.includes('if [ "$#" -ne 2 ]; then'),
	'diagnostics must require exactly two arguments');
assert.ok(diagnostics.includes("''|-*|*[!A-Za-z0-9._:-]*"),
	'diagnostics must reject empty, option-like and metacharacter targets');
assert.match(diagnostics, /\[ "\$\{#target\}" -gt 253 \]/,
	'diagnostics must bound target length');

const packageStatus = read(applicationHelpers, 'freenetic-package-status');
assert.ok(packageStatus.includes("''|-*|*[!A-Za-z0-9+_.:@/-]*"),
	'package status must reject option-like and metacharacter package names');
assert.ok(packageStatus.indexOf('for package in "$@"; do') < packageStatus.indexOf('available=$(apk search'),
	'package names must be validated before invoking apk search');
assert.match(packageStatus, /\$1 == "Status:" && \$NF == "installed"/,
	'legacy opkg detection must accept current user-installed status records');

const openvpn = read(applicationHelpers, 'freenetic-openvpn-profile');
assert.ok(openvpn.includes('[ "$#" -eq 2 ]'), 'OpenVPN helper must require action and name');
assert.ok(openvpn.includes("''|*[!A-Za-z0-9_-]*"),
	'OpenVPN names must use a conservative allowlist');

const portProbe = read(applicationHelpers, 'freenetic-port-probe');
assert.ok(portProbe.includes("''|-*|*[!A-Za-z0-9_-]*"),
	'Ethernet probe port names must use a conservative allowlist');
assert.match(portProbe, /jsonfilter -i \/etc\/board\.json/,
	'Ethernet probing must be restricted to ports declared by the board');
assert.match(portProbe, /\/sys\/class\/net\/\$port\/master/,
	'Ethernet probing must reject ports attached to a bridge');
assert.match(portProbe, /temporary-lan[\s\S]*network\.lan\.device/,
	'the guided probe must only detach a port from the configured Home network bridge');
assert.match(portProbe, /ip link set dev "\$port" master "\$original_master"/,
	'the guided probe must restore the selected LAN port even after detection fails');
assert.match(portProbe, /error_code\":\"restore-failed/,
	'the guided probe must report a failed bridge restoration instead of returning success');
assert.match(portProbe, /ubus call network reload/,
	'the guided probe must have a safe network-reload fallback when bridge restoration fails');
assert.match(portProbe, /udhcpc[\s\S]*-s "\$0"/,
	'DHCP discovery must use the non-configuring probe event handler');
assert.match(portProbe, /pppoe-discovery/,
	'adaptive ports must support non-session PPPoE discovery');
assert.match(portProbe, /"error_code"/,
	'Ethernet probe errors must expose stable codes for localized UI messages');
assert.match(portProbe, /network\.lan\.device/,
	'Ethernet probing must recognize the same LAN device form as LuCI');
assert.match(portProbe, /network\.wan\.ports\[\*\]/,
	'Ethernet probing must recognize the same WAN ports form as LuCI');
assert.match(portProbe, /mktemp -d \/tmp\/freenetic-port-probe\.XXXXXX/,
	'Ethernet probing must isolate root-owned temporary files');

const mwanRecover = read(applicationHelpers, 'freenetic-mwan-recover');
assert.ok(mwanRecover.includes("''|-*|*[!A-Za-z0-9_-]*"),
	'Multi-WAN recovery interface names must use a conservative allowlist');
assert.match(mwanRecover, /network\.\$interface\.defaultroute/,
	'Multi-WAN recovery must preserve interfaces that deliberately disable a default route');
assert.match(mwanRecover, /\[ "\$track_status" = offline \]/,
	'Multi-WAN recovery must run only after mwan3 has declared the interface offline');
assert.match(mwanRecover, /route show table main default dev "\$device"/,
	'Multi-WAN recovery must distinguish a missing kernel route from a real provider outage');
assert.match(mwanRecover, /ip -4 rule show[\s\S]*\$i == "iif"[\s\S]*route show table "\$table" default dev "\$device"/,
	'Multi-WAN recovery must preserve the per-interface route mwan3 retains during a normal outage');
assert.match(mwanRecover, /"interface-route-present"/,
	'Multi-WAN recovery must explicitly skip an ordinary mwan3 failover state');
assert.match(mwanRecover, /freenetic-mwan-recover-\$interface\.lock/,
	'Multi-WAN recovery must serialize concurrent hotplug events');
assert.match(mwanRecover, /now - last[\s\S]*-lt 300/,
	'Multi-WAN recovery must rate-limit disruptive interface restarts');
assert.match(mwanRecover, /ifdown "\$interface"[\s\S]*ifup "\$interface"/,
	'Multi-WAN recovery must rebuild the affected netifd interface, not rewrite its configuration');

const multiwan = read(applicationHelpers, 'freenetic-multiwan');
assert.match(multiwan, /case "\$2" in single\|failover\|balance\)/,
	'Multi-WAN mode input must use a fixed allowlist');
assert.match(multiwan, /mktemp -d \/tmp\/freenetic-multiwan\.XXXXXX/,
	'Multi-WAN changes must use an unpredictable private snapshot directory');
assert.match(multiwan, /cp -a \/etc\/config\/mwan3 "\$snapshot_dir\/mwan3"/,
	'Multi-WAN changes must snapshot the complete configuration');
assert.match(multiwan, /network\.\$name\.freenetic_scope[\s\S]*ethernet-port/,
	'Multi-WAN discovery must admit only Freenetic-owned Ethernet uplinks');
assert.match(multiwan, /ethernet-port\|wifi-uplink\|modem-uplink/,
	'Multi-WAN discovery must recognize managed Ethernet, Wi-Fi, and modem uplinks');
assert.match(multiwan, /\[ "\$count" -le 7 \][\s\S]*uplink-limit/,
	'Multi-WAN must reject an eighth uplink instead of creating ambiguous policies');
assert.match(multiwan, /json_add_string scope[\s\S]*network\.\$name\.freenetic_scope/,
	'Multi-WAN status must expose managed uplink scope so inactive backups remain visible');
assert.match(multiwan, /single_interface[\s\S]*requested_single[\s\S]*invalid-interface/,
	'single mode must validate and retain the explicitly selected uplink');
assert.match(multiwan, /uplink_has_internet[\s\S]*mwan3 use[\s\S]*ping[\s\S]*no-internet/,
	'single mode must reject an explicitly selected uplink that cannot reach the Internet');
assert.match(multiwan, /\[ "\$mode" = single \][\s\S]*single_policy=\$policy/,
	'active single-mode status must derive its interface from the policy selected by the default rule');
assert.match(multiwan, /freenetic-mwan-mutation\.lock/,
	'Multi-WAN mode changes must use the shared mwan3 mutation lock');
assert.match(multiwan, /state=checking/,
	'a netifd-up interface must remain in checking state until mwan3 confirms reachability');
assert.match(multiwan, /uci -q commit mwan3[\s\S]*\/etc\/init\.d\/mwan3 reload/,
	'Multi-WAN application must commit and reload as one controller operation');
assert.match(multiwan, /restore_snapshot/,
	'Multi-WAN application must retain a rollback path');

const avahi = read(applicationHelpers, 'freenetic-avahi-reflector');
assert.match(avahi, /mktemp \/tmp\/freenetic-avahi-reflector\.XXXXXX/,
	'Avahi updates must use unpredictable root-owned temporary files');
assert.doesNotMatch(avahi, /freenetic-avahi-reflector\.\$\$/,
	'Avahi updates must not use PID-derived temporary paths');

const update = read(applicationHelpers, 'freenetic-self-update');
assert.ok(update.includes('[ "$#" -eq 1 ] || { reply_error "Usage: $0 status"; exit 0; }'),
	'self-update status must reject extra arguments');
assert.ok(update.includes('[ "$#" -eq 2 ] || { reply_error "Usage: $0 install TAG"; exit 0; }'),
	'self-update install must require exactly one tag');
assert.ok(update.includes('[ "$#" -eq 3 ] || { reply_error "Usage: $0 run TAG STAGE_DIR"; exit 0; }'),
	'self-update run must require exactly one staging directory');

const awgFeed = read(applicationHelpers, 'freenetic-awg-feed');
assert.ok(awgFeed.includes('[ "$#" -le 1 ]'), 'AWG feed helper must reject extra arguments');
assert.match(awgFeed, /case "\$ACTION" in[\s\S]*\n\s*status\)/,
	'AWG feed helper must keep a fixed action set');
assert.doesNotMatch(awgFeed, /\$FEED_ROOT\/keys|wget[^\n]+awg-openwrt-feed\.(?:pem|pub)/,
	'AWG feed trust anchors must never be bootstrapped from the repository they authenticate');
const awgKeyDirectory = path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'freenetic', 'keys');
for (const [ name, expectedSha256 ] of Object.entries({
	'awg-openwrt-feed.pem': 'a71810e45492ceee99df86a72e05c78400d04c3159cc6145a23824cd66e0a239',
	'awg-openwrt-feed.pub': '3f5456b200f2e771aad61376a25b8bead54047ac6cb851dc5dbc52c56c8e5d4b'
})) {
	const contents = fs.readFileSync(path.join(awgKeyDirectory, name));
	assert.equal(crypto.createHash('sha256').update(contents).digest('hex'), expectedSha256,
		`${name} must remain the independently pinned AWG feed trust anchor`);
}

for (const name of [
	'freenetic-ipsec-restart',
	'freenetic-ipsec-status',
	'freenetic-network-restart',
	'freenetic-pbr-restart'
]) {
	const result = run(applicationHelpers, name, [ '-unexpected' ]);
	assert.equal(result.status, 0, `${name} must return a structured error`);
	assert.match(result.stdout, /"ok":false/, `${name} must report unexpected arguments`);
}

for (const name of [ 'freenetic-backup-call' ]) {
	const result = run(applicationHelpers, name, [ '-unexpected' ]);
	assert.notEqual(result.status, 0, `${name} must reject unexpected arguments`);
}
const backup = read(applicationHelpers, 'freenetic-backup-call');
assert.match(backup, /chmod 600 "\$out"/,
	'configuration backups must be private while waiting for browser download');

const diagnosticsBundle = read(applicationHelpers, 'freenetic-diagnostics-bundle');
assert.ok(diagnosticsBundle.includes('[ "$#" -eq 0 ]'),
	'diagnostic bundle must not accept browser-controlled arguments');
assert.match(diagnosticsBundle, /mktemp -d \/tmp\/freenetic-diagnostics\.XXXXXX/,
	'diagnostic bundle must isolate root-owned temporary files');
assert.doesNotMatch(diagnosticsBundle, /uci\s+-q\s+show|\/etc\/shadow|private.?key/i,
	'diagnostic bundle must not collect router secrets');
const diagnosticsBundleArgs = run(applicationHelpers, 'freenetic-diagnostics-bundle', [ '-unexpected' ]);
assert.notEqual(diagnosticsBundleArgs.status, 0,
	'diagnostic bundle must reject unexpected arguments');

const clearCache = run(themeHelpers, 'freenetic-clear-luci-cache', [ '-unexpected' ]);
assert.notEqual(clearCache.status, 0, 'cache helper must reject unexpected arguments');

const diagnosticInjection = run(applicationHelpers, 'freenetic-diagnostics-call', [ 'ping', 'bad;touch' ]);
assert.equal(diagnosticInjection.status, 2, 'diagnostics must reject shell metacharacters');
const packageInjection = run(applicationHelpers, 'freenetic-package-status', [ 'bad;touch' ]);
assert.equal(packageInjection.status, 0, 'package status must return a JSON error for invalid names');
assert.match(packageInjection.stdout, /"ok":false/, 'package status must report invalid names');
const openvpnInjection = run(applicationHelpers, 'freenetic-openvpn-profile', [ 'install', 'bad;touch' ]);
assert.equal(openvpnInjection.status, 0, 'OpenVPN helper must return a JSON error for invalid names');
assert.match(openvpnInjection.stdout, /"ok":false/, 'OpenVPN helper must report invalid names');
const portProbeInjection = run(applicationHelpers, 'freenetic-port-probe', [ 'bad;touch' ]);
assert.equal(portProbeInjection.status, 0, 'Ethernet probe must return a JSON error for invalid names');
assert.match(portProbeInjection.stdout, /"ok":false/, 'Ethernet probe must report invalid names');
const mwanRecoverInjection = run(applicationHelpers, 'freenetic-mwan-recover', [ 'repair', 'bad;touch' ]);
assert.equal(mwanRecoverInjection.status, 0, 'Multi-WAN recovery must return a JSON error for invalid names');
assert.match(mwanRecoverInjection.stdout, /"ok":false/,
	'Multi-WAN recovery must reject interface-name injection');
const multiwanInjection = run(applicationHelpers, 'freenetic-multiwan', [ 'apply', 'bad;touch' ]);
assert.equal(multiwanInjection.status, 0, 'Multi-WAN controller must return a structured error for invalid modes');
assert.match(multiwanInjection.stdout, /"ok":false/, 'Multi-WAN controller must reject mode injection');
const wifiUplink = read(applicationHelpers, 'freenetic-wifi-uplink');
assert.match(wifiUplink, /freenetic_scope[\s\S]*wifi-uplink/,
	'Wi-Fi backup sections must carry a subsystem-specific ownership scope');
assert.match(wifiUplink, /fnwwan[\s\S]*fnwwan\$index/,
	'Wi-Fi backup setup must allocate a private name instead of claiming user wwan');
assert.doesNotMatch(wifiUplink, /network\.wwan|wireless\.wwan|mwan3\.wwan/,
	'Wi-Fi backup setup must never claim the conventional user-owned wwan name');
assert.match(wifiUplink, /mktemp -d \/tmp\/freenetic-wifi-uplink\.XXXXXX/,
	'Wi-Fi backup changes must use a private transactional snapshot');
assert.match(wifiUplink, /for config in network wireless firewall mwan3/,
	'Wi-Fi backup changes must snapshot every affected configuration');
assert.match(wifiUplink, /restore_snapshot/,
	'Wi-Fi backup changes must roll back failed DHCP and subnet checks');
assert.match(wifiUplink, /freenetic-mwan-mutation\.lock/,
	'Wi-Fi setup must serialize against every other mwan3 mutation');
assert.match(wifiUplink, /mkdir "\$lock_dir"[\s\S]*lock_owned=1/,
	'Wi-Fi setup must record ownership only after acquiring the shared lock');
assert.match(wifiUplink, /\[ "\$lock_owned" = 1 \][\s\S]*rmdir "\$lock_dir"/,
	'Wi-Fi cleanup must never remove a shared lock it did not acquire');
assert.match(wifiUplink, /wait_for_internet[\s\S]*mwan3track[\s\S]*no-internet/,
	'Wi-Fi setup must not report success before mwan3 confirms Internet reachability');
assert.match(wifiUplink, /assign_route_metric[\s\S]*20 30 40 50 60 70[\s\S]*network\.\$network_name\.metric=\$route_metric/,
	'Wi-Fi backup must allocate a unique route metric across seven supported uplinks');
assert.match(wifiUplink, /network\.wan\.metric[\s\S]*network\.wan\.metric=10/,
	'Wi-Fi backup setup must assign a primary metric when the WAN has none');
assert.match(wifiUplink, /FREENETIC_MWAN_LOCK_HELD=1[\s\S]*freenetic-multiwan apply/,
	'nested policy updates must reuse the Wi-Fi transaction lock without deadlocking');
assert.match(wifiUplink, /previous_mode[\s\S]*mode=\$previous_mode/,
	'removing Wi-Fi must retain the selected Multi-WAN mode whenever enough uplinks remain');
assert.match(wifiUplink, /\[ "\$#" = 3 \] \|\| \[ "\$#" = 4 \]/,
	'open Wi-Fi networks must be accepted when file.exec omits the empty password argument');
assert.doesNotMatch(wifiUplink, /base64 -d/,
	'Wi-Fi credentials must not depend on an optional base64 utility on the router');
const wifiUplinkInjection = run(applicationHelpers, 'freenetic-wifi-uplink',
	[ 'connect', 'radio0;reboot', 'test', 'psk2', '12345678' ]);
assert.equal(wifiUplinkInjection.status, 0, 'Wi-Fi backup helper must return a structured input error');
assert.match(wifiUplinkInjection.stdout, /"ok":false/,
	'Wi-Fi backup helper must reject radio-name injection');
const uninstallInjection = run(applicationHelpers, 'freenetic-uninstall', [ 'purge-managed;reboot' ]);
assert.equal(uninstallInjection.status, 0, 'uninstall must return a structured error for an invalid mode');
assert.match(uninstallInjection.stdout, /"ok":false/, 'uninstall must reject mode injection');

console.log('helper security contracts: ok');
