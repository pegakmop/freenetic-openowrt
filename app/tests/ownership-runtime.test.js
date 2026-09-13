'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'freenetic-network.js'), 'utf8');

class FakeUci {
	constructor(configs) {
		this.configs = configs;
	}

	section(config, sectionName) {
		const sections = this.configs[config] || {};
		return sections[sectionName] || Object.values(sections)
			.find(section => section['.name'] === sectionName) || null;
	}

	sections(config, type) {
		return Object.values(this.configs[config] || {})
			.filter(section => section['.type'] === type);
	}

	get(config, sectionName, option) {
		const section = this.section(config, sectionName);
		return option === undefined ? (section || null) : (section ? section[option] : null);
	}

	set(config, sectionName, option, value) {
		this.section(config, sectionName)[option] = value;
	}
}

const uci = new FakeUci({
	wireless: {
		radio0: { '.name': 'radio0', '.type': 'wifi-device' },
		legacy: {
			'.name': 'guest_radio0', '.type': 'wifi-iface', device: 'radio0',
			mode: 'ap', network: 'guest', isolate: '1', unknown_foo: 'bar'
		},
		foreign: {
			'.name': 'guest_manual', '.type': 'wifi-iface', device: 'radio0',
			mode: 'ap', network: 'lan', isolate: '1', unknown_foo: 'keep'
		}
	},
	network: {
		bridge: {
			'.name': 'cfg-br-guest', '.type': 'device', name: 'br-guest',
			type: 'bridge', bridge_empty: '1', unknown_foo: 'bridge-value'
		},
		guest: { '.name': 'guest', '.type': 'interface', proto: 'static', device: 'br-guest' }
	},
	dhcp: {
		guest: { '.name': 'guest', '.type': 'dhcp', interface: 'guest', unknown_foo: 'dhcp-value' }
	},
	firewall: {
		guest: { '.name': 'guest', '.type': 'zone', name: 'guest', network: 'guest' },
		forwarding: { '.name': 'guest_wan_fwd', '.type': 'forwarding', src: 'guest', dest: 'wan' }
	}
});

const baseclass = { extend: value => value };
const networkHelper = new Function('baseclass', 'uci', source)(baseclass, uci);

networkHelper.adoptLegacyGuest();

assert.equal(uci.get('wireless', 'guest_radio0', 'freenetic_managed'), '1');
assert.equal(uci.get('wireless', 'guest_radio0', 'unknown_foo'), 'bar');
assert.equal(uci.get('network', 'cfg-br-guest', 'freenetic_managed'), '1');
assert.equal(uci.get('network', 'cfg-br-guest', 'unknown_foo'), 'bridge-value');
assert.equal(uci.get('network', 'guest', 'freenetic_managed'), '1');
assert.equal(uci.get('dhcp', 'guest', 'freenetic_managed'), '1');
assert.equal(uci.get('dhcp', 'guest', 'unknown_foo'), 'dhcp-value');
assert.equal(uci.get('firewall', 'guest', 'freenetic_managed'), '1');
assert.equal(uci.get('firewall', 'guest_wan_fwd', 'freenetic_managed'), '1');

assert.equal(uci.get('wireless', 'guest_manual', 'freenetic_managed'), undefined,
	'foreign guest-like Wi-Fi section must not be adopted');
assert.equal(uci.get('wireless', 'guest_manual', 'unknown_foo'), 'keep');

console.log('ownership runtime: ok');
