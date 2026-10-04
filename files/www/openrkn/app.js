(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const bytes = n => { let i = 0; const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (Number(n) || 0).toFixed(i ? 1 : 0) + ' ' + units[i]; };
  const uptime = n => `${Math.floor(n / 86400)}d ${Math.floor(n % 86400 / 3600)}h ${Math.floor(n % 3600 / 60)}m`;
  let connectionError = '', state = null, view = 'dashboard', profile = null, settings = null;
  let busy = false, polling = false, logPaused = false, loginPromise = null, canControl = false, canExport = false;
  const history = [], nav = [
    ['dashboard', 'Обзор', 'grid'], ['flux', 'OpenFlux', 'flux'], ['dpi', 'Zapret', 'shield'],
    ['cores', 'Proxy & Cores', 'layers'], ['tg', 'Telegram', 'send'], ['routing', 'Routing', 'route'], ['diag', 'Журнал', 'act']
  ];
  const toast = (text, error = false) => {
    const el = document.createElement('div'); el.className = 'toast' + (error ? ' err' : ''); el.textContent = text;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), 5500);
  };
  function auth() {
    if (loginPromise) return loginPromise;
    $('#login').classList.add('show'); $('#lErr').textContent = ''; $('#lp').focus();
    loginPromise = new Promise(resolve => { auth.resolve = resolve; });
    return loginPromise;
  }
  let storage; try { storage = sessionStorage; } catch (_) {}
  const client = OpenRKNApi.createClient({ storage, onAuth: auth });
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); const button = $('#loginForm button'); button.disabled = true;
    try {
      await client.login($('#lu').value.trim(), $('#lp').value);
      $('#lp').value = ''; $('#login').classList.remove('show');
      loginPromise = null; auth.resolve?.();
    } catch (error) { $('#lErr').textContent = error.code === 6 ? 'Неверный логин или пароль.' : error.message; }
    finally { button.disabled = false; }
  });
  $('#logout').style.display = '';
  $('#logout').onclick = async () => { await client.logout(); profile = null; location.reload(); };

  const controls = () => `<div class="row"><button class="btn pri" data-action="start">${icon('play')}Запустить</button><button class="btn" data-action="restart">${icon('refresh')}Перезапустить</button><button class="btn dng" data-action="stop">${icon('x')}Остановить</button></div>`;
  const zapretNotice = () => `<div class="note notice"><b data-zapret-warning>Проверяем Zapret на роутере…</b><p>Для обработки DPI установите Zapret, подберите конфигурацию для вашего провайдера и запустите его. Рекомендуем <a href="https://github.com/StressOzz/Zapret-Manager" target="_blank" rel="noopener noreferrer">Zapret-Manager</a>.</p><small>OpenRKN управляет OpenFlux. Служба Zapret и её настройки управляются отдельно.</small></div>`;
  const luci = new URL('/cgi-bin/luci/', location.href); luci.port = '';
  const views = {
    dashboard: `<div class="note notice" id="connectionNote">Подключение к роутеру…</div>
      ${zapretNotice()}
      <div class="g">
        <div class="card glow c3 half"><p class="lbl">CPU</p><div class="big"><span id="dCpu">—</span><small>%</small></div><div class="sub" id="dModel">—</div></div>
        <div class="card glow m c3 half"><p class="lbl">RAM</p><div class="row"><div class="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="40"/><circle class="fg" id="ringFg" cx="50" cy="50" r="40"/></svg><b id="ringTxt">—</b></div><div id="dRam">—</div></div></div>
        <div class="card glow v c3 half"><p class="lbl">OpenFlux L4</p><div class="big" style="font-size:24px" id="dFlux">—</div><div class="sub" id="dTransport">—</div></div>
        <div class="card glow l c3 half"><p class="lbl">Watchdog</p><div class="big" style="font-size:24px" id="dWatchdog">—</div><div class="sub">Проверка процессов каждые 60 секунд</div></div>
      </div>
      <div class="g"><div class="card c8 wide"><div class="ch"><h3>OpenRKN</h3><a class="btn sm" href="${esc(luci.href)}" target="_blank" rel="noopener noreferrer">Открыть LuCI</a></div>${controls()}<p class="sub">Управление OpenFlux. Перезапуск не затрагивает внешний Zapret.</p><canvas class="cv" id="cpuChart"></canvas></div><div class="card c4"><div class="ch"><h3>Ядра CPU</h3></div><div id="cpuCores">—</div><p class="sub" id="dLoad">—</p></div></div>
      <div class="g"><div class="card c12"><div class="ch"><h3>Сетевые интерфейсы</h3></div><div class="ports" id="dPorts">—</div></div></div>`,
    flux: `${zapretNotice()}<div class="g"><div class="card glow m c5"><div class="ch"><h3>OpenFlux exit node</h3><span class="pill" id="fluxPill">—</span></div><p class="sub">Роутер принимает туннель телефона и открывает исходящие TCP/UDP-соединения в режиме L4.</p>${controls()}<div class="note">Для Mail.ru / Яндекс нужна доступная HTTPS-ссылка на документ. Сохраните её перед первым запуском.</div></div>
      <div class="card glow c7 wide"><div class="ch"><h3>Подключить телефон</h3></div><div class="two"><div><p class="sub">Запустите OpenFlux, получите профиль и отсканируйте QR в приложении OpenFlux.</p><div class="row mt"><button class="btn pri" id="generateProfile">${icon('qr')}Получить QR-профиль</button><button class="btn" id="downloadProfile" disabled>${icon('dl')}.conf + ключ (.zip)</button></div><p class="note" id="profileNote">Ссылка содержит ключ доступа. Передавайте её только своим устройствам.</p></div><div><div class="qr ph" id="profileQR">QR · ожидание</div><div class="uri" id="profileLink" title="Скопировать ссылку"></div></div></div></div></div>
      <div class="g"><div class="card c12"><div class="ch"><h3>Настройки подключения</h3></div><form id="settingsForm"><div class="settings-grid">
        <label>Транспорт<select id="transport"><option value="mailru">Mail.ru Docs</option><option value="yandex">Yandex.Docs</option><option value="direct">Direct · публичный адрес</option></select></label>
        <label id="urlField">HTTPS-ссылка документа<input type="text" id="documentURL" placeholder="https://cloud.mail.ru/public/…"></label>
        <label id="hostField">Публичный IP или домен<input type="text" id="shareHost" placeholder="exit.example.org"></label>
      </div><div class="row mt"><button class="btn pri" id="saveSettings">Сохранить настройки</button><small>Работающий сервис будет перезапущен.</small></div><div class="note" id="settingsNote">Загрузка настроек…</div></form></div></div>`,
    dpi: `${zapretNotice()}<div class="g"><div class="card glow c12"><div class="ch"><h3>Внешний Zapret</h3><span class="pill" id="nfqPill">—</span></div><dl class="kv"><dt>Установлен</dt><dd id="zapretInstalled">—</dd><dt>Настроен</dt><dd id="zapretConfigured">—</dd><dt>Правила исходящего трафика</dt><dd id="nfqRule">—</dd></dl><div class="note">Исходящие соединения L4-прокси проходят через правила Zapret в postrouting. Порты, списки доменов и исключения определяются вашей конфигурацией Zapret. Обнаружение правил не подтверждает успешный обход конкретного сайта.</div></div></div>`,
    diag: `<div class="g"><div class="card c12"><div class="ch"><h3>Журнал OpenRKN</h3><div class="r"><button class="btn sm" id="pauseLogs">Пауза</button><button class="btn sm" id="clearLogs">Очистить экран</button></div></div><div class="row" style="margin-bottom:12px"><select id="logService" style="width:190px"><option value="all">Все процессы</option><option value="openflux">OpenFlux</option><option value="nfqws">nfqws</option><option value="watchdog">Watchdog</option></select><input type="search" id="logSearch" placeholder="Фильтр строк…" style="flex:1"></div><div class="note" id="logNote">Последние 150 строк. Ссылки профилей и QR исключены из журнала.</div><pre id="log"></pre></div></div>`
  };
  for (const id of ['cores', 'tg', 'routing']) views[id] = `<div class="card glow"><div class="ch"><h3>${esc(nav.find(n => n[0] === id)[1])}</h3><span class="pill na">НЕ ПОДКЛЮЧЕНО</span></div><div class="note">Этот раздел оболочки требует отдельного бэкенда. Текущая сборка управляет OpenFlux.</div><a class="btn" href="#/flux">Открыть OpenFlux</a></div>`;
  $('#nav').innerHTML = nav.map(([id, label, symbol]) => `<a href="#/${id}" data-id="${id}" class="${['cores', 'tg', 'routing'].includes(id) ? 'unavailable' : ''}" title="${esc(label)}">${icon(symbol)}<span>${esc(label)}</span></a>`).join('');
  $('#views').innerHTML = nav.map(([id]) => `<section class="view" id="v-${id}">${views[id]}</section>`).join('');
  $('#profileNote').insertAdjacentHTML('beforebegin', '<div class="row mt"><button class="btn" id="copyProfile" disabled>Копировать ссылку</button><button class="btn" id="downloadQR" disabled>Скачать QR (.png)</button><button class="btn" id="expandQR" disabled>Увеличить QR</button></div>');

  function show() {
    const next = location.hash.replace('#/', ''); view = views[next] ? next : 'dashboard';
    $$('.view').forEach(el => el.classList.toggle('act', el.id === 'v-' + view));
    $$('#nav a').forEach(el => el.classList.toggle('act', el.dataset.id === view));
    $('#pageTitle').textContent = nav.find(n => n[0] === view)[1];
    document.title = 'OpenRKN · ' + $('#pageTitle').textContent;
    update(); if (view === 'diag') refreshLogs();
  }
  function setEnabled() {
    $$('[data-action],#saveSettings').forEach(el => { el.disabled = busy || !state || !canControl; });
    $('#generateProfile').disabled = busy || !state?.processes?.openflux?.running || !canExport;
    $('#downloadProfile').disabled = !profile;
    for (const id of ['copyProfile', 'downloadQR', 'expandQR']) $('#' + id).disabled = !profile;
  }
  function drawCPU() {
    const canvas = $('#cpuChart'), width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = width * devicePixelRatio; canvas.height = height * devicePixelRatio;
    const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.beginPath();
    history.forEach((value, i) => { const x = i * width / 59, y = height - 8 - value / 100 * (height - 16); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  }
  function update() {
    const connected = !!state, flux = !!state?.processes?.openflux?.running, nfq = !!state?.zapret?.running;
    $('#sys').className = 'chip sys ' + (!connected ? 'offline' : state.state === 'ONLINE' ? '' : 'degraded');
    $('#sysTxt').textContent = connected ? (state.state || 'CONNECTED') : 'OFFLINE';
    $('#topUp').textContent = connected ? uptime(state.uptime || 0) : '—';
    $('#connectionNote').textContent = connected ? (canControl ? 'Роутер подключён. Управление сервисом доступно.' : 'Роутер подключён. Доступ только для чтения.') : (connectionError || 'Нет связи с роутером. Проверьте /ubus, вход и журнал rpcd.');
    $('#sideFoot').innerHTML = connected ? `<b>${esc(state.model || state.board || 'OpenWrt')}</b><br>${esc(state.release || '')}<br>WAN ${esc(state.wan?.ip || '—')}<br>ubus: connected` : 'ubus: нет связи';
    $('#dCpu').textContent = connected ? state.cpu.total : '—'; $('#dModel').textContent = state?.model || '—';
    const ram = state?.ram, used = ram?.used_kib || 0, total = ram?.total_kib || 0, percentage = total ? used / total * 100 : 0;
    $('#ringFg').style.strokeDashoffset = 251.3 * (1 - percentage / 100); $('#ringTxt').textContent = connected ? percentage.toFixed(0) + '%' : '—';
    $('#dRam').textContent = connected ? `${bytes(used * 1024)} / ${bytes(total * 1024)}` : '—';
    $('#dFlux').textContent = connected ? (flux ? 'RUNNING' : 'STOPPED') : '—';
    $('#dTransport').textContent = state?.openflux?.transport || settings?.transport || '—';
    $('#dWatchdog').textContent = connected ? (state.processes.watchdog ? 'RUNNING' : 'STOPPED') : '—';
    $('#dLoad').textContent = state?.load ? 'Load: ' + state.load.map(n => Number(n).toFixed(2)).join(' / ') : '—';
    $('#cpuCores').innerHTML = (state?.cpu?.cores || []).map((n, i) => `<div class="core"><span>CPU ${i}</span><div class="bar"><i style="width:${Math.min(100, Math.max(0, n))}%"></i></div><em>${Number(n).toFixed(0)}%</em></div>`).join('') || 'Нет данных';
    $('#dPorts').innerHTML = Object.entries(state?.ports || {}).map(([name, p]) => `<div class="port ${p.up ? 'up' : ''}"><div class="hd">${esc(name)} <span class="pill ${p.up ? 'on' : ''}">${esc(p.role)}</span></div><dl><dt>Link</dt><dd>${p.up ? (p.speed != null ? esc(p.speed) + ' Mb/s' : 'up') : 'down'}</dd><dt>IP</dt><dd>${esc(p.ip || '—')}</dd><dt>RX / TX</dt><dd>${bytes(p.rx_bps)}/s · ${bytes(p.tx_bps)}/s</dd><dt>Σ RX / TX</dt><dd>${bytes(p.rx_bytes)} · ${bytes(p.tx_bytes)}</dd></dl></div>`).join('') || 'Нет данных';
    for (const [id, on] of [['fluxPill', flux], ['nfqPill', nfq]]) { $('#' + id).textContent = connected ? (on ? 'RUNNING' : 'STOPPED') : 'N/A'; $('#' + id).className = 'pill ' + (on ? 'on' : ''); }
    $('#nfqRule').textContent = connected ? (state.zapret?.postrouting_rules ? 'Обнаружены' : 'Не обнаружены') : '—';
    $('#zapretInstalled').textContent = connected ? (state.zapret?.installed ? 'Да' : 'Нет') : '—';
    $('#zapretConfigured').textContent = connected ? (state.zapret?.configured ? 'Да' : 'Нет') : '—';
    const messages = { not_installed: 'Zapret не установлен. Установите и настройте его для обработки DPI.', not_running: 'Zapret установлен, но не запущен.', not_configured: 'Для Zapret нужно включить nfqws и настроить стратегию.', rules_missing: 'Не найдены правила Zapret для исходящего трафика. Проверьте настройку firewall.', check_filters: 'Проверьте фильтры и пользователя Zapret: они могут исключать трафик OpenFlux.', detected: 'Zapret запущен, конфигурация и правила обнаружены. Эффективность проверьте на ваших сайтах.' };
    $$('[data-zapret-warning]').forEach(el => { el.textContent = connected ? (messages[state.zapret?.state] || 'Статус Zapret не определён.') : 'Статус Zapret пока недоступен.'; });
    setEnabled(); if (view === 'dashboard') drawCPU();
  }
  async function metadata() {
    const [caps, cfg] = await Promise.all([client.call('capabilities'), client.call('get_config')]);
    if (caps.api_version !== 3) throw new Error('Обновите бэкенд OpenRKN до версии 0.3.0.');
    [canControl, canExport] = await Promise.all([client.allowed('configure'), client.allowed('gen_mobile_profile')]);
    settings = cfg;
    $('#transport').value = ['mailru', 'yandex', 'direct'].includes(cfg.transport) ? cfg.transport : 'mailru'; $('#documentURL').value = cfg.url || ''; $('#shareHost').value = cfg.share_host || '';
    $('#settingsNote').textContent = canControl ? 'Секрет шифрования хранится на роутере и сохраняется при смене транспорта.' : 'Для изменения настроек нужны права openrkn-admin.';
    transportFields(); setEnabled();
  }
  async function refresh() {
    if (polling || document.hidden) return; polling = true;
    try {
      state = await client.call('status'); connectionError = '';
      history.push(Number(state.cpu.total)); if (history.length > 60) history.shift();
      if (!settings) await metadata();
    } catch (error) { state = null; connectionError = error.message; }
    finally { polling = false; update(); }
  }
  document.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]'); if (!action || busy || !canControl) return;
    busy = true; setEnabled();
    try { await client.call(action.dataset.action + '_service', { service: 'openrkn' }); toast('Команда принята. Состояние обновляется…'); if (action.dataset.action !== 'start') clearProfile(); }
    catch (error) { toast(error.message, true); }
    finally { busy = false; await refresh(); }
  });
  function clearProfile() { profile = null; $('#qrModal').classList.remove('show'); $('#qmQr').textContent = ''; $('#qmUri').textContent = ''; $('#profileQR').className = 'qr ph'; $('#profileQR').textContent = 'QR · ожидание'; $('#profileLink').textContent = ''; $('#profileNote').textContent = 'Ссылка содержит ключ доступа. Передавайте её только своим устройствам.'; $('#downloadProfile').disabled = true; }
  $('#generateProfile').onclick = async () => {
    busy = true; setEnabled(); clearProfile(); $('#profileNote').textContent = 'OpenFlux готовит профиль…';
    try {
      const result = await client.call('gen_mobile_profile');
      if (!result.link?.startsWith('openflux://v1/') || !result.files?.['mobile.conf']) throw new Error('Роутер вернул неполный профиль.');
      profile = result; $('#profileQR').className = 'qr';
      $('#profileLink').textContent = result.link;
      try { $('#profileQR').innerHTML = OpenRKNQR.toSvg(result.link, 4); $('#profileNote').textContent = 'Для импорта из галереи скачайте QR (.png). На этом телефоне можно скопировать ссылку и импортировать её в OpenFlux. Профиль содержит ключ доступа.'; }
      catch (_) { $('#profileQR').textContent = 'Ссылка не помещается в QR'; $('#profileNote').textContent = 'Скопируйте ссылку и импортируйте её в OpenFlux. ZIP-профиль также доступен.'; }
    } catch (error) { clearProfile(); $('#profileNote').textContent = error.message; toast(error.message, true); }
    finally { busy = false; setEnabled(); }
  };
  $('#downloadProfile').onclick = () => {
    if (!profile) return;
    try { const url = URL.createObjectURL(new Blob([OpenRKNApi.profileZip(profile.files)], { type: 'application/zip' })); const link = document.createElement('a'); link.href = url; link.download = 'openflux-profile.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (error) { toast(error.message, true); }
  };
  async function copyProfile() {
    if (!profile) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(profile.link);
      else { const area = document.createElement('textarea'); area.value = profile.link; document.body.appendChild(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('Выделите ссылку и скопируйте вручную.'); }
      toast('Ссылка скопирована.');
    } catch (error) { toast(error.message, true); }
  }
  $('#profileLink').onclick = copyProfile; $('#copyProfile').onclick = copyProfile; $('#qmCopy').onclick = copyProfile;
  $('#downloadQR').onclick = () => {
    if (!profile) return;
    try {
      const matrix = OpenRKNQR.encode(profile.link), quiet = 4, scale = 8;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = (matrix.length + quiet * 2) * scale;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
      matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
      const imageURL = canvas.toDataURL('image/png');
      const image = document.createElement('img'); image.alt = 'QR-профиль OpenFlux для импорта из галереи'; image.src = imageURL; image.style.width = '100%'; image.style.imageRendering = 'pixelated';
      $('#qmQr').replaceChildren(image); $('#qmUri').textContent = profile.link; $('#qmTitle').textContent = 'QR для галереи · PNG'; $('#qrModal').classList.add('show');
      const link = document.createElement('a'); link.download = 'openflux-qr.png'; link.href = imageURL; document.body.appendChild(link); link.click(); link.remove();
    } catch (error) { toast(error.message, true); }
  };
  $('#expandQR').onclick = () => {
    if (!profile) return;
    try { $('#qmQr').innerHTML = OpenRKNQR.toSvg(profile.link, 4); $('#qmUri').textContent = profile.link; $('#qmTitle').textContent = 'Профиль OpenFlux'; $('#qrModal').classList.add('show'); }
    catch (error) { toast(error.message, true); }
  };
  $('#qmClose').onclick = () => $('#qrModal').classList.remove('show');
  function transportFields() { const direct = $('#transport').value === 'direct'; $('#hostField').hidden = !direct; $('#urlField').hidden = direct; $('#documentURL').required = ['yandex', 'mailru'].includes($('#transport').value); $('#shareHost').required = direct; }
  $('#transport').onchange = transportFields;
  $('#settingsForm').onsubmit = async e => {
    e.preventDefault(); if (!canControl || busy) return; busy = true; setEnabled();
    try { await client.call('configure', { transport: $('#transport').value, url: $('#documentURL').value.trim(), share_host: $('#shareHost').value.trim() }); clearProfile(); await metadata(); toast('Настройки сохранены.'); }
    catch (error) { $('#settingsNote').textContent = error.message; toast(error.message, true); }
    finally { busy = false; await refresh(); }
  };
  let logLines = [], logsBusy = false;
  function renderLogs() { const query = $('#logSearch').value.toLowerCase(); $('#log').textContent = logLines.filter(l => !query || l.toLowerCase().includes(query)).join('\n'); }
  async function refreshLogs() {
    if (logsBusy || logPaused || view !== 'diag' || !state) return; logsBusy = true;
    try { const result = await client.call('get_logs', { service: $('#logService').value, lines: 150 }); logLines = (result.logs || '').split('\n'); renderLogs(); $('#logNote').textContent = 'Последние 150 строк. Ссылки профилей и QR исключены из журнала.'; }
    catch (error) { $('#logNote').textContent = error.message; }
    finally { logsBusy = false; }
  }
  $('#pauseLogs').onclick = () => { logPaused = !logPaused; $('#pauseLogs').textContent = logPaused ? 'Продолжить' : 'Пауза'; refreshLogs(); };
  $('#clearLogs').onclick = () => { logLines = []; renderLogs(); };
  $('#logService').onchange = refreshLogs; $('#logSearch').oninput = renderLogs;
  window.addEventListener('hashchange', show); window.addEventListener('resize', drawCPU);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if (location.protocol !== 'file:') { setInterval(refresh, 5000); setInterval(refreshLogs, 3000); }
  show();
  if (location.protocol === 'file:') { $('#connectionNote').textContent = 'Откройте оболочку по адресу роутера /openrkn/. Локальный HTML не подключается к ubus.'; }
  else refresh();
})();
