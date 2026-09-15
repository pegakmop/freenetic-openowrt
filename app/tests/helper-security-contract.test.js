'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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

console.log('helper security contracts: ok');
