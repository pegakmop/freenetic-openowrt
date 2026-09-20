'use strict';
'require baseclass';
'require ui';

/* Versioned browser helpers for luci-app-zapret2 4.0.0-r30. */

function errorText(error) {
	if (!error) return _('Unknown error');
	var location = [];
	if (error.section) location.push(_('section %s').format(error.section));
	if (error.option) location.push(_('option %s').format(error.option));
	if (error.step) location.push(_('step %s').format(error.step));
	if (error.line) location.push(_('line %d').format(error.line));
	return (error.message || String(error)) + (location.length ? '\n(' + location.join(', ') + ')' : '');
}

function notifyError(error) {
	ui.addNotification(null, E('p', { style: 'white-space:pre-wrap' }, errorText(error)), 'error');
	if (error && error.section) setTimeout(function() {
		var suffix = error.option ? '.' + error.option : '';
		var node = document.getElementById('widget.cbid.zapret2.' + error.section + suffix) ||
			document.getElementById('cbid.zapret2.' + error.section + suffix);
		if (!node) return;
		var control = node.matches && node.matches('input,select,textarea,button') ? node : node.querySelector && node.querySelector('input,select,textarea,button');
		(control || node).scrollIntoView({ block: 'center', behavior: 'smooth' });
		if (control && control.focus) control.focus();
	}, 0);
}

function notifyWarnings(diagnostics) {
	var messages = ((diagnostics && diagnostics.warnings) || []).map(function(item) { return item.message || String(item); });
	if (messages.length)
		ui.addNotification(null, E('p', { style: 'white-space:pre-wrap' }, messages.join('\n')), 'warning');
}

function badge(text, kind) {
	kind = kind || 'notice';
	return E('span', { class: 'label ' + kind }, text);
}

function actionRow(buttons, className, attributes) {
	var content = [];
	(buttons || []).filter(Boolean).forEach(function(button) {
		if (content.length) content.push(' ');
		content.push(button);
	});
	return E('div', Object.assign({ class: className || 'cbi-page-actions' }, attributes || {}), content);
}

function tableActions(buttons) {
	return actionRow(buttons, 'nowrap', {
		style: 'display:inline-flex;gap:.25rem;justify-content:center;white-space:nowrap',
	});
}

function pageHeader(title, description) {
	return E([], [
		E('h2', {}, title),
		description ? E('div', { class: 'cbi-map-descr' }, description) : E([])
	]);
}

function sectionDescription(text) {
	return E('p', { class: 'cbi-section-descr' }, text);
}

function alertMessage(text, kind, attributes) {
	return E('div', Object.assign({ class: 'alert-message ' + (kind || 'notice') }, attributes || {}), text);
}

function counter(data, key) {
	var value = data && data.counters && data.counters[key];
	return value && Number(value.packets) || 0;
}

function confirm(title, message, label, callback) {
	ui.showModal(title, [
		sectionDescription(message),
		actionRow([
			E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
			E('button', {
				class: 'btn cbi-button-negative important',
				click: function() {
					ui.hideModal();
					return Promise.resolve(callback()).catch(notifyError);
				}
			}, label || _('Confirm'))
		], 'right')
	]);
}

return baseclass.extend({
	errorText: errorText,
	notifyError: notifyError,
	notifyWarnings: notifyWarnings,
	badge: badge,
	actionRow: actionRow,
	tableActions: tableActions,
	pageHeader: pageHeader,
	sectionDescription: sectionDescription,
	alertMessage: alertMessage,
	counter: counter,
	confirm: confirm
});
