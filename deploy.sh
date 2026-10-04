#!/bin/sh
# OpenWrt x86_64 installer. All temporary files belong to this invocation.
set -eu
umask 077
[ "$(id -u)" = 0 ] || { echo 'Запустите установщик от root.' >&2; exit 1; }
[ -f /etc/openwrt_release ] && [ -x /sbin/uci ] || { echo 'Нужен OpenWrt с procd и firewall4.' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'Эта сборка предназначена для OpenWrt x86_64.' >&2; exit 1; }
work=$(mktemp -d /tmp/openrkn-install.XXXXXX)
trap 'rm -rf "$work"' 0
trap 'exit 1' INT TERM
fetch() {
    if command -v curl >/dev/null 2>&1; then curl -fSL --connect-timeout 15 --max-time 180 --retry 2 -o "$2" "$1"
    elif command -v uclient-fetch >/dev/null 2>&1; then uclient-fetch -O "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
    else echo 'Нет curl, uclient-fetch или wget.' >&2; return 1
    fi
}
check_sha() { printf '%s  %s\n' "$1" "$2" | sha256sum -c -; }
echo '[1/6] Зависимости OpenWrt'
packages='rpcd ubus uci libubox jshn uhttpd uhttpd-mod-ubus firewall4 kmod-nft-queue kmod-nfnetlink-queue ca-bundle'
if command -v apk >/dev/null 2>&1; then apk update; apk add $packages
elif command -v opkg >/dev/null 2>&1; then opkg update; opkg install $packages
else echo 'Нет apk / opkg.' >&2; exit 1
fi
for tool in ubus uci fw4 nft jshn sha256sum; do command -v "$tool" >/dev/null 2>&1 || { echo "Не установлен $tool" >&2; exit 1; }; done

echo '[2/6] Системный пользователь'
if ! grep -q '^openrkn:' /etc/group; then
    ! awk -F: '$3==453 {found=1} END {exit !found}' /etc/group || { echo 'GID 453 уже занят.' >&2; exit 1; }
    printf 'openrkn:x:453:\n' >> /etc/group
fi
if ! id openrkn >/dev/null 2>&1; then
    ! awk -F: '$3==453 {found=1} END {exit !found}' /etc/passwd || { echo 'UID 453 уже занят.' >&2; exit 1; }
    printf 'openrkn:x:453:453:OpenRKN:/var/run/openrkn:/bin/false\n' >> /etc/passwd
fi
[ "$(id -u openrkn)" = 453 ] && [ "$(id -g openrkn)" = 453 ] || { echo 'openrkn должен иметь UID/GID 453.' >&2; exit 1; }

echo '[3/6] Официальные бинарники (с проверкой SHA256)'
fetch 'https://github.com/p1neappleXpress/OpenFlux/releases/download/v0.3.0/openflux-linux-amd64' "$work/openflux"
check_sha fdc30ccd12f65bc88db080da600a5fb2e5bbb22fe886648b67583ed77282c622 "$work/openflux"
fetch 'https://github.com/bol-van/zapret/releases/download/v72.13/zapret-v72.13.tar.gz' "$work/zapret.tar.gz"
check_sha 25c74e6c5f48963fa244c2955e76694a07c39447245a0457e2efdc74b3317e68 "$work/zapret.tar.gz"
tar -xzf "$work/zapret.tar.gz" -C "$work"
[ -f "$work/zapret-v72.13/binaries/linux-x86_64/nfqws" ] || { echo 'В архиве отсутствует nfqws x86_64.' >&2; exit 1; }
chmod 755 "$work/openflux"
# This is an offline parser probe, not a second exit node.
printf 'not-a-link\n' | "$work/openflux" --parse-link - > "$work/parser.json" 2>/dev/null || :
grep -q '"code"' "$work/parser.json" || { echo 'Бинарник OpenFlux не запускается / отсутствует --parse-link.' >&2; exit 1; }

echo '[4/6] Установка бэкенда и оболочки'
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$script_dir/files/www/openrkn/app.js" ]; then source_dir=$script_dir
else
    fetch 'https://github.com/DJEBAN228/OpenRKN-Manager/archive/refs/heads/main.tar.gz' "$work/source.tar.gz"
    tar -xzf "$work/source.tar.gz" -C "$work"
    source_dir="$work/OpenRKN-Manager-main"
fi
[ -f "$source_dir/files/www/openrkn/app.js" ] || { echo 'Неполное дерево файлов OpenRKN.' >&2; exit 1; }
[ ! -x /etc/init.d/openrkn ] || /etc/init.d/openrkn stop
[ ! -f /etc/config/openrkn ] || cp /etc/config/openrkn "$work/config.saved"
mkdir -p /opt/openrkn/bin /etc/openrkn/profiles /var/run/openrkn
cp -R "$source_dir/files/"* /
[ ! -f "$work/config.saved" ] || cp "$work/config.saved" /etc/config/openrkn
cp "$work/openflux" /opt/openrkn/bin/openflux
cp "$work/zapret-v72.13/binaries/linux-x86_64/nfqws" /opt/openrkn/bin/nfqws
chmod 755 /opt/openrkn/bin/* /etc/init.d/openrkn /usr/libexec/rpcd/openrkn /usr/libexec/openrkn/* /etc/uci-defaults/90-openrkn-uhttpd
if [ ! -s /etc/openrkn/secret.key ]; then
    if command -v od >/dev/null 2>&1; then head -c 32 /dev/urandom | od -An -v -tx1 | tr -d ' \n' > /etc/openrkn/secret.key
    else head -c 32 /dev/urandom | hexdump -v -e '1/1 "%02x"' > /etc/openrkn/secret.key
    fi
    [ "$(wc -c < /etc/openrkn/secret.key)" = 64 ] || { echo 'Ошибка генерации ключа.' >&2; exit 1; }
fi
# Repair earlier empty Yandex configurations; retain an administrator's valid config.
if [ ! -s /etc/openrkn/exit.conf ] || { grep -q '^Type = yandex$' /etc/openrkn/exit.conf && ! grep -q '^URL = https://' /etc/openrkn/exit.conf; }; then
    [ ! -f /etc/openrkn/exit.conf ] || cp /etc/openrkn/exit.conf /etc/openrkn/exit.conf.previous
    cp /etc/openrkn/exit.conf.example /etc/openrkn/exit.conf
    uci set openrkn.main.transport=cupsonline
    uci set openrkn.main.url=''
fi
uci set openrkn.main.mode=hybrid
uci -q get openrkn.main.dpi_enabled >/dev/null || uci set openrkn.main.dpi_enabled=0
uci set openrkn.main.enabled=1
uci commit openrkn
chown root:openrkn /etc/openrkn /etc/openrkn/secret.key /etc/openrkn/exit.conf
chmod 750 /etc/openrkn
chmod 640 /etc/openrkn/secret.key /etc/openrkn/exit.conf
chown root:root /etc/openrkn/profiles
chmod 700 /etc/openrkn/profiles
chown openrkn:openrkn /var/run/openrkn
chmod 700 /var/run/openrkn

echo '[5/6] uhttpd /ubus и rpcd'
sh /etc/uci-defaults/90-openrkn-uhttpd
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
fw4 check

echo '[6/6] Автозапуск OpenFlux'
/etc/init.d/openrkn enable
/etc/init.d/openrkn start
lan_ip=$(uci -q get network.lan.ipaddr || :)
echo "Готово. Откройте http://${lan_ip:-192.168.1.1}:7788/openrkn/"
echo 'Войдите под root с паролем OpenWrt → OpenFlux → Получить QR-профиль.'
echo 'Ссылка появляется после создания комнат; это может занять некоторое время.'
