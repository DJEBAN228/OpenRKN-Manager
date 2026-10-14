const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = __dirname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const write = (rel, text) => {
  const clean = text.replace(/\r\n/g, '\n');
  if (clean.includes('\r')) throw new Error('CR found in ' + rel);
  fs.writeFileSync(path.join(root, rel), clean, 'utf8');
  console.log('Patched:', rel);
};
const patch = (rel, replacements) => {
  let content = read(rel);
  for (const [from, to] of replacements) {
    if (!content.includes(from)) throw new Error(`Target not found in ${rel}:\n${from}`);
    content = content.replace(from, to);
  }
  write(rel, content);
};

// 1. Версия 0.3.2
write('files/usr/share/openrkn/version', '0.3.2\n');

// 2. deploy.sh
patch('deploy.sh', [
  ['= 0.3.1 ]; then source_dir=$script_dir', '= 0.3.2 ]; then source_dir=\$script_dir'],
  ['= 0.3.1 ] || {', '= 0.3.2 ] || {'],
  ['mkdir -p /opt/openrkn/bin /etc/openrkn/profiles /var/run/openrkn', 'mkdir -p /opt/openrkn/bin /etc/openrkn /var/run/openrkn\nrm -rf /etc/openrkn/profiles'],
  ['chown root:root /etc/openrkn/profiles\nchmod 700 /etc/openrkn/profiles\n', '']
]);

// 3. files/etc/config/openrkn
patch('files/etc/config/openrkn', [
  ["\toption url ''\n", "\toption url ''\n\toption fallback_transport ''\n\toption fallback_url ''\n"]
]);

// 4. files/etc/init.d/openrkn
patch('files/etc/init.d/openrkn', [
  ['mkdir -p "$OR_RUN" /etc/openrkn/profiles || return 1', 'mkdir -p "$OR_RUN" || return 1'],
  ['chmod 700 "$OR_RUN" /etc/openrkn/profiles', 'chmod 700 "$OR_RUN"']
]);

// 5. files/usr/lib/openrkn/connectivity.sh
write('files/usr/lib/openrkn/connectivity.sh', [
  '#!/bin/sh',
  '# Fixed destinations and configured transport probe, never caller-provided arguments.',
  'or_connectivity() (',
  '\tor_config',
  '\tdir=\$(mktemp -d /tmp/openrkn-probe.XXXXXX) || { or_error probe_failed; return; }',
  '\ttrap \'rm -rf "\$dir"\' 0',
  '\ttrap \'exit 1\' INT TERM',
  '\tip=0 dns=0 https=0 transport_ok=0',
  '\ttransport=$(uci -q get openrkn.main.transport)', '\tdoc_url=$(uci -q get openrkn.main.url)',
  '\ttimeout 3 ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1 && ip=1',
  '\ttimeout 3 nslookup example.com >/dev/null 2>&1 && dns=1',
  '\ttimeout 3 wget -q -T 2 -O "\$dir/page" https://example.com/ >/dev/null 2>&1 && https=1',
  '\tcase "\$transport" in',
  '\t\tmailru|yandex)',
  '\t\t\tcase "\$doc_url" in',
  '\t\t\t\thttps://?*) timeout 3 wget -q -T 2 -O "\$dir/doc" "$doc_url" >/dev/null 2>&1 && [ -s "$dir/doc" ] && transport_ok=1;;',
  '\t\t\tesac',
  '\t\t\t;;',
  '\t\tdirect)',
  '\t\t\tawk \'$2 ~ /:20FB$/ && \$4 == "0A" {found=1} END {exit !found}\' /proc/net/tcp /proc/net/tcp6 2>/dev/null && transport_ok=1',
  '\t\t\t;;',
  '\tesac',
  '\tjson_init',
  '\tjson_add_boolean ok 1',
  '\tjson_add_string scope router',
  '\tjson_add_boolean ip_ping "\$ip"',
  '\tjson_add_boolean dns_lookup "\$dns"',
  '\tjson_add_boolean https_fetch "\$https"',
  '\tjson_add_boolean transport_probe "\$transport_ok"',
  '\tjson_add_string note \'Router connectivity and transport check; does not test the phone tunnel. ICMP may be filtered.\'',
  '\tjson_dump',
  ')',
  ''
].join('\n'));

// 6. files/usr/lib/openrkn/settings.sh
patch('files/usr/lib/openrkn/settings.sh', [
  ['\tjson_get_var host share_host\n', '\tjson_get_var host share_host\n\tjson_get_var fb_transport fallback_transport\n\tjson_get_var fb_url fallback_url\n'],
  [
    '\t\tdirect) case "\$host" in \'\'|*[!A-Za-z0-9.:-]*) or_error public_host_required; return;; esac;;\n\tesac\n',
    [
      '\t\tdirect) case "\$host" in \'\'|*[!A-Za-z0-9.:-]*) or_error public_host_required; return;; esac;;',
      '\tesac',
      '\tif [ -n "$fb_transport" ] && [ "$fb_transport" != none ]; then',
      '\t\t[ "$encryption" = enabled ] && [ "$session" = strict ] || { or_error fallback_requires_strict_session; return; }',
      '\t\tcase "\$fb_transport" in yandex|mailru) ;; *) or_error unsupported_transport; return;; esac',
      '\t\t[ "$fb_transport" != "$transport" ] || [ "$fb_url" != "$url" ] || { or_error duplicate_fallback_transport; return; }',
      '\t\t[ "\${#fb_url}" -le 2048 ] || { or_error invalid_transport_settings; return; }',
      '\t\tcase "\$fb_url" in *"\'"*|*\'#\'*|*\';\'*|*\' \'*|*\'\n\'*|*"$(printf \'\\r\')"*\vert{}*"$(printf \'\\t\')"*) or_error invalid_transport_settings; return;; esac',
      '\t\tcase "\$fb_url" in https://?*) ;; *) or_error document_url_required; return;; esac',
      '\telse fb_transport=\'\'; fb_url=\'\'; fi\n'
    ].join('\n')
  ],
  [
    '\t\tcase "\$transport" in direct) printf \'Listen = 0.0.0.0:8443\\n\';; *) [ -z "$url" ] \vert{}\vert{} printf \'URL = \%s\\n\' "$url";; esac\n',
    [
      '\t\tcase "\$transport" in direct) printf \'Listen = 0.0.0.0:8443\\n\';; *) [ -z "$url" ] \vert{}\vert{} printf \'URL = \%s\\n\' "$url";; esac',
      '\t\tif [ -n "\$fb_transport" ]; then',
      '\t\t\tprintf \'\\n[Transport fallback_%s]\\nType = %s\\nPriority = 50\\nURL = %s\\n\' "\$fb_transport" "$fb_transport" "$fb_url"',
      '\t\tfi\n'
    ].join('\n')
  ],
  [
    '\tuci -q set "openrkn.main.url=\$url" &&\n',
    '\tuci -q set "openrkn.main.url=\$url" &&\n\tuci -q set "openrkn.main.fallback_transport=\$fb_transport" &&\n\tuci -q set "openrkn.main.fallback_url=\$fb_url" &&\n'
  ],
  [
    '\tjson_add_string url "\$(uci -q get openrkn.main.url)"\n',
    '\tjson_add_string url "\$(uci -q get openrkn.main.url)"\n\tjson_add_string fallback_transport "\$(uci -q get openrkn.main.fallback_transport)"\n\tjson_add_string fallback_url "\$(uci -q get openrkn.main.fallback_url)"\n'
  ]
]);

// 7. files/usr/libexec/openrkn/profile (RAM-профиль без сохранения секретов на флеш)
patch('files/usr/libexec/openrkn/profile', [
  [
    'dir=\$(mktemp -d /etc/openrkn/profiles/mobile.XXXXXX) || { or_error profile_storage_failed; exit 0; }\ncomplete=0\ntrap \'[ "$complete" = 1 ] \vert{}\vert{} rm -rf "$dir"\' 0',
    'mkdir -p "$OR_RUN"\ndir=$(mktemp -d "$OR_RUN/profile.XXXXXX") \vert{}\vert{} { or_error profile_storage_failed; exit 0; }\ntrap \'rm -rf "$dir"\' 0'
  ],
  [
    'printf \'%s\\n\' "$link" > "$dir/share.link" || { or_error profile_storage_failed; exit 0; }\ncomplete=1\njson_init\njson_add_boolean ok 1\njson_add_string link "\$link"\njson_add_string uri "\$link"\njson_add_string path "\$conf"',
    'printf \'%s\\n\' "$link" > "$dir/share.link" || { or_error profile_storage_failed; exit 0; }\njson_init\njson_add_boolean ok 1\njson_add_string link "\$link"\njson_add_string uri "\$link"\njson_add_string path "mobile.conf"'
  ]
]);

// 8. files/usr/libexec/rpcd/openrkn
patch('files/usr/libexec/rpcd/openrkn', [
  [
    '"configure":{"transport":"","url":"","share_host":"","codec":"","encryption":"","session_mode":"","encryption_key":""}',
    '"configure":{"transport":"","url":"","share_host":"","fallback_transport":"","fallback_url":"","codec":"","encryption":"","session_mode":"","encryption_key":""}'
  ],
  [
    '\tjson_close_object\n\tjson_add_object openflux\n',
    [
      '\tjson_close_object',
      '\tnft_chain=\$(nft list chain inet fw4 openrkn_output 2>/dev/null)',
      '\tnft_stats=$(printf \'\%s\\n\' "$nft_chain" | awk \'/counter packets/ {for(i=1;i<=NF;i++){if($i=="packets")p=$(i+1);if($i=="bytes")b=$(i+1)}} END {printf "%s %s", p+0, b+0}\')',
      '\tset -- \$nft_stats',
      '\tflux_pkts=${1:-0} flux_bytes=${2:-0}',
      '\tjson_add_object openflux\n'
    ].join('\n')
  ],
  [
    '\t\tsection && /^[[:space:]]*Type[[:space:]]*=/ {sub(/^[^=]*=[[:space:]]*/, "");sub(/[[:space:]]*[#;].*\$/, "");printf "%s%s",sep,$0;sep=", "}\' "$OR_CONF" 2>/dev/null)"\n\tjson_close_object',
    '\t\tsection && /^[[:space:]]*Type[[:space:]]*=/ {sub(/^[^=]*=[[:space:]]*/, "");sub(/[[:space:]]*[#;].*\$/, "");printf "%s%s",sep,$0;sep=", "}\' "$OR_CONF" 2>/dev/null)"\n\tjson_add_int tx_packets "\$flux_pkts"\n\tjson_add_int tx_bytes "\$flux_bytes"\n\tjson_close_object'
  ],
  [
    '\tjson_add_boolean output_counter_rule "\$(nft list chain inet fw4 openrkn_output >/dev/null 2>&1 && echo 1 || echo 0)"',
    '\tjson_add_boolean output_counter_rule "$([ -n "$nft_chain" ] && echo 1 || echo 0)"'
  ]
]);

// 9. files/www/openrkn/api.js
patch('files/www/openrkn/api.js', [
  [
    "incompatible_openflux_or_invalid_link: 'Версия OpenFlux не поддерживает экспорт. Переустановите пакет.'",
    "incompatible_openflux_or_invalid_link: 'Версия OpenFlux не поддерживает экспорт. Переустановите пакет.',\n    fallback_requires_strict_session: 'Резервный транспорт доступен только при включённом шифровании и строгом сеансовом режиме.',\n    duplicate_fallback_transport: 'Резервный транспорт и ссылка не должны полностью совпадать с основным.'"
  ]
]);

// 10. files/www/openrkn/index.html
patch('files/www/openrkn/index.html', [
  ['qr.js?v=0.3.1', 'qr.js?v=0.3.2'],
  ['api.js?v=0.3.1', 'api.js?v=0.3.2'],
  ['app.js?v=0.3.1', 'app.js?v=0.3.2']
]);

// 11. files/www/openrkn/app.js
patch('files/www/openrkn/app.js', [
  [
    '<label id="keyField">Свой ключ (необязательно)<input type="password" id="encryptionKey" autocomplete="new-password" minlength="16" maxlength="128" pattern="[A-Za-z0-9_-]{16,128}" title="16–128 латинских букв, цифр, символов _ или -" placeholder="Пусто — сохранить ключ роутера"></label>',
    '<label id="keyField">Свой ключ (необязательно)<input type="password" id="encryptionKey" autocomplete="new-password" minlength="16" maxlength="128" pattern="[A-Za-z0-9_-]{16,128}" title="16–128 латинских букв, цифр, символов _ или -" placeholder="Пусто — сохранить ключ роутера"></label>\n        <label id="fbTransportField">Резервный транспорт (Failover)<select id="fallbackTransport"><option value="">Отключён</option><option value="mailru">Mail.ru Docs (Priority 50)</option><option value="yandex">Yandex.Docs (Priority 50)</option></select></label>\n        <label id="fbUrlField">HTTPS-ссылка резервного документа<input type="text" id="fallbackURL" placeholder="https://disk.yandex.ru/i/…"></label>'
  ],
  [
    "\$('#dTransport').textContent = state?.openflux?.transport || settings?.transport || '—';",
    "const fluxBytes = state?.openflux?.tx_bytes || 0;\n    \$('#dTransport').textContent = (state?.openflux?.transport || settings?.transport || '—') + (connected && fluxBytes > 0 ? ' · ' + bytes(fluxBytes) : '');"
  ],
  [
    "if (caps.api_version !== 4) throw new Error('Обновите бэкенд OpenRKN до версии 0.3.1.');",
    "if (caps.api_version !== 4) throw new Error('Обновите бэкенд OpenRKN до версии 0.3.2.');"
  ],
  [
    "$('#codec').value = cfg.codec \vert{}\vert{} 'batched'; $('#encryption').value = cfg.encryption || 'enabled'; $('#sessionMode').value = cfg.session_mode \vert{}\vert{} 'strict'; $('#encryptionKey').value = '';",
    "$('#codec').value = cfg.codec \vert{}\vert{} 'batched'; $('#encryption').value = cfg.encryption || 'enabled'; $('#sessionMode').value = cfg.session_mode \vert{}\vert{} 'strict'; $('#encryptionKey').value = '';\n    $('#fallbackTransport').value = ['mailru', 'yandex'].includes(cfg.fallback_transport) ? cfg.fallback_transport : ''; $('#fallbackURL').value = cfg.fallback_url || '';"
  ],
  [
    "\$('#encryptionKey').disabled = !encrypted;",
    "\$('#encryptionKey').disabled = !encrypted;\n    const canFallback = encrypted && \$('#sessionMode').value === 'strict';\n    if (!canFallback) \$('#fallbackTransport').value = '';\n    const hasFallback = canFallback && !!$('#fallbackTransport').value;\n    $('#fbTransportField').hidden = !canFallback;\n    $('#fbUrlField').hidden = !hasFallback;\n    $('#fallbackURL').required = hasFallback;"
  ],
  [
    "\$('#codec').onchange = cryptoFields;",
    "\$('#codec').onchange = cryptoFields;\n  $('#sessionMode').onchange = cryptoFields;\n  $('#fallbackTransport').onchange = cryptoFields;"
  ],
  [
    "$('#checkInternet').disabled = true; $('#internetResult').textContent = 'Проверка IP, DNS и HTTPS (до 9 секунд)…';\n    try { const r = await client.call('check_connectivity'); \$('#internetResult').textContent = 'Роутер: IP (ping) ' + (r.ip_ping ? 'OK' : 'нет ответа') + ' · DNS ' + (r.dns_lookup ? 'OK' : 'ошибка') + ' · HTTPS ' + (r.https_fetch ? 'OK' : 'ошибка') + '. Если HTTPS работает, а на телефоне интернета нет — проверьте ссылку редактируемого документа, переимпортируйте новый QR и посмотрите журнал OpenFlux. Ping может блокироваться провайдером. Эта проверка не проходит через туннель телефона.'; }",
    "$('#checkInternet').disabled = true; $('#internetResult').textContent = 'Проверка IP, DNS, HTTPS и транспорта (до 12 секунд)…';\n    try { const r = await client.call('check_connectivity'); \$('#internetResult').textContent = 'Роутер: IP (ping) ' + (r.ip_ping ? 'OK' : 'нет ответа') + ' · DNS ' + (r.dns_lookup ? 'OK' : 'ошибка') + ' · HTTPS ' + (r.https_fetch ? 'OK' : 'ошибка') + ' · Транспорт (' + (settings?.transport || 'doc') + ') ' + (r.transport_probe ? 'ДОСТУПЕН' : 'НЕДОСТУПЕН') + '. Если транспорт недоступен — проверьте ссылку редактируемого документа или порт 8443. Ping может блокироваться провайдером.'; }"
  ],
  [
    "try { await client.call('configure', { transport: $('#transport').value, url: $('#documentURL').value.trim(), share_host: $('#shareHost').value.trim(), codec: $('#codec').value, encryption: $('#encryption').value, session_mode: $('#sessionMode').value, encryption_key: $('#encryption').value === 'enabled' ? $('#encryptionKey').value : '' });",
    "try { await client.call('configure', { transport: $('#transport').value, url: $('#documentURL').value.trim(), share_host: $('#shareHost').value.trim(), fallback_transport: $('#fallbackTransport').value, fallback_url: $('#fallbackURL').value.trim(), codec: $('#codec').value, encryption: $('#encryption').value, session_mode: $('#sessionMode').value, encryption_key: $('#encryption').value === 'enabled' ? $('#encryptionKey').value : '' });"
  ]
]);

// 12. tests/host.cjs
patch('tests/host.cjs', [
  [
    "assert.equal(configure(mailru).ok, true);",
    "assert.equal(configure(mailru).ok, true);\n  const withFallback = { ...mailru, fallback_transport: 'yandex', fallback_url: 'https://disk.yandex.ru/i/fallback-doc' };\n  assert.equal(configure(withFallback).ok, true);\n  assert(fs.readFileSync(confDir + '/exit.conf', 'utf8').includes('[Transport fallback_yandex]\\nType = yandex\\nPriority = 50\\nURL = https://disk.yandex.ru/i/fallback-doc'));\n  assert.equal(configure({ ...withFallback, session_mode: 'compatible' }).error, 'fallback_requires_strict_session');\n  assert.equal(configure({ ...mailru, fallback_transport: 'mailru', fallback_url: mailru.url }).error, 'duplicate_fallback_transport');\n  assert.equal(configure(mailru).ok, true);"
  ],
  [
    "fs.writeFileSync(t + '/probe-test', shim + '\\ntimeout() { [ \"\$PROBE_FAIL\" != 1 ]; }\\n' + connectivity + '\\nor_connectivity\\n');\n  const goodProbe = JSON.parse(run([t + '/probe-test']));\n  assert.equal(goodProbe.scope, 'router');\n  assert.equal(goodProbe.https_fetch, true);",
    "fs.writeFileSync(t + '/probe-test', shim + '\\nuci() { case \"\$*\" in *transport) printf mailru;; *url) printf \"https://cloud.mail.ru/public/doc\";; esac; }\\ntimeout() { [ \"$PROBE_FAIL\" != 1 ] \vert{}\vert{} return 1; case \"$*\" in *-O*) eval \"out=\\\\$$(($# - 1))\"; printf ok > \"\$out\";; esac; }\\n' + connectivity + '\\nor_connectivity\\n');\n  const goodProbe = JSON.parse(run([t + '/probe-test']));\n  assert.equal(goodProbe.scope, 'router');\n  assert.equal(goodProbe.https_fetch, true);\n  assert.equal(goodProbe.transport_probe, true);"
  ],
  [
    ".replace('. /usr/lib/openrkn/common.sh', shim).replaceAll('/etc/openrkn/profiles', t + '/profiles');",
    ".replace('. /usr/lib/openrkn/common.sh', shim);"
  ],
  [
    "const dirs = fs.readdirSync(path.join(temp, 'profiles'));\n  assert.equal(dirs.length, 1);\n  assert.equal(fs.readFileSync(path.join(temp, 'profiles', dirs[0], 'secret.key'), 'utf8'), fixture.config.secret);",
    "assert.equal(fs.readdirSync(path.join(temp, 'run')).filter(n => n.startsWith('profile.')).length, 0, 'ephemeral profile dir must be removed after export');"
  ],
  [
    "assert.equal(fs.readdirSync(path.join(temp, 'profiles')).length, 1, 'failed export must clean up');",
    "assert.equal(fs.readdirSync(path.join(temp, 'run')).filter(n => n.startsWith('profile.')).length, 0, 'failed export must clean up');"
  ]
]);

// 13. tests/preview-server.cjs
patch('tests/preview-server.cjs', [
  ['https_fetch: true }', 'https_fetch: true, transport_probe: true }'],
  ['openflux: { transport: settings.transport }', 'openflux: { transport: settings.transport, tx_packets: 1420, tx_bytes: 1843200 }']
]);

console.log('\n--- Running Test Suite & Bundle Builder ---');
for (const script of ['tests/host.cjs', 'tests/web.cjs', 'tests/qr.cjs', 'tests/build-bundle.cjs']) {
  cp.execFileSync(process.execPath, [path.join(root, script)], { stdio: 'inherit' });
}
console.log('\nSUCCESS! All tests passed and openrkn-deploy.tar.gz is rebuilt.');