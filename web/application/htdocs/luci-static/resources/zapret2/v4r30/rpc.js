'use strict';
'require baseclass';
'require rpc';

/* Versioned browser client for luci-app-zapret2 4.0.0-r30. */

var API_VERSION = 1;
var SCHEMA_VERSION = 2;

function call(method, params) {
	return rpc.declare({
		object: 'zapret2',
		method: method,
		params: [ 'api_version', 'schema_version' ].concat(params || []),
		reject: true
	});
}

function unwrap(reply) {
	if (!reply || reply.api_version !== API_VERSION || reply.schema_version !== SCHEMA_VERSION) {
		var versionError = new Error(_('This LuCI application requires Zapret2 API v%d and UCI schema v%d.').format(API_VERSION, SCHEMA_VERSION));
		versionError.code = 'incompatible_api';
		throw versionError;
	}

	if (reply.ok !== true) {
		var detail = reply.error || {};
		var error = new Error(detail.message || _('Zapret2 returned an invalid response.'));
		error.code = detail.code || 'rpc_error';
		error.section = detail.section || '';
		error.option = detail.option || '';
		error.step = detail.step || '';
		error.line = Number(detail.line || 0);
		throw error;
	}

	return reply.data || {};
}

function invoke(fn, args) {
	return fn.apply(null, [ API_VERSION, SCHEMA_VERSION ].concat(args || [])).then(unwrap);
}

var callInfo = call('info');
var callStatus = call('status');
var callValidate = call('validate', [ 'candidate' ]);
var callService = call('service', [ 'action' ]);
var callListIndex = call('list_index');
var callListGet = call('list_get', [ 'id', 'type' ]);
var callListPut = call('list_put', [ 'id', 'type', 'content', 'old_id', 'old_type' ]);
var callListDelete = call('list_delete', [ 'id', 'type' ]);
var callListClear = call('list_clear', [ 'id', 'type' ]);
var callLog = call('log', [ 'limit' ]);

return baseclass.extend({
	API_VERSION: API_VERSION,
	SCHEMA_VERSION: SCHEMA_VERSION,
	info: function() { return invoke(callInfo); },
	status: function() { return invoke(callStatus); },
	validate: function(candidate) { return invoke(callValidate, [ candidate || {} ]); },
	service: function(action) { return invoke(callService, [ action ]); },
	listIndex: function() { return invoke(callListIndex); },
	listGet: function(id, type) { return invoke(callListGet, [ id, type ]); },
	listPut: function(id, type, content, oldId, oldType) {
		return invoke(callListPut, [ id, type, content, oldId || '', oldType || '' ]);
	},
	listDelete: function(id, type) { return invoke(callListDelete, [ id, type ]); },
	listClear: function(id) { return invoke(callListClear, [ id, 'auto_domain' ]); },
	log: function(limit) { return invoke(callLog, [ limit || 100 ]); }
});
