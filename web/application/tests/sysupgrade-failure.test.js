'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'system', 'freenetic-system.js'), 'utf8');

const modals = [];
const cleared = [];
let execResult = Promise.resolve({ code: 1, stderr: 'invalid image write' });
global.E = (name, attrs, children) => ({ name, attrs: attrs || {}, children });
global.L = { env: {} };
global.window = {
	location: { host: 'router.lan' },
	setTimeout() { return 17; },
	clearTimeout(id) { cleared.push(id); }
};

const ui = {
	showModal(title, body) { modals.push({ title, body }); },
	hideModal() {},
	pingDevice() { return Promise.reject(new Error('offline')); }
};
const systemView = new Function('view', 'ui', 'fs', 'poll', 'guard', 'rpc', '_', source)(
	{ extend: value => value }, ui,
	{ exec() { return execResult; }, read() { return Promise.resolve(''); } },
	{ add() { throw new Error('polling must not start after a local failure'); }, stop() {} },
	{}, { call() { return Promise.resolve({}); } }, value => value
);

(async () => {
	await systemView.flashUploadedFirmware();
	assert.deepEqual(modals.map(item => item.title), [ 'Flashing…', 'Firmware flashing failed' ]);
	assert.equal(cleared.includes(17), true, 'a local failure must cancel the pending reconnect transition');
	assert.equal(String(modals[1].body[0].children), 'invalid image write');

	modals.length = 0;
	cleared.length = 0;
	execResult = Promise.reject(new Error('network connection lost'));
	await systemView.flashUploadedFirmware();
	assert.deepEqual(modals.map(item => item.title), [ 'Flashing…', 'Rebooting…' ],
		'an expected rpcd disconnect must transition to reboot polling');
	assert.equal(cleared.length, 0);

	console.log('Sysupgrade failure behavior: ok');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
