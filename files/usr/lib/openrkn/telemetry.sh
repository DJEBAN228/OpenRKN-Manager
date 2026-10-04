#!/bin/sh
# Append actual device data to the current jshn object. No invented interfaces.
or_net_value() (
	json_load "$1" || return 1
	case "$2" in
		device)
			json_get_var value l3_device
			[ -n "$value" ] || json_get_var value device
			case "$value" in ''|*[!A-Za-z0-9_.:-]*) return 1;; esac
			printf '%s' "$value";;
		up) json_get_var value up; printf '%s' "$value";;
		ip)
			json_select ipv4-address && json_select 1 || return 1
			json_get_var value address
			printf '%s' "$value";;
	esac
)

or_net_counters() {
	for sys_path in /sys/class/net/*; do
		[ -d "$sys_path" ] || continue
		[ "${sys_path##*/}" != lo ] || continue
		sys_rx=$(cat "$sys_path/statistics/rx_bytes" 2>/dev/null)
		sys_tx=$(cat "$sys_path/statistics/tx_bytes" 2>/dev/null)
		printf '%s %s %s\n' "${sys_path##*/}" "${sys_rx:-0}" "${sys_tx:-0}"
	done
}

or_telemetry() {
	sys_cpu_before=$(awk '/^cpu/ {print $1,$2+$3+$4+$5+$6+$7+$8+$9,$5+$6}' /proc/stat)
	sys_net_before=$(or_net_counters)
	sys_time_before=$(awk '{print $1}' /proc/uptime)
	sleep 1
	sys_cpu_after=$(awk '/^cpu/ {print $1,$2+$3+$4+$5+$6+$7+$8+$9,$5+$6}' /proc/stat)
	sys_net_after=$(or_net_counters)
	sys_time_after=$(awk '{print $1}' /proc/uptime)
	sys_cpu=$(printf '%s\n--\n%s\n' "$sys_cpu_before" "$sys_cpu_after" | awk '
		$1=="--" {after=1;next}
		!after {t[$1]=$2;i[$1]=$3;next}
		{d=$2-t[$1];p=d>0 ? 100*(d-($3-i[$1]))/d : 0;
		 if(p<0)p=0;if(p>100)p=100;printf "%s %.0f\n",$1,p}')
	sys_ram=$(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {print t+0,a+0,t-a}' /proc/meminfo)
	set -- $sys_ram
	sys_tot=${1:-0} sys_available=${2:-0} sys_used=${3:-0}
	sys_wan=$(ubus -t 2 call network.interface.wan status '{}' 2>/dev/null)
	sys_lan=$(ubus -t 2 call network.interface.lan status '{}' 2>/dev/null)
	sys_wan_dev=$(or_net_value "$sys_wan" device)
	sys_lan_dev=$(or_net_value "$sys_lan" device)
	sys_wan_ip=$(or_net_value "$sys_wan" ip)
	sys_lan_ip=$(or_net_value "$sys_lan" ip)
	sys_wan_up=$(or_net_value "$sys_wan" up)
	json_add_string board "$(cat /tmp/sysinfo/board_name 2>/dev/null)"
	json_add_string model "$(cat /tmp/sysinfo/model 2>/dev/null)"
	json_add_string release "$( [ ! -r /etc/openwrt_release ] || { . /etc/openwrt_release; printf '%s' "$DISTRIB_DESCRIPTION"; } )"
	json_add_string kernel "$(uname -r)"
	json_add_int uptime "$(awk '{print int($1)}' /proc/uptime)"
	json_add_array load
	for sys_load in $(awk '{print $1,$2,$3}' /proc/loadavg); do json_add_double '' "$sys_load"; done
	json_close_array
	json_add_object cpu
	json_add_int total "$(printf '%s\n' "$sys_cpu" | awk '$1=="cpu" {print $2}')"
	json_add_int usage_percent "$(printf '%s\n' "$sys_cpu" | awk '$1=="cpu" {print $2}')"
	json_add_int sample_seconds 1
	json_add_array cores
	for sys_core in $(printf '%s\n' "$sys_cpu" | awk '$1!="cpu" {print $2}'); do json_add_int '' "$sys_core"; done
	json_close_array
	json_close_object
	json_add_object ram
	json_add_int total_kib "$sys_tot"
	json_add_int available_kib "$sys_available"
	json_add_int used_kib "$sys_used"
	json_close_object
	json_add_object mem
	json_add_int total "$((sys_tot * 1024))"
	json_add_int free "$((sys_available * 1024))"
	json_close_object
	json_add_object wan
	json_add_boolean up "${sys_wan_up:-0}"
	json_add_string ip "$sys_wan_ip"
	json_add_string device "$sys_wan_dev"
	json_close_object
	json_add_object ports
	for sys_port in $(printf '%s\n' "$sys_net_after" | awk '{print $1}'); do
		sys_path="/sys/class/net/$sys_port"
		sys_role=interface sys_ip=
		[ "$sys_port" != "$sys_lan_dev" ] || { sys_role=LAN; sys_ip=$sys_lan_ip; }
		[ "$sys_port" != "$sys_wan_dev" ] || { sys_role=WAN; sys_ip=$sys_wan_ip; }
		sys_counters=$(printf '%s\n--\n%s\n' "$sys_net_before" "$sys_net_after" | awk -v dev="$sys_port" -v a="$sys_time_before" -v b="$sys_time_after" '
			$1=="--" {after=1;next} $1!=dev {next}
			!after {rx=$2;tx=$3;seen=1;next}
			{d=b-a;r=seen&&d>0&&$2>=rx ? ($2-rx)/d : 0;t=seen&&d>0&&$3>=tx ? ($3-tx)/d : 0;
			 printf "%.0f %.0f %.0f %.0f",$2,$3,r,t}')
		set -- $sys_counters
		json_add_object "$sys_port"
		json_add_string role "$sys_role"
		json_add_string ip "$sys_ip"
		json_add_boolean up "$([ "$(cat "$sys_path/carrier" 2>/dev/null)" = 1 ] && echo 1 || echo 0)"
		sys_speed=$(cat "$sys_path/speed" 2>/dev/null)
		case "$sys_speed" in ''|*[!0-9]*) json_add_null speed;; *) json_add_int speed "$sys_speed";; esac
		json_add_string duplex "$(cat "$sys_path/duplex" 2>/dev/null)"
		json_add_int rx_bytes "${1:-0}"
		json_add_int tx_bytes "${2:-0}"
		json_add_int rx_bps "${3:-0}"
		json_add_int tx_bps "${4:-0}"
		json_close_object
	done
	json_close_object
}
