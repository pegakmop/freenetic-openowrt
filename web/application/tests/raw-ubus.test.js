'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resourcesPath = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources');
const themeResourcesPath = path.join(__dirname, '..', '..', 'theme', 'htdocs', 'luci-static', 'resources');
const modulePath = path.join(themeResourcesPath, 'freenetic-rpc.js');
const source = fs.readFileSync(modulePath, 'utf8');
const requests = [];

function responseFor(message) {
	const object = message.params[1];
	const method = message.params[2];
	let reply;

	if (object === 'system' && method === 'board')
		reply = { result: [ 0, { ok: true } ] };
	else if (object === 'network.interface' && method === 'dump')
		reply = { result: [ 0, null ] };
	else if (object === 'uci' && method === 'get')
		reply = { result: [ 4, null ] };
	else if (object === 'uci' && method === 'commit')
		reply = { error: { code: -32002, message: 'Access denied' } };
	else
		reply = { unexpected: true };

	return Object.assign({ jsonrpc: '2.0', id: message.id }, reply);
}

const fetchMock = (url, options) => {
	requests.push({ url, options });
	const payload = JSON.parse(options.body);
	const response = payload.id === 0
		? { jsonrpc: '2.0', id: 0, result: [ 0, { model: 'test' } ] }
		: (Array.isArray(payload) ? payload.map(responseFor) : responseFor(payload));
	return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(response) });
};
const rpc = new Function('baseclass', 'fetch', 'L', source)(
	{ extend: value => value },
	fetchMock,
	{ url: value => '/cgi-bin/luci/' + value, env: {
		sessionid: 'test-session',
		scriptname: '/cgi-bin/luci',
		ubuspath: '/ubus/'
	} }
);

(async () => {
	const call = rpc.call;
	assert.deepEqual(await call('system', 'board'), { ok: true },
		'the helper must remain safe when passed around as an unbound function');
	assert.equal(requests[0].url, '/ubus/', 'the helper must use the native uhttpd ubus handler directly');
	assert.equal(requests[0].options.method, 'POST');
	assert.equal(requests[0].options.credentials, 'include');
	assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
	assert.deepEqual(JSON.parse(requests[0].options.body), {
		jsonrpc: '2.0',
		id: 1,
		method: 'call',
		params: [ 'test-session', 'system', 'board', {} ]
	});

	const beforeBatch = requests.length;
	const [ board, dump ] = await Promise.all([
		call('system', 'board'),
		call('network.interface', 'dump', { verbose: true })
	]);
	assert.deepEqual(board, { ok: true });
	assert.deepEqual(dump, {});
	assert.equal(requests.length, beforeBatch + 1, 'same-tick calls must share one HTTP request');
	const batch = JSON.parse(requests[beforeBatch].options.body);
	assert.equal(batch.length, 2);
	assert.deepEqual(batch.map(message => message.id), [ 2, 3 ]);

	const failures = await Promise.allSettled([
		call('uci', 'get'),
		call('uci', 'commit'),
		call('system', 'info')
	]);
	assert.match(failures[0].reason.message, /object=uci method=get, code 4/);
	assert.match(failures[1].reason.message, /object=uci method=commit, Access denied, code -32002/);
	assert.match(failures[2].reason.message, /Malformed ubus reply/);
	assert.equal(JSON.parse(requests.at(-1).options.body).length, 3,
		'one failed batch member must not discard the other replies');

	const fallbackRequests = [];
	const fallbackFetch = (url, options) => {
		fallbackRequests.push({ url, options });
		if (url === '/ubus/')
			return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
		const payload = JSON.parse(options.body);
		return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responseFor(payload)) });
	};
	const fallbackRpc = new Function('baseclass', 'fetch', 'L', source)(
		{ extend: value => value },
		fallbackFetch,
		{ url: value => '/cgi-bin/luci/' + value, env: {
			sessionid: 'test-session',
			ubuspath: '/ubus/'
		} }
	);
	assert.deepEqual(await fallbackRpc.call('system', 'board'), { ok: true });
	assert.deepEqual(fallbackRequests.map(request => request.url), [
		'/ubus/',
		'/cgi-bin/luci/admin/ubus'
	], 'an unavailable native endpoint must fall back before application calls are sent');

	const expectedViews = [
		'view/network/freenetic-firewall.js',
		'view/network/freenetic-ddns.js',
		'view/network/freenetic-mynetworks.js',
		'view/network/freenetic-wifi-acl.js',
		'view/network/freenetic-other-connections.js',
		'view/network/freenetic-portforward.js',
		'view/network/freenetic-routing.js',
		'view/network/freenetic-wan.js',
		'view/status/freenetic-clients.js',
		'view/status/freenetic-dashboard.js',
		'view/status/freenetic-traffic.js',
		'view/status/freenetic-wifimonitor.js',
		'view/system/freenetic-diagnostics.js',
		'view/system/freenetic-system.js'
	];

	for (const relativeView of expectedViews) {
		const view = fs.readFileSync(path.join(resourcesPath, relativeView), 'utf8');
		assert.match(view, /'require freenetic-rpc as rpc';/,
			`${relativeView} must load the shared raw ubus helper`);
		assert.match(view, /const ubusCall = rpc\.call;/,
			`${relativeView} must use the shared raw ubus helper`);
		assert.doesNotMatch(view, /function ubusCall|let ubusReqId/,
			`${relativeView} must not carry a private raw ubus implementation`);
	}

	console.log('raw ubus helper: ok');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
