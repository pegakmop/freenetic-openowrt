'use strict';
'require view';
'require ui';
'require zapret2.v4r30.rpc as api';
'require zapret2.v4r30.strategy as model';
'require zapret2.v4r30.ui as zui';

var index = [], limits = {};

function download(name, content) {
	var url = URL.createObjectURL(new Blob([ content || '' ], { type: 'text/plain;charset=utf-8' }));
	var link = E('a', { href: url, download: name }); document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function bytes(value) { return new TextEncoder().encode(String(value || '')).length; }
function readFile(file) {
	return new Promise(function(resolve, reject) {
		var reader = new FileReader(); reader.onload = function() { resolve(String(reader.result || '')); };
		reader.onerror = function() { reject(reader.error || new Error(_('Unable to read the selected file.'))); }; reader.readAsText(file, 'UTF-8');
	});
}

function refresh() {
	return api.listIndex().then(function(data) { index = data.lists || []; var node = document.getElementById('zapret2-list-content'); if (node) node.replaceChildren(renderManager()); }).catch(zui.notifyError);
}

function editList(item) {
	var existing = item || null;
	return (existing ? api.listGet(existing.id, existing.type) : Promise.resolve({ id: '', type: 'domain', content: '' })).then(function(data) {
		var referenced = existing && +existing.references > 0;
		var id = E('input', { class: 'cbi-input-text', value: data.id || '', maxlength: 32, disabled: referenced });
		var type = E('select', { class: 'cbi-input-select', disabled: referenced }, [ E('option', { value: 'domain', selected: data.type === 'domain' }, _('Domain')), E('option', { value: 'ip', selected: data.type === 'ip' }, _('IP address')) ]);
		var content = E('textarea', { class: 'cbi-input-textarea', rows: 24, wrap: 'off', style: 'width:100%;font-family:monospace' }, data.content || '');
		var upload = E('input', { type: 'file', accept: '.txt,.domain,.ip,text/plain' });
		upload.addEventListener('change', function() {
			if (!upload.files || !upload.files[0]) return;
			readFile(upload.files[0]).then(function(value) { content.value = value; }).catch(zui.notifyError);
		});
		ui.showModal(existing ? _('Edit local list') : _('Create local list'), [
			E('div', { class: 'cbi-value' }, [ E('label', { class: 'cbi-value-title' }, _('List ID')), E('div', { class: 'cbi-value-field' }, id) ]),
			E('div', { class: 'cbi-value' }, [ E('label', { class: 'cbi-value-title' }, _('List type')), E('div', { class: 'cbi-value-field' }, type) ]),
			E('div', { class: 'cbi-value' }, [ E('label', { class: 'cbi-value-title' }, _('Import local text file')), E('div', { class: 'cbi-value-field' }, upload) ]),
			zui.sectionDescription(_('Domain lists accept domains and ^exact.domain. IP lists accept IPv4, IPv6 and CIDR. Empty lines and # comments are allowed.')),
			referenced ? zui.alertMessage(_('This list is in use. Its ID and type cannot be changed until all Profile references are removed.'), 'notice') : E([]),
			content,
			zui.actionRow([ E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')), E('button', { class: 'btn cbi-button-positive', click: function() {
				var listId = id.value.trim(), listType = type.value, text = content.value;
				if (!model.validId(listId)) { zui.notifyError(new Error(_('Use 1 to 32 lowercase letters, digits or underscores for the list ID.'))); return; }
				if (bytes(text) > +(limits.file_bytes || 1048576)) { zui.notifyError(new Error(_('The list exceeds the allowed size.'))); return; }
				return api.listPut(listId, listType, text, existing && existing.id, existing && existing.type).then(function() { ui.hideModal(); return refresh(); }).catch(zui.notifyError);
			} }, _('Save list')) ], 'right')
		]);
	}).catch(zui.notifyError);
}

function exportList(item) {
	return api.listGet(item.id, item.type).then(function(data) { download(item.id + (item.type === 'ip' ? '.ip' : '.domain'), data.content || ''); }).catch(zui.notifyError);
}
function removeList(item) {
	zui.confirm(_('Delete local list'), _('Delete list %s?').format(item.id), _('Delete'), function() { return api.listDelete(item.id, item.type).then(refresh); });
}
function clearAuto(item) {
	zui.confirm(_('Clear automatic hostlist'), _('Clear the managed automatic hostlist for %s?').format(item.id), _('Clear'), function() { return api.listClear(item.id).then(refresh); });
}

function table(type, title) {
	var items = index.filter(function(item) { return item.type === type; });
	return E('div', { class: 'cbi-section' }, [ E('h3', {}, title), E('table', { class: 'table' }, [
		E('tr', { class: 'tr table-titles' }, [ E('th', { class: 'th left top' }, _('ID')), E('th', { class: 'th top' }, _('Entries')), E('th', { class: 'th top' }, _('Size')), E('th', { class: 'th left top' }, _('Referenced by')), E('th', { class: 'th cbi-section-actions top' }, _('Actions')) ])
	].concat(items.length ? items.map(function(item) {
		var actions = [];
		if (type !== 'auto_domain') {
			actions.push(E('button', { class: 'btn cbi-button-action', click: ui.createHandlerFn(null, editList, item) }, _('Edit')));
		}
		actions.push(E('button', { class: 'btn', click: ui.createHandlerFn(null, exportList, item) }, _('Export')));
		if (type === 'auto_domain')
			actions.push(E('button', { class: 'btn cbi-button-negative', click: ui.createHandlerFn(null, clearAuto, item) }, _('Clear')));
		else
			actions.push(E('button', { class: 'btn cbi-button-negative', disabled: +item.references > 0, title: +item.references > 0 ? _('Referenced lists cannot be deleted or renamed.') : '', click: ui.createHandlerFn(null, removeList, item) }, _('Delete')));
		return E('tr', { class: 'tr' }, [ E('td', { class: 'td left top', 'data-title': _('ID') }, item.id), E('td', { class: 'td top', 'data-title': _('Entries') }, String(item.entries || 0)), E('td', { class: 'td top', 'data-title': _('Size') }, '%1024.2mB'.format(item.size || 0)), E('td', { class: 'td left top', 'data-title': _('Referenced by') }, (item.profiles || []).join(', ') || '-'), E('td', { class: 'td cbi-section-actions top', 'data-title': _('Actions') }, zui.tableActions(actions)) ]);
	}) : [ E('tr', { class: 'tr placeholder' }, E('td', { class: 'td', colspan: 5 }, _('No lists available.'))) ])) ]);
}

function renderManager() {
	return E([], [
		table('domain', _('Domain lists')), table('ip', _('IP address lists')), table('auto_domain', _('Automatic domain lists')),
		zui.actionRow([ E('button', { class: 'btn cbi-button-add', disabled: index.filter(function(item) { return item.type !== 'auto_domain'; }).length >= +(limits.count || 32), click: ui.createHandlerFn(null, editList, null) }, _('Create list')), E('button', { class: 'btn cbi-button-reload', click: ui.createHandlerFn(null, refresh) }, _('Refresh')) ])
	]);
}

return view.extend({
	load: function() { return Promise.all([ api.info().catch(function(error) { return { error: error }; }), api.listIndex().catch(function(error) { return { error: error }; }) ]); },
	render: function(data) {
		if (data[0].error || data[1].error)
			return E('div', { class: 'cbi-map' }, [ zui.pageHeader(_('Local lists'), _('Manage local domain and IP lists.')), zui.alertMessage(zui.errorText(data[0].error || data[1].error), 'error') ]);
		model.setInfo(data[0]); limits = data[0].list_limits || {}; index = data[1].lists || [];
		return E('div', { class: 'cbi-map' }, [ zui.pageHeader(_('Local lists'), _('Manage local domain and IP lists. Automatic hostlists are maintained by nfqws2 and can only be viewed, exported, or cleared.')), E('div', { id: 'zapret2-list-content' }, renderManager()) ]);
	},
	handleSave: null, handleSaveApply: null, handleReset: null
});
