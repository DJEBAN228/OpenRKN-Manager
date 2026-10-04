#!/bin/sh
or_settings() (
	read -r input
	json_load "$input" || { or_error invalid_json; return; }
	json_get_var transport transport
	json_get_var url url
	json_get_var host share_host
	json_get_var dpi dpi_enabled
	case "$transport" in cupsonline|yandex|mailru|direct) ;; *) or_error unsupported_transport; return;; esac
	case "$dpi" in 0|1) ;; *) or_error invalid_dpi_enabled; return;; esac
	[ "${#url}" -le 2048 ] && [ "${#host}" -le 253 ] || { or_error invalid_transport_settings; return; }
	case "$url$host" in *"'"*|*'#'*|*';'*|*' '*|*'
'*|*"$(printf '\r')"*|*"$(printf '\t')"*) or_error invalid_transport_settings; return;; esac
	case "$transport" in
		yandex|mailru) case "$url" in https://?*) ;; *) or_error document_url_required; return;; esac;;
		cupsonline) case "$url" in ''|https://?*) ;; *) or_error invalid_document_url; return;; esac;;
		direct) case "$host" in ''|*[!A-Za-z0-9.:-]*) or_error public_host_required; return;; esac;;
	esac
	or_config
	[ -r /etc/openrkn/secret.key ] || { or_error missing_encryption_key; return; }
	# Config path is administrator-controlled UCI, never an RPC parameter.
	stage=$(mktemp /etc/openrkn/.exit.XXXXXX) || { or_error config_failed; return; }
	trap 'rm -f "$stage"' 0
	{
		printf '[Interface]\nRole = exit\nMode = l4\nEncryptionKeyFile = /etc/openrkn/secret.key\nSessionContext = openrkn-v1\nCookieStore = /var/run/openrkn/cookies.json\n'
		printf '\n[Transport %s]\nType = %s\nPriority = 100\n' "$transport" "$transport"
		case "$transport" in direct) printf 'Listen = 0.0.0.0:8443\n';; *) [ -z "$url" ] || printf 'URL = %s\n' "$url";; esac
		:
	} > "$stage" || { or_error config_failed; return; }
	chown root:openrkn "$stage" && chmod 640 "$stage" && mv -f "$stage" "$OR_CONF" || { or_error config_failed; return; }
	uci -q set "openrkn.main.transport=$transport" &&
	uci -q set "openrkn.main.url=$url" &&
	uci -q set "openrkn.main.share_host=$host" &&
	uci -q set "openrkn.main.dpi_enabled=$dpi" &&
	uci -q set openrkn.main.mode=hybrid &&
	uci -q commit openrkn || { or_error config_failed; return; }
	if [ -f "$OR_RUN/desired" ]; then
		/etc/init.d/openrkn restart >/dev/null 2>&1 || { or_error service_action_failed; return; }
	fi
	json_init
	json_add_boolean ok 1
	json_add_string state saved
	json_dump
)

or_get_settings() (
	or_config
	json_init
	json_add_boolean ok 1
	json_add_string transport "$(uci -q get openrkn.main.transport)"
	json_add_string url "$(uci -q get openrkn.main.url)"
	json_add_string share_host "$OR_SHARE_HOST"
	json_add_boolean dpi_enabled "$OR_DPI_ENABLED"
	json_dump
)
