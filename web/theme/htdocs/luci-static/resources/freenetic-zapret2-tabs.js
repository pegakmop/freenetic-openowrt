'use strict';
'require baseclass';
'require dom';
'require ui';
'require freenetic-ui as uiHelper';

/*
 * The native Zapret2 view already builds and wires the engine-wide settings
 * block (including validation and the package-default reset action). Move
 * that exact live node into a peer tab instead of reimplementing its UCI
 * controls or creating a second sidebar page.
 */

const PAGE = 'admin-services-zapret2';
const TAB = 'freenetic-global-settings';
const TAB_TITLE = 'Настройки';
const STRATEGY_TITLE = 'Стратегии обхода';
const APPLY_ID = 'freenetic-zapret2-apply';
const applyChanges = uiHelper.applyChanges;

function nativeSettingsNode(map) {
	return map.querySelector(':scope > .cbi-map-tabbed > #cbi-zapret2-strategy > .cbi-section:not(.cbi-tblsection)');
}

return baseclass.extend({
	__init__() {
		this.applyPromise = null;
		if (document.body.dataset.page !== PAGE)
			return;

		let attempts = 0;
		const mountWhenReady = () => {
			if (this.mount() || ++attempts > 50)
				return;
			window.setTimeout(mountWhenReady, 100);
		};
		mountWhenReady();

		const view = document.querySelector('#view');
		if (view) {
			this.observer = new MutationObserver(() => this.mount());
			this.observer.observe(view, { childList: true, subtree: true });
		}
	},

	mount() {
		const map = document.querySelector('#cbi-zapret2');
		const menu = map && map.querySelector(':scope > .cbi-tabmenu');
		const groupNode = map && map.querySelector(':scope > .cbi-map-tabbed');
		if (!map || !menu || !groupNode)
			return false;

		const strategyItem = menu.querySelector(':scope > li[data-tab="strategy"]');
		const strategyLink = strategyItem && strategyItem.querySelector(':scope > a');
		if (strategyLink && strategyLink.textContent !== STRATEGY_TITLE)
			strategyLink.textContent = STRATEGY_TITLE;
		if (strategyItem && strategyItem.getAttribute('data-tab-title') !== STRATEGY_TITLE)
			strategyItem.setAttribute('data-tab-title', STRATEGY_TITLE);

		if (!map.querySelector('[data-tab="' + TAB + '"]')) {
			const settings = nativeSettingsNode(map);
			if (!settings)
				return false;

			const link = E('a', { href: '#' }, TAB_TITLE);
			const menuItem = E('li', { class: 'cbi-tab-disabled', 'data-tab': TAB }, link);
			const pane = E('div', {
				id: 'cbi-zapret2-freenetic-global-settings',
				class: 'cbi-section fn-zapret-settings-pane',
				'data-tab': TAB,
				'data-tab-title': TAB_TITLE,
				'data-tab-active': 'false'
			}, settings);

			link.addEventListener('click', event => ui.tabs.switchTab(event));
			menu.insertBefore(menuItem, menu.children[1] || null);
			groupNode.insertBefore(pane, groupNode.children[1] || null);
		}

		this.mountApplyButton();
		return !!map.querySelector('[data-tab="' + TAB + '"]');
	},

	mountApplyButton() {
		const startButton = document.getElementById('zapret2-start-btn');
		const actionGroup = startButton && startButton.parentElement;
		if (!actionGroup || actionGroup.querySelector('#' + APPLY_ID))
			return false;

		const button = E('button', {
			'id': APPLY_ID,
			'class': 'btn cbi-button cbi-button-positive fn-zapret-apply-btn',
			'click': () => this.applyPendingChanges(button)
		}, 'Применить изменения');
		actionGroup.insertBefore(button, actionGroup.firstElementChild || null);
		return true;
	},

	saveNativeMaps() {
		const maps = Array.from(document.querySelectorAll('#view .cbi-map'));
		return Promise.all(maps.map(map => dom.callClassMethod(map, 'save')));
	},

	applyPendingChanges(button) {
		if (this.applyPromise)
			return this.applyPromise;

		const originalText = button.textContent;
		button.disabled = true;
		button.classList.add('spinning');
		button.textContent = 'Применяем…';

		this.applyPromise = this.saveNativeMaps()
			.then(() => applyChanges(30))
			.then(() => {
				uiHelper.notify('Изменения Zapret2 применены.', 'info');
				window.setTimeout(() => window.location.reload(), 800);
			})
			.catch(error => {
				uiHelper.notify('Не удалось применить изменения Zapret2: ' + (error.message || error), 'danger');
				button.disabled = false;
				button.classList.remove('spinning');
				button.textContent = originalText;
			})
			.finally(() => {
				this.applyPromise = null;
			});

		return this.applyPromise;
	}
});
