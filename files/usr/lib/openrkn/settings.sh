#!/bin/sh
or_settings() (
	read -r input
	json_load "$input" || { or_error invalid_json; return; }
	json_get_var transport transport
	json_get_var url url
	json_get_var host share_host
	json_get_var codec codec
	json_get_var encryption encryption
	json_get_var session session_mode
	json_get_var key encryption_key
	[ -n "$codec" ] || codec=batched
	[ -n "$encryption" ] || encryption=enabled
	[ -n "$session" ] || session=compatible
	case "$codec" in batched|legacy) ;; *) or_error invalid_codec; return;; esac
	case "$encryption" in enabled|disabled) ;; *) or_error invalid_encryption; return;; esac
	case "$session" in compatible|strict) ;; *) or_error invalid_session_mode; return;; esac
	if [ "$encryption" = enabled ] && [ "$codec" = legacy ]; then or_error legacy_requires_plain_profile; return; fi
	if [ "$transport" = direct ]; then
		[ "$encryption" = enabled ] && [ "$codec" = batched ] || { or_error direct_requires_encrypted_batched; return; }
		session=strict
	fi
	if [ "$encryption" = enabled ] && [ "$session" = strict ] && [ "$codec" != batched ]; then or_error strict_requires_batched; return; fi
	if [ -n "$key" ]; then
		case "$key" in *[!A-Za-z0-9_-]*) or_error invalid_encryption_key; return;; esac
		[ "${#key}" -ge 16 ] && [ "${#key}" -le 128 ] || { or_error invalid_encryption_key; return; }
		[ "$encryption" = enabled ] || { or_error key_requires_encryption; return; }
	fi
	case "$transport" in yandex|mailru|direct) ;; *) or_error unsupported_transport; return;; esac
	[ "${#url}" -le 2048 ] && [ "${#host}" -le 253 ] || { or_error invalid_transport_settings; return; }
	case "$url$host" in *"'"*|*'#'*|*';'*|*' '*|*'
'*|*"$(printf '\r')"*|*"$(printf '\t')"*) or_error invalid_transport_settings; return;; esac
	case "$transport" in
		yandex|mailru) case "$url" in https://?*) ;; *) or_error document_url_required; return;; esac;;
		direct) case "$host" in ''|*[!A-Za-z0-9.:-]*) or_error public_host_required; return;; esac;;
	esac
	or_config
	if [ "$encryption" = enabled ] && [ -z "$key" ]; then
		[ -r /etc/openrkn/secret.key ] || { or_error missing_encryption_key; return; }
		stored=$(cat /etc/openrkn/secret.key)
		[ "${#stored}" -ge 16 ] || { or_error encryption_key_too_short; return; }
	fi
	# Config path is administrator-controlled UCI, never an RPC parameter.
	stage=$(mktemp /etc/openrkn/.exit.XXXXXX) || { or_error config_failed; return; }
	key_stage=
	trap 'rm -f "$stage"; [ -z "$key_stage" ] || rm -f "$key_stage"' 0
	{
		printf '[Interface]\nRole = exit\nMode = l4\nCodec = %s\nCookieStore = /var/run/openrkn/cookies.json\n' "$codec"
		[ "$encryption" != enabled ] || printf 'EncryptionKeyFile = /etc/openrkn/secret.key\nSessionContext = openrkn-v1\n'
		if [ "$transport" != direct ] && { [ "$encryption" = disabled ] || [ "$session" = compatible ]; }; then
			printf 'Transport = %s\nURL = %s\n' "$transport" "$url"
		else
		printf '\n[Transport %s]\nType = %s\nPriority = 100\n' "$transport" "$transport"
		case "$transport" in direct) printf 'Listen = 0.0.0.0:8443\n';; *) [ -z "$url" ] || printf 'URL = %s\n' "$url";; esac
		fi
		:
	} > "$stage" || { or_error config_failed; return; }
	chown root:openrkn "$stage" && chmod 640 "$stage" || { or_error config_failed; return; }
	if [ -n "$key" ]; then
		key_stage=$(mktemp /etc/openrkn/.key.XXXXXX) || { or_error config_failed; return; }
		printf '%s\n' "$key" > "$key_stage" && chown root:openrkn "$key_stage" && chmod 640 "$key_stage" && mv -f "$key_stage" /etc/openrkn/secret.key || { or_error config_failed; return; }
	fi
	mv -f "$stage" "$OR_CONF" || { or_error config_failed; return; }
	uci -q set "openrkn.main.transport=$transport" &&
	uci -q set "openrkn.main.url=$url" &&
	uci -q set "openrkn.main.share_host=$host" &&
	uci -q set "openrkn.main.codec=$codec" &&
	uci -q set "openrkn.main.encryption=$encryption" &&
	uci -q set "openrkn.main.session_mode=$session" &&
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
	json_add_string codec "$OR_CODEC"
	json_add_string encryption "$OR_ENCRYPTION"
	json_add_string session_mode "$OR_SESSION"
	json_add_string dpi_mode external
	json_dump
)
