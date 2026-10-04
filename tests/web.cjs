const assert = require('node:assert/strict');
const { createClient, profileZip } = require('../files/www/openrkn/api.js');
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
(async () => {
  let captured, auth = 0, loggedIn = false;
  const fakeFetch = async (url, options) => {
    assert.equal(url, '/ubus'); captured = JSON.parse(options.body);
    const [sid, object, method] = captured.params;
    if (object === 'session' && method === 'login') { loggedIn = true; return response({ jsonrpc: '2.0', id: captured.id, result: [0, { ubus_rpc_session: 'a'.repeat(32) }] }); }
    if (object === 'session' && method === 'destroy') { loggedIn = false; return response({ jsonrpc: '2.0', id: captured.id, result: [0] }); }
    return response({ jsonrpc: '2.0', id: captured.id, result: loggedIn && sid === 'a'.repeat(32) ? [0, { ok: true }] : [6] });
  };
  const client = createClient({ fetchImpl: fakeFetch, onAuth: async () => { auth++; await client.login('root', 'fixture-password'); } });
  await client.call('start_service', { service: 'openrkn' });
  assert.equal(auth, 1);
  assert.deepEqual(captured.params.slice(1), ['openrkn', 'start_service', { service: 'openrkn' }]);
  await client.logout(); assert.equal(loggedIn, false);
  for (const [body, message] of [
    [{ result: [0] }, 'Некорректный ответ'],
    [{ jsonrpc: '2.0', id: 1, result: [0, { ok: false, error: 'share_not_ready' }] }, 'создаёт комнаты'],
    [{ jsonrpc: '2.0', id: 1, result: [4] }, 'код 4'],
    [{ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad request' } }, 'bad request']
  ]) {
    const bad = createClient({ fetchImpl: async () => response(body) });
    await assert.rejects(bad.call('status'), new RegExp(message));
  }
  const denied = createClient({ fetchImpl: async () => response({}, 403) });
  await assert.rejects(denied.call('status'), /HTTP 403/);
  const files = { 'mobile.conf': '[Interface]\nEncryptionKeyFile = secret.key\n', 'secret.key': 'fixture-secret', 'share.link': 'openflux://v1/fixture' };
  const zip = profileZip(files);
  const bytes = Buffer.from(zip), end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 3);
  let position = 0;
  const extracted = {};
  while (bytes.readUInt32LE(position) === 0x04034b50) {
    const size = bytes.readUInt32LE(position + 18), length = bytes.readUInt16LE(position + 26);
    const name = bytes.subarray(position + 30, position + 30 + length).toString('utf8');
    extracted[name] = bytes.subarray(position + 30 + length, position + 30 + length + size).toString('utf8');
    position += 30 + length + size;
  }
  assert.deepEqual(extracted, files);
  assert.throws(() => profileZip({ '../secret.key': 'x' }), /Некорректный/);
  console.log('PASS: ubus auth, method payloads, server errors, logout, portable ZIP profile');
})().catch(e => { console.error(e); process.exitCode = 1; });
