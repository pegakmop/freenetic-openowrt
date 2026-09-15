'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-portforward.js'), 'utf8');

const configs = {
	network: {
		lan: { '.name': 'lan', '.type': 'interface', ipaddr: '192.168.10.1', netmask: '255.255.254.0' },
		guest: { '.name': 'guest', '.type': 'interface', ipaddr: '192.168.50.1/24' },
		freenetic_port_lan2: { '.name': 'freenetic_port_lan2', '.type': 'interface', ipaddr: '192.168.22.1', netmask: '255.255.255.0' }
	},
	firewall: {
		lan_zone: { '.name': 'lan_zone', '.type': 'zone', name: 'home', network: [ 'lan' ] },
		guest_zone: { '.name': 'guest_zone', '.type': 'zone', name: 'guest', network: [ 'guest' ] },
		port_zone: { '.name': 'port_zone', '.type': 'zone', name: 'freenetic_port_lan2', network: [ 'freenetic_port_lan2' ] }
	}
};

let sequence = 0;
const uci = {
	load() { return Promise.resolve(); },
	add(config, type) {
		const name = `test_${type}_${++sequence}`;
		configs[config][name] = { '.name': name, '.type': type };
		return name;
	},
	set(config, section, option, value) { configs[config][section][option] = value; },
	unset(config, section, option) { delete configs[config][section][option]; },
	sections(config, type) { return Object.values(configs[config] || {}).filter(item => item['.type'] === type); },
	save() { return Promise.resolve(); }
};

const originalFormat = String.prototype.format;
String.prototype.format = function(...args) {
	let index = 0;
	return String(this).replace(/%s/g, () => String(args[index++]));
};

const portForward = new Function('view', 'ui', 'uci', 'networkHelper', 'rpc', 'uiHelper', '_', source)(
	{ extend: value => value }, {}, uci,
	{ validPort: () => true, validAddress: () => true },
	{ call() { return Promise.resolve({}); } },
	{ empty() {}, notify() {}, applyChanges: () => Promise.resolve() },
	value => value
);

(async () => {
	try {
		portForward.network = configs.network;
		portForward.firewall = configs.firewall;
		portForward.zones = { wan: 'wan', lan: 'home' };
		assert.equal(portForward.destinationZoneForAddress('192.168.11.80'), 'home',
			'destination lookup must honor the LAN /23 rather than assuming /24');
		assert.equal(portForward.destinationZoneForAddress('192.168.50.40'), 'guest');
		assert.equal(portForward.destinationZoneForAddress('192.168.22.140'), 'freenetic_port_lan2');

		portForward.editingSection = null;
		portForward.closeForm = () => {};
		portForward.refresh = () => Promise.resolve();
		await portForward.saveRule({
			extPort: '8443', family: 'ipv4', ip: '192.168.22.140', inputNetwork: 'wan',
			destZone: portForward.destinationZoneForAddress('192.168.22.140'),
			proto: 'tcp', intPort: '443', name: 'Dedicated HTTPS', enabled: true
		}, { disabled: false });
		assert.equal(configs.firewall.test_redirect_1.dest, 'freenetic_port_lan2',
			'a DNAT to a dedicated Ethernet client must target its actual firewall zone');

		configs.firewall.foreign_redirect = {
			'.name': 'foreign_redirect', '.type': 'redirect', src: 'wan', dest: 'iot_custom',
			dest_ip: '172.19.0.5', src_dport: '9000', target: 'DNAT'
		};
		portForward.editingSection = 'foreign_redirect';
		await portForward.saveRule({
			extPort: '9000', family: 'ipv4', ip: '172.19.0.5', inputNetwork: 'wan',
			destZone: 'iot_custom', proto: 'tcp', intPort: '', name: 'Custom', enabled: true
		}, { disabled: false });
		assert.equal(configs.firewall.foreign_redirect.dest, 'iot_custom',
			'editing a DNAT outside known compact-editor networks must preserve its destination zone');

		console.log('Port forwarding segment behavior: ok');
	}
	finally {
		if (originalFormat) String.prototype.format = originalFormat;
		else delete String.prototype.format;
	}
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
