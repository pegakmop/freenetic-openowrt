'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-wifimonitor.js'), 'utf8');
const helperSource = source.slice(source.indexOf('function mhzToChannel'), source.indexOf('function signalQuality'));
const helpers = new Function('_', helperSource + '\nreturn { mhzToChannel, channelFrequency, scoreChannel, recommendChannel };')(value => value);

assert.equal(helpers.mhzToChannel(2484, '2g'), 14,
	'2484 MHz must be displayed as 2.4 GHz channel 14');
assert.equal(helpers.channelFrequency(14, '2g'), 2484,
	'2.4 GHz channel 14 must map back to its special 2484 MHz frequency');

const neighbour = [ { mhz: 5220, signal: -45, vht_operation: { channel_width: 20 } } ];
assert.equal(helpers.scoreChannel({ mhz: 5180, width: 20 }, neighbour), 0,
	'a 20 MHz candidate 40 MHz away must not overlap');
assert.ok(helpers.scoreChannel({ mhz: 5180, width: 80 }, neighbour) > 0,
	'an 80 MHz candidate must account for a neighbour 40 MHz from its center');

const recommendation = helpers.recommendChannel(
	{ band: '5g', htmode: 'HE80' },
	[ { channel: 36, mhz: 5180 }, { channel: 100, mhz: 5500 } ],
	neighbour
);
assert.equal(recommendation.width, 80, 'the recommended spectrum marker must use the configured radio width');
assert.equal(recommendation.channel, 100, 'wide-channel interference must influence the recommendation');

console.log('Wi-Fi airspace algorithm: ok');
