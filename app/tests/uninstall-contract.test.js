'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-uninstall');
const helper = fs.readFileSync(helperPath, 'utf8');
const view = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'system', 'freenetic-system.js'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'the uninstall helper must be executable');
assert.match(helper, /case "\$mode" in\s+keep-config\|purge-managed\)/,
	'the helper must expose only the two documented modes');
assert.match(helper, /if \[ "\$mode" = purge-managed \]; then[\s\S]*purge_config/,
	'owned UCI sections must only be removed in explicit purge mode');
assert.match(helper, /freenetic_managed='1'/,
	'full cleanup must be bounded by the explicit ownership marker');
assert.match(helper, /mktemp -d \/tmp\/freenetic-uninstall\.XXXXXX/,
	'the rollback snapshot must use an unpredictable root-owned directory');
assert.match(helper, /mutation_started[\s\S]*removal_committed[\s\S]*snapshot_dir/,
	'a failed package transaction must restore the UCI snapshot');
assert.match(helper, /ddns:ddns\|pbr:pbr\) continue/,
	'shared DDNS and PBR global section types must survive full cleanup');
assert.match(helper, /clear_shared_markers ddns ddns[\s\S]*clear_shared_markers pbr pbr/,
	'ownership markers must be removed from shared DDNS and PBR sections');
assert.doesNotMatch(helper, /apk del[^\n]*(?:luci-base|luci-app-package-manager|pbr|strongswan)/,
	'the APK transaction must not request removal of shared dependencies');
assert.doesNotMatch(helper, /opkg remove[^\n]*(?:luci-base|luci-app-package-manager|pbr|strongswan)/,
	'the opkg transaction must not request removal of shared dependencies');
assert.match(helper, /apk --wait 30 del/,
	'APK removal must tolerate a short-lived package-manager lock');
assert.match(helper, /tail -n 8 "\$package_log"/,
	'package-manager failures must be returned with actionable diagnostics');
for (const pkg of [ 'luci-theme-freenetic', 'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru', 'luci-i18n-freenetic-ru' ])
	assert.ok(helper.includes(pkg), `uninstall must remove ${pkg}`);

assert.match(view, /exec_direct\('\/usr\/libexec\/freenetic-uninstall', \[ mode \], 'json'\)/,
	'the System page must call the constrained uninstall helper');
assert.match(view, /confirmation\.value\.trim\(\) !== 'FREENETIC'/,
	'full cleanup must require an explicit typed confirmation');
assert.match(view, /window\.location\.replace\('\/cgi-bin\/luci\/admin\/logout\?_='/,
	'the completion action must end the session through the real stock LuCI logout route');
assert.match(view, /key\.indexOf\('freenetic-'\) === 0[\s\S]*localStorage[\s\S]*sessionStorage[\s\S]*window\.caches\.delete/,
	'the completion action must clear only Freenetic browser state and cached assets before logout');
assert.doesNotMatch(view, /(?:localStorage|sessionStorage)\.clear\(\)/,
	'uninstall must not wipe unrelated browser preferences for the router origin');
assert.doesNotMatch(view, /cgi_base \+ '\/admin\/status\/overview'/,
	'the completion action must not omit the LuCI CGI executable');
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-uninstall keep-config'], [ 'exec' ]);
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-uninstall purge-managed'], [ 'exec' ]);

console.log('uninstall contract: ok');
