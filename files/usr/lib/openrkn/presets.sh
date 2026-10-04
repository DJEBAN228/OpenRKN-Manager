#!/bin/sh
# Strategies are fixed argv, never arbitrary options from a web request.
or_preset_valid() {
	case "$1" in general|youtube|youtube4k|discord|discord-voice) return 0;; *) return 1;; esac
}
or_preset_args() {
	case "$1" in
		youtube|youtube4k)
			printf '%s' '--filter-tcp=80,443 --dpi-desync=fake,multisplit --dpi-desync-split-pos=2 --dpi-desync-fooling=md5sig --new --filter-udp=443 --dpi-desync=fake --dpi-desync-repeats=6';;
		discord|discord-voice)
			printf '%s' '--filter-tcp=80,443 --dpi-desync=fake,multisplit --dpi-desync-split-pos=1 --dpi-desync-fooling=badseq --new --filter-udp=443,50000-50100 --dpi-desync=fake --dpi-desync-repeats=6';;
		general)
			printf '%s' '--filter-tcp=80,443 --dpi-desync=fake,multisplit --dpi-desync-split-pos=1 --dpi-desync-fooling=badseq --new --filter-udp=443 --dpi-desync=fake --dpi-desync-repeats=6';;
		*) return 1;;
	esac
}
