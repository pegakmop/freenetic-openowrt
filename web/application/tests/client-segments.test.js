'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-clients.js'), 'utf8');

const arp = [
	'IP address HW type Flags HW address Mask Device',
	'192.168.1.22 0x1 0x2 AA:BB:CC:00:00:01 * br-lan',
	'10.21.29.1 0x1 0x2 EC:E7:C2:95:2F:34 * wan',
	'192.168.22.100 0x1 0x2 AA:BB:CC:00:00:22 * lan2'
].join('\n');

const configs = {
	network: {
		lan: { '.type': 'interface', label: 'LAN' },
		freenetic_port_lan2: { '.type': 'interface', label: 'Port lan2' }
	},
	dhcp: {
		lan: { '.type': 'dhcp', interface: 'lan', ignore: '0' },
		wan: { '.type': 'dhcp', interface: 'wan', ignore: '1' },
		freenetic_port_lan2: { '.type': 'dhcp', interface: 'freenetic_port_lan2' }
	},
	firewall: {
		lan_zone: { '.type': 'zone', name: 'lan', network: [ 'lan' ] },
		wan_zone: { '.type': 'zone', name: 'wan', network: [ 'wan', 'wan6' ] },
		port_zone: { '.type': 'zone', name: 'freenetic_port_lan2', network: [ 'freenetic_port_lan2' ] }
	}
};

const rpc = {
	call(object, method, args) {
		if (object === 'file' && method === 'read')
			return Promise.resolve({ data: arp });
		if (object === 'luci-rpc' && method === 'getDHCPLeases')
			return Promise.resolve({ dhcp_leases: [
				{ macaddr: 'AA:BB:CC:00:00:01', ipaddr: '192.168.1.22', hostname: 'Laptop' }
			] });
		if (object === 'iwinfo' && method === 'devices')
			return Promise.resolve({ devices: [] });
		if (object === 'network.interface' && method === 'dump')
			return Promise.resolve({ interface: [
				{ interface: 'lan', device: 'br-lan', l3_device: 'br-lan', 'ipv4-address': [ { address: '192.168.1.1', mask: 24 } ] },
				{ interface: 'wan', device: 'wan', l3_device: 'wan', 'ipv4-address': [ { address: '10.21.29.212', mask: 24 } ] },
				{ interface: 'freenetic_port_lan2', device: 'lan2', l3_device: 'lan2', 'ipv4-address': [ { address: '192.168.22.1', mask: 24 } ] }
			] });
		if (object === 'uci' && method === 'get')
			return Promise.resolve({ values: configs[args.config] || {} });
		return Promise.resolve({});
	}
};

const firewallWrites = [];
let sectionSequence = 0;
const uci = {
	load(config) {
		return Promise.resolve(configs[config] || {});
	},
	add(config, type) {
		const name = `test_${type}_${++sectionSequence}`;
		configs[config] ||= {};
		configs[config][name] = { '.type': type, '.name': name };
		return name;
	},
	set(config, section, option, value) {
		configs[config][section][option] = value;
		firewallWrites.push({ config, section, option, value });
	},
	sections(config, type) {
		return Object.values(configs[config] || {}).filter(section => section['.type'] === type);
	},
	remove(config, section) {
		delete configs[config][section];
	},
	save() {
		return Promise.resolve();
	}
};

const clientView = new Function('view', 'poll', 'ui', 'uci', 'rpc', 'uiHelper', '_', source)(
	{ extend: value => value },
	{ add() {} },
	{},
	uci,
	rpc,
	{ empty() {}, notify() {}, applyChanges: () => Promise.resolve() },
	value => value
);

(async () => {
	const data = await clientView.load();
	clientView.leases = data[0];
	clientView.arp = data[1];
	clientView.stations = data[2];
	clientView.clientSegments = data[3];

	const live = clientView.buildLiveDevices();
	assert.ok(live['AA:BB:CC:00:00:01'], 'a LAN neighbour must remain visible');
	assert.ok(live['AA:BB:CC:00:00:22'], 'a dedicated port segment must remain visible');
	assert.equal(live['EC:E7:C2:95:2F:34'], undefined,
		'the upstream WAN gateway must never appear as a client');
	assert.equal(clientView.describeConnection('AA:BB:CC:00:00:22', live['AA:BB:CC:00:00:22']).segment,
		'Port lan2', 'dedicated clients must use their real segment label');
	assert.equal(clientView.describeConnection('AA:BB:CC:00:00:22', live['AA:BB:CC:00:00:22']).zone,
		'freenetic_port_lan2', 'client actions must target the segment firewall zone');

	configs.firewall.alpha1_wrong_block = {
		'.type': 'rule', '.name': 'alpha1_wrong_block', freenetic_managed: '1',
		name: 'freenetic_block_AABBCC000022', src: 'lan',
		src_mac: 'AA:BB:CC:00:00:22', dest: 'wan', target: 'REJECT'
	};
	clientView.refresh = () => Promise.resolve();
	await clientView.blockClient('AA:BB:CC:00:00:22', 'freenetic_port_lan2');
	assert.equal(configs.firewall.alpha1_wrong_block, undefined,
		'reblocking must remove the ineffective alpha.1 Freenetic rule');
	const sourceWrite = firewallWrites.find(write => write.option === 'src');
	assert.equal(sourceWrite && sourceWrite.value, 'freenetic_port_lan2',
		'blocking a dedicated Ethernet client must write its actual firewall zone');
	const createdRule = configs.firewall[sourceWrite.section];
	assert.equal(createdRule.src_mac, 'AA:BB:CC:00:00:22');
	assert.equal(createdRule.dest, 'wan');
	assert.equal(createdRule.target, 'REJECT');
	console.log('Client segment discovery: ok');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
