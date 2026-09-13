'use strict';

const assert = require('node:assert/strict');
const checker = require('../check-package-contents.js');

assert.equal(checker.archiveVersion(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'apk'),
	'26.256.50513~5091025');
assert.equal(checker.archiveVersion(
	'luci-app-freenetic_26.256.50513~5091025_all.ipk', 'luci-app-freenetic', 'ipk'),
	'26.256.50513~5091025');
assert.equal(checker.archiveMatches(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'apk'), true);
assert.equal(checker.archiveMatches(
	'luci-app-freenetic_26.256.50513~5091025_all.ipk', 'luci-app-freenetic', 'ipk'), true);
assert.equal(checker.archiveMatches(
	'luci-app-freenetic-26.256.50513~5091025.apk', 'luci-app-freenetic', 'ipk'), false);

for (const packageName of checker.PACKAGE_NAMES) {
	assert.ok(checker.EXPECTED_FILES[packageName].length > 0,
		packageName + ' must have a package content contract');
}

console.log('package content contract: ok');
