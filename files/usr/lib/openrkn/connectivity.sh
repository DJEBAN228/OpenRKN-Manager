#!/bin/sh
# Fixed destinations, bounded probes, never a caller-provided command or URL.
or_connectivity() (
	dir=$(mktemp -d /tmp/openrkn-probe.XXXXXX) || { or_error probe_failed; return; }
	trap 'rm -rf "$dir"' 0
	trap 'exit 1' INT TERM
	ip=0 dns=0 https=0
	timeout 3 ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1 && ip=1
	timeout 3 nslookup example.com >/dev/null 2>&1 && dns=1
	timeout 3 wget -q -T 2 -O "$dir/page" https://example.com/ >/dev/null 2>&1 && https=1
	json_init
	json_add_boolean ok 1
	json_add_string scope router
	json_add_boolean ip_ping "$ip"
	json_add_boolean dns_lookup "$dns"
	json_add_boolean https_fetch "$https"
	json_add_string note 'Router connectivity only; does not test the phone tunnel. ICMP may be filtered.'
	json_dump
)
