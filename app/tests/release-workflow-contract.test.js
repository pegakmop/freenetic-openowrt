'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality.yml'), 'utf8');
const prepare = fs.readFileSync(path.join(root, 'app', 'prepare-release.js'), 'utf8');

assert.match(workflow, /name: OpenWrt 24\.10\.8 mediatek\/filogic \(IPK\)[\s\S]*?include_fnc: true/,
	'filogic IPK build must publish the legacy-ABI fnc artifact');
assert.match(workflow, /name: OpenWrt 25\.12\.5 ramips\/mt7621 \(APK \+ fnc\)/,
	'the matrix must build an MT7621 fnc binary for the APK ABI');
assert.match(workflow, /fnc-\$asset_version-\$ASSET_ARCH-\$PACKAGE_FORMAT/,
	'fnc assets must identify their package-manager ABI');
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
assert.match(workflow, /app\/prepare-release\.js/, 'release publication must generate installer metadata from final assets');
assert.match(workflow, /\$GITHUB_WORKSPACE\/docs\/CHANGELOG\.md/,
	'release publication must read release notes from the documentation directory');
assert.match(workflow, /asset_count.*-eq 20/, 'the release must contain packages, binaries, installer and manifest');
assert.match(workflow, /pre-0\.2\.6 dashboard can discover this release/,
	'the release must retain architecture-only fnc names for older dashboards');
assert.match(workflow, /--notes-file/, 'release publication must use the generated changelog notes');
assert.match(workflow, /node app\/release-codenames\.js "\$RELEASE_TAG"/,
	'release publication must derive its human title from the codename registry');
assert.match(workflow, /--title "\$release_title"/,
	'release publication must use the codename-bearing human title');
assert.match(workflow, /cp -f "\$RELEASE_DIR\/install\.sh" "\$GITHUB_WORKSPACE\/install\.sh"/,
	'release publication must copy the generated installer into the tagged source');
assert.match(workflow, /git config user\.name/,
	'release publication must configure the tag commit author');
assert.match(workflow, /git tag -a -f/,
	'release publication must retag the generated installer commit');
assert.match(workflow, /git push --force origin [^\n]*refs\/tags/,
	'release publication must push the generated installer tag');
assert.match(prepare, /SHA256SUMS\.txt/, 'the release preparation helper must publish checksums for every asset');

console.log('Release workflow contract: ok');
