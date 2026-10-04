# OpenRKN backend для OpenWrt 25.x / x86_64

`files/` — готовое дерево rootfs. Рабочий код: POSIX sh, совместимый с
BusyBox ash, стандартные апплеты BusyBox и штатные API OpenWrt. Bash и GNU
утилиты на роутере не нужны. Бинарники OpenFlux и **nfqws из zapret v1**
поставляются отдельно: `/opt/openrkn/bin/openflux` и `/opt/openrkn/bin/nfqws`.
nfqws2 имеет другой интерфейс и сюда не подходит.

## Установка

Рекомендуется сборка пакета через OpenWrt SDK: поместить этот каталог в
`package/openrkn`, выполнить `make package/openrkn/compile V=s`, установить
полученный пакет. Makefile устанавливает зависимости и пользователя
`openrkn` с UID/GID **453**. Сначала убедиться, что этот UID свободен.

При ручной установке скопировать `files/` в `/`, создать пользователя и группу
openrkn с UID/GID 453, установить зависимости из Makefile и выставить 0755 для
`/etc/init.d/openrkn`, `/usr/libexec/rpcd/openrkn`, `/usr/libexec/openrkn/*`.
Файлы должны иметь окончания строк LF. `rpcd` должен поддерживать exec plugins.

Подготовить настройки transport, ключ и читаемые пользователем openrkn файлы:

```sh
mkdir -p /etc/openrkn
cp /etc/openrkn/exit.conf.example /etc/openrkn/exit.conf
umask 077
head -c 32 /dev/urandom | hexdump -v -e '1/1 "%02x"' > /etc/openrkn/secret.key
chown root:openrkn /etc/openrkn /etc/openrkn/exit.conf /etc/openrkn/secret.key
chmod 750 /etc/openrkn
chmod 640 /etc/openrkn/exit.conf /etc/openrkn/secret.key
uci set openrkn.main.share_host='exit.example.org'
uci commit openrkn
fw4 check
/etc/init.d/rpcd restart
/etc/init.d/openrkn enable
/etc/init.d/openrkn start
```

Пример использует direct TCP transport на 8443. Указать реальный публичный
адрес в `share_host`; разрешить вход на этот порт из нужной firewall zone и
при необходимости настроить NAT на внешнем роутере. Правило входа зависит от
топологии и автоматически не добавляется. Для document transport заменить
секцию `[Transport direct]` на соответствующий транспорт с настоящим URL.
Ключ, `SessionContext` и transport должны соответствовать клиентам.
Ядро принудительно задаёт `--role=exit --mode=l4 --negotiate --share`;
поддерживаются зашифрованные negotiated sessions, требуется ключ OpenFlux.
Конфигурация CookieStore в примере использует tmpfs; cookies не переживают reboot.

## RPC

```sh
ubus -v list openrkn
ubus call openrkn status '{}'
ubus call openrkn start_service '{}'
ubus call openrkn get_logs '{"lines":100}'
ubus call openrkn gen_mobile_profile '{}'
ubus call openrkn stop_service '{}'
```

`status`: desired, processes.openflux/nfqws (running, pid, rss_kib), watchdog,
CPU всей системы за 1 секунду, RAM в KiB, наличие цепочки NFQUEUE.
Состояние процесса означает живость executable, а не доступность transport.
`start_service`/`stop_service` возвращают принятую команду и переходное состояние;
итог проверяется через status. Автозапуск и UCI enabled меняются администратором.
Ошибки приложения возвращаются JSON `{"ok":false,"error":"..."}`.
`get_logs`: 1–1000 строк, по умолчанию 100; ответ ограничен последними 64 KiB.

`gen_mobile_profile` работает с запущенным сервисом, ждёт ссылку до 5 секунд
(UCI profile_timeout: 1–10). **`--share` запускает exit и не завершается после
печати ссылки**: его выполняет единственный экземпляр под procd. Collector
перехватывает ссылку из stdout/stderr и обновляет её при изменении комнат.
RPC декодирует её штатным `openflux --parse-link -`, а не самодельным base64
декодером. Нужна версия OpenFlux с этим JSON интерфейсом.

Результат: `link`, `path`, `config`. На диске создаётся приватный каталог
`/etc/openrkn/profiles/mobile.XXXXXX` с `mobile.conf`, `secret.key`, `share.link`;
права каталога 0700, файлов 0600. Для мобильного приложения импортировать
`link`. При переносе `.conf` для CLI скопировать также ключ и поправить
EncryptionKeyFile на путь устройства. Экспорты содержат секреты; удалять
ненужные каталоги вручную, чтобы не заполнять flash. Значения с переводами
строки, `#`, `;` и крайними пробелами отклоняются: текущий INI-парсер OpenFlux
не может сохранить их без искажений. Указать SessionContext без этих символов.

ACL разделён на `openrkn-read` и `openrkn-admin`. Сам файл ACL не назначает права
всем веб-пользователям: добавить соответствующие группы в `list read`/`list write`
нужной login-секции `/etc/config/rpcd`. Административной группе нужны оба списка;
читателю — только read openrkn-read. Не предоставлять export неавторизованным
сессиям: ссылка содержит ключ. После изменений перезапустить rpcd.

## NFQUEUE и watchdog

`/usr/share/nftables.d/table-post/90-openrkn.nft` включается внутрь `table inet fw4`
атомарно при start/reload firewall. Цепочка `openrkn_output` с hook output
на приоритете `mangle + 1` обрабатывает IPv4/IPv6 сокеты UID 453:
TCP 80/443 и UDP 443 → очередь 200. Это включает исходящие соединения L4 exit
и его transport на этих портах; отделить их одним UID без модификации OpenFlux
нельзя. Forwarded LAN-трафик и остальные UID не затрагиваются. Правило
остаётся после stop; без слушателя `queue ... bypass` пропускает пакеты.
`firewall.@defaults[0].auto_includes` должен быть включён.

Loopback, локальные назначения и mark-бит 0x40000000 исключаются; nfqws
использует тот же `--dpi-desync-fwmark`. Очередь 200, mark и UID 453 должны быть
свободны от конфликтов. Изменять их одновременно в init, nft include и USERID.
Desync: TCP fake,multisplit / split-pos=1 / fooling=badseq, UDP443 fake/repeats=6.
Это исходная стратегия; её эффективность зависит от сети и проверяется на месте.
Нужны модули kmod-nft-queue и kmod-nfnetlink-queue.

procd отдельно supervises nfqws, openflux и watchdog; respawn без ограничения
числа попыток с задержкой 5 секунд. Wrapper передаёт TERM дочерним процессам
и ограничивает их shutdown. Watchdog каждые 60 секунд проверяет реальный PID,
executable и zombie-state; для мёртвого daemon сигнализирует только его
procd instance, после чего procd делает respawn. При явном stop desired
снимается, поэтому watchdog не возобновляет сервис. Речь о проверке живости,
не о сетевой проверке зависшего, но существующего процесса.

Журнал `/tmp/openrkn.log` — tmpfs, 0600, строки share и QR исключены. Watchdog
при превышении 1 MiB оставляет последние 1000 строк, сохраняя inode.
Лимит проверяется раз в минуту, не является жёсткой квотой. При одновременной
записи и усечении небольшой фрагмент журнала может потеряться.

## Проверки

`node tests/host.cjs` проверяет POSIX-синтаксис через dash, декларацию RPC,
валидацию limits/injection, экранирование logs и экспорт профиля на фикстурах.
На Windows передать DASH_PATH к установленному dash.exe.
Это mock-тесты; они не заменяют запуск на OpenWrt:

```sh
fw4 check
nft list chain inet fw4 openrkn_output
ubus call openrkn status '{}'
ubus call openrkn gen_mobile_profile '{}'
# После тестового завершения PID из status: procd должен восстановить daemon.
# После firewall reload: правило должно остаться, дубликатов быть не должно.
# После stop: все три procd instances должны остановиться.
```

Первичные источники интерфейсов:
[rpcd exec plugins](https://openwrt.org/docs/techref/rpcd),
[fw4 include positions](https://github.com/openwrt/firewall4/blob/master/root/usr/share/nftables.d/README),
[OpenFlux CLI](https://github.com/p1neappleXpress/OpenFlux/blob/main/main.go),
[OpenFlux share](https://github.com/p1neappleXpress/OpenFlux/blob/main/share_cli.go),
[nfqws options](https://github.com/bol-van/zapret/blob/master/docs/readme.en.md).
