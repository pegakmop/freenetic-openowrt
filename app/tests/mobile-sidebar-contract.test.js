'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const theme = path.join(root, 'web', 'theme');
const css = fs.readFileSync(path.join(theme, 'htdocs', 'luci-static', 'freenetic', 'cascade.css'), 'utf8');
const header = fs.readFileSync(path.join(theme, 'ucode', 'template', 'themes', 'freenetic', 'header.ut'), 'utf8');
const menu = fs.readFileSync(path.join(theme, 'htdocs', 'luci-static', 'resources', 'menu-freenetic.js'), 'utf8');

assert.match(header, /id="fn-mobile-menu-toggle"[^>]*aria-controls="fn-sidebar"/s,
	'the mobile top bar must expose an accessible sidebar control');
assert.match(header, /id="fn-sidebar"[^>]*aria-label=/,
	'the navigation drawer must have an accessible name');
assert.match(header, /cascade\.css\?v=\{\{ pkgs_update_time \}\}/,
	'the theme stylesheet must follow LuCI resource cache versioning');

assert.match(css, /@media \(max-width: 860px\)[\s\S]*?#fn-sidebar \{[\s\S]*?translate3d\(-100%, 0, 0\)/,
	'the closed mobile sidebar must move fully off canvas');
assert.match(css, /@media \(max-width: 860px\)[\s\S]*?#fn-main \{ margin-left: 0; \}/,
	'mobile content must use the full viewport width');
assert.match(css, /@media \(max-width: 860px\)[\s\S]*?#fn-mobile-menu-toggle \{ display: flex; \}/,
	'the top-bar menu control must be visible on mobile');

assert.match(menu, /mobileQuery\.matches\) \|\| !expanded/,
	'a remembered desktop state must not leave the drawer open at mobile startup');
assert.match(menu, /mobileToggle\.addEventListener\('click'/,
	'the mobile control must toggle the navigation drawer');
assert.match(menu, /topbar\.getBoundingClientRect\(\)\.bottom/,
	'the mobile drawer must be positioned below the actual rendered top bar');
assert.match(menu, /sidebar\.style\.top = top \+ 'px'/,
	'the measured top-bar boundary must control the drawer offset');
assert.match(menu, /sidebar\.scrollTop = active \? Math\.max\(0, active\.offsetTop - 8\) : 0/,
	'opening the mobile drawer must reveal the currently active navigation group');
assert.match(menu, /requestAnimationFrame\(revealActiveMobileSection\)/,
	'the active group scroll position must be restored after the drawer layout expands');
assert.match(menu, /mobileToggle\.setAttribute\('aria-expanded'/,
	'the mobile control must expose the current drawer state');
assert.match(menu, /shell\.classList\.contains\('fn-sidebar-collapsed'\) && mobileToggle\)[\s\S]*?mobileToggle\.focus\(\)/,
	'closing the drawer from inside it must restore focus to the visible mobile control');

console.log('mobile sidebar contract: ok');
