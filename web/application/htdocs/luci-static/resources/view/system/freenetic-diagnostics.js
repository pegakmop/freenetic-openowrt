'use strict';
'require view';
'require fs';
'require freenetic-diagnostics as diagnostics';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

const ubusCall = rpc.call;
const setContent = uiHelper.content;
const notify = uiHelper.notify;
const MULTIWAN_HELPER = '/usr/libexec/freenetic-multiwan';

function infoRow(label, value) {
	return E('div', { class: 'fn-info-row' }, [
		E('div', { class: 'fn-info-label' }, label),
		E('div', { class: 'fn-info-value' }, value || '–')
	]);
}

function humanUplinkName(name) {
	const value = String(name || '').trim();
	const match = value.match(/^wan(\d+)$/i);

	if (/^wan$/i.test(value))
		return _('Internet connection');
	if (/^(?:fn)?wwan$/i.test(value))
		return _('Wi-Fi connection');
	if (match)
		return _('Internet connection %s').format(match[1]);

	return value || _('Internet connection');
}

function humanProtocol(protocol) {
	const value = String(protocol || '').trim();
	return value && value !== '–' ? value.toUpperCase() : '–';
}

function humanInterface(device) {
	const value = String(device || '').trim();
	return value && value !== '–' ? value.toUpperCase() : '–';
}

function downloadFile(path, filename) {
	const form = E('form', {
		method: 'post',
		action: L.env.cgi_base + '/cgi-download',
		enctype: 'application/x-www-form-urlencoded'
	}, [
		E('input', { type: 'hidden', name: 'sessionid', value: L.env.sessionid }),
		E('input', { type: 'hidden', name: 'path', value: path }),
		E('input', { type: 'hidden', name: 'filename', value: filename })
	]);
	document.body.appendChild(form);
	form.submit();
	form.parentNode.removeChild(form);
}

function renderUplink(uplink, mwanStates) {
	const tracked = mwanStates[uplink.name];
	const health = tracked === 'online'
		? { className: 'fn-status-ok', label: _('Internet access') }
		: tracked === 'checking'
			? { className: 'fn-status-warn', label: _('Checking…') }
			: tracked === 'offline'
				? { className: 'fn-status-off', label: _('No Internet access') }
				: uplink.up
					? { className: 'fn-status-warn', label: _('IP address received') }
					: { className: 'fn-status-off', label: _('Disconnected') };
	return E('div', { class: 'fn-diag-uplink' }, [
		E('div', { class: 'fn-info-group-title' }, humanUplinkName(uplink.name)),
		infoRow(_('Internet status'), E('span', {
			class: 'fn-status-pill ' + health.className
		}, health.label)),
		infoRow(_('Connection type'), humanProtocol(uplink.protocol)),
		infoRow(_('Interface'), humanInterface(uplink.device)),
		infoRow(_('IP address'), uplink.addresses.join(', ')),
		infoRow(_('Gateway'), uplink.gateway),
		infoRow(_('DNS'), uplink.dns.join(', '))
	]);
}

return view.extend({
	load() {
		return Promise.all([
			ubusCall('network.interface', 'dump').catch(() => ({ interface: [] })),
			fs.exec_direct(MULTIWAN_HELPER, [ 'status' ], 'json').catch(() => null)
		]);
	},

	render(data) {
		const interfaceDump = data[0];
		const multiwanStatus = data[1];
		const mwanStates = {};
		((multiwanStatus && multiwanStatus.ok && multiwanStatus.interfaces) || []).forEach(item => {
			mwanStates[item.name] = item.state;
		});
		this.uplinks = diagnostics.summarizeInterfaces(interfaceDump);
		const defaultTarget = (this.uplinks.find(item => item.up && item.gateway) || {}).gateway || '1.1.1.1';
		const networkBody = this.uplinks.length
			? this.uplinks.map(uplink => renderUplink(uplink, mwanStates))
			: [ E('div', { class: 'fn-info-empty' }, _('No WAN interface or default route was found.')) ];
		this.bundleButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-diag-bundle-button',
			click: () => this.downloadBundle()
		}, _('Download diagnostic report'));

		this.targetInput = E('input', {
			type: 'text',
			value: defaultTarget,
			placeholder: _('Host name or IP address'),
			autocapitalize: 'none',
			autocorrect: 'off',
			spellcheck: 'false'
		});
		this.targetInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.runDiagnostic('ping');
			}
		});

		this.pingButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary',
			click: () => this.runDiagnostic('ping')
		}, _('Ping'));
		this.traceButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			click: () => this.runDiagnostic('traceroute')
		}, _('Traceroute'));
		this.resultStatus = E('span', { class: 'fn-status-pill fn-status-off' }, _('Not started'));
		this.output = E('pre', {
			class: 'fn-diag-output',
			'aria-live': 'polite'
		}, _('Run a check to see its output here.'));

		return E('div', { class: 'fn-dash fn-diag-page' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Internet diagnostics')),
					this.bundleButton
				]),
				E('div', { class: 'fn-card-body fn-info-list' }, networkBody)
			]),
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Network check')),
					this.resultStatus
				]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Check whether a host is reachable or inspect the route taken by packets.')),
					E('div', { class: 'fn-diag-controls' }, [
						E('div', { class: 'fn-kn-field' }, [
							E('label', {}, _('Target')),
							this.targetInput
						]),
						E('div', { class: 'fn-diag-actions' }, [ this.pingButton, this.traceButton ])
					]),
					this.output
				])
			])
		]);
	},

	downloadBundle() {
		this.bundleButton.disabled = true;
		return fs.exec('/usr/libexec/freenetic-diagnostics-bundle', [])
			.then(result => {
				const path = (result.stdout || '').trim();
				if (result.code !== 0 || !path) {
					notify(result.stderr || _('Failed to build the diagnostic report.'), 'danger');
					return;
				}
				downloadFile(path, 'freenetic-diagnostics.tar.gz');
			})
			.catch(error => notify(error.message || String(error), 'danger'))
			.finally(() => { this.bundleButton.disabled = false; });
	},

	runDiagnostic(operation) {
		const target = diagnostics.normalizeTarget(this.targetInput.value);
		if (!target) {
			notify(_('Enter a valid host name or IP address.'), 'warning');
			return Promise.resolve();
		}

		this.targetInput.value = target;
		this.setRunning(true);
		setContent(this.output, _('Running…'));

		return fs.exec('/usr/libexec/freenetic-diagnostics-call', [ operation, target ])
			.then(result => {
				const text = [ result.stdout, result.stderr ].filter(Boolean).join('\n').trim();
				setContent(this.output, text || _('The command produced no output.'));
				this.setResult(result.code === 0, result.code === 0 ? _('Passed') : _('Failed'));
			})
			.catch(error => {
				setContent(this.output, error.message || String(error));
				this.setResult(false, _('Failed'));
			})
			.finally(() => this.setRunning(false));
	},

	setRunning(running) {
		this.targetInput.disabled = running;
		this.pingButton.disabled = running;
		this.traceButton.disabled = running;
		if (running)
			this.setResult(false, _('Running'));
	},

	setResult(ok, label) {
		this.resultStatus.className = 'fn-status-pill ' + (ok ? 'fn-status-ok' : 'fn-status-off');
		setContent(this.resultStatus, label);
	}
});
