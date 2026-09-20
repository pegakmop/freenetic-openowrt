'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-self-update');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-self-update-runtime-'));
const binDir = path.join(tempRoot, 'bin');
const jshnPath = path.join(tempRoot, 'jshn.sh');
const helperCopy = path.join(tempRoot, 'freenetic-self-update');
let stageDir;

try {
	fs.mkdirSync(binDir);
	fs.writeFileSync(jshnPath, `
json_init() { JSON='{'; JSON_FIRST=1; }
json_add_raw() {
    [ "$JSON_FIRST" -eq 1 ] || JSON="$JSON,"
    JSON=$(printf '%s"%s":%s' "$JSON" "$1" "$2")
    JSON_FIRST=0
}
json_add_boolean() { json_add_raw "$1" "$2"; }
json_add_string() { json_add_raw "$1" "$(printf '"%s"' "$2")"; }
json_dump() { printf '%s}\n' "$JSON"; }
`);
	fs.chmodSync(jshnPath, 0o700);

	const helper = fs.readFileSync(helperPath, 'utf8')
		.replace('JSHN=/usr/share/libubox/jshn.sh', `JSHN=${jshnPath}`);
	fs.writeFileSync(helperCopy, helper);
	fs.chmodSync(helperCopy, 0o700);

	fs.writeFileSync(path.join(binDir, 'uci'), `#!/bin/sh
if [ "$1" = "-q" ] && [ "$2" = "get" ]; then
    printf '%s\\n' v0.2.2
fi
`);
	fs.chmodSync(path.join(binDir, 'uci'), 0o700);

	fs.writeFileSync(path.join(binDir, 'wget'), `#!/bin/sh
set -eu
if [ "$1" = "-4" ]; then
    shift
fi
[ "$1" = "-qO" ]
destination="$2"
url="$3"
case "$url" in
    */v9.9.9/install.sh)
        printf '%s\\n' '#!/bin/sh' 'RELEASE_TAG="v9.9.9"' 'echo "Freenetic installer: stage: package_install"' 'exit 1' > "$destination"
        ;;
    */v0.2.2/install.sh)
        printf '%s\\n' '#!/bin/sh' 'RELEASE_TAG="v0.2.2"' 'echo "Freenetic installer: stage: complete"' > "$destination"
        ;;
    *)
        exit 1
        ;;
esac
`);
	fs.chmodSync(path.join(binDir, 'wget'), 0o700);
	for (const command of [ 'grep', 'rm', 'sed', 'sh', 'tail', 'wc' ])
		fs.symlinkSync('/bin/' + command, path.join(binDir, command));

	stageDir = fs.mkdtempSync('/tmp/freenetic-self-update.');
	const result = childProcess.spawnSync('/bin/sh', [ helperCopy, 'run', 'v9.9.9', stageDir ], {
		encoding: 'utf8',
		env: { ...process.env, PATH: binDir }
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /"ok":0/);
	assert.match(result.stdout, /"stage":"package_install"/);
	assert.match(result.stdout, /"rollback_attempted":1/);
	assert.match(result.stdout, /"rollback_ok":1/);
	assert.match(result.stdout, /v0\.2\.2/);
	assert.equal(fs.existsSync(stageDir), false, 'update staging directory must be cleaned after rollback');
}
finally {
	if (stageDir)
		fs.rmSync(stageDir, { recursive: true, force: true });
	fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Freenetic self-update runtime: ok');
