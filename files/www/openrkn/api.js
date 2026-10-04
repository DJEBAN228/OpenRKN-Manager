/* Same-origin ubus client and portable profile export; no runtime dependencies. */
(function (root) {
  'use strict';
  class RpcError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }
  const messages = {
    service_not_running: 'Сначала запустите OpenFlux.',
    share_not_ready: 'OpenFlux ещё создаёт комнаты. Подождите и повторите экспорт.',
    service_changed: 'Сервис перезапустился во время экспорта. Повторите запрос.',
    service_action_failed: 'Сервис не запустился. Откройте журнал для подробностей.',
    disabled_in_uci: 'Сервис отключён в /etc/config/openrkn.',
    busy: 'Роутер выполняет другую команду. Повторите через несколько секунд.',
    document_url_required: 'Укажите HTTPS-ссылку на доступный документ.',
    public_host_required: 'Для Direct укажите публичный IP или доменное имя роутера.',
    invalid_transport_settings: 'Проверьте ссылку и имя сервера: пробелы и символы # ; недопустимы.',
    incompatible_openflux_or_invalid_link: 'Версия OpenFlux не поддерживает экспорт. Переустановите пакет.'
  };
  function createClient({ fetchImpl = root.fetch.bind(root), storage, onAuth, timeout = 30000 } = {}) {
    const empty = '00000000000000000000000000000000';
    let session = empty, id = 0;
    try { session = storage?.getItem('openrkn_sid') || empty; } catch (_) {}
    const clear = () => { session = empty; try { storage?.removeItem('openrkn_sid'); } catch (_) {} };
    async function raw(object, method, params = {}, sid = session) {
      const requestId = ++id, controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchImpl('/ubus', {
          method: 'POST', signal: controller.signal, cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'call', params: [sid, object, method, params] })
        });
        if (!response.ok) throw new RpcError('Ошибка HTTP ' + response.status + '. Проверьте uhttpd-mod-ubus и /ubus.', response.status);
        const data = await response.json();
        if (data.id !== requestId || data.jsonrpc !== '2.0') throw new RpcError('Некорректный ответ RPC.');
        if (data.error) throw new RpcError(data.error.message || 'Ошибка RPC', data.error.code);
        if (!Array.isArray(data.result) || typeof data.result[0] !== 'number') throw new RpcError('Некорректный результат ubus.');
        if (data.result[0] !== 0) throw new RpcError(data.result[0] === 6 ? 'Недостаточно прав или сессия истекла.' : 'ubus: код ' + data.result[0], data.result[0]);
        const result = data.result[1] || {};
        if (result.ok === false) throw new RpcError(messages[result.error] || result.error || 'Команда не выполнена.');
        return result;
      } catch (e) {
        if (e.name === 'AbortError') throw new RpcError('Роутер не ответил за 30 секунд.');
        throw e;
      } finally { clearTimeout(timer); }
    }
    return {
      raw,
      async login(username, password) {
        const result = await raw('session', 'login', { username, password, timeout: 3600 }, empty);
        if (!/^[a-f0-9]{32}$/.test(result.ubus_rpc_session || '')) throw new RpcError('Не удалось войти.');
        session = result.ubus_rpc_session;
        try { storage?.setItem('openrkn_sid', session); } catch (_) {}
        return result;
      },
      async call(method, params = {}) {
        try { return await raw('openrkn', method, params); }
        catch (e) {
          if (![6, -32002].includes(e.code) || !onAuth) throw e;
          clear();
          await onAuth();
          return raw('openrkn', method, params);
        }
      },
      async allowed(method) {
        try { return (await raw('session', 'access', { scope: 'ubus', object: 'openrkn', function: method })).access === true; }
        catch (_) { return false; }
      },
      async logout() { try { await raw('session', 'destroy'); } catch (_) {} finally { clear(); } }
    };
  }
  // ZIP STORE with UTF-8 names and CRC32. The archive includes the separate key
  // referenced by mobile.conf, so no router-local path survives a download.
  function profileZip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    const table = Array.from({ length: 256 }, (_, i) => {
      let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
    });
    const entries = Object.entries(files || {});
    if (!entries.length || entries.length > 8) throw new Error('Нет файлов профиля.');
    for (const [name, text] of entries) {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(name) || typeof text !== 'string') throw new Error('Некорректный файл профиля.');
      const filename = encoder.encode(name), bytes = encoder.encode(text);
      if (bytes.length > 1048576) throw new Error('Профиль слишком большой.');
      let crc = 0xffffffff; for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true);
      h.setUint16(26, filename.length, true); header.set(filename, 30);
      const central = new Uint8Array(46 + filename.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true);
      c.setUint16(28, filename.length, true); c.setUint32(42, offset, true); central.set(filename, 46);
      chunks.push(header, bytes); directory.push(central); offset += header.length + bytes.length;
    }
    const size = directory.reduce((n, x) => n + x.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    const all = [...chunks, ...directory, end], result = new Uint8Array(offset + size + end.length);
    let position = 0; for (const part of all) { result.set(part, position); position += part.length; }
    return result;
  }
  const api = { createClient, profileZip, RpcError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenRKNApi = api;
})(globalThis);
