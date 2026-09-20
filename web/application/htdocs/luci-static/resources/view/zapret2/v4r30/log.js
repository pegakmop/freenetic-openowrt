'use strict';
'require view';
'require form';
'require poll';
'require zapret2.v4r30.rpc as api';
'require zapret2.v4r30.ui as zui';

function setText(option, value) {
	var element = option.getUIElement('log');
	if (element)
		element.setValue(value || '');
}

function scrollToBottom(option) {
	var element = option.getUIElement('log');
	var node = element && element.node ? element.node.querySelector('textarea') || element.node.firstChild : null;
	if (node)
		node.scrollTop = node.scrollHeight;
}

function setRefreshError(node, error) {
	if (!node)
		return;
	node.textContent = error ? _('Last refresh failed: %s').format(zui.errorText(error)) : '';
	node.hidden = !error;
}

function refreshLog(option, errorNode) {
	return api.log(100).then(function(data) {
		setText(option, data.text || _('No log entries are available.'));
		setRefreshError(errorNode, null);
	}).catch(function(error) {
		setRefreshError(errorNode, error);
		throw error;
	});
}

return view.extend({
	load: function() {
		return api.log(100).catch(function(error) {
			return { text: '', error: error };
		});
	},

	render: function(data) {
		var errorNode = zui.alertMessage('', 'warning', { hidden: '' });
		setRefreshError(errorNode, data && data.error);
		var model = {
			log: {
				text: data && data.text ? data.text : _('No log entries are available.'),
			},
		};
		var map = new form.JSONMap(model, _('Log'), _('View recent Zapret2 service messages.'));
		map.submit = false;
		map.reset = false;
		var section = map.section(form.NamedSection, 'log', 'log', _('Recent log'));

		var text = section.option(form.TextValue, 'text');
		text.rows = 25;
		text.wrap = 'off';
		text.readonly = true;
		text.monospace = true;
		text.write = function() {};

		var refresh = section.option(form.Button, '_refresh');
		refresh.inputtitle = _('Refresh');
		refresh.inputstyle = 'reload';
		refresh.onclick = function() {
			return refreshLog(text, errorNode).catch(zui.notifyError);
		};

		var scroll = section.option(form.Button, '_scroll');
		scroll.inputtitle = _('Scroll to bottom');
		scroll.onclick = function() {
			scrollToBottom(text);
		};

		return map.render().then(function(root) {
			var sectionNode = root.querySelector('[data-tab]') || root.querySelector('.cbi-section-node') || root;
			sectionNode.appendChild(errorNode);
			window.setTimeout(function() {
				poll.add(function() {
					return refreshLog(text, errorNode).catch(function() {});
				}, 3);
			}, 0);
			return root;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
});
