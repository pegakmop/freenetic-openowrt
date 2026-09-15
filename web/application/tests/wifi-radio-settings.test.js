'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-mynetworks.js'), 'utf8');
const writes = [];
const uci = {
	set(config, section, option, value) {
		writes.push({ action: 'set', config, section, option, value });
	},
	unset(config, section, option) {
		writes.push({ action: 'unset', config, section, option });
	}
};

const networkView = new Function('view', 'ui', 'uci', 'fs', 'networkHelper', 'rpc', 'uiHelper', '_', source)(
	{ extend: value => value }, {}, uci, {}, {}, { call() {} },
	{ empty() {}, notify() {}, applyChanges() {} }, value => value
);

networkView.writeOptionalRadioSetting('radio1', 'txpower', '', '20');
assert.deepEqual(writes.pop(), {
	action: 'unset', config: 'wireless', section: 'radio1', option: 'txpower'
}, 'Automatic transmit power must remove an explicit UCI limit');

networkView.writeOptionalRadioSetting('radio1', 'txpower', '17', '20');
assert.deepEqual(writes.pop(), {
	action: 'set', config: 'wireless', section: 'radio1', option: 'txpower', value: '17'
}, 'an explicit transmit power must be written');

networkView.writeOptionalRadioSetting('radio1', 'txpower', '17', '17');
assert.equal(writes.length, 0, 'an unchanged radio option must not be rewritten');

console.log('Wi-Fi radio setting behavior: ok');
