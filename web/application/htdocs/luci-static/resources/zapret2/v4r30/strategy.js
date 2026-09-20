'use strict';
'require baseclass';
'require uci';

/* Versioned browser model for luci-app-zapret2 4.0.0-r30. */

var API_VERSION = 1;
var SCHEMA_VERSION = 2;
var MAX_CANDIDATE_BYTES = 128 * 1024;
var info = { limits: {}, l7: [], payload: [], conditions: [], actions: [], action_parameters: {}, list_limits: {} };
var DOMAIN_RE = /^\^?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
var MARK_RE = /^0x[0-9a-fA-F]{1,8}$/;
var MATCH_MARK_RE = /^(0x[0-9a-fA-F]{1,8})\/(0x[0-9a-fA-F]{1,8})$/;
var ID_RE = /^[a-z0-9][a-z0-9_]{0,31}$/;

function setInfo(value) {
	info = value || info;
	info.limits = info.limits || {};
	info.l7 = Array.isArray(info.l7) ? info.l7 : [];
	info.payload = Array.isArray(info.payload) ? info.payload : [];
	info.conditions = Array.isArray(info.conditions) ? info.conditions : [];
	info.actions = Array.isArray(info.actions) ? info.actions : [];
	info.action_parameters = info.action_parameters || {};
	info.list_limits = info.list_limits || {};
}

function capability() { return info; }
function supports(type, option) {
	return Array.isArray(info.action_parameters[type]) && info.action_parameters[type].indexOf(option) >= 0;
}
function stepTypes() { return info.conditions.concat(info.actions); }
function validId(value) { return ID_RE.test(String(value || '')); }
function validDomain(value) { value = String(value || ''); return value.length <= 253 && DOMAIN_RE.test(value); }
function validHostname(value) { value = String(value || ''); return value.charAt(0) !== '^' && validDomain(value); }
function validMark(value) { return MARK_RE.test(String(value || '')); }
function validSingleBitMark(value) {
	if (!validMark(value)) return false;
	var n = parseInt(value, 16) >>> 0;
	return n !== 0 && (n & (n - 1)) === 0;
}
function validMatchMark(value) {
	var m = String(value || '').match(MATCH_MARK_RE);
	if (!m) return false;
	var v = parseInt(m[1], 16) >>> 0, mask = parseInt(m[2], 16) >>> 0;
	return mask !== 0 && ((v & mask) >>> 0) === v;
}
function validPort(value) {
	value = String(value || '');
	var raw = value.charAt(0) === '~' ? value.substring(1) : value;
	if (raw === '*') return true;
	var m = raw.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
	if (!m) return false;
	var a = +m[1], b = +(m[2] || m[1]);
	return a >= 1 && b <= 65535 && a <= b;
}
function validIcmp(value) {
	value = String(value || '');
	if (value === '*') return true;
	var m = value.match(/^(\d{1,3})(?::(\d{1,3}))?$/);
	return !!m && +m[1] <= 255 && (m[2] == null || +m[2] <= 255);
}
function validProtocol(value) { return value === '*' || /^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(String(value || '')); }
function validAutottl(value) {
	var m = String(value || '').match(/^(-?\d+),(\d+)-(\d+)$/);
	return !!m && +m[1] >= -20 && +m[1] <= 20 && +m[2] >= 1 && +m[3] <= 255 && +m[2] <= +m[3];
}
function validFragPos(value) { return /^\d+$/.test(String(value || '')) && +value >= 8 && +value <= 1480 && +value % 8 === 0; }
function validRange(value) {
	value = String(value || '');
	return value !== '-' && value !== '<' && /^(?:a|x|(?:[nadspb]\d+)?(?:-|<)(?:[nadspb]\d+)?)$/.test(value);
}
function validPosition(value) { value = String(value || ''); return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_+,-]+$/.test(value); }
function validIp(value) {
	value = String(value || '');
	var parts = value.split('/'), address = parts[0], prefix = parts[1];
	if (parts.length > 2 || (prefix != null && !/^\d+$/.test(prefix))) return false;
	if (address.indexOf(':') >= 0) {
		if (!/^[0-9a-fA-F:.]+$/.test(address) || /:::/.test(address) || (address.match(/::/g) || []).length > 1 || (prefix != null && +prefix > 128)) return false;
		var compressed = address.indexOf('::') >= 0, groups = address.split(':'), units = 0;
		if (!compressed && (address.charAt(0) === ':' || address.charAt(address.length - 1) === ':')) return false;
		for (var i = 0; i < groups.length; i++) {
			if (!groups[i]) continue;
			if (groups[i].indexOf('.') >= 0) {
				var v4 = groups[i].split('.');
				if (i !== groups.length - 1 || v4.length !== 4 || !v4.every(function(v) { return /^\d+$/.test(v) && +v <= 255; })) return false;
				units += 2;
			} else if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return false;
			else units++;
		}
		return compressed ? units < 8 : units === 8;
	}
	var octets = address.split('.');
	return octets.length === 4 && octets.every(function(v) { return /^\d+$/.test(v) && +v <= 255; }) && (prefix == null || +prefix <= 32);
}

function candidateFromSections(source) {
	var sections = [];
	(source || []).forEach(function(section) {
		var options = {}, lists = {};
		Object.keys(section).forEach(function(key) {
			if (key.charAt(0) === '.') return;
			if (Array.isArray(section[key])) lists[key] = section[key].filter(function(value) { return value !== ''; });
			else if (section[key] != null) options[key] = section[key];
		});
		sections.push({ name: section['.name'], type: section['.type'], options: options, lists: lists });
	});
	var result = { api_version: API_VERSION, schema_version: SCHEMA_VERSION, sections: sections };
	if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_CANDIDATE_BYTES)
		throw new Error(_('The configuration exceeds the 128 KiB limit.'));
	return result;
}
function candidate() { return candidateFromSections(uci.sections('zapret2')); }

var exported = {
	API_VERSION: API_VERSION, SCHEMA_VERSION: SCHEMA_VERSION,
	setInfo: setInfo, info: capability, supports: supports, stepTypes: stepTypes,
	validId: validId, validDomain: validDomain, validHostname: validHostname, validIp: validIp,
	validPort: validPort, validIcmp: validIcmp, validProtocol: validProtocol,
	validMark: validMark, validSingleBitMark: validSingleBitMark, validMatchMark: validMatchMark,
	validAutottl: validAutottl, validFragPos: validFragPos, validRange: validRange, validPosition: validPosition,
	candidate: candidate, candidateFromSections: candidateFromSections
};
if (typeof module !== 'undefined') module.exports = exported;
if (typeof baseclass !== 'undefined') return baseclass.extend(exported);
return exported;
