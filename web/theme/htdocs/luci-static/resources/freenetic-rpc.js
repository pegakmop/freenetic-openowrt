'use strict';
'require baseclass';

/*
 * LuCI's rpc module batches calls through requestAnimationFrame. Backgrounded
 * and headless tabs may never flush that batch, so custom Freenetic views keep
 * their own scheduler here. A microtask still coalesces calls issued by one
 * view/poll tick, but it does not depend on a browser paint to make progress.
 *
 * Prefer uhttpd's native /ubus handler: on embedded hardware it avoids a full
 * LuCI dispatcher pass for every state read. Try it directly and retain the
 * dispatcher endpoint as a compatibility fallback for reverse proxies and
 * older images.
 */
const REQUEST_TIMEOUT_MS = 15000;
const FALLBACK_URL = L.url('admin/ubus');
let requestId = 1;
let endpointPromise = null;
let flushScheduled = false;
const pendingCalls = [];

function timedFetch(url, options, timeoutMs) {
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	let timeoutId;
	const requestOptions = Object.assign({}, options);
	timeoutMs = timeoutMs || REQUEST_TIMEOUT_MS;

	if (controller)
		requestOptions.signal = controller.signal;

	const request = fetch(url, requestOptions);
	const timeout = new Promise((resolve, reject) => {
		timeoutId = setTimeout(() => {
			if (controller)
				controller.abort();
			reject(new Error('ubus request timed out'));
		}, timeoutMs);
	});

	return Promise.race([ request, timeout ]).finally(() => clearTimeout(timeoutId));
}

function sessionId() {
	return (L.env && L.env.sessionid) || '00000000000000000000000000000000';
}

function fetchJson(url, payload, timeoutMs) {
	return timedFetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(payload)
	}, timeoutMs).then(r => {
		if (!r.ok)
			throw new Error('ubus request failed (HTTP ' + r.status + ')');

		return r.json();
	});
}

function selectEndpoint() {
	if (endpointPromise)
		return endpointPromise;

	const directUrl = L.env && L.env.ubuspath;
	/* L.env.ubuspath is emitted by LuCI from the same uhttpd instance that
	 * serves this page. Sending a probe before the first application batch
	 * doubles one network round-trip on high-latency links and needlessly
	 * repeats calls such as system.board. Try the native endpoint directly;
	 * flushCalls() retries the complete batch through the dispatcher only when
	 * the direct request actually fails at the transport/HTTP layer. */
	endpointPromise = Promise.resolve(directUrl || FALLBACK_URL);

	return endpointPromise;
}

function decodeReply(call, msg) {
	if (msg && msg.error) {
		const code = msg.error.code != null ? ', code ' + msg.error.code : '';
		const message = msg.error.message || 'JSON-RPC error';
		throw new Error('ubus request failed (object=' + call.object + ' method=' + call.method +
			', ' + message + code + ')');
	}
	if (!msg || !Array.isArray(msg.result))
		throw new Error('Malformed ubus reply');

	const [rc, data] = msg.result;
	if (rc !== 0)
		throw new Error('ubus error (object=' + call.object + ' method=' + call.method + ', code ' + rc + ')');

	return data || {};
}

function dispatchReplies(calls, payload) {
	const replies = Array.isArray(payload) ? payload : [ payload ];
	const byId = {};
	let hasIds = false;

	replies.forEach(reply => {
		if (reply && reply.id != null) {
			byId[reply.id] = reply;
			hasIds = true;
		}
	});

	calls.forEach((call, index) => {
		const reply = hasIds ? byId[call.message.id] : replies[index];
		try {
			call.resolve(decodeReply(call, reply));
		}
		catch (error) {
			call.reject(error);
		}
	});
}

function flushCalls() {
	flushScheduled = false;
	if (!pendingCalls.length)
		return;

	const calls = pendingCalls.splice(0, pendingCalls.length);
	const messages = calls.map(call => call.message);
	const payload = messages.length === 1 ? messages[0] : messages;

	selectEndpoint().then(url => fetchJson(url, payload).catch(error => {
		if (url === FALLBACK_URL)
			throw error;

		return fetchJson(FALLBACK_URL, payload).then(result => {
			/* Remember a working dispatcher fallback so an older reverse proxy
			 * does not cost one failed native request on every later poll tick. */
			endpointPromise = Promise.resolve(FALLBACK_URL);
			return result;
		});
	}))
		.then(replies => dispatchReplies(calls, replies))
		.catch(error => calls.forEach(call => call.reject(error)));
}

return baseclass.extend({
	call: function(object, method, params) {
		return new Promise((resolve, reject) => {
			pendingCalls.push({
				object,
				method,
				resolve,
				reject,
				message: {
					jsonrpc: '2.0',
					id: requestId++,
					method: 'call',
					params: [ sessionId(), object, method, params || {} ]
				}
			});

			if (!flushScheduled) {
				flushScheduled = true;
				Promise.resolve().then(flushCalls);
			}
		});
	}
});
