'use strict';
'require baseclass';
'require ui';
'require uci';

const FADE_MS = 400;

function empty(node) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
}

function content(node, text) {
	empty(node);
	node.appendChild(document.createTextNode(text));
}

function notification(message, type, errorTimeout) {
	const timeout = (type === 'warning' || type === 'danger') ? errorTimeout : 4000;
	const msg = ui.addNotification(null, E('p', {}, message), type);

	setTimeout(() => {
		msg.classList.add('fade-out');
		msg.classList.remove('fade-in');
		setTimeout(() => {
			if (msg.parentNode)
				msg.parentNode.removeChild(msg);
		}, FADE_MS);
	}, timeout);

	return msg;
}

function refreshSessionPermissions() {
	const cacheCleanup = window.caches && typeof window.caches.keys === 'function'
		? window.caches.keys()
			.then(keys => Promise.all(keys.map(key => window.caches.delete(key))))
			.catch(() => null)
		: Promise.resolve();

	cacheCleanup.finally(() => {
		setTimeout(() => {
			window.location.replace('/cgi-bin/luci/admin/logout?_=' + Date.now());
		}, 1800);
	});
}

function applyChanges(timeout) {
	return uci.apply(timeout).catch(err => {
		if (err && /code 5/.test(err.message))
			return;
		if (err && /(?:code 6|permission denied)/i.test(err.message)) {
			refreshSessionPermissions();
			throw new Error(_('The administrator session permissions changed. You will be signed out; sign in again and repeat the action.'));
		}
		throw err;
	}).then(() => ui.changes.init());
}

return baseclass.extend({
	empty: empty,
	content: content,
	notify: function(message, type) {
		return notification(message, type, 6000);
	},
	notifyLong: function(message, type) {
		return notification(message, type, 8000);
	},
	applyChanges: applyChanges
});
