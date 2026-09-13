'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const wan = read('web/application/htdocs/luci-static/resources/view/network/freenetic-wan.js');
const connections = read('web/application/htdocs/luci-static/resources/view/network/freenetic-other-connections.js');
const css = read('web/theme/htdocs/luci-static/freenetic/cascade.css');
const catalog = read('app/luci-app-freenetic/po/ru/freenetic.po');

assert.match(wan, /function advancedInterfaceOptions\(section, editedOptions\)/,
	'WAN editor must detect options outside its compact form');
assert.match(wan, /key\.charAt\(0\) !== '\.'/,
	'WAN option detection must ignore UCI metadata fields');
assert.match(wan, /const EDITED_WAN4_OPTIONS = \[/,
	'WAN editor must document the IPv4 options it controls');
assert.match(wan, /const EDITED_WAN6_OPTIONS = \[/,
	'WAN editor must document the IPv6 options it controls');
assert.match(wan, /This connection contains additional OpenWrt parameters that Freenetic does not display\./,
	'WAN editor must explain preservation of hidden options');

assert.match(connections, /function advancedPeerOptions\(peer\)/,
	'WireGuard editor must detect options outside its compact peer form');
assert.match(connections, /advanced: advancedPeerOptions\(peer\)\.length > 0/,
	'WireGuard peer models must retain the hidden-option state');
assert.match(connections, /peer\.advanced \? E\('div', \{ class: 'fn-oc-peer-warning' \}/,
	'WireGuard editor must warn on a peer with hidden options');
assert.match(connections, /This peer contains additional OpenWrt parameters that Freenetic does not display\./,
	'WireGuard warning must explain preservation of hidden peer options');

assert.match(css, /\.fn-wan-advanced-note[\s\S]*border-left: 3px solid var\(--fn-warning\)/,
	'WAN warning must use the existing warning visual language');
assert.match(css, /\.fn-oc-peer-warning[\s\S]*border-left: 3px solid var\(--fn-warning\)/,
	'peer warning must use the existing warning visual language');
assert.match(catalog, /msgid "This connection contains additional OpenWrt parameters that Freenetic does not display\./,
	'WAN preservation explanation needs a Russian translation');
assert.match(catalog, /msgid "This peer contains additional OpenWrt parameters that Freenetic does not display\./,
	'peer preservation explanation needs a Russian translation');

console.log('UCI preservation warning contract: ok');
