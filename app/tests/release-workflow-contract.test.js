'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality.yml'), 'utf8');

assert.match(workflow, /include_fnc: false/, 'filogic IPK build must not publish a duplicate fnc');
assert.match(workflow, /asset_arch: mipsel_24kc/, 'the MT7621 build must declare its release architecture');
assert.match(workflow, /release-assets/, 'target builds must prepare release assets');
assert.match(workflow, /-path '\*\/release-assets\/\*'/,
	'release publication must find assets below the downloaded artifact root');
assert.match(workflow, /actions\/download-artifact@v4/, 'release publication must consume the verified build artifacts');
assert.strictEqual((workflow.match(/fetch-depth: 0/g) || []).length, 3,
	'static, package and release jobs must use full history for source revision calculation');
assert.match(workflow, /publish-release:/, 'the workflow must publish tagged releases');
assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/,
	'release publication must be restricted to version tags');
assert.match(workflow, /contents: write/, 'the release job must have explicit release permission');
assert.match(workflow, /--verify-tag/, 'release publication must verify the pushed tag');
assert.match(workflow, /install\.sh is pinned to/, 'release publication must reject stale installer metadata');
assert.match(workflow, /asset_count.*-eq 14/, 'the release must contain the expected asset set');
assert.match(workflow, /SHA256SUMS\.txt/, 'the release must publish checksums for every asset');

console.log('Release workflow contract: ok');
