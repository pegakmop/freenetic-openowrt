'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'system', 'freenetic-apps.js'), 'utf8');
const originalFormat = String.prototype.format;

function format(...values) {
	let index = 0;
	return String(this).replace(/%s/g, () => String(values[index++]));
}

function evaluate(execDirect, notifications) {
	const view = { extend(value) { return value; } };
	const uiHelper = {
		empty() {},
		content(node, value) { node.textContent = value; },
		notifyLong(message, level) { notifications.push({ message: String(message), level }); }
	};
	return new Function('view', 'fs', 'uiHelper', 'E', '_', source)(
		view, { exec_direct: execDirect }, uiHelper, () => ({}), value => value);
}

function initialize(application) {
	application.packageIndexRefresh = null;
	application.packageOperationInProgress = 0;
	application.packageStatusRefreshPending = false;
	application.installedNames = {};
	application.activeFilter = 'recommended';
	application.renderCatalog = () => {};
}

async function successCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		if (args[0] === 'update')
			return Promise.resolve({ code: 0 });
		if (args[0] === 'install')
			return Promise.resolve({ code: 0 });
		throw new Error(`unexpected helper call: ${helper} ${args.join(' ')}`);
	}, notifications);
	initialize(application);

	const item = { name: 'L2TP/IPsec', packages: [ 'xl2tpd', 'strongswan-default' ] };
	const button = { disabled: false, textContent: '', className: '' };
	const pill = { textContent: '', className: '' };
	await application.toggleItem(item, false, button, pill, {});

	assert.deepEqual(calls, [
		[ 'update' ],
		[ 'install', 'xl2tpd', 'strongswan-default' ]
	], 'fresh installs must update package indexes before invoking install');
	assert.equal(application.installedNames.xl2tpd, true);
	assert.equal(application.installedNames['strongswan-default'], true);
	assert.equal(notifications.at(-1).level, 'info');
}

async function failedUpdateCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		return Promise.resolve({ code: 4, stderr: 'network unavailable' });
	}, notifications);
	initialize(application);

	const item = { name: 'L2TP/IPsec', packages: [ 'xl2tpd' ] };
	const button = { disabled: false, textContent: '', className: '' };
	await application.toggleItem(item, false, button, { textContent: '', className: '' }, {});

	assert.deepEqual(calls, [ [ 'update' ] ], 'a failed index refresh must prevent installation');
	assert.equal(button.disabled, false);
	assert.match(notifications.at(-1).message, /network unavailable/);
	assert.equal(application.packageIndexRefresh, null, 'a failed refresh must be retryable');
}

async function sharedRemovalCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		return Promise.resolve({ code: 0 });
	}, notifications);
	initialize(application);
	application.installedNames = {
		xl2tpd: true,
		'ppp-mod-pppol2tp': true,
		'kmod-l2tp': true,
		'kmod-pppol2tp': true,
		'strongswan-default': true,
		'luci-proto-ppp': true,
		'strongswan-mod-eap-identity': true,
		'strongswan-mod-eap-mschapv2': true,
		xfrm: true,
		'kmod-xfrm-interface': true,
		'luci-proto-xfrm': true
	};
	const item = {
		id: 'l2tp_ipsec', name: 'L2TP/IPsec',
		packages: [ 'xl2tpd', 'ppp-mod-pppol2tp', 'kmod-l2tp', 'kmod-pppol2tp', 'strongswan-default', 'luci-proto-ppp' ]
	};
	const button = { disabled: false, textContent: '', className: '' };
	const pill = { textContent: '', className: '' };
	await application.toggleItem(item, true, button, pill, {});

	assert.deepEqual(calls, [ [ 'remove', 'xl2tpd', 'kmod-l2tp', 'kmod-pppol2tp', 'luci-proto-ppp' ] ]);
	assert.equal(application.installedNames['ppp-mod-pppol2tp'], true);
	assert.equal(application.installedNames['strongswan-default'], true);
	assert.equal(application.installedNames.xl2tpd, undefined);
}

String.prototype.format = format;
Promise.resolve()
	.then(successCase)
	.then(failedUpdateCase)
	.then(sharedRemovalCase)
	.then(() => console.log('Applications package install runtime: ok'))
	.finally(() => {
		if (originalFormat)
			String.prototype.format = originalFormat;
		else
			delete String.prototype.format;
	});
