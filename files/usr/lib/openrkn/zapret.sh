#!/bin/sh
# Read-only integration with the router's Zapret. Never start/stop its daemons
# or source its configuration: these belong to Zapret-Manager.
or_zapret_probe() {
	ZP_INSTALLED=0 ZP_RUNNING=0 ZP_CONFIGURED=0 ZP_RULES=0 ZP_FILTERED=0
	[ ! -x /etc/init.d/zapret ] || ZP_INSTALLED=1
	for exe in /proc/[0-9]*/exe; do
		binary=$(readlink "$exe" 2>/dev/null) || continue
		case "$binary" in */nfqws) ;; *) continue;; esac
		cmd=$(tr '\000' '\n' < "${exe%/exe}/cmdline" 2>/dev/null | head -n 1)
		case "$cmd" in /opt/zapret/*) ZP_RUNNING=1; break;; esac
	done
	opt=$(uci -q get zapret.config.NFQWS_OPT 2>/dev/null)
	if [ "$(uci -q get zapret.config.NFQWS_ENABLE 2>/dev/null)" = 1 ]; then
		case "$opt" in *--dpi-desync=*) ZP_CONFIGURED=1;; esac
	fi
	rules=$(nft list table inet zapret 2>/dev/null)
	if printf '%s\n' "$rules" | grep -q 'hook postrouting' && printf '%s\n' "$rules" | grep -q 'queue num'; then
		ZP_RULES=1
	fi
	filter=$(uci -q get zapret.config.FILTER_MARK 2>/dev/null | tr -d ' \t\r\n')
	[ -z "$filter" ] || ZP_FILTERED=1
	[ "$(uci -q get zapret.config.WS_USER 2>/dev/null)" != openrkn ] || ZP_FILTERED=1
	ZP_STATE=detected
	if [ "$ZP_INSTALLED" = 0 ]; then ZP_STATE=not_installed
	elif [ "$ZP_RUNNING" = 0 ]; then ZP_STATE=not_running
	elif [ "$ZP_CONFIGURED" = 0 ]; then ZP_STATE=not_configured
	elif [ "$ZP_RULES" = 0 ]; then ZP_STATE=rules_missing
	elif [ "$ZP_FILTERED" = 1 ]; then ZP_STATE=check_filters
	fi
}
or_zapret_json() {
	json_add_object zapret
	json_add_string mode external
	json_add_string state "$ZP_STATE"
	json_add_boolean installed "$ZP_INSTALLED"
	json_add_boolean running "$ZP_RUNNING"
	json_add_boolean configured "$ZP_CONFIGURED"
	json_add_boolean postrouting_rules "$ZP_RULES"
	json_add_boolean filters_require_check "$ZP_FILTERED"
	json_add_string manager_url 'https://github.com/StressOzz/Zapret-Manager'
	json_close_object
}
