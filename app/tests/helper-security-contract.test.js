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
const uninstallInjection = run(applicationHelpers, 'freenetic-uninstall', [ 'purge-managed;reboot' ]);
assert.equal(uninstallInjection.status, 0, 'uninstall must return a structured error for an invalid mode');
assert.match(uninstallInjection.stdout, /"ok":false/, 'uninstall must reject mode injection');

console.log('helper security contracts: ok');
