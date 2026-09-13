'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-self-update');
const helper = fs.readFileSync(helperPath, 'utf8');
const installer = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];
const preflight = fs.readFileSync(path.join(root, 'app', 'freenetic-preflight.mk'), 'utf8');
const appMakefile = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'Makefile'), 'utf8');
const themeMakefile = fs.readFileSync(path.join(root, 'app', 'luci-theme-freenetic', 'Makefile'), 'utf8');

assert.ok(fs.statSync(helperPath).mode & 0o111, 'self-update helper must be executable');
assert.ok(helper.startsWith('#!/bin/sh'), 'self-update helper must be POSIX sh');
assert.doesNotMatch(helper, /^set -u$/m,
	'OpenWrt 24.10 jshn expands optional variables and is incompatible with nounset');
assert.match(helper, /RAW_BASE_URL=https:\/\/raw\.githubusercontent\.com\/unisequence\/freenetic/,
	'installer source repository must be fixed router-side');
assert.match(helper, /RELEASES_BASE_URL=https:\/\/github\.com\/unisequence\/freenetic\/releases\/download/,
	'release asset repository must be fixed router-side');
assert.match(helper, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/,
	'release tags must be constrained to Freenetic semver tags');
assert.match(helper, /mktemp -d \/tmp\/freenetic-self-update\.XXXXXX/,
	'updates must use an isolated staging directory');
assert.match(helper, /cp "\$0" "\$stage_dir\/runner"/,
	'the running updater must survive replacement of its installed package');
assert.match(helper, /grep -Fqx "RELEASE_TAG=\\"\$tag\\""/,
	'downloaded installers must declare the selected release tag exactly');
assert.match(helper, /MAX_INSTALLER_BYTES=262144/,
	'downloaded installer size must be bounded');
assert.match(helper, /sh -n "\$installer"/,
	'downloaded installers must pass a shell syntax check');
assert.match(helper, /FREENETIC_RELEASE_BASE_URL="\$RELEASES_BASE_URL\/\$tag" sh "\$installer"/,
	'asset downloads must stay pinned to the selected GitHub release');
assert.match(helper, /uci -q set "freenetic\.updates\.installed_release=\$tag"/,
	'a successful UI update must persist its release tag');
assert.match(helper, /apk query --fields name,version --format json --installed/,
	'status must read package versions from current apk');
assert.match(helper, /opkg status "\$package_name"/,
	'status must read package versions from legacy opkg');
assert.match(helper, /json_add_array packages/,
	'status must expose installed versions without relying on package-manager-call');
assert.match(helper, /reply_update_error\(\)/,
	'self-update failures must expose structured update diagnostics');
assert.match(helper, /last_installer_stage\(\)/,
	'self-update must identify the last installer stage on failure');
assert.match(helper, /rollback_release\(\)/,
	'self-update must have an automatic rollback path');
assert.match(helper, /previous_tag="\$\(uci -q get freenetic\.updates\.installed_release/,
	'self-update must capture the previous release before changing packages');
assert.match(helper, /json_add_boolean rollback_attempted/,
	'self-update must report whether rollback was attempted');
assert.match(helper, /json_add_boolean rollback_ok/,
	'self-update must report rollback success separately from update success');
assert.match(helper, /fail_after_mutation\(\)/,
	'package and post-install failures must pass through rollback handling');
assert.match(installer, /stage preflight/,
	'the release installer must report the preflight stage');
assert.match(installer, /stage package_verification/,
	'the release installer must report package verification failures');
assert.match(installer, /stage package_install/,
	'the release installer must report package installation failures');
assert.match(installer, /stage post_install/,
	'the release installer must report post-install failures');
assert.match(installer, /stage smoke_test/,
	'the release installer must report smoke-test failures');
assert.match(dashboard, /freeneticUpdateResult/,
	'dashboard update errors must retain structured helper diagnostics');
assert.match(dashboard, /Update failed during %s: %s/,
	'dashboard must show the failing update stage');
assert.match(dashboard, /Automatic rollback failed; check the router before retrying\./,
	'dashboard must surface a failed rollback clearly');

assert.deepEqual(acl.read.file['/usr/libexec/freenetic-self-update status'], [ 'exec' ]);
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-self-update install *'], [ 'exec' ]);
assert.match(preflight, /FREENETIC_VERSION_PATHS:=.*app\/luci-app-freenetic.*app\/luci-theme-freenetic.*web\/application.*web\/theme/,
	'theme and application versions must cover both source trees');
assert.match(appMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'application package must use the shared release revision');
assert.match(themeMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'theme package must use the shared release revision');

console.log('Freenetic self-update contract: ok');
