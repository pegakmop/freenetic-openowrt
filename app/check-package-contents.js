'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_NAMES = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];

const EXPECTED_FILES = {
	'luci-theme-freenetic': [
		'etc/uci-defaults/30_luci-theme-freenetic',
		'usr/libexec/freenetic-clear-luci-cache',
		'usr/share/rpcd/acl.d/luci-theme-freenetic.json',
		'usr/share/ucode/luci/template/themes/freenetic/footer.ut',
		'usr/share/ucode/luci/template/themes/freenetic/header.ut',
		'usr/share/ucode/luci/template/themes/freenetic/sysauth.ut',
		'www/luci-static/freenetic/cascade.css',
		'www/luci-static/freenetic/favicon.svg',
		'www/luci-static/resources/freenetic-navigation.js',
		'www/luci-static/resources/freenetic-rpc.js',
		'www/luci-static/resources/menu-freenetic.js',
		'www/luci-static/resources/settings-freenetic.js'
	],
	'luci-app-freenetic': [
		'etc/config/freenetic',
		'usr/libexec/freenetic-awg-feed',
		'usr/libexec/freenetic-backup-call',
		'usr/libexec/freenetic-diagnostics-call',
		'usr/libexec/freenetic-ipsec-restart',
		'usr/libexec/freenetic-ipsec-status',
		'usr/libexec/freenetic-network-restart',
		'usr/libexec/freenetic-openvpn-profile',
		'usr/libexec/freenetic-package-status',
		'usr/libexec/freenetic-pbr-restart',
		'usr/libexec/freenetic-self-update',
		'usr/share/luci/menu.d/zz-luci-freenetic.json',
		'usr/share/rpcd/acl.d/luci-app-freenetic.json',
		'www/cgi-bin/freenetic-events',
		'www/luci-static/resources/freenetic-diagnostics.js',
		'www/luci-static/resources/freenetic-network.js',
		'www/luci-static/resources/freenetic-qrcode.js',
		'www/luci-static/resources/freenetic-ui.js',
		'www/luci-static/resources/freenetic-view-guard.js',
		'www/luci-static/resources/view/network/freenetic-ddns.js',
		'www/luci-static/resources/view/network/freenetic-firewall.js',
		'www/luci-static/resources/view/network/freenetic-mynetworks.js',
		'www/luci-static/resources/view/network/freenetic-other-connections.js',
		'www/luci-static/resources/view/network/freenetic-portforward.js',
		'www/luci-static/resources/view/network/freenetic-routing.js',
		'www/luci-static/resources/view/network/freenetic-wan.js',
		'www/luci-static/resources/view/network/freenetic-wifi-acl.js',
		'www/luci-static/resources/view/status/freenetic-clients.js',
		'www/luci-static/resources/view/status/freenetic-dashboard.js',
		'www/luci-static/resources/view/status/freenetic-traffic.js',
		'www/luci-static/resources/view/status/freenetic-wifimonitor.js',
		'www/luci-static/resources/view/system/freenetic-apps.js',
		'www/luci-static/resources/view/system/freenetic-diagnostics.js',
		'www/luci-static/resources/view/system/freenetic-system.js'
	],
	'luci-i18n-theme-freenetic-ru': [
		'usr/lib/lua/luci/i18n/freenetic-theme.ru.lmo'
	],
	'luci-i18n-freenetic-ru': [
		'usr/lib/lua/luci/i18n/freenetic.ru.lmo'
	]
};

function run(command, args) {
	const result = childProcess.spawnSync(command, args, { encoding: 'utf8' });
	if (result.error)
		throw result.error;
	if (result.status !== 0)
		throw new Error(command + ' failed (' + result.status + '): ' +
			(result.stderr || result.stdout || '').trim());
}

function archiveMatches(filename, packageName, format) {
	if (format === 'apk')
		return filename === packageName + '.apk' ||
			(filename.startsWith(packageName + '-') && filename.endsWith('.apk'));
	if (format === 'ipk')
		return filename.startsWith(packageName + '_') && filename.endsWith('.ipk');
	throw new Error('Unsupported package format: ' + format);
}

function archiveVersion(filename, packageName, format) {
	if (format === 'apk')
		return filename.slice((packageName + '-').length, -'.apk'.length);

	const stem = filename.slice(0, -'.ipk'.length);
	const prefix = packageName + '_';
	const architectureSeparator = stem.lastIndexOf('_');
	if (!stem.startsWith(prefix) || architectureSeparator <= prefix.length)
		throw new Error('Cannot parse IPK version from ' + filename);
	return stem.slice(prefix.length, architectureSeparator);
}

function findArchive(packageRoot, packageName, format) {
	if (!fs.existsSync(packageRoot))
		throw new Error('Package output directory does not exist: ' + packageRoot);

	const candidates = fs.readdirSync(packageRoot, { withFileTypes: true })
		.filter(entry => entry.isFile() && archiveMatches(entry.name, packageName, format))
		.map(entry => path.join(packageRoot, entry.name));
	if (candidates.length !== 1)
		throw new Error('Expected exactly one ' + format.toUpperCase() + ' for ' + packageName +
			', found ' + candidates.length + ': ' + candidates.map(path.basename).join(', '));
	if (fs.statSync(candidates[0]).size === 0)
		throw new Error('Package archive is empty: ' + candidates[0]);
	return candidates[0];
}

function extractArchive(archive, format, apkTool) {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-package-check-'));
	const root = path.join(temporaryDirectory, 'root');
	fs.mkdirSync(root);

	try {
		if (format === 'apk') {
			if (!apkTool || !fs.existsSync(apkTool))
				throw new Error('OpenWrt host apk tool is required for APK inspection: ' + (apkTool || '(not set)'));
			run(apkTool, [ 'extract', '--allow-untrusted', '--no-chown', '--destination', root, archive ]);
		}
		else {
			const packageDirectory = path.join(temporaryDirectory, 'ipk');
			fs.mkdirSync(packageDirectory);
			run('tar', [ '-xzf', archive, '-C', packageDirectory ]);
			const dataArchive = path.join(packageDirectory, 'data.tar.gz');
			if (!fs.existsSync(dataArchive))
				throw new Error('IPK does not contain data.tar.gz: ' + archive);
			run('tar', [ '-xzf', dataArchive, '-C', root ]);
		}

		return { root, temporaryDirectory };
	}
	catch (error) {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		throw error;
	}
}

function walkFiles(directory, relativeDirectory = '') {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const relativePath = path.posix.join(relativeDirectory, entry.name);
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory())
			files.push(...walkFiles(absolutePath, relativePath));
		else if (entry.isFile() || entry.isSymbolicLink())
			files.push(relativePath);
	}
	return files.sort();
}

function requireJson(root, relativePath) {
	try {
		const value = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('JSON root is not an object');
	}
	catch (error) {
		throw new Error('Invalid packaged JSON ' + relativePath + ': ' + error.message);
	}
}

function verifyPackageContents(packageRoot, format, apkTool) {
	if (!['apk', 'ipk'].includes(format))
		throw new Error('Package format must be apk or ipk');

	const records = [];
	const extracted = [];
	try {
		for (const packageName of PACKAGE_NAMES) {
			const archive = findArchive(packageRoot, packageName, format);
			const version = archiveVersion(path.basename(archive), packageName, format);
			const extraction = extractArchive(archive, format, apkTool);
			const files = walkFiles(extraction.root);
			extracted.push(extraction.temporaryDirectory);

			for (const expectedFile of EXPECTED_FILES[packageName]) {
				if (!files.includes(expectedFile))
					throw new Error(packageName + ' is missing ' + expectedFile);
			}

			for (const packagedFile of files.filter(file => file.startsWith('usr/libexec/') ||
				file.startsWith('www/cgi-bin/'))) {
				const mode = fs.statSync(path.join(extraction.root, packagedFile)).mode;
				if (!(mode & 0o111))
					throw new Error(packageName + ' ships a non-executable helper: ' + packagedFile);
			}

			for (const jsonFile of [
				'usr/share/rpcd/acl.d/luci-theme-freenetic.json',
				'usr/share/rpcd/acl.d/luci-app-freenetic.json',
				'usr/share/luci/menu.d/zz-luci-freenetic.json'
			]) {
				if (files.includes(jsonFile))
					requireJson(extraction.root, jsonFile);
			}

			if (packageName === 'luci-theme-freenetic' && files.some(file =>
				file.startsWith('www/luci-static/resources/view/')))
				throw new Error('Theme package contains application views');
			if (packageName === 'luci-app-freenetic' && (files.some(file =>
				file.startsWith('www/luci-static/freenetic/')) || files.some(file =>
				file.startsWith('usr/share/ucode/luci/'))))
				throw new Error('Application package contains theme-owned files');

			records.push({ name: packageName, version, archive, files });
		}
	}
	finally {
		for (const temporaryDirectory of extracted)
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}

	const versions = new Set(records.map(record => record.version));
	if (versions.size !== 1)
		throw new Error('Freenetic package versions do not match: ' + [...versions].join(', '));

	return records;
}

function main() {
	const packageRoot = path.resolve(process.argv[2] || '');
	const format = process.argv[3] || process.env.FREENETIC_PACKAGE_FORMAT || '';
	const apkTool = process.argv[4] || process.env.FREENETIC_APK_TOOL || '';
	const records = verifyPackageContents(packageRoot, format, apkTool);

	console.log('Package contents (' + format + '): ok');
	console.log('Freenetic package version: ' + records[0].version);
	for (const record of records)
		console.log(record.name + ': ' + record.files.length + ' files');
}

if (require.main === module) {
	try {
		main();
	}
	catch (error) {
		console.error('Package contents: failed\n' + error.message);
		process.exitCode = 1;
	}
}

module.exports = {
	EXPECTED_FILES,
	PACKAGE_NAMES,
	archiveMatches,
	archiveVersion,
	findArchive,
	verifyPackageContents
};
