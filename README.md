# OpenRKN Manager

OpenFlux exit node в режиме L4 для **OpenWrt 25 / x86_64**, с веб-оболочкой OpenRKN. Бэкенд написан на POSIX sh для BusyBox ash; процессы запускает procd, команды интерфейса проходят через авторизованный rpcd / ubus.

## Установка

Подключитесь к роутеру по SSH как root. Роутеру нужен доступ в интернет и доступные пакеты для его версии ядра.

```sh
wget -O /tmp/openrkn-install.sh https://raw.githubusercontent.com/DJEBAN228/OpenRKN-Manager/main/deploy.sh
sh /tmp/openrkn-install.sh
```

Установщик поддерживает apk и opkg, устанавливает зависимости и официальные OpenFlux **v0.3.0** / nfqws из zapret **v72.13** с проверкой SHA256. ARM, Debian и другие платформы этим установщиком не поддерживаются.

Откройте **http://192.168.1.1:7788/openrkn/** (замените IP на адрес LAN роутера). Вход — существующие логин и пароль OpenWrt, обычно root. Установщик не меняет пароль и не отключает авторизацию ubus.

Если после установки прежней версии `/openrkn/` возвращает **403 Forbidden**, исправьте права публичной оболочки и индекс uhttpd через SSH:

```sh
find /www/openrkn -type d -exec chmod 755 '{}' \;
find /www/openrkn -type f -exec chmod 644 '{}' \;
chmod 755 /usr/lib/openrkn /usr/libexec/openrkn
chmod 644 /usr/lib/openrkn/*.sh
uci -q delete uhttpd.openrkn.index_page
uci add_list uhttpd.openrkn.index_page='index.html'
uci commit uhttpd
/etc/init.d/uhttpd restart
/etc/init.d/openrkn restart
```

Открывайте адрес с портом **7788**. Если 403 остаётся, проверьте `ls -ld /www /www/openrkn /www/openrkn/index.html` и `uci show uhttpd.openrkn`.

## Подключение телефона

1. Откройте вкладку OpenFlux. По умолчанию выбран **Cups.online**, который создаёт комнаты автоматически; nfqws выключен.
2. Дождитесь запуска и нажмите **Получить QR-профиль**. Если комнаты ещё создаются, повторите позже; причина ошибки доступна в журнале.
3. Отсканируйте QR в совместимом клиенте OpenFlux. Для CLI можно скачать ZIP с `mobile.conf`, `secret.key` и `share.link`, распаковать рядом и запустить клиент с этим конфигом.

Профиль содержит ключ доступа к exit node. Он общий для этой конфигурации, сохраняется при повторном экспорте и не является одноразовым. Смена транспорта требует нового QR. Изменение конфигурации перезапускает сервис и разрывает активные соединения.

## Mail.ru Документы и другие транспорты

Во вкладке **OpenFlux → Настройки подключения** выберите **Mail.ru Docs**, укажите HTTPS-ссылку общего доступа на документ Mail.ru, доступный для редактирования без авторизации, и нажмите **Сохранить настройки**. Backend создаёт секцию `Type = mailru` с `URL`, сохраняет UCI и перезапускает работающий сервис. Затем получите новый профиль. Автоматическое создание документа и вход в аккаунт Mail.ru не реализованы.

Аналогично доступен Yandex.Docs с HTTPS-ссылкой документа. Для Cups.online ссылку можно оставить пустой. Direct требует публичного адреса, доступного TCP-порта 8443 и отдельно настроенного firewall / NAT; установщик не открывает его в WAN автоматически.

Реальная доступность и скорость зависят от провайдера и выбранного транспорта. ONLINE означает живые процессы, а успешное подключение клиента нужно проверить отдельно.

## nfqws и firewall4

Опция **OpenFlux + nfqws** включает обработку локальных исходящих TCP 80/443 и UDP 443/50000–50100 соединений пользователя `openrkn` (UID 453). В таблицу fw4 автоматически включается цепочка output с NFQUEUE 200 и bypass. Метка `0x40000000` исключает повторную обработку отправленных nfqws пакетов.

Это обработка исходящих соединений L4 exit node; пересылаемый LAN-трафик остальных устройств этим правилом не охватывается. В интерфейсе доступны фиксированные пресеты nfqws. Их эффективность нужно проверять в своей сети. При выключенном nfqws очередь пропускает пакеты.

procd автоматически перезапускает завершившиеся процессы. Дополнительный watchdog раз в 60 секунд проверяет PID и исполняемый файл. Журнал `/tmp/openrkn.log` ограничивается и ротируется; share-ссылки и QR исключены из него.

## Управление и файлы

```sh
/etc/init.d/openrkn start
/etc/init.d/openrkn restart
/etc/init.d/openrkn stop
ubus call openrkn status '{}'
ubus call openrkn get_logs '{"lines":100}'
ubus call openrkn gen_mobile_profile '{}'
```

- `/etc/config/openrkn` — автозапуск, transport, URL, DPI и пресет.
- `/etc/openrkn/exit.conf` — конфигурация OpenFlux; интерфейс обновляет её при сохранении настроек.
- `/etc/openrkn/secret.key` — постоянный ключ (root:openrkn, 0640).
- `/usr/libexec/rpcd/openrkn` — методы status, capabilities, dpi_state, get_config, configure, start_service, restart_service, stop_service, gen_mobile_profile, get_logs.
- `/usr/share/rpcd/acl.d/openrkn.json` — отдельные права чтения и администрирования. Экспорт секретов доступен администратору.
- `/usr/share/nftables.d/table-post/90-openrkn.nft` — включение в fw4 без отдельных команд добавления правил.

Статистика берётся из `/proc`, `/sys` и netifd. Не реализованные разделы исходной оболочки (дополнительные proxy cores, Telegram, routing) обозначены прямо и не показывают выдуманные данные. Самостоятельный HTML через file:// не имеет доступа к ubus: открывайте оболочку с роутера.

## Разработка и проверка

```sh
node tests/host.cjs
node tests/web.cjs
node tests/build-bundle.cjs
```

Host-тестам нужен Node.js и dash (Windows: Git for Windows, либо `DASH_PATH`). Проверяются POSIX-синтаксис, RPC/ACL, ограничение журналов, экспорт и очистка профилей, настройки Mail.ru, авторизация JSON-RPC и ZIP. GitHub Actions запускает проверки на Linux. `node tests/preview-server.cjs` открывает тестовый стенд на localhost:8787 с явно фиктивными данными; это не router backend.

`openrkn-deploy.tar.gz` содержит `deploy.sh` и дерево `files/`, без бинарников и ключей. Для локальной установки распакуйте архив и выполните `sh deploy.sh`.

Makefile предназначен для интеграции дерева файлов в OpenWrt SDK; бинарники и первичная генерация ключа выполняются установщиком `deploy.sh`. Для готовой установки используйте установщик.

Проверены host-тесты и работа оболочки с тестовым ubus. Сквозной туннель, загрузка пакетов и firewall на реальном OpenWrt-роутере здесь не проверены.

Основа: [OpenFlux](https://github.com/p1neappleXpress/OpenFlux), [zapret](https://github.com/bol-van/zapret). Лицензия файлов этого репозитория — MIT; лицензии сторонних бинарников определяются их проектами.
