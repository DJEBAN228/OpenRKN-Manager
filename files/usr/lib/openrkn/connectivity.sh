#!/bin/sh
# Fixed destinations and configured transport probe, never caller-provided arguments.
or_connectivity() (
	or_config
	dir=$(mktemp -d /tmp/openrkn-probe.XXXXXX) || { or_error probe_failed; return; }
	trap 'rm -rf "$dir"' 0
	trap 'exit 1' INT TERM
	ip=0 dns=0 https=0 transport_ok=0
	transport=$(uci -q get openrkn.main.transport)
	doc_url=$(uci -q get openrkn.main.url)
	timeout 3 ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1 && ip=1
	timeout 3 nslookup example.com >/dev/null 2>&1 && dns=1
	timeout 3 wget -q -T 2 -O "$dir/page" https://example.com/ >/dev/null 2>&1 && https=1
	case "$transport" in
		mailru|yandex)
			case "$doc_url" in
				https://?*) timeout 3 wget -q -T 2 -O "$dir/doc" "$doc_url" >/dev/null 2>&1 && [ -s "$dir/doc" ] && transport_ok=1;;
			esac
			;;
		direct)
			awk '$2 ~ /:20FB$/ && $4 == "0A" {found=1} END {exit !found}' /proc/net/tcp /proc/net/tcp6 2>/dev/null && transport_ok=1
			;;
	esac
	json_init
	json_add_boolean ok 1
	json_add_string scope router
	json_add_boolean ip_ping "$ip"
	json_add_boolean dns_lookup "$dns"
	json_add_boolean https_fetch "$https"
	json_add_boolean transport_probe "$transport_ok"
	json_add_string note 'Router connectivity and transport check; does not test the phone tunnel. ICMP may be filtered.'
	json_dump
)
