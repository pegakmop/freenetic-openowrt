'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(root, 'app', 'deploy.sh'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'app', 'check-router.sh'), 'utf8');

assert.match(deploy, /ROUTER="\$\{FREENETIC_ROUTER:-root@192\.168\.1\.1\}"/,
	'development deployment must support an explicit router target');
assert.match(deploy, /command -v apk/, 'development deployment must detect apk');
assert.match(deploy, /apk info -e luci-app-package-manager/, 'apk deployments must check the package');
assert.match(deploy, /apk add luci-app-package-manager/, 'apk deployments must install the package');
assert.match(deploy, /command -v opkg/, 'development deployment must detect opkg');
assert.match(deploy, /opkg status luci-app-package-manager/, 'opkg deployments must check the package');
assert.match(deploy, /opkg update/, 'opkg deployments must refresh package indexes when needed');
assert.match(deploy, /opkg install luci-app-package-manager/, 'opkg deployments must install the package');
assert.match(deploy, /Neither apk nor opkg is installed/, 'unsupported package managers must fail clearly');
assert.match(deploy, /touch \/lib\/apk\/db\/installed/,
	'development apk deployments must advance LuCI resource cache versioning');
assert.match(deploy, /touch \/usr\/lib\/opkg\/status/,
	'development opkg deployments must advance LuCI resource cache versioning');
assert.match(preflight, /command -v apk/, 'router preflight must detect apk');
assert.match(preflight, /command -v opkg/, 'router preflight must detect opkg');
assert.match(preflight, /package_manager=opkg/, 'router preflight must accept OpenWrt 24.10');
assert.doesNotMatch(preflight, /apk is not installed; this release targets apk-based OpenWrt/,
	'router preflight must not reject opkg-based releases');

console.log('deploy compatibility contract: ok');
