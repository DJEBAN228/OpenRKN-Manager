#!/bin/sh
set -e

echo "=========================================================="
echo "           УСТАНОВКА И РАЗВЕРТЫВАНИЕ OpenRKN              "
echo "              OpenWrt 25 (x86_64 / ARM)                   "
echo "=========================================================="

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)
        FLUX_BIN="openflux-linux-amd64"
        ZAPRET_DIR="x86_64"
        ;;
    aarch64|arm64)
        echo "[!] Архитектура $ARCH: экспериментальная поддержка (тестировалось на x86_64)."
        FLUX_BIN="openflux-linux-arm64"
        ZAPRET_DIR="aarch64"
        ;;
    armv7l|arm)
        echo "[!] Архитектура $ARCH: экспериментальная поддержка (тестировалось на x86_64)."
        FLUX_BIN="openflux-linux-arm"
        ZAPRET_DIR="arm"
        ;;
    *)
        echo "[!] Неизвестная архитектура: $ARCH. По умолчанию x86_64."
        FLUX_BIN="openflux-linux-amd64"
        ZAPRET_DIR="x86_64"
        ;;
esac

echo "[1/7] Установка необходимых пакетов OpenWrt..."
opkg update
opkg install rpcd ubus uci libubox jshn firewall4 kmod-nft-queue kmod-nfnetlink-queue ca-bundle curl tar gzip coreutils-od 2>/dev/null || true

echo "[2/7] Создание системного пользователя openrkn (UID 453)..."
grep -q '^openrkn:' /etc/passwd || echo 'openrkn:x:453:453:openrkn:/var/run/openrkn:/bin/false' >> /etc/passwd
grep -q '^openrkn:' /etc/group || echo 'openrkn:x:453:' >> /etc/group

echo "[3/7] Подготовка каталогов..."
mkdir -p /opt/openrkn/bin /etc/openrkn /etc/openrkn/profiles /var/run/openrkn /www/openrkn
chown -R openrkn:openrkn /var/run/openrkn /etc/openrkn/profiles 2>/dev/null || true

echo "[4/7] Загрузка бинарников openflux и zapret ($ARCH)..."
if [ ! -x /opt/openrkn/bin/openflux ]; then
    echo "  -> Скачивание openflux ($FLUX_BIN)..."
    curl -fsSL -o /opt/openrkn/bin/openflux "https://github.com/p1neappleXpress/OpenFlux/releases/download/v0.3.0/$FLUX_BIN"
    chmod 755 /opt/openrkn/bin/openflux
fi

if [ ! -x /opt/openrkn/bin/nfqws ]; then
    echo "  -> Скачивание nfqws (zapret)..."
    curl -fsSL -o /tmp/zapret.tar.gz "https://github.com/bol-van/zapret/releases/download/v72.13/zapret-v72.13.tar.gz"
    tar -xzf /tmp/zapret.tar.gz -C /tmp
    cp "/tmp/zapret-v72.13/binaries/$ZAPRET_DIR/nfqws" /opt/openrkn/bin/nfqws
    chmod 755 /opt/openrkn/bin/nfqws
    rm -rf /tmp/zapret.tar.gz /tmp/zapret-v72.13
fi

echo "[5/7] Копирование файлов пакета OpenRKN..."
SCRIPT_DIR=$(dirname "$0")
if [ -d "$SCRIPT_DIR/files" ]; then
    cp -r "$SCRIPT_DIR/files"/* /
else
    echo "  -> Скачивание дерева файлов пакета из GitHub..."
    curl -fsSL -o /tmp/openrkn-deploy.tar.gz "https://raw.githubusercontent.com/DJEBAN228/OpenRKN-Manager/main/openrkn-deploy.tar.gz"
    tar -xzf /tmp/openrkn-deploy.tar.gz -C /tmp
    cp -r /tmp/files/* /
    rm -rf /tmp/openrkn-deploy.tar.gz /tmp/files
fi

chmod 755 /etc/init.d/openrkn /usr/libexec/rpcd/openrkn /usr/libexec/openrkn/* 2>/dev/null || true

# Генерация ключа шифрования если отсутствует
if [ ! -f /etc/openrkn/secret.key ]; then
    echo "  -> Генерация ключа шифрования AES-256..."
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/openrkn/secret.key
    chmod 600 /etc/openrkn/secret.key
fi

# Дефолтный exit.conf
if [ ! -f /etc/openrkn/exit.conf ]; then
    cp /etc/openrkn/exit.conf.example /etc/openrkn/exit.conf 2>/dev/null || true
fi

echo "[6/7] Настройка uhttpd на порт 7788..."
uci -q get uhttpd.openrkn >/dev/null || {
    uci set uhttpd.openrkn=uhttpd
    uci set uhttpd.openrkn.listen_http='0.0.0.0:7788'
    uci set uhttpd.openrkn.home='/www'
    uci set uhttpd.openrkn.cgi_prefix='/cgi-bin'
    uci commit uhttpd
    /etc/init.d/uhttpd restart 2>/dev/null || true
}

echo "[7/7] Запуск служб..."
/etc/init.d/rpcd restart
fw4 reload 2>/dev/null || true
/etc/init.d/openrkn enable
/etc/init.d/openrkn restart

LAN_IP=$(uci -q get network.lan.ipaddr || echo "192.168.1.1")

echo ""
echo "=========================================================="
echo "             OpenRKN УСПЕШНО РАЗВЕРНУТ!                   "
echo "=========================================================="
echo "  Панель управления доступна по адресу:"
echo "  👉 http://$LAN_IP:7788/openrkn/"
echo "=========================================================="
