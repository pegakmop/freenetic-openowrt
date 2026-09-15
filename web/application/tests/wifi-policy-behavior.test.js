'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'htdocs', 'luci-static',
	'resources', 'view', 'network', 'freenetic-wifi-acl.js'), 'utf8');

if (!String.prototype.format) {
	Object.defineProperty(String.prototype, 'format', {
		value(...values) {
			let index = 0;
			return this.replace(/%s/g, () => String(values[index++]));
		}
	});
}

class FakeUci {
	constructor(configs) {
		this.configs = configs;
		this.order = {};
		Object.keys(configs).forEach(config => { this.order[config] = Object.keys(configs[config]); });
		this.next = 0;
		this.saveCount = 0;
	}

	section(config, name) {
		return this.configs[config] && this.configs[config][name] || null;
	}

	get(config, name, option) {
		const section = this.section(config, name);
		return option == null ? section : section && section[option];
	}

	sections(config, type) {
		return (this.order[config] || []).map(name => this.configs[config][name])
			.filter(section => section && (!type || section['.type'] === type));
	}

	add(config, type, name) {
		name ||= `new_${type}_${this.next++}`;
		assert.equal(this.section(config, name), null, `duplicate ${config}.${name}`);
		this.configs[config] ||= {};
		this.order[config] ||= [];
		this.configs[config][name] = { '.name': name, '.type': type };
		this.order[config].push(name);
		return name;
	}

	set(config, name, option, value) {
		assert.ok(this.section(config, name), `missing ${config}.${name}`);
		this.configs[config][name][option] = value;
	}

	unset(config, name, option) {
		assert.ok(this.section(config, name), `missing ${config}.${name}`);
		delete this.configs[config][name][option];
	}

	remove(config, name) {
		delete this.configs[config][name];
		this.order[config] = (this.order[config] || []).filter(item => item !== name);
	}

	move(config, name, target, after) {
		const order = this.order[config] || [];
		const from = order.indexOf(name);
		const to = order.indexOf(target);
		assert.notEqual(from, -1, `cannot move missing ${config}.${name}`);
		assert.notEqual(to, -1, `cannot move before missing ${config}.${target}`);
		order.splice(from, 1);
		const targetIndex = order.indexOf(target);
		order.splice(targetIndex + (after ? 1 : 0), 0, name);
	}

	load() { return Promise.resolve(); }
	save() { this.saveCount++; return Promise.resolve(); }
}

function evaluate(uci, notifications) {
	const view = new Function('view', 'ui', 'uci', 'fs', 'rpc', 'uiHelper', '_', source)(
		{ extend: value => value },
		{},
		uci,
		{ exec_direct: () => Promise.resolve({ ok: true }) },
		{ call: () => Promise.resolve({}) },
		{
			empty() {},
			notify(message, level) { notifications.push({ message, level }); },
			applyChanges: () => Promise.resolve()
		},
		value => value
	);
	view.network = { segment: { label: 'Segment' } };
	view.clientByMac = {};
	view.refreshPolicies = () => Promise.resolve();
	return view;
}

function configWithForeignRule() {
	return {
		network: {},
		firewall: {
			foreign_accept: {
				'.name': 'foreign_accept', '.type': 'rule', src: 'segment', dest: 'wan', target: 'ACCEPT'
			}
		},
		pbr: {}
	};
}

function policyHash(value) {
	let hash = 0;
	for (const character of String(value || ''))
		hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
	return hash;
}

function networkPolicyName(network) {
	const safe = String(network).replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'network';
	return `freenetic_${safe}_${(policyHash(network) >>> 0).toString(36)}`;
}

function devicePolicyName(mac) {
	return `freenetic_device_${(policyHash(mac) >>> 0).toString(36)}`;
}

(async () => {
	const networkUci = new FakeUci(configWithForeignRule());
	const networkView = evaluate(networkUci, []);
	await networkView.savePolicy('segment', {
		cidr: '192.168.44.0/24', mode: 'block', zone: 'segment', wanZone: 'wan', pbrAvailable: false
	}, { disabled: false });
	const networkRules = networkUci.sections('firewall', 'rule');
	assert.equal(networkRules[0].target, 'REJECT',
		'a managed segment block must precede an earlier broad ACCEPT rule');
	assert.equal(networkRules[1]['.name'], 'foreign_accept');

	const ipv6OnlyUci = new FakeUci(configWithForeignRule());
	const ipv6OnlyView = evaluate(ipv6OnlyUci, []);
	await ipv6OnlyView.savePolicy('segment', {
		cidr: null, mode: 'block', zone: 'segment', wanZone: 'wan', pbrAvailable: false
	}, { disabled: false });
	assert.equal(ipv6OnlyUci.sections('firewall', 'rule')[0].target, 'REJECT',
		'an IPv6-only segment must still be able to apply a zone-level Internet block');

	const deviceUci = new FakeUci(configWithForeignRule());
	const deviceView = evaluate(deviceUci, []);
	const mac = 'AA:BB:CC:DD:EE:FF';
	await deviceView.saveDevicePolicy(mac, {
		mode: 'block', network: 'segment', zone: 'segment', wanZone: 'wan', pbrAvailable: false
	}, { disabled: false });
	assert.equal(deviceUci.sections('firewall', 'rule')[0].target, 'REJECT',
		'a managed device block must precede an earlier broad ACCEPT rule');

	const directUci = new FakeUci({
		network: {},
		firewall: {
			foreign_reject: {
				'.name': 'foreign_reject', '.type': 'rule', src: 'segment', dest: 'wan', target: 'REJECT'
			}
		},
		pbr: {}
	});
	const directView = evaluate(directUci, []);
	await directView.saveDevicePolicy(mac, {
		mode: 'direct', network: 'segment', zone: 'segment', wanZone: 'wan', pbrAvailable: false
	}, { disabled: false });
	const directRules = directUci.sections('firewall', 'rule');
	assert.equal(directRules[0].target, 'ACCEPT',
		'a Direct device override must be durable without the optional pbr package');
	assert.deepEqual(directRules[0].src_mac, [ 'aa:bb:cc:dd:ee:ff' ]);
	assert.equal(directRules[1]['.name'], 'foreign_reject');

	const invalidNotifications = [];
	const invalidUci = new FakeUci(configWithForeignRule());
	const invalidView = evaluate(invalidUci, invalidNotifications);
	await invalidView.saveDevicePolicy(mac, {
		mode: 'direct', network: '', zone: '', wanZone: '', pbrAvailable: false
	}, { disabled: false });
	assert.equal(invalidUci.saveCount, 0, 'Direct without pbr must reject an unknown firewall topology');
	assert.equal(invalidNotifications[0].level, 'warning');

	const foreignPbrUci = new FakeUci({
		pbr: {
			config: { '.name': 'config', '.type': 'pbr', enabled: '1' },
			foreign_policy: { '.name': 'foreign_policy', '.type': 'policy', enabled: '1' },
			freenetic_policy: {
				'.name': 'freenetic_policy', '.type': 'policy', enabled: '1', freenetic_managed: '1'
			}
		}
	});
	const foreignPbrView = evaluate(foreignPbrUci, []);
	foreignPbrView.pbrSection = foreignPbrUci.get('pbr', 'config');
	foreignPbrView.reconcileGlobalPbr();
	assert.equal(foreignPbrUci.get('pbr', 'config', 'freenetic_managed'), undefined,
		'an already enabled operator-owned pbr config must not be claimed');
	foreignPbrUci.remove('pbr', 'freenetic_policy');
	foreignPbrView.reconcileGlobalPbr();
	assert.equal(foreignPbrUci.get('pbr', 'config', 'enabled'), '1',
		'removing the last Freenetic policy must not disable operator pbr state');

	const managedPbrUci = new FakeUci({
		pbr: {
			config: { '.name': 'config', '.type': 'pbr', enabled: '0' },
			freenetic_policy: {
				'.name': 'freenetic_policy', '.type': 'policy', enabled: '1', freenetic_managed: '1'
			}
		}
	});
	const managedPbrView = evaluate(managedPbrUci, []);
	managedPbrView.pbrSection = managedPbrUci.get('pbr', 'config');
	managedPbrView.reconcileGlobalPbr();
	assert.equal(managedPbrUci.get('pbr', 'config', 'enabled'), '1');
	assert.equal(managedPbrUci.get('pbr', 'config', 'freenetic_managed'), '1');
	managedPbrUci.remove('pbr', 'freenetic_policy');
	managedPbrView.reconcileGlobalPbr();
	assert.equal(managedPbrUci.get('pbr', 'config', 'enabled'), '0',
		'Freenetic may restore only global pbr state it enabled itself');
	assert.equal(managedPbrUci.get('pbr', 'config', 'freenetic_managed'), undefined);

	const networkCollisionName = networkPolicyName('segment') + '_block';
	const networkCollisionUci = new FakeUci({
		network: {},
		firewall: {
			[networkCollisionName]: { '.name': networkCollisionName, '.type': 'rule', target: 'DROP' }
		},
		pbr: { config: { '.name': 'config', '.type': 'pbr', enabled: '1' } }
	});
	const networkCollisionView = evaluate(networkCollisionUci, []);
	networkCollisionView.pbrSection = networkCollisionUci.get('pbr', 'config');
	await networkCollisionView.savePolicy('segment', {
		cidr: '192.168.44.0/24', mode: 'direct', zone: 'segment', wanZone: 'wan', pbrAvailable: true
	}, { disabled: false });
	assert.equal(networkCollisionUci.sections('pbr', 'policy').length, 0,
		'a late firewall-name collision must not leave an in-memory managed pbr mutation');
	assert.equal(networkCollisionUci.saveCount, 0);

	const deviceCollisionName = devicePolicyName(mac) + '_allow';
	const deviceCollisionUci = new FakeUci({
		network: {},
		firewall: {
			[deviceCollisionName]: { '.name': deviceCollisionName, '.type': 'rule', target: 'DROP' }
		},
		pbr: { config: { '.name': 'config', '.type': 'pbr', enabled: '1' } }
	});
	const deviceCollisionView = evaluate(deviceCollisionUci, []);
	deviceCollisionView.pbrSection = deviceCollisionUci.get('pbr', 'config');
	await deviceCollisionView.saveDevicePolicy(mac, {
		mode: 'direct', network: 'segment', zone: 'segment', wanZone: 'wan', pbrAvailable: true
	}, { disabled: false });
	assert.equal(deviceCollisionUci.sections('pbr', 'policy').length, 0,
		'a late device firewall collision must not leave an in-memory managed pbr mutation');
	assert.equal(deviceCollisionUci.saveCount, 0);

	console.log('Wi-Fi traffic policy behavior: ok');
})().catch(error => {
	console.error(error.stack || error);
	process.exitCode = 1;
});
