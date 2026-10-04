#!/bin/sh
# Only OpenWrt APIs and POSIX shell syntax. No evaluation of RPC input.
. /lib/functions.sh
. /usr/share/libubox/jshn.sh

OR_RUN=/var/run/openrkn
OR_LOG=/tmp/openrkn.log
OR_FLUX=/opt/openrkn/bin/openflux
OR_NFQ=/opt/openrkn/bin/nfqws

or_config() {
	config_load openrkn
	config_get_bool OR_ENABLED main enabled 1
	config_get OR_MODE main mode 'hybrid'
	config_get OR_STRATEGY main strategy 'general'
	config_get_bool OR_DPI_ENABLED main dpi_enabled 0
	config_get OR_CONF main openflux_config /etc/openrkn/exit.conf
	config_get OR_SHARE_HOST main share_host ''
	config_get OR_PROFILE_TIMEOUT main profile_timeout 5
	case "$OR_PROFILE_TIMEOUT" in ''|*[!0-9]*) OR_PROFILE_TIMEOUT=5;; esac
	[ "${#OR_PROFILE_TIMEOUT}" -le 2 ] || OR_PROFILE_TIMEOUT=5
	[ "$OR_PROFILE_TIMEOUT" -ge 1 ] && [ "$OR_PROFILE_TIMEOUT" -le 10 ] || OR_PROFILE_TIMEOUT=5
}

or_error() {
	json_init
	json_add_boolean ok 0
	json_add_string error "$1"
	json_dump
}

or_log() {
	printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$OR_LOG"
}

# Verify the actual executable and reject stale/reused PID files and zombies.
or_pid() (
	name="$1" binary="$2"
	[ -r "$OR_RUN/$name.pid" ] || return 1
	read -r pid < "$OR_RUN/$name.pid"
	case "$pid" in ''|*[!0-9]*) return 1;; esac
	[ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$(readlink -f "$binary" 2>/dev/null)" ] || return 1
	state=$(awk '/^State:/ {print $2}' "/proc/$pid/status" 2>/dev/null)
	[ "$state" != Z ] && kill -0 "$pid" 2>/dev/null || return 1
	printf '%s\n' "$pid"
)

or_service_json() {
	ubus -t 3 call service list '{"name":"openrkn"}' 2>/dev/null
}

or_instance_running() (
	data="$1" name="$2"
	json_load "$data" || return 1
	json_select openrkn && json_select instances && json_select "$name" || return 1
	json_get_var running running
	json_get_var pid pid
	[ "$running" = 1 ] && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
)
