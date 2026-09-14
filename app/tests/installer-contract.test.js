'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const installer = fs.readFileSync(path.join(__dirname, '../../install.sh'), 'utf8');

assert(installer.startsWith('#!/bin/sh'), 'installer must be POSIX sh');
for (const marker of [
	"mediatek/filogic",
	"ramips/mt7621",
	"aarch64_cortex-a53",
	"mipsel_24kc",
	"luci-theme-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-app-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-theme-freenetic-${ASSET_VERSION}-all.ipk",
	"luci-app-freenetic-${ASSET_VERSION}-all.ipk",
	"luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-all.ipk",
	"luci-i18n-freenetic-ru-${ASSET_VERSION}-all.ipk",
	"FNC_BIN=\"fnc-${ASSET_VERSION}-${target_suffix}-${fnc_variant}\"",
	"sha256sum",
	"apk add --allow-untrusted",
	"opkg install",
	"neither apk nor opkg is installed",
	"link_runtime_library",
	"LD_LIBRARY_PATH=\"/usr/lib/freenetic:/lib:/usr/lib",
	"/usr/lib/freenetic/fnc.bin",
	"/usr/bin/fnc",
	"/tmp/luci-indexcache*",
	"/etc/init.d/rpcd",
	"fnc show version",
	"freenetic.updates.installed_release=$RELEASE_TAG",
	"uci -q commit freenetic"
]) {
	assert(installer.includes(marker), `installer is missing: ${marker}`);
}

assert.match(installer, /^RELEASE_TAG="v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?"$/m,
	'release installer must carry a semver release tag');
assert.match(installer, /^ASSET_VERSION="[0-9]{2}\.[0-9]{3}\.[0-9]+\.[0-9a-f]+"$/m,
	'release installer must carry the OpenWrt-derived asset version');
for (const name of [ 'theme_sha256', 'app_sha256', 'theme_ru_sha256', 'app_ru_sha256',
	'fnc_sha256_apk', 'fnc_sha256_ipk' ]) {
	assert.strictEqual((installer.match(new RegExp(`${name}="[0-9a-f]{64}"`, 'g')) || []).length, 2,
		`${name} must be pinned for APK and IPK/target variants`);
}

for (const name of [
	'fnc_ubus_lib_apk="libubus.so.20251202"',
	'fnc_ubox_lib_apk="libubox.so.20260213"',
	'fnc_blobmsg_lib_apk="libblobmsg_json.so.20260213"',
	'fnc_ubus_lib_ipk="libubus.so.20250102"',
	'fnc_ubox_lib_ipk="libubox.so.20240329"',
	'fnc_blobmsg_lib_ipk="libblobmsg_json.so.20240329"'
]) {
	assert(installer.includes(name), `installer is missing manager-specific runtime pin: ${name}`);
}

const checksumCount = (installer.match(/download_checked /g) || []).length;
assert.strictEqual(checksumCount, 5, 'installer must verify exactly five assets');

console.log('installer contract: ok');
