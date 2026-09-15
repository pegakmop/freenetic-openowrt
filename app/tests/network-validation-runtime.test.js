'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'application',
	'htdocs', 'luci-static', 'resources', 'freenetic-network.js'), 'utf8');
const helper = new Function('baseclass', 'uci', source)({ extend(value) { return value; } }, {});

for (const address of [ '0.0.0.0', '192.168.1.1', '255.255.255.255' ])
	assert.equal(helper.validIPv4(address), true, `${address} must be valid IPv4`);
for (const address of [ '256.0.0.1', '999.999.999.999', '1.2.3', '1.2.3.-1' ])
	assert.equal(helper.validIPv4(address), false, `${address} must be rejected`);

assert.equal(helper.validIPv4Netmask('255.255.255.0'), true);
assert.equal(helper.validIPv4Netmask('255.0.255.0'), false);
assert.equal(helper.validIPv4Netmask('255.255.255.1'), false);

for (const address of [ '::1', '2001:db8::1', 'fe80::1%eth0', '2001:db8:0:1:2:3:4:5' ])
	assert.equal(helper.validIPv6(address, false), true, `${address} must be valid IPv6`);
for (const address of [ '1:::2', '12345:0:0:0:0:0:0:0', '1::2::3', 'abcd:1:2' ])
	assert.equal(helper.validIPv6(address, false), false, `${address} must be rejected`);
assert.equal(helper.validIPv6('2001:db8::/64', true), true);
assert.equal(helper.validIPv6('2001:db8::/129', true), false);

assert.equal(helper.validPort('1', false), true);
assert.equal(helper.validPort('65535', false), true);
assert.equal(helper.validPort('8000-9000', true), true);
for (const port of [ '0', '65536', 'abc', '9000-8000' ])
	assert.equal(helper.validPort(port, true), false, `${port} must be rejected`);

console.log('network validation runtime: ok');
