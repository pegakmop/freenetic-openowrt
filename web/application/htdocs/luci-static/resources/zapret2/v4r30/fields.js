'use strict';
'require baseclass';

/* User-facing labels for the structured nfqws2 step fields. */

function parameterLabel(name) {
	var labels = {
		value: _('Payload values'),
		range: _('Range expression'),
		direction: _('Direction'),
		delay: _('Delay (milliseconds)'),
		repeats: _('Repeats'),
		spell: _('HTTP Host spelling'),
		size: _('Window size'),
		scale: _('Window scale'),
		forced_cutoff: _('Forced cutoff payloads'),
		blob: _('Blob or clone ID'),
		fallback: _('Clone fallback blob'),
		sni_del_ext: _('Delete the SNI extension'),
		sni_del: _('Delete existing SNI names'),
		sni_first: _('Insert the SNI name first'),
		sni_last: _('Append the SNI name last'),
		optional: _('Skip if optional data is unavailable'),
		nodrop: _('Keep the original packet'),
		nofake1: _('Skip fake packet 1'),
		nofake2: _('Skip fake packet 2'),
		nofake3: _('Skip fake packet 3'),
		nofake4: _('Skip fake packet 4'),
		rstack: _('Send RST with ACK'),
		sni_snt: _('Existing SNI name type'),
		sni_snt_new: _('New SNI name type'),
		tls_mod: _('TLS modifications'),
		tls_sni: _('TLS SNI hostname'),
		position: _('Position expression'),
		host: _('Host template'),
		disorder_after: _('Disorder-after position'),
		seqovl_pattern: _('Sequence overlap pattern'),
		pattern: _('Fake packet pattern'),
		seqovl: _('Sequence overlap'),
		byte: _('OOB byte'),
		urp: _('OOB urgent pointer'),
		increment: _('UDP length increment'),
		min: _('Minimum UDP length'),
		max: _('Maximum UDP length'),
		pattern_offset: _('Pattern offset'),
		dn: _('DHT directory number'),
		mode: _('SYN/ACK split mode'),
		ip_ttl: _('IPv4 TTL'),
		ip6_ttl: _('IPv6 Hop Limit'),
		ip_autottl: _('IPv4 automatic TTL'),
		ip6_autottl: _('IPv6 automatic Hop Limit'),
		tcp_seq: _('TCP sequence offset'),
		tcp_ack: _('TCP acknowledgement offset'),
		tcp_ts: _('TCP timestamp offset'),
		tcp_ts_up: _('Move TCP timestamp first'),
		tcp_nop_del: _('Remove TCP NOP options'),
		badsum: _('Corrupt the transport checksum'),
		tcp_md5: _('Add a TCP MD5 option'),
		ip_id: _('IPv4 IP ID policy'),
		ip_id_conn: _('Keep IP ID sequence between packets'),
		ipfrag: _('Enable IP fragmentation'),
		ipfrag_disorder: _('Reverse fragment order'),
		ipfrag_next: _('Next-header value'),
		ipfrag_pos_tcp: _('TCP fragment position'),
		ipfrag_pos_udp: _('UDP fragment position'),
		ipfrag_pos_icmp: _('ICMP fragment position'),
		ipfrag_pos: _('IP fragment position'),
	};

	return labels[name] || name;
}

function parameterColumns() {
	var listFields = { value: true, forced_cutoff: true, tls_mod: true };
	var flagFields = {
		sni_del_ext: true, sni_del: true, sni_first: true, sni_last: true,
		optional: true, nodrop: true, nofake1: true, nofake2: true,
		nofake3: true, nofake4: true, rstack: true, tcp_ts_up: true,
		tcp_nop_del: true, badsum: true, tcp_md5: true, ip_id_conn: true,
		ipfrag: true, ipfrag_disorder: true,
	};
	var names = [
		'value', 'range', 'direction', 'delay', 'repeats', 'spell', 'size', 'scale',
		'forced_cutoff', 'blob', 'fallback', 'sni_del_ext', 'sni_del', 'sni_first',
		'sni_last', 'optional', 'nodrop', 'nofake1', 'nofake2', 'nofake3', 'nofake4',
		'rstack', 'sni_snt', 'sni_snt_new', 'tls_mod', 'tls_sni', 'position', 'host',
		'disorder_after', 'seqovl_pattern', 'pattern', 'seqovl', 'byte', 'urp',
		'increment', 'min', 'max', 'pattern_offset', 'dn', 'mode', 'ip_ttl', 'ip6_ttl',
		'ip_autottl', 'ip6_autottl', 'tcp_seq', 'tcp_ack', 'tcp_ts', 'tcp_ts_up',
		'tcp_nop_del', 'badsum', 'tcp_md5', 'ip_id', 'ip_id_conn', 'ipfrag',
		'ipfrag_disorder', 'ipfrag_next', 'ipfrag_pos_tcp', 'ipfrag_pos_udp',
		'ipfrag_pos_icmp', 'ipfrag_pos',
	];

	return names.map(function (name) {
		return [name, parameterLabel(name), listFields[name] ? 'list' : flagFields[name] ? 'flag' : null];
	});
}

return baseclass.extend({
	label: parameterLabel,
	columns: parameterColumns,
});
