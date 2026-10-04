// Development-only fake router. Never copied to the OpenWrt web root.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../files/www/openrkn');
let running = true, preset = 'general', settings = { transport: 'cupsonline', url: '', share_host: '', dpi_enabled: false };
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.url === '/ubus') {
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 65536) { res.writeHead(413); res.end(); return; } }
    try {
      const r = JSON.parse(text), [sid, object, method, params] = r.params; requests.push({ object, method, params });
      let data = {}, code = 0;
      if (object === 'session' && method === 'login') data = { ubus_rpc_session: 'a'.repeat(32) };
      else if (sid !== 'a'.repeat(32)) code = 6;
      else if (object === 'session') data = method === 'access' ? { access: true } : {};
      else switch (method) {
        case 'capabilities': data = { ok: true, api_version: 2, service_scope: 'stack' }; break;
        case 'get_config': data = { ok: true, ...settings }; break;
        case 'status': data = { ok: true, state: running ? 'ONLINE' : 'STOPPED', desired: running, dpi_enabled: settings.dpi_enabled,
          model: 'OpenWrt x86_64 · test fixture', release: 'OpenWrt 25 · test fixture', uptime: 38591, load: [0.08, 0.12, 0.1],
          cpu: { total: 12, cores: [9, 18, 10, 11] }, ram: { total_kib: 2097152, used_kib: 348160 },
          processes: { openflux: { running }, nfqws: { running: running && settings.dpi_enabled }, watchdog: running },
          nfqueue_rule: true, openflux: { transport: settings.transport }, wan: { ip: '192.0.2.10' },
          ports: { eth0: { role: 'WAN', up: true, speed: 1000, ip: '192.0.2.10', rx_bps: 1500000, tx_bps: 100000, rx_bytes: 409600000, tx_bytes: 20480000 } } }; break;
        case 'dpi_state': data = { ok: true, preset, presets: [{ id: 'general', name: 'General', desc: 'TCP fake + multisplit' }, { id: 'youtube4k', name: 'YouTube', desc: 'md5sig + QUIC fake' }] }; break;
        case 'start_service': case 'restart_service': running = true; data = { ok: true }; break;
        case 'stop_service': running = false; data = { ok: true }; break;
        case 'configure': settings = params; data = { ok: true }; break;
        case 'gen_mobile_profile': data = { ok: true, link: 'openflux://v1/fixture', files: { 'mobile.conf': '[Interface]\nEncryptionKeyFile = secret.key\n', 'secret.key': 'fixture-secret', 'share.link': 'openflux://v1/fixture' } }; break;
        case 'get_logs': data = { ok: true, logs: '2026-10-04 openflux: Running as EXIT NODE (mode=l4)\n2026-10-04 watchdog: fixture check OK\n<script>test input is plain text</script>' }; break;
        default: code = 3;
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: code ? [code] : [0, data] }));
    } catch { res.writeHead(400); res.end(); }
    return;
  }
  if (req.url === '/test-requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
  const name = req.url.split('?')[0].replace(/^\/openrkn\/?/, '') || 'index.html';
  if (!['index.html', 'app.js', 'api.js', 'qr.js'].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});
server.listen(8787, '127.0.0.1', () => console.log('Preview fixture: http://127.0.0.1:8787/openrkn/'));
