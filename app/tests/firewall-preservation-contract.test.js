'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const view = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-firewall.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'freenetic', 'cascade.css'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic',
	'po', 'ru', 'freenetic.po'), 'utf8');

assert.match(view, /function advancedRuleOptions\(rule\)/,
	'firewall editor must detect options outside its compact form');
assert.match(view, /key\.charAt\(0\) !== '\.'/,
	'firewall option detection must ignore UCI metadata fields');
assert.match(view, /if \(advancedOptions\.length\)/,
	'firewall editor must show the warning only when needed');
assert.match(view, /Additional OpenWrt options detected/,
	'firewall editor must explain why the warning is shown');
assert.match(view, /Saving preserves parameters it does not edit\./,
	'firewall warning must promise preservation only for untouched options');
assert.match(css, /\.fn-fw-advanced-note[\s\S]*border-left: 3px solid var\(--fn-warning\)/,
	'firewall warning must use the existing warning visual language');
assert.match(catalog, /msgid "Additional OpenWrt options detected"\nmsgstr "/,
	'firewall warning needs a Russian translation');
assert.match(catalog, /msgid "This rule contains additional OpenWrt parameters; Freenetic does not display them\./,
	'firewall preservation explanation needs a Russian translation');

console.log('firewall preservation contract: ok');
