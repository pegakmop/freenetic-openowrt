'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(root, 'app', 'deploy.sh'), 'utf8');

assert.match(deploy, /command -v apk/, 'development deployment must detect apk');
assert.match(deploy, /apk info -e luci-app-package-manager/, 'apk deployments must check the package');
assert.match(deploy, /apk add luci-app-package-manager/, 'apk deployments must install the package');
assert.match(deploy, /command -v opkg/, 'development deployment must detect opkg');
assert.match(deploy, /opkg status luci-app-package-manager/, 'opkg deployments must check the package');
assert.match(deploy, /opkg update/, 'opkg deployments must refresh package indexes when needed');
assert.match(deploy, /opkg install luci-app-package-manager/, 'opkg deployments must install the package');
assert.match(deploy, /Neither apk nor opkg is installed/, 'unsupported package managers must fail clearly');

console.log('deploy compatibility contract: ok');
