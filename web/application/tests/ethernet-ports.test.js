'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-ports.js'), 'utf8');

const configs = { network: {}, dhcp: {}, firewall: {}, pbr: {} };
let sequence = 0;
const uci = {
	add(config, type, requestedName) {
		const name = requestedName || `test_${type}_${++sequence}`;
		configs[config][name] = { '.type': type, '.name': name };
		return name;
	},
	get(config, section, option) {
		const value = configs[config] && configs[config][section];
		return option == null ? value : value && value[option];
	},
	set(config, section, option, value) {
		assert.ok(configs[config] && configs[config][section], `${config}.${section} must exist before set`);
		configs[config][section][option] = value;
	},
	unset(config, section, option) {
		if (configs[config] && configs[config][section])
			delete configs[config][section][option];
	},
	remove(config, section) {
		delete configs[config][section];
	},
	sections(config, type) {
		return Object.values(configs[config] || {}).filter(section => !type || section['.type'] === type);
	}
};

let pbrResult = { ok: true, installed: true };
const fsApi = {
	exec_direct() {
		return Promise.resolve(pbrResult);
	}
};

const originalFormat = String.prototype.format;
String.prototype.format = function(...args) {
	let index = 0;
	return String(this).replace(/%[sd]/g, () => String(args[index++]));
};

const portsView = new Function('view', 'ui', 'uci', 'fs', 'rpc', 'uiHelper', '_', source)(
	{ extend: value => value }, {}, uci, fsApi, { call() {} },
	{ notify() {}, applyChanges() {} }, value => value
);

(async () => {
	try {
		portsView.pbr = configs.pbr;
		portsView.firewall = configs.firewall;
		portsView.pbrConfig = null;
		portsView.createPortSegment({
			port: { device: 'lan2' },
			addressInput: { value: '192.168.22.1' },
			policySelect: { value: 'direct' },
			vpnSelect: { value: '' }
		});

		assert.deepEqual(configs.network.freenetic_port_lan2, {
			'.type': 'interface', '.name': 'freenetic_port_lan2',
			device: 'lan2', proto: 'static', ipaddr: '192.168.22.1', netmask: '255.255.255.0',
			label: 'Port lan2', freenetic_managed: '1', freenetic_scope: 'ethernet-port',
			freenetic_port: 'lan2'
		}, 'a dedicated port must produce the complete managed network interface');
		assert.equal(configs.firewall.freenetic_port_lan2.input, 'REJECT',
			'a dedicated segment must deny router services by default');
		assert.equal(configs.firewall.freenetic_port_lan2.forward, 'REJECT');
		assert.deepEqual(configs.firewall.freenetic_port_lan2_dns.proto, [ 'tcp', 'udp' ]);
		assert.equal(configs.firewall.freenetic_port_lan2_dns.dest_port, '53');
		assert.equal(configs.firewall.freenetic_port_lan2_dns.target, 'ACCEPT');
		assert.equal(configs.firewall.freenetic_port_lan2_dhcp.proto, 'udp');
		assert.equal(configs.firewall.freenetic_port_lan2_dhcp.dest_port, '67');
		assert.equal(configs.firewall.freenetic_port_lan2_dhcp.target, 'ACCEPT');
		assert.equal(configs.firewall.freenetic_port_lan2_wan.src, 'freenetic_port_lan2');
		assert.equal(configs.firewall.freenetic_port_lan2_wan.dest, 'wan');

		portsView.pbrConfig = { '.name': 'config' };
		pbrResult = { ok: false, error: 'restart failed' };
		await assert.rejects(() => portsView.restartPbr(), /did not restart/,
			'a structured PBR failure must reject the save chain');
		pbrResult = { ok: true, installed: false };
		await assert.rejects(() => portsView.restartPbr(), /did not restart/,
			'a missing PBR service must not be reported as an applied VPN policy');
		pbrResult = { ok: true, installed: true };
		await portsView.restartPbr();

		configs.network.lan = { '.type': 'interface', '.name': 'lan', device: 'home-br', ipaddr: '192.168.10.1', netmask: '255.255.254.0' };
		configs.network.home_bridge = { '.type': 'device', '.name': 'home_bridge', type: 'bridge', name: 'home-br', ports: [ 'lan0', 'lan1' ] };
		configs.network.wan = { '.type': 'interface', '.name': 'wan', device: 'wan' };
		configs.network.wan6 = { '.type': 'interface', '.name': 'wan6', device: '6in4-wan6' };
		assert.equal(portsView.sharedBridge('lan', 'br-lan', 'freenetic_br_lan'), 'home_bridge',
			'a valid custom LAN bridge must be reused instead of creating an unused br-lan');
		assert.equal(configs.network.freenetic_br_lan, undefined);

		portsView.updateWanDevices('lan3');
		assert.equal(configs.network.wan.device, 'lan3');
		assert.equal(configs.network.wan6.device, '6in4-wan6',
			'an independent IPv6 uplink must survive an Ethernet port apply');
		configs.network.wan.device = 'wan';
		configs.network.wan6.device = 'wan';
		portsView.updateWanDevices('lan3');
		assert.equal(configs.network.wan6.device, 'lan3',
			'WAN6 must follow WAN only when both previously shared the physical device');

		portsView.network = configs.network;
		portsView.dhcp = configs.dhcp;
		portsView.firewall = configs.firewall;
		portsView.pbr = configs.pbr;
		portsView.cards = [
			{ locked: false, role: { value: 'wan' }, port: { device: 'lan3' } },
			{
				locked: false, role: { value: 'dedicated' }, port: { device: 'lan2' },
				addressInput: { value: '192.168.11.1' }, policySelect: { value: 'direct' }, vpnSelect: { value: '' }
			}
		];
		assert.match(portsView.validate(), /already used/,
			'a new 192.168.11.0\/24 segment must collide with an existing 192.168.10.0\/23 network');
		portsView.cards[1].addressInput.value = '192.168.22.1';
		assert.equal(portsView.validate(), null, 'a genuinely separate /24 must remain valid');

		console.log('Ethernet port behavior: ok');
	}
	finally {
		if (originalFormat)
			String.prototype.format = originalFormat;
		else
			delete String.prototype.format;
	}
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
