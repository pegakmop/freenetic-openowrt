'use strict';
'require view';
'require fs';

/*
 * One entry point for Zapret2 in Freenetic.
 *
 * Prefer the real luci-app-zapret2 page when it is installed.  Some older
 * Freenetic test images contain only our signed runtime package, so retain a
 * compatibility route to the small native client shipped with that package.
 * This keeps the catalog and sidebar stable without presenting two settings
 * implementations on routers which already have the complete LuCI app.
 */

const NATIVE_UI_PACKAGE = 'luci-app-zapret2';
const NATIVE_RUNTIME_PACKAGE = 'zapret2';
const FREENETIC_RUNTIME_PACKAGE = 'freenetic-zapret2';

function applicationsUrl() {
	return L.url('admin/system/applications') + '?focus=nfqws2';
}

function packageStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-package-status', [
		NATIVE_UI_PACKAGE,
		NATIVE_RUNTIME_PACKAGE,
		FREENETIC_RUNTIME_PACKAGE
	], 'json')
		.then(result => result && result.packages || null)
		.catch(() => null);
}

function installed(status, packageName) {
	return !!(status && status[packageName] && status[packageName].installed);
}

return view.extend({
	load() {
		return packageStatus();
	},

	render(status) {
		if (installed(status, NATIVE_UI_PACKAGE)) {
			const target = L.url('admin/services/zapret2');
			window.setTimeout(() => window.location.replace(target), 0);
			return E('div', { class: 'fn-card fn-zapret-launcher' }, [
				E('div', { class: 'fn-card-body' }, [
					E('strong', {}, _('Opening the Zapret2 settings…')),
					E('p', {}, _('The installed LuCI interface is opening.'))
				])
			]);
		}

		if (installed(status, FREENETIC_RUNTIME_PACKAGE)) {
			const target = L.url('admin/network/zapret2/config');
			window.setTimeout(() => window.location.replace(target), 0);
			return E('div', { class: 'fn-card fn-zapret-launcher' }, [
				E('div', { class: 'fn-card-body' }, [
					E('strong', {}, _('Opening the Zapret2 settings…')),
					E('p', {}, _('The compatibility interface is opening.'))
				])
			]);
		}

		const runtimeOnly = installed(status, NATIVE_RUNTIME_PACKAGE);

		return E('section', { class: 'fn-card fn-zapret-missing' }, [
			E('div', { class: 'fn-card-body' }, [
				E('strong', {}, runtimeOnly ? _('Zapret2 interface is not installed') : _('Zapret2 is not installed')),
				E('p', {}, runtimeOnly
					? _('The runtime is present, but its LuCI interface is missing. Install luci-app-zapret2 from Applications.')
					: _('Install Zapret2 from Applications. Installation does not enable traffic processing.')),
				E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: applicationsUrl() }, _('Open Applications'))
			])
		]);
	},

	addFooter() { return E([]); }
});
