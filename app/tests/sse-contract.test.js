'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const endpoint = path.join(root, 'app', 'luci-app-freenetic', 'root', 'www',
	'cgi-bin', 'freenetic-events');
assert.equal(fs.existsSync(endpoint), false,
	'live metrics must not ship a long-running CGI which occupies a uhttpd script slot');

for (const view of [ 'freenetic-dashboard.js', 'freenetic-traffic.js' ]) {
	const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
		'luci-static', 'resources', 'view', 'status', view), 'utf8');
	assert.doesNotMatch(source, /rpc\.stream\(/,
		`${view} must not retain a uhttpd CGI worker`);
	assert.match(source, /livePollers/, `${view} must register short live polling callbacks`);
	assert.match(source, /poll\.add\(/, `${view} must refresh through the LuCI poll scheduler`);
}

const rpcSource = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'resources', 'freenetic-rpc.js'), 'utf8');
assert.match(rpcSource, /L\.env && L\.env\.ubuspath/,
	'live reads must prefer uhttpd native ubus instead of the LuCI dispatcher');
assert.match(rpcSource, /Promise\.resolve\(\)\.then\(flushCalls\)/,
	'RPC batching must make progress without requestAnimationFrame');
assert.doesNotMatch(rpcSource, /EventSource/,
	'the shared RPC helper must not open persistent CGI connections');

const deploySource = fs.readFileSync(path.join(root, 'app', 'deploy.sh'), 'utf8');
assert.match(deploySource, /rm -f \/www\/cgi-bin\/freenetic-events/,
	'development deployment must remove an endpoint left by older builds');

const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'freenetic', 'cascade.css'), 'utf8');
assert.match(css, /\[data-indicator="poll-status"\]\s*\{\s*display:\s*none/,
	'poll status indicator must not occupy the header');

console.log('Batched live update contract: ok');
