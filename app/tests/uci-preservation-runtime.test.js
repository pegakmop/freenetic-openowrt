'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const viewRoot = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view');

/* This is deliberately a small UCI model, not a mock of Freenetic's own
 * helpers.  It implements the LuCI UCI signatures closely enough that a
 * wrong argument order (or an accidental broad remove) fails loudly. */
class FakeUci {
	constructor(configs) {
		this.configs = configs;
		this.removes = [];
		this.saveCount = 0;
		this.nextId = 0;
	}

	section(config, sid) {
		const sections = this.configs[config] || {};
		return sections[sid] || Object.values(sections)
			.find(section => section['.name'] === sid) || null;
	}

	sections(config, type) {
		return Object.values(this.configs[config] || {})
			.filter(section => !type || section['.type'] === type);
	}

	get(config, sid, option) {
		const section = this.section(config, sid);
		return option == null ? section : (section ? section[option] : null);
	}

	set(config, sid, option, value) {
		assert.equal(arguments.length, 4, 'uci.set() must use the LuCI four-argument signature');
		const section = this.section(config, sid);
		assert.ok(section, `uci.set() targeted missing section ${config}.${sid}`);
		section[option] = value;
	}

	unset(config, sid, option) {
		assert.equal(arguments.length, 3, 'uci.unset() must use the LuCI three-argument signature');
		const section = this.section(config, sid);
		assert.ok(section, `uci.unset() targeted missing section ${config}.${sid}`);
		delete section[option];
	}

	add(config, type, name) {
		assert.ok(arguments.length === 2 || arguments.length === 3,
			'uci.add() must use the LuCI two/three-argument signature');
		const sid = name || `new_${type}_${this.nextId++}`;
		assert.equal(this.section(config, sid), null, `section ${config}.${sid} already exists`);
		if (!this.configs[config])
			this.configs[config] = {};
		this.configs[config][sid] = { '.name': sid, '.type': type };
		return sid;
	}

	remove(config, sid) {
		assert.equal(arguments.length, 2, 'uci.remove() must use the LuCI two-argument signature');
		const section = this.section(config, sid);
		assert.ok(section, `uci.remove() targeted missing section ${config}.${sid}`);
		this.removes.push(`${config}.${sid}`);
		delete this.configs[config][section['.name']];
	}

	load() {
		return Promise.resolve();
	}

	save() {
		this.saveCount++;
		return Promise.resolve();
	}
}

function translate(value) {
	return value;
}

function makeElement() {
	return {
		children: [],
		appendChild(child) { this.children.push(child); },
		classList: { add() {}, remove() {} },
		setAttribute() {},
		removeAttribute() {}
	};
}

function evaluateView(relative, uci, options = {}) {
	const source = fs.readFileSync(path.join(viewRoot, relative), 'utf8');
	const resourceRoot = path.join(root, 'web', 'application', 'htdocs', 'luci-static', 'resources');
	const connectionCoreSource = fs.readFileSync(path.join(resourceRoot,
		'freenetic-connections-core.js'), 'utf8');
	const connectionWireguardSource = fs.readFileSync(path.join(resourceRoot,
		'freenetic-connections-wireguard.js'), 'utf8');
	const connectionOpenvpnSource = fs.readFileSync(path.join(resourceRoot,
		'freenetic-connections-openvpn.js'), 'utf8');
	const connectionIpsecSource = fs.readFileSync(path.join(resourceRoot,
		'freenetic-connections-ipsec.js'), 'utf8');
	const dashboardDataSource = fs.readFileSync(path.join(resourceRoot,
		'freenetic-dashboard-data.js'), 'utf8');
	const view = {
		extend(value) { return value; }
	};
	const ui = {
		hideModal() {},
		showModal() {}
	};
	const fsModule = {
		exec() { return Promise.resolve({}); },
		exec_direct() { return Promise.resolve({ ok: true }); },
		read() { return Promise.resolve(''); },
		write() { return Promise.resolve(); }
	};
	const rpc = { call() { return Promise.resolve({}); } };
	const uiHelper = {
		empty(node) {
			if (node)
				node.children = [];
		},
		content(node, value) {
			if (node)
				node.textContent = value;
		},
		notify() {},
		notifyLong() {},
		applyChanges() { return Promise.resolve(); }
	};
	const networkHelper = {
		isManaged(section) { return !!section && section.freenetic_managed === '1'; }
	};
	const guard = {
		isForeignTheme() { return Promise.resolve(false); }
	};
	const poll = { add() {}, remove() {} };
	const document = {
		querySelector() { return null; },
		addEventListener() {},
		removeEventListener() {}
	};
	const window = { confirm() { return true; } };
	const location = { reload() {} };
	const L = { url(value) { return value; }, bind(fn, context) { return fn.bind(context); } };
	const E = () => makeElement();
	const connectionCore = new Function('baseclass', 'fs', 'uci', 'rpc', '_', connectionCoreSource)(
		view, fsModule, uci, rpc, translate);
	const moduleArgs = [ 'ui', 'uci', 'fs', 'uiHelper', 'networkHelper', 'E', '_', 'L',
		'window', 'document', 'URL', 'Blob', 'FileReader', 'connectionCore' ];
	const moduleValues = [ ui, uci, fsModule, uiHelper, networkHelper, E, translate, L,
		window, document, URL, Blob, undefined, connectionCore ];
	const evaluateConnectionModule = moduleSource => new Function(...moduleArgs, moduleSource)(...moduleValues);
	const wireguardView = evaluateConnectionModule(connectionWireguardSource);
	const openvpnView = evaluateConnectionModule(connectionOpenvpnSource);
	const ipsecView = evaluateConnectionModule(connectionIpsecSource);
	const dashboardData = new Function('baseclass', 'fs', 'uci', 'rpc', '_', dashboardDataSource)(
		view, fsModule, uci, rpc, translate);

	return new Function('view', 'ui', 'uci', 'fs', 'rpc', 'uiHelper',
		'networkHelper', 'guard', 'poll', 'E', '_', 'L', 'window',
		'document', 'location', 'confirm', 'URL', 'Blob', 'connectionCore',
		'dashboardData', 'wireguardView', 'openvpnView', 'ipsecView', source)(
		view, ui, uci, fsModule, rpc, uiHelper, networkHelper, guard, poll,
		E, translate, L, window, document, location, window.confirm, URL, Blob,
		connectionCore, dashboardData, wireguardView, openvpnView, ipsecView
	);
}

async function call(view, method, ...args) {
	await view[method](...args);
}

function button() {
	return { disabled: false, textContent: '' };
}

function baseWanConfig(extra = {}) {
	return {
		network: {
			wan: { '.name': 'wan', '.type': 'interface', proto: 'dhcp', device: 'eth0' },
			wan6: { '.name': 'wan6', '.type': 'interface', proto: 'dhcpv6', device: 'eth0' },
			...extra
		}
	};
}

async function testFirewallRulePreservation() {
	const uci = new FakeUci({ firewall: {
		foreign_rule: {
			'.name': 'foreign_rule', '.type': 'rule', name: 'old', target: 'ACCEPT',
			src: 'lan', dest: 'wan', proto: 'tcp', unknown_foo: 'keep'
		}
	} });
	const view = evaluateView('network/freenetic-firewall.js', uci);
	view.editingSection = 'foreign_rule';
	view.closeForm = () => {};
	view.refresh = () => Promise.resolve();
	await call(view, 'saveRule', {
		name: 'updated', src: 'lan', dest: 'wan', target: 'ACCEPT', proto: 'tcp',
		srcIp: '', destIp: '', srcPort: '', destPort: ''
	}, button());
	assert.equal(uci.get('firewall', 'foreign_rule', 'unknown_foo'), 'keep');
}

async function testPortForwardPreservation() {
	const uci = new FakeUci({ firewall: {
		foreign_redirect: {
			'.name': 'foreign_redirect', '.type': 'redirect', target: 'DNAT',
			src: 'wan', dest: 'lan', src_dport: '8080', dest_ip: '192.168.1.20',
			unknown_foo: 'keep'
		}
	} });
	const view = evaluateView('network/freenetic-portforward.js', uci);
	view.editingSection = 'foreign_redirect';
	view.zones = { wan: 'wan', lan: 'lan' };
	view.closeForm = () => {};
	view.refresh = () => Promise.resolve();
	await call(view, 'saveRule', {
		extPort: '8080', family: 'ipv4', ip: '192.168.1.20', inputNetwork: 'wan',
		proto: 'tcp', intPort: '80', name: 'HTTP', enabled: true
	}, button());
	assert.equal(uci.get('firewall', 'foreign_redirect', 'unknown_foo'), 'keep');
}

async function testRoutePreservation() {
	const uci = new FakeUci({ network: {
		foreign_route: {
			'.name': 'foreign_route', '.type': 'route', target: '10.0.0.0',
			netmask: '255.255.255.0', gateway: '192.168.1.1', unknown_foo: 'keep'
		}
	} });
	const view = evaluateView('network/freenetic-routing.js', uci);
	view.editingSection = 'foreign_route';
	view.closeForm = () => {};
	view.refresh = () => Promise.resolve();
	await call(view, 'saveRoute', {
		family: 'ipv4', routeType: 'network', target: '10.10.0.0/24',
		gateway: '192.168.1.1', interface: '', metric: '10', description: 'test',
		automatic: false, targetError: null, gatewayError: null
	}, button());
	assert.equal(uci.get('network', 'foreign_route', 'unknown_foo'), 'keep');
}

async function testDdnsPreservation() {
	const uci = new FakeUci({ ddns: {
		global: { '.name': 'global', '.type': 'ddns' },
		foreign_ddns: {
			'.name': 'foreign_ddns', '.type': 'service', service_name: 'duckdns.org',
			lookup_host: 'old.example.com', unknown_foo: 'keep'
		}
	} });
	const view = evaluateView('network/freenetic-ddns.js', uci);
	view.editingSection = 'foreign_ddns';
	view.closeForm = () => {};
	view.restartDdns = () => Promise.resolve();
	view.refresh = () => Promise.resolve();
	await call(view, 'saveProfile', {
		id: 'foreign_ddns', name: 'Home DNS', provider: 'duckdns.org',
		host: 'home.example.com', username: 'user', password: 'token',
		useIpv6: false, network: 'wan', customUrl: '', enabled: true
	}, button());
	assert.equal(uci.get('ddns', 'foreign_ddns', 'unknown_foo'), 'keep');
}

async function testDhcpHostPreservation() {
	const uci = new FakeUci({ dhcp: {
		foreign_host: {
			'.name': 'foreign_host', '.type': 'host', mac: 'AA:BB:CC:DD:EE:FF',
			name: 'printer', unknown_foo: 'keep'
		}
	} });
	const view = evaluateView('status/freenetic-clients.js', uci);
	view.refresh = () => Promise.resolve();
	await call(view, 'registerClient', '11:22:33:44:55:66', 'phone', '192.168.1.50');
	assert.equal(uci.get('dhcp', 'foreign_host', 'unknown_foo'), 'keep');
	assert.equal(uci.get('dhcp', 'foreign_host', 'name'), 'printer');
	assert.ok(uci.sections('dhcp', 'host').some(section => section.mac === '11:22:33:44:55:66'));
}

async function testWanPreservation() {
	const uci = new FakeUci(baseWanConfig({
		managed_old: {
			'.name': 'managed_old', '.type': 'device', type: '8021q', ifname: 'eth0',
			vid: '99', name: 'eth0.99', freenetic_managed: '1'
		},
		foreign_vlan: {
			'.name': 'foreign_vlan', '.type': 'device', type: '8021q', ifname: 'eth0',
			vid: '100', name: 'eth0.100', unknown_foo: 'keep'
		}
	}));
	const view = evaluateView('network/freenetic-wan.js', uci);
	view.baseIfname = 'eth0';
	view.vlanSectionName = 'managed_old';
	view.fillStatus = () => {};
	view.fillStatus6 = () => {};
	await call(view, 'save', {
		enabled: true, proto: 'dhcp', username: '', password: '', ipaddr: '',
		netmask: '', gateway: '', vlan: '100', dns1: '', dns2: ''
	}, button());
	assert.equal(uci.get('network', 'wan', 'device'), 'eth0.100');
	assert.equal(uci.get('network', 'wan6', 'device'), 'eth0.100');
	assert.equal(uci.get('network', 'foreign_vlan', 'unknown_foo'), 'keep');
	assert.equal(uci.get('network', 'foreign_vlan', 'freenetic_managed'), undefined);
	assert.equal(uci.get('network', 'managed_old'), null);
	assert.deepEqual(uci.removes, [ 'network.managed_old' ]);

	const managedUci = new FakeUci(baseWanConfig({
		managed_vlan: {
			'.name': 'managed_vlan', '.type': 'device', type: '8021q', ifname: 'eth0',
			vid: '100', name: 'eth0.100', freenetic_managed: '1', unknown_foo: 'keep'
		}
	}));
	const managedView = evaluateView('network/freenetic-wan.js', managedUci);
	managedView.baseIfname = 'eth0';
	managedView.vlanSectionName = 'managed_vlan';
	managedView.fillStatus = () => {};
	managedView.fillStatus6 = () => {};
	await call(managedView, 'save', {
		enabled: true, proto: 'dhcp', username: '', password: '', ipaddr: '',
		netmask: '', gateway: '', vlan: '200', dns1: '', dns2: ''
	}, button());
	assert.equal(managedUci.get('network', 'managed_vlan', 'vid'), '200');
	assert.equal(managedUci.get('network', 'managed_vlan', 'unknown_foo'), 'keep');
}

function wireguardFields(section, protocol, peerSection) {
	const key = 'A'.repeat(43) + '=';
	return {
		section, name: section, protocol, enabled: true, privateKey: key,
		publicKey: '', addresses: [ '10.0.0.1/24' ], dns: [], listenPort: '51820',
		mtu: '', fwmark: '', nohostroute: false, awg: {}, peers: [ {
			section: peerSection, managed: false, advanced: true, description: 'peer',
			disabled: false, publicKey: key, privateKey: '', presharedKey: '',
			allowedIps: [ '10.0.0.2/32' ], endpointHost: '', endpointPort: '',
			keepalive: '', routeAllowed: false
		} ]
	};
}

async function testWireguardPreservation(protocol) {
	const section = protocol === 'wireguard' ? 'wg0' : 'awg0';
	const peerType = protocol === 'wireguard' ? 'wireguard_' : 'amneziawg_';
	const foreignPeer = `${section}_foreign`;
	const managedPeer = `${section}_managed`;
	const key = 'A'.repeat(43) + '=';
	const uci = new FakeUci({ network: {
		[section]: {
			'.name': section, '.type': 'interface', proto: protocol,
			private_key: key, addresses: [ '10.0.0.1/24' ], unknown_foo: 'interface-keep'
		},
		[foreignPeer]: {
			'.name': foreignPeer, '.type': peerType + section, public_key: key,
			allowed_ips: [ '10.0.0.2/32' ], unknown_foo: 'peer-keep'
		},
		[managedPeer]: {
			'.name': managedPeer, '.type': peerType + section, public_key: key,
			freenetic_managed: '1', unknown_foo: 'managed-peer-option'
		}
	} });
	const view = evaluateView('network/freenetic-other-connections.js', uci);
	view.formConnection = { protocol };
	view.refresh = () => Promise.resolve();
	view.awgAvailable = () => true;
	await call(view, 'saveConnection', wireguardFields(section, protocol, foreignPeer), button());
	assert.equal(uci.get('network', section, 'unknown_foo'), 'interface-keep');
	assert.equal(uci.get('network', foreignPeer, 'unknown_foo'), 'peer-keep');
	assert.equal(uci.get('network', foreignPeer, 'freenetic_managed'), undefined);
	assert.equal(uci.get('network', managedPeer), null,
		'missing managed peer must be reconciled away');
	assert.deepEqual(uci.removes, [ `network.${managedPeer}` ]);

	const fieldsWithoutPeers = wireguardFields(section, protocol, foreignPeer);
	fieldsWithoutPeers.peers = [];
	await call(view, 'saveConnection', fieldsWithoutPeers, button());
	assert.equal(uci.get('network', foreignPeer, 'unknown_foo'), 'peer-keep',
		'foreign peer missing from the model must not be removed');
}

async function testIpsecOwnership() {
	const uci = new FakeUci({ ipsec: {
		foreign_remote: { '.name': 'foreign_remote', '.type': 'conn', unknown_foo: 'foreign' },
		managed_remote: { '.name': 'managed_remote', '.type': 'conn', freenetic_managed: '1', unknown_foo: 'managed' }
	} });
	const view = evaluateView('network/freenetic-other-connections.js', uci);
	view.ensureIpsecSection('conn', 'new_remote');
	assert.equal(uci.get('ipsec', 'new_remote', 'freenetic_managed'), '1');
	view.removeIpsecSections({
		remoteSection: 'foreign_remote', childSection: 'managed_remote',
		secretSection: null, ikeProposalSection: null, espProposalSection: null
	});
	assert.ok(uci.get('ipsec', 'foreign_remote'), 'foreign IPsec section must be preserved');
	assert.equal(uci.get('ipsec', 'managed_remote'), null,
		'managed IPsec section should be removed during explicit connection deletion');
	assert.deepEqual(uci.removes, [ 'ipsec.managed_remote' ]);
}

(async () => {
	await testFirewallRulePreservation();
	await testPortForwardPreservation();
	await testRoutePreservation();
	await testDdnsPreservation();
	await testDhcpHostPreservation();
	await testWanPreservation();
	await testWireguardPreservation('wireguard');
	await testWireguardPreservation('amneziawg');
	await testIpsecOwnership();
	console.log('UCI preservation runtime: ok');
})().catch(error => {
	console.error(error.stack || error);
	process.exitCode = 1;
});
