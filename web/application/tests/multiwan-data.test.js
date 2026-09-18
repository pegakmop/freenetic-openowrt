'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources', 'freenetic-multiwan-data.js');
const source = fs.readFileSync(modulePath, 'utf8');
const data = new Function('baseclass', source)({ extend: value => value });

assert.equal(data.nextRouteMetric({
	wan: { '.name': 'wan', '.type': 'interface', metric: '10' },
	wanb: { '.name': 'wanb', '.type': 'interface', metric: '20' },
	fnwwan: { '.name': 'fnwwan', '.type': 'interface', metric: '30' }
}, 'modem'), 40, 'new uplinks must receive the first free route metric');
assert.equal(data.nextRouteMetric({
	wan: { '.name': 'wan', '.type': 'interface', metric: '10' },
	wanb: { '.name': 'wanb', '.type': 'interface', metric: '20' },
	fnwwan: { '.name': 'fnwwan', '.type': 'interface', metric: '30' }
}, 'fnwwan'), 30, 'an existing unique managed metric must be preserved');
assert.equal(data.nextRouteMetric(Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
	'uplink' + index,
	{ '.name': 'uplink' + index, '.type': 'interface', metric: String((index + 1) * 10) }
])), 'new_uplink'), null, 'an eighth uplink must be rejected instead of reusing a metric');

const model = data.buildModel({
	interfaces: [
		{ '.name': 'wan', '.type': 'interface', enabled: '1', track_method: 'ping', track_ip: [ '1.1.1.1', '8.8.8.8' ] },
		{ '.name': 'wanb', '.type': 'interface', enabled: '1', track_method: 'ping' },
		{ '.name': 'disabled', '.type': 'interface', enabled: '0' }
	],
	members: [
		{ '.name': 'wan_m1_w1', '.type': 'member', interface: 'wan', metric: '1', weight: '2' },
		{ '.name': 'wanb_m2_w1', '.type': 'member', interface: 'wanb', metric: '2', weight: '1' }
	],
	policies: [
		{ '.name': 'balanced', '.type': 'policy', use_member: [ 'wan_m1_w1', 'wanb_m2_w1' ] }
	],
	rules: [
		{ '.name': 'default_rule', '.type': 'rule', use_policy: 'balanced' }
	]
}, [
	{ '.name': 'wan', '.type': 'interface', proto: 'dhcp', device: 'eth1' },
	{ '.name': 'wanb', '.type': 'interface', proto: 'dhcp', device: 'wwan0' }
], {
	interface: [
		{ interface: 'wan', l3_device: 'eth1', up: true },
		{ interface: 'wanb', l3_device: 'wwan0', up: false }
	]
}, {
	ok: true,
	packages: {
		mwan3: { installed: true, available: true },
		'luci-app-mwan3': { installed: false, available: true }
	}
});

assert.equal(model.package.ready, true);
assert.deepEqual(model.uplinks.map(item => item.state), [ 'online', 'offline', 'disabled' ]);
assert.equal(model.uplinks[0].device, 'eth1');
assert.equal(model.uplinks[0].family, 'ipv4');
assert.deepEqual(model.uplinks[0].trackIps, [ '1.1.1.1', '8.8.8.8' ]);
assert.equal(model.uplinks[0].metric, 1);
assert.equal(model.uplinks[0].weight, 2);
assert.equal(model.policies[0].members[1].interface, 'wanb');
assert.equal(model.policies[0].ruleCount, 1);
assert.deepEqual(model.summary, {
	total: 3,
	online: 1,
	offline: 1,
	disabled: 1,
	policyCount: 1,
	ruleCount: 1
});

const trackedModel = data.buildModel({
	interfaces: [
		{ '.name': 'wan', '.type': 'interface', enabled: '1', family: 'ipv4' },
		{ '.name': 'wanb', '.type': 'interface', enabled: '1', family: 'ipv4' }
	]
}, [
	{ '.name': 'wan', '.type': 'interface', proto: 'dhcp', device: 'eth1' },
	{ '.name': 'wanb', '.type': 'interface', proto: 'dhcp', device: 'eth2' }
], {
	interface: [
		{ interface: 'wan', l3_device: 'eth1', up: true },
		{ interface: 'wanb', l3_device: 'eth2', up: true }
	]
}, {}, {
	interfaces: {
		wan: { enabled: true, status: 'offline', tracking: 'active' },
		wanb: { enabled: true, status: 'online', tracking: 'active' }
	}
});
assert.deepEqual(trackedModel.uplinks.map(item => item.state), [ 'offline', 'online' ]);

const missing = data.buildModel({ interfaces: [] }, [], {}, {
	packages: { mwan3: { installed: false, available: false } }
});
assert.equal(missing.package.ready, false);
assert.equal(missing.package.mwan3.available, false);

const failoverPlan = data.buildModePlan('failover', [
	{ name: 'wan', enabled: true, family: 'ipv4' },
	{ name: 'wanb', enabled: true, family: 'ipv4' },
	{ name: 'wan6', enabled: true, family: 'ipv6' },
	{ name: 'disabled', enabled: false, family: 'ipv4' }
]);
assert.deepEqual(failoverPlan.policies.map(policy => policy.name), [
	'fn_f4', 'fn_f6'
]);
assert.deepEqual(failoverPlan.policies[0].members.map(member => member.metric), [ 1, 2 ]);
assert.deepEqual(failoverPlan.policies[1].members.map(member => member.metric), [ 1 ]);

const balancePlan = data.buildModePlan('balance', [
	{ name: 'wan', enabled: true, family: 'ipv4' },
	{ name: 'wanb', enabled: true, family: 'ipv4' }
]);
assert.deepEqual(balancePlan.policies[0].members.map(member => member.metric), [ 1, 1 ]);
assert.deepEqual(balancePlan.policies[0].members.map(member => member.weight), [ 1, 1 ]);
assert.equal(data.detectMode([{ use_policy: 'fn_s4' }], 'balance'), 'single');
assert.equal(data.detectMode([{ use_policy: 'wan_wanb' }], 'single'), 'failover');
assert.equal(data.detectMode([{ use_policy: 'balanced' }], 'single'), 'balance');
assert.equal(data.detectDefaultMode([
	{ '.name': 'https', dest_port: '443', use_policy: 'balanced' },
	{ '.name': 'default_rule_v4', family: 'ipv4', dest_ip: '0.0.0.0/0', use_policy: 'fn_f4' },
	{ '.name': 'default_rule_v6', family: 'ipv6', dest_ip: '::/0', use_policy: 'balanced' }
], [
	{ name: 'wan', family: 'ipv4', enabled: true },
	{ name: 'wanb', family: 'ipv4', enabled: true },
	{ name: 'wan6', family: 'ipv6', enabled: false }
], 'single'), 'failover');
assert.equal(data.detectDefaultMode([
	{ '.name': 'default_rule_v4', enabled: '0', family: 'ipv4', dest_ip: '0.0.0.0/0', use_policy: 'balanced' },
	{ '.name': 'fn_default_rule_v4', enabled: '1', family: 'ipv4', dest_ip: '0.0.0.0/0', use_policy: 'fn_s4' }
], [
	{ name: 'wan', family: 'ipv4', enabled: true },
	{ name: 'wanb', family: 'ipv4', enabled: true }
], 'failover'), 'single', 'a disabled default rule must not override the active mode');

const stateUplinks = [
	{ name: 'wan', family: 'ipv4', state: 'offline' },
	{ name: 'wanb', family: 'ipv4', state: 'online' },
	{ name: 'guest_uplink', family: 'ipv4', state: 'online' },
	{ name: 'wan6', family: 'ipv6', state: 'online' }
];
const statePolicies = [
	{ name: 'fn_s4', members: [ { interface: 'wan' } ] },
	{ name: 'fn_f4', members: [ { interface: 'wan' }, { interface: 'wanb' } ] }
];
const singleState = data.buildTrafficState(stateUplinks, 'single', statePolicies, 'fn_s4');
assert.equal(singleState.current, null,
	'an online backup must not be presented as active while single-WAN policy selects an offline primary');
assert.deepEqual(singleState.backups.map(item => item.name), [ 'wanb' ],
	'unrelated and IPv6 uplinks must not be mislabeled as backup providers');
const failoverState = data.buildTrafficState(stateUplinks, 'failover', statePolicies, 'fn_f4');
assert.equal(failoverState.current.name, 'wanb', 'failover must present the online policy member as active');

const wifiBackupState = data.buildTrafficState([
	{ name: 'wan', family: 'ipv4', state: 'online' },
	{ name: 'fnwwan', family: 'ipv4', state: 'online', scope: 'wifi-uplink' }
], 'single', statePolicies, 'fn_s4');
assert.deepEqual(wifiBackupState.uplinks.map(item => item.name), [ 'wan', 'fnwwan' ],
	'a configured Wi-Fi backup must remain visible while single-connection mode is selected');
assert.equal(wifiBackupState.current.name, 'wan',
	'single-connection mode must still present only the primary connection as active');
assert.equal(wifiBackupState.backupOnline.name, 'fnwwan',
	'an online Wi-Fi backup must be reported as ready even before failover mode is selected');

const selectedWifiState = data.buildTrafficState([
	{ name: 'wan', family: 'ipv4', state: 'offline' },
	{ name: 'fnwwan', family: 'ipv4', state: 'online', scope: 'wifi-uplink' }
], 'single', [ { name: 'fn_s4', members: [ { interface: 'fnwwan' } ] } ], 'fn_s4');
assert.equal(selectedWifiState.selected.name, 'fnwwan',
	'single-connection mode must retain the connection selected by its policy');
assert.equal(selectedWifiState.current.name, 'fnwwan',
	'the selected online Wi-Fi line must be presented as the active Internet connection');
assert.equal(selectedWifiState.heroState, 'online',
	'an offline unselected WAN must not make the Internet summary report an outage');

const checkingState = data.buildTrafficState([
	{ name: 'wan', family: 'ipv4', state: 'checking' }
], 'single', [ { name: 'fn_s4', members: [ { interface: 'wan' } ] } ], 'fn_s4');
assert.equal(checkingState.heroState, 'checking',
	'netifd availability without a completed health check must remain a checking state');
assert.equal(checkingState.current, null,
	'a checking connection must not be advertised as online');

const modemState = data.buildTrafficState([
	{ name: 'wan', family: 'ipv4', state: 'online' },
	{ name: 'cellular', family: 'ipv4', state: 'online', scope: 'modem-uplink' }
], 'failover', [], 'fn_f4');
assert.deepEqual(modemState.uplinks.map(item => item.name), [ 'wan', 'cellular' ],
	'a managed modem must participate as a normal backup uplink');

console.log('multiwan data model: ok');
