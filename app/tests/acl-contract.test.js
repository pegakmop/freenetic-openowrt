'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const resources = path.join(root, 'web', 'application', 'htdocs', 'luci-static', 'resources');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'share',
	'rpcd', 'acl.d', 'luci-app-freenetic.json');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];

function walk(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const item = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(item) : [ item ];
	});
}

const ubusGrants = {};
for (const access of [ acl.read, acl.write ]) {
	for (const [object, methods] of Object.entries(access.ubus || {})) {
		ubusGrants[object] ||= new Set();
		methods.forEach(method => ubusGrants[object].add(method));
	}
}

const fileGrants = Object.keys(acl.read.file || {}).concat(Object.keys(acl.write.file || {}));
const missingUbus = new Set();
const missingFiles = new Set();

for (const filename of walk(resources).filter(file => file.endsWith('.js'))) {
	const source = fs.readFileSync(filename, 'utf8');
	let match;
	const ubusPattern = /ubusCall\('([^']+)',\s*'([^']+)'/g;
	const filePattern = /fs\.(?:read|exec|exec_direct)\('([^']+)'/g;

	while ((match = ubusPattern.exec(source)) != null) {
		const [, object, method] = match;
		/* rpcd's UCI ACL is expressed through read.uci/write.uci instead of
		 * the generic ubus method map. */
		if (object !== 'uci' && !ubusGrants[object]?.has(method))
			missingUbus.add(`${object}.${method}`);
	}

	while ((match = filePattern.exec(source)) != null) {
		const executable = match[1];
		if (!fileGrants.some(grant => grant === executable || grant.startsWith(executable + ' ')))
			missingFiles.add(executable);
	}
}

assert.deepEqual([ ...missingUbus ].sort(), [], 'literal ubus calls must be covered by rpcd ACL');
assert.deepEqual([ ...missingFiles ].sort(), [], 'literal file operations must be covered by rpcd ACL');
assert.ok(acl.read.uci.includes('luci'), 'theme detection requires read access to luci config');
assert.ok(acl.write.uci.includes('luci'), 'theme settings require write access to luci config');
assert.ok(acl.read.ubus.uci.includes('get'), 'raw UCI reads require the legacy ubus method grant');
assert.ok(acl.read.ubus.uci.includes('changes'), 'the unsaved changes header requires the UCI changes grant');
for (const method of [ 'add', 'apply', 'commit', 'confirm', 'delete', 'order', 'rename', 'rollback', 'set' ])
	assert.ok(acl.write.ubus.uci.includes(method), `UCI editing requires the ${method} ubus grant`);
assert.ok(acl.read.file['/proc/[0-9]*/net/arp'],
	'new rpcd releases resolve /proc/net through /proc/<pid>/net and require the resolved path grant');
assert.ok(acl.read.file['/usr/libexec/package-manager-call update'],
	'package index refresh must have the exact helper ACL used by the application catalog');
assert.ok(acl.read.file['/usr/libexec/freenetic-multiwan status'],
	'Multi-WAN status must use the controller read grant');
assert.ok(acl.write.file['/usr/libexec/freenetic-multiwan apply *'],
	'Multi-WAN changes must use the controller write grant');
assert.ok(acl.read.file['/usr/libexec/freenetic-wifi-uplink status'],
	'Wi-Fi backup status must use a read-only helper grant');
assert.ok(acl.write.file['/usr/libexec/freenetic-wifi-uplink connect *'],
	'Wi-Fi backup setup must use the transactional helper grant');
assert.ok(acl.write.file['/usr/libexec/freenetic-wifi-uplink remove'],
	'Wi-Fi backup removal must use an exact helper grant');
assert.ok(acl.write.file['/sbin/ifup guest'],
	'guest activation must be constrained to the only interface the UI starts');
assert.equal(acl.write.file['/sbin/ifup'], undefined,
	'the ACL must not grant a generic argument-free ifup capability');

console.log('rpcd ACL contract: ok');
