'use strict';
'require baseclass';

/*
 * This module turns the native mwan3 UCI sections and netifd's runtime dump
 * into a small, stable model for the UI and mode planner. Keeping the
 * normalization here means the editor can share the same semantics without
 * depending on raw UCI shapes or on a particular mwan3 release.
 */

function listValue(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value.slice() : [ value ];
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

function enabledValue(value) {
	return !(value === false || value === 0 || value === '0' || value === 'false');
}

function numberValue(value) {
	if (value === '' || value == null || !/^-?\d+$/.test(String(value)))
		return null;
	return Number(value);
}

function nextRouteMetric(networkSource, currentName) {
	const sections = normalizeSections(networkSource, 'interface');
	const used = {};
	let current = null;
	sections.forEach(section => {
		const name = sectionName(section);
		const metric = numberValue(section.metric);
		if (name === currentName)
			current = metric;
		else if (metric != null)
			used[metric] = true;
	});
	if (current != null && current >= 20 && current <= 70 && current % 10 === 0 && !used[current])
		return current;
	for (let metric = 20; metric <= 70; metric += 10)
		if (!used[metric])
			return metric;
	return null;
}

function familyValue(value, name, proto) {
	value = String(value || '').toLowerCase();
	if (value === 'ipv6' || value === '6')
		return 'ipv6';
	if (value === 'ipv4' || value === '4')
		return 'ipv4';

	return /6$|6(?:v)?$/i.test(String(name || '')) || /6/.test(String(proto || '').toLowerCase())
		? 'ipv6' : 'ipv4';
}

function buildModePlan(mode, uplinks) {
	mode = [ 'single', 'failover', 'balance' ].indexOf(mode) !== -1 ? mode : 'failover';
	uplinks = (uplinks || []).filter(uplink => uplink && uplink.enabled !== false);
	const groups = { ipv4: [], ipv6: [] };

	uplinks.forEach(uplink => {
		const family = uplink.family === 'ipv6' ? 'ipv6' : 'ipv4';
		groups[family].push(uplink);
	});

	const policies = Object.keys(groups).map(family => {
		let members = groups[family];
		if (mode === 'single')
			members = members.slice(0, 1);
		if (!members.length)
			return null;

		const modeCode = { single: 's', failover: 'f', balance: 'b' }[mode];
		const familyCode = family === 'ipv6' ? '6' : '4';
		return {
			/* mwan3 limits policy/member identifiers to 15 characters because
			 * they become part of iptables chain names. Keep these IDs compact. */
			name: 'fn_' + modeCode + familyCode,
			family: family,
			members: members.map((uplink, index) => ({
				name: 'fn_' + modeCode + familyCode + '_' + index,
				interface: uplink.name,
				metric: mode === 'balance' ? 1 : index + 1,
				weight: 1
			}))
		};
	}).filter(Boolean);

	return { mode: mode, policies: policies };
}

function detectMode(rules, fallback) {
	const modes = [];
	(rules || []).forEach(rule => {
		const policy = String(rule && (rule.use_policy || '') || '').toLowerCase();
		if (!policy)
			return;
		if (policy.indexOf('fn_b') === 0 || policy === 'balanced')
			modes.push('balance');
		else if (policy.indexOf('fn_f') === 0 || policy === 'wan_wanb' || policy === 'wanb_wan')
			modes.push('failover');
		else if (policy.indexOf('fn_s') === 0 || policy === 'wan_only')
			modes.push('single');
	});

	if (modes.indexOf('balance') !== -1)
		return 'balance';
	if (modes.indexOf('failover') !== -1)
		return 'failover';
	if (modes.indexOf('single') !== -1)
		return 'single';
	return [ 'single', 'failover', 'balance' ].indexOf(fallback) !== -1 ? fallback : 'single';
}

function defaultRuleMatches(rule, family) {
	const name = sectionName(rule);
	const destination = family === 'ipv6' ? '::/0' : '0.0.0.0/0';
	const suffix = family === 'ipv6' ? 'v6' : 'v4';
	return !!rule && (name === 'default_rule_' + suffix || name === 'fn_default_rule_' + suffix ||
		(rule.freenetic_managed === '1' && rule.dest_ip === destination));
}

function detectDefaultMode(rules, uplinks, fallback) {
	const active = (uplinks || []).filter(uplink => uplink && uplink.enabled !== false);
	/* The UI exposes one mode for the router. Prefer IPv4 when both families
	 * exist; applying a mode synchronizes every enabled family. Disabled IPv6
	 * defaults must never override the active IPv4 selection. */
	const family = active.some(uplink => uplink.family === 'ipv4')
		? 'ipv4'
		: active.some(uplink => uplink.family === 'ipv6') ? 'ipv6' : null;
	const defaults = family
		? (rules || []).filter(rule => defaultRuleMatches(rule, family) && enabledValue(rule.enabled))
		: [];
	return detectMode(defaults, fallback);
}

function buildTrafficState(uplinks, mode, policies, policyName) {
	uplinks = (uplinks || []).filter(Boolean);
	const ipv4 = uplinks.filter(uplink => uplink.family === 'ipv4');
	const candidates = ipv4.length ? ipv4 : uplinks;
	const selectedPolicy = (policies || []).find(policy => policy && policy.name === policyName) || null;
	const policyInterfaces = selectedPolicy
		? (selectedPolicy.members || []).map(member => member.interface).filter(Boolean) : [];
	const roleCandidates = candidates.filter(uplink => {
		const name = String(uplink.name || '').toLowerCase();
		const scope = String(uplink.scope || '').toLowerCase();
		return name === 'wan' || name === 'wanb' ||
			scope === 'ethernet-port' || scope === 'wifi-uplink' || scope === 'modem-uplink' ||
			policyInterfaces.indexOf(uplink.name) !== -1;
	});
	const scoped = roleCandidates.length ? roleCandidates : candidates;
	const primary = scoped.find(uplink => String(uplink.name || '').toLowerCase() === 'wan') || scoped[0] || null;
	const backups = scoped.filter(uplink => uplink !== primary);
	const ordered = (primary ? [ primary ] : []).concat(backups);
	const policyUplinks = policyInterfaces.length
		? policyInterfaces.map(name => ordered.find(uplink => uplink.name === name)).filter(Boolean)
		: ordered;
	const selected = mode === 'single' ? (policyUplinks[0] || primary) : primary;
	const eligible = mode === 'single' ? (selected ? [ selected ] : []) : policyUplinks;
	const current = eligible.find(uplink => uplink.state === 'online') || null;
	const backupOnline = backups.find(uplink => uplink.state === 'online') || null;
	const heroState = current ? 'online' : selected ? selected.state : 'unknown';
	return { uplinks: ordered, primary, selected, current, fallback: selected, backups, backupOnline, heroState, mode };
}

/* uci.sections() returns an array, while tests and a few LuCI helpers often
 * expose a config as an object keyed by section name. Accept both forms so
 * the model remains easy to exercise without a live router. */
function normalizeSections(source, type) {
	if (Array.isArray(source))
		return source.filter(section => section && (!type || !section['.type'] || section['.type'] === type));

	if (!source || typeof source !== 'object')
		return [];

	if (Array.isArray(source[type]))
		return source[type].slice();

	return Object.keys(source).map(name => {
		const value = source[name];
		if (!value || typeof value !== 'object' || Array.isArray(value))
			return null;
		const section = Object.assign({}, value);
		if (!section['.name'])
			section['.name'] = name;
		return section;
	}).filter(section => section && (!type || !section['.type'] || section['.type'] === type));
}

function normalizeRuntime(source) {
	if (Array.isArray(source))
		return source.slice();

	if (source && Array.isArray(source.interface))
		return source.interface.slice();

	if (!source || typeof source !== 'object')
		return [];

	return Object.keys(source).map(name => {
		const value = source[name];
		if (!value || typeof value !== 'object' || Array.isArray(value))
			return null;
		return Object.assign({ interface: name }, value);
	}).filter(Boolean);
}

function normalizeMwanRuntime(source) {
	if (source && source.interfaces && typeof source.interfaces === 'object')
		return source.interfaces;
	return source && typeof source === 'object' ? source : {};
}

function mwanRuntimeState(entry) {
	if (!entry || typeof entry !== 'object')
		return null;
	if (entry.enabled === false || entry.enabled === 0 || entry.enabled === '0')
		return 'disabled';

	const status = String(entry.status || '').toLowerCase();
	if (status === 'online' || status === 'offline' || status === 'disabled' || status === 'unknown')
		return status;
	return null;
}

function packageMap(source) {
	if (source && source.packages && typeof source.packages === 'object')
		return source.packages;
	return source && typeof source === 'object' ? source : {};
}

function packageInstalled(state) {
	return state === true || state === 1 || state === '1' || !!(state && state.installed);
}

function packageAvailable(state) {
	return packageInstalled(state) || !!(state && state.available);
}

function findRuntime(runtime, name) {
	return runtime.find(entry => entry && (entry.interface === name ||
		entry.name === name || entry.l3_device === name || entry.device === name)) || null;
}

function runtimeState(entry) {
	if (!entry || !Object.prototype.hasOwnProperty.call(entry, 'up'))
		return 'unknown';
	return entry.up === true || entry.up === 1 || entry.up === '1' ? 'online' : 'offline';
}

function buildModel(config, networkSource, runtimeSource, packageSource, mwanRuntimeSource) {
	config = config || {};
	const interfaceSections = normalizeSections(config.interfaces || config.interface, 'interface');
	const memberSections = normalizeSections(config.members || config.member, 'member');
	const policySections = normalizeSections(config.policies || config.policy, 'policy');
	const ruleSections = normalizeSections(config.rules || config.rule, 'rule');
	const networkSections = normalizeSections(networkSource, 'interface');
	const runtime = normalizeRuntime(runtimeSource);
	const mwanRuntime = normalizeMwanRuntime(mwanRuntimeSource);
	const membersByInterface = {};
	const memberByName = {};

	memberSections.forEach(section => {
		const name = sectionName(section);
		if (!name)
			return;

		const member = {
			name: name,
			interface: String(section.interface || '').trim(),
			metric: numberValue(section.metric),
			weight: numberValue(section.weight)
		};
		memberByName[name] = member;
		if (member.interface) {
			if (!membersByInterface[member.interface])
				membersByInterface[member.interface] = [];
			membersByInterface[member.interface].push(member);
		}
	});

	const uplinks = interfaceSections.map(section => {
		const name = sectionName(section);
		const network = networkSections.find(item => sectionName(item) === name) || {};
		const runtimeEntry = findRuntime(runtime, name);
		const mwanRuntimeEntry = mwanRuntime[name] || null;
		const members = membersByInterface[name] || [];
		const disabled = !enabledValue(section.enabled);
		const state = disabled ? 'disabled' : (mwanRuntimeState(mwanRuntimeEntry) || runtimeState(runtimeEntry));
		const metrics = members.map(member => member.metric).filter(metric => metric != null);
		const weights = members.map(member => member.weight).filter(weight => weight != null);

		return {
			name: name || '',
			label: section.label || section.description || network.label || name || '–',
			scope: network.freenetic_scope || section.freenetic_scope || '',
			device: (runtimeEntry && (runtimeEntry.l3_device || runtimeEntry.device)) ||
				network.device || network.ifname || '',
			proto: network.proto || section.proto || '',
			family: familyValue(section.family, name, network.proto || section.proto),
			enabled: !disabled,
			state: state,
			up: state === 'online',
			trackMethod: section.track_method || '',
			trackIps: listValue(section.track_ip),
			tracking: mwanRuntimeEntry && mwanRuntimeEntry.tracking || '',
			initialState: section.initial_state || '',
			members: members,
			metric: metrics.length ? Math.min.apply(null, metrics) : null,
			weight: weights.length ? weights.reduce((sum, weight) => sum + weight, 0) : null
		};
	});

	const policies = policySections.map(section => {
		const name = sectionName(section);
		const members = listValue(section.use_member).map(memberName => {
			const member = memberByName[memberName];
			return {
				name: memberName,
				interface: member ? member.interface : '',
				metric: member ? member.metric : null,
				weight: member ? member.weight : null
			};
		});
		const ruleCount = ruleSections.filter(rule =>
			listValue(rule.use_policy || rule.policy).indexOf(name) !== -1).length;

		return {
			name: name || '',
			label: section.label || section.description || name || '–',
			members: members,
			ruleCount: ruleCount,
			lastResort: section.last_resort || ''
		};
	});

	const packages = packageMap(packageSource);
	const mwanPackage = packages.mwan3;
	const luciPackage = packages['luci-app-mwan3'];
	const packageReady = packageInstalled(mwanPackage);
	const online = uplinks.filter(item => item.state === 'online').length;
	const offline = uplinks.filter(item => item.state === 'offline').length;
	const disabled = uplinks.filter(item => item.state === 'disabled').length;

	return {
		package: {
			ready: packageReady,
			mwan3: { installed: packageInstalled(mwanPackage), available: packageAvailable(mwanPackage) },
			luci: { installed: packageInstalled(luciPackage), available: packageAvailable(luciPackage) }
		},
		uplinks: uplinks,
		policies: policies,
		summary: {
			total: uplinks.length,
			online: online,
			offline: offline,
			disabled: disabled,
			policyCount: policies.length,
			ruleCount: ruleSections.length
		}
	};
}

return baseclass.extend({
	listValue,
	sectionName,
	normalizeSections,
	normalizeRuntime,
	normalizeMwanRuntime,
	familyValue,
	nextRouteMetric,
	buildModePlan,
	detectMode,
	defaultRuleMatches,
	detectDefaultMode,
	buildTrafficState,
	buildModel
});
