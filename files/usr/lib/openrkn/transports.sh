#!/bin/sh
# Validate every configured transport before procd starts the exit node.
# "supported" permits an unfinished document configuration during installation.
or_transports_valid() {
	[ -r "$1" ] || return 1
	awk -v require_url="${2:-ready}" '
	function check() {
		if (!section) return
		count++
		if (type != "mailru" && type != "yandex" && type != "direct") bad=1
		if (require_url == "ready") {
			if ((type == "mailru" || type == "yandex") && url !~ /^https:\/\/[^[:space:]]+$/) bad=1
			if (type == "direct" && listen == "") bad=1
		}
	}
	/^[[:space:]]*\[/ {
		check(); section=($0 ~ /^[[:space:]]*\[Transport[[:space:]]/)
		type=""; url=""; listen=""; next
	}
	section && /^[[:space:]]*(Type|URL|Listen)[[:space:]]*=/ {
		key=$0; sub(/[[:space:]]*=.*/, "", key); sub(/^[[:space:]]*/, "", key)
		value=$0; sub(/^[^=]*=[[:space:]]*/, "", value)
		sub(/[[:space:]]*[#;].*$/, "", value); sub(/[[:space:]]*$/, "", value)
		if (key == "Type") type=value
		if (key == "URL") url=value
		if (key == "Listen") listen=value
	}
	END { check(); exit (bad || count == 0) }
	' "$1"
}
