const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dash = process.env.DASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/dash.exe' : 'dash');
const shellQuote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const slash = s => s.replaceAll('\\', '/');
const run = (args, input = '') => {
  const p = cp.spawnSync(dash, args, { cwd: root, encoding: 'utf8', input, timeout: 20000 });
  if (p.error) throw p.error;
  assert.equal(p.status, 0, p.stderr || `dash exit ${p.status}`);
  return p.stdout.trim();
};
for (const f of ['files/etc/init.d/openrkn', 'files/usr/lib/openrkn/common.sh', 'files/usr/lib/openrkn/zapret.sh', 'files/usr/lib/openrkn/settings.sh', 'files/usr/lib/openrkn/connectivity.sh', 'files/usr/lib/openrkn/telemetry.sh', 'files/usr/lib/openrkn/transports.sh', 'files/etc/uci-defaults/90-openrkn-uhttpd', 'deploy.sh',
  'files/usr/libexec/rpcd/openrkn', ...fs.readdirSync(path.join(root, 'files/usr/libexec/openrkn')).map(n => 'files/usr/libexec/openrkn/' + n)]) {
  assert(!fs.readFileSync(path.join(root, f)).includes(13), `CR in ${f}`);
  run(['-n', f]);
}
const rpc = fs.readFileSync(path.join(root, 'files/usr/libexec/rpcd/openrkn'), 'utf8');
const list = JSON.parse(run(['files/usr/libexec/rpcd/openrkn', 'list']));
assert.deepEqual(Object.keys(list).sort(), ['status', 'check_connectivity', 'capabilities', 'dpi_state', 'get_config', 'configure', 'start_service', 'restart_service', 'stop_service', 'gen_mobile_profile', 'get_logs'].sort());
const acl = JSON.parse(fs.readFileSync(path.join(root, 'files/usr/share/rpcd/acl.d/openrkn.json')));
assert(!acl['openrkn-read'].read.ubus.openrkn.includes('gen_mobile_profile'));
assert(acl['openrkn-admin'].write.ubus.openrkn.includes('gen_mobile_profile'));

const temp = fs.mkdtempSync(path.join(root, '.host-test-'));
const t = slash(temp);
const node = shellQuote(slash(process.execPath));
const helper = shellQuote(slash(path.join(__dirname, 'json-shim.cjs')));
const shim = `
PATH=/usr/bin:/bin
export PATH
jshim() { printf '%s\\n%s\\n%s\\n%s\\n%s' "$1" "$2" "$3" "$4" "$5" | ${node} ${helper}; }
json_init() { JOUT='{}'; OPATH=; }
json_load() { JIN=$1; JPATH=; jshim load "$JIN"; }
json_select() {
  if [ "$1" = .. ]; then JPATH=\${JPATH%/*}; return; fi
  jshim select "$JIN" "$JPATH" "$1" || return 1
  JPATH="$JPATH/$1"
}
json_get_var() { jvalue=$(jshim get "$JIN" "$JPATH" "$2"); eval "$1=\\$jvalue"; }
json_get_type() { jvalue=$(jshim type "$JIN" "$JPATH" "$2"); eval "$1=\\$jvalue"; }
json_get_keys() { jvalue=$(jshim keys "$JIN" "$JPATH"); eval "$1=\\$jvalue"; }
json_add_string() { JOUT=$(jshim add-string "$JOUT" "$OPATH" "$1" "$2"); }
json_add_int() { JOUT=$(jshim add-int "$JOUT" "$OPATH" "$1" "$2"); }
json_add_boolean() { JOUT=$(jshim add-boolean "$JOUT" "$OPATH" "$1" "$2"); }
json_add_object() { JOUT=$(jshim add-object "$JOUT" "$OPATH" "$1"); OPATH="$OPATH/$1"; }
json_close_object() { OPATH=\${OPATH%/*}; }
json_dump() { printf '%s\\n' "$JOUT"; }
or_error() { json_init; json_add_boolean ok 0; json_add_string error "$1"; json_dump; }
OR_LOG=${shellQuote(t + '/log')}
OR_RUN=${shellQuote(t + '/run')}
OR_FLUX=${shellQuote(t + '/fakeflux')}
or_pid() { printf '12345\\n'; }
or_config() { OR_PROFILE_TIMEOUT=1; }
`;
try {
  fs.mkdirSync(path.join(temp, 'run'));
  fs.mkdirSync(path.join(temp, 'profiles'));
  const zapretProbe = fs.readFileSync(path.join(root, 'files/usr/lib/openrkn/zapret.sh'), 'utf8')
    .replaceAll('/etc/init.d/zapret', t + '/zapret-init').replaceAll('/proc/[0-9]*/exe', t + '/proc/[0-9]*/exe');
  fs.mkdirSync(t + '/proc'); fs.mkdirSync(t + '/proc/123');
  fs.writeFileSync(t + '/proc/123/exe', '');
  fs.writeFileSync(t + '/proc/123/cmdline', '/opt/zapret/nfq/nfqws\0--qnum=200\0');
  fs.writeFileSync(t + '/zapret-init', '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(t + '/zapret-test', shim + `
phase=$1
readlink() { [ "$phase" != not_running ] || return 1; printf '/opt/zapret/nfq/nfqws\\n'; }
uci() {
  case "$*" in
    *NFQWS_OPT) [ "$phase" = not_configured ] || printf '%s' '--dpi-desync=multisplit';;
    *NFQWS_ENABLE) printf 1;;
    *FILTER_MARK) [ "$phase" != check_filters ] || printf 1;;
  esac
  return 0
}
nft() { [ "$phase" != rules_missing ] || return 1; printf 'type filter hook postrouting priority 101; queue num 200 bypass\\n'; }
` + zapretProbe + '\nor_zapret_probe\njson_init\nor_zapret_json\njson_dump\n');
  for (const phase of ['detected', 'not_running', 'not_configured', 'rules_missing', 'check_filters']) {
    assert.equal(JSON.parse(run([t + '/zapret-test', phase])).zapret.state, phase);
  }
  fs.unlinkSync(t + '/zapret-init');
  assert.equal(JSON.parse(run([t + '/zapret-test', 'detected'])).zapret.state, 'not_installed');
  const initSource = fs.readFileSync(path.join(root, 'files/etc/init.d/openrkn'), 'utf8');
  assert(!initSource.includes('procd_open_instance nfqws'), 'external Zapret must not have a second owner');
  assert(!/\bqueue\s+num\b/.test(fs.readFileSync(path.join(root, 'files/usr/share/nftables.d/table-post/90-openrkn.nft'), 'utf8')), 'do not queue traffic twice');
  const webDir = t + '/web';
  fs.mkdirSync(webDir, { mode: 0o700 });
  fs.mkdirSync(webDir + '/assets', { mode: 0o700 });
  fs.writeFileSync(webDir + '/index.html', '<!doctype html>', { mode: 0o600 });
  fs.writeFileSync(webDir + '/assets/app.js', '// public asset', { mode: 0o600 });
  const httpDefaults = fs.readFileSync(path.join(root, 'files/etc/uci-defaults/90-openrkn-uhttpd'), 'utf8')
    .replaceAll('/www/openrkn', webDir);
  fs.writeFileSync(t + '/http-defaults', `PATH=/usr/bin:/bin\nexport PATH\nuci() { printf '%s\\n' "$@" >> ${shellQuote(t + '/http.args')}; }\n` + httpDefaults);
  run([t + '/http-defaults']);
  const httpArgs = fs.readFileSync(t + '/http.args', 'utf8');
  assert(httpArgs.includes('uhttpd.openrkn.index_page=index.html'));
  assert(httpArgs.includes('uhttpd.openrkn.no_ubusauth=0'));
  if (process.platform !== 'win32') {
    for (const directory of [webDir, webDir + '/assets']) assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
    for (const file of [webDir + '/index.html', webDir + '/assets/app.js']) assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  }
  const confDir = t + '/configuration';
  fs.mkdirSync(confDir);
  fs.writeFileSync(confDir + '/secret.key', '0123456789abcdef0123456789abcdef');
  const settings = fs.readFileSync(path.join(root, 'files/usr/lib/openrkn/settings.sh'), 'utf8')
    .replaceAll('/etc/openrkn', confDir);
  fs.writeFileSync(path.join(temp, 'settings'), shim + `
or_config() { OR_CONF=${shellQuote(confDir + '/exit.conf')}; }
chown() { :; }
uci() { printf '%s\\n' "$@" >> ${shellQuote(t + '/uci.args')}; }
` + settings + '\nor_settings\n');
  const configure = request => JSON.parse(run([t + '/settings'], JSON.stringify(request) + '\n'));
  const mailru = { session_mode: 'strict', transport: 'mailru', url: 'https://docs.mail.ru/test-fixture?x=1&y=2', share_host: '', dpi_enabled: false };
  assert.equal(configure(mailru).ok, true);
  assert(fs.readFileSync(confDir + '/exit.conf', 'utf8').includes('[Transport mailru]\nType = mailru\nPriority = 100\nURL = ' + mailru.url));
  assert(fs.readFileSync(t + '/uci.args', 'utf8').includes('openrkn.main.url=' + mailru.url));
  assert.equal(configure({ ...mailru, url: '' }).error, 'document_url_required');
  assert.equal(configure({ ...mailru, url: 'http://docs.mail.ru/x' }).error, 'document_url_required');
  assert.equal(configure({ ...mailru, url: "https://docs.mail.ru/x'\nRole = client" }).error, 'invalid_transport_settings');
  assert.equal(configure({ ...mailru, transport: 'unknown' }).error, 'unsupported_transport');
  assert.equal(configure({ ...mailru, transport: 'yandex', url: '' }).error, 'document_url_required');
  assert.equal(configure({ ...mailru, encryption: 'disabled', codec: 'legacy' }).ok, true);
  const plainExit = fs.readFileSync(confDir + '/exit.conf', 'utf8');
  assert(plainExit.includes('Transport = mailru'));
  assert(!plainExit.includes('EncryptionKeyFile'));
  assert.equal(configure({ ...mailru, codec: 'legacy' }).error, 'legacy_requires_plain_profile');
  assert.equal(configure({ ...mailru, encryption_key: 'too-short' }).error, 'invalid_encryption_key');
  assert.equal(configure({ ...mailru, encryption_key: '0123456789abcdefNEWKEY' }).ok, true);
  assert.equal(fs.readFileSync(confDir + '/secret.key', 'utf8').trim(), '0123456789abcdefNEWKEY');
  assert.equal(configure({ ...mailru, transport: 'direct', share_host: 'example.com', encryption: 'disabled' }).error, 'direct_requires_encrypted_batched');
  assert.equal(configure({ ...mailru, session_mode: 'compatible' }).ok, true);
  assert(fs.readFileSync(confDir + '/exit.conf', 'utf8').includes('Transport = mailru'));
  const transportLibrary = slash(path.join(root, 'files/usr/lib/openrkn/transports.sh'));
  const checkTransport = (config, mode = 'ready') => {
    fs.writeFileSync(t + '/transport.conf', config);
    return run(['-c', `PATH=/usr/bin:/bin; export PATH; . ${shellQuote(transportLibrary)}; if or_transports_valid ${shellQuote(t + '/transport.conf')} ${shellQuote(mode)}; then printf yes; else printf no; fi`]);
  };
  const document = '[Transport document]\nType = mailru\n';
  assert.equal(checkTransport(plainExit), 'yes');
  const connectivity = fs.readFileSync(path.join(root, 'files/usr/lib/openrkn/connectivity.sh'), 'utf8').replaceAll('/tmp/openrkn-probe.', t + '/probe.');
  fs.writeFileSync(t + '/probe-test', shim + '\ntimeout() { [ "$PROBE_FAIL" != 1 ]; }\n' + connectivity + '\nor_connectivity\n');
  const goodProbe = JSON.parse(run([t + '/probe-test']));
  assert.equal(goodProbe.scope, 'router');
  assert.equal(goodProbe.https_fetch, true);
  const failedProbe = JSON.parse(run(['-c', `PROBE_FAIL=1; export PROBE_FAIL; . ${shellQuote(t + '/probe-test')}`]));
  assert.equal(failedProbe.ip_ping, false);
  assert.equal(failedProbe.dns_lookup, false);
  assert.equal(failedProbe.https_fetch, false);
  assert.equal(checkTransport(document), 'no', 'missing URL must prevent starting');
  assert.equal(checkTransport(document, 'supported'), 'yes', 'unfinished supported config must be preserved');
  assert.equal(checkTransport(document + 'URL = https://cloud.mail.ru/public/fixture/document\n'), 'yes');
  assert.equal(checkTransport(document + 'URL = http://example.org\n'), 'no');
  assert.equal(checkTransport('[Transport direct]\nType = direct\nListen = 0.0.0.0:8443\n'), 'yes');
  assert.equal(checkTransport('[Transport unknown]\nType = unknown\n', 'supported'), 'no');
  assert.equal(checkTransport(document + 'URL = https://example.org\n[Transport bad]\nType = unknown\n'), 'no', 'every transport must be supported');
  const rpcMock = rpc.replace('. /usr/lib/openrkn/common.sh', shim);
  fs.writeFileSync(path.join(temp, 'rpc'), rpcMock);
  const invoke = req => JSON.parse(run([t + '/rpc', 'call', 'get_logs'], req + '\n'));
  for (const req of ['{"lines":0}', '{"lines":1001}', '{"lines":-1}', '{"lines":1.5}',
    '{"lines":"$(touch injected)"}', '{"lines":"1"}', '{"lines":null}', 'bad json']) {
    assert.equal(invoke(req).ok, false, req);
  }
  assert(!fs.existsSync(path.join(root, 'injected')));
  fs.writeFileSync(path.join(temp, 'log'), 'first\nsecond "quoted" \\ slash\nthird\n');
  assert.equal(invoke('{"lines":2}').logs, 'second "quoted" \\ slash\nthird');
  assert.equal(invoke('{}').requested_lines, 100);
  fs.unlinkSync(path.join(temp, 'log'));
  assert.equal(invoke('{}').logs, '');
  fs.writeFileSync(path.join(temp, 'log'), 'a'.repeat(70000) + '\n');
  assert(invoke('{"lines":1}').logs.length <= 65536);

  fs.writeFileSync(path.join(temp, 'run/share.link'), 'openflux://v1/fixture\n');
  fs.writeFileSync(path.join(temp, 'run/desired'), '');
  fs.writeFileSync(path.join(temp, 'fakeflux'), `#!/bin/sh\n[ "$1" = --parse-link ] || exit 1\ncat ${shellQuote(t + '/fixture.json')}\n`, { mode: 0o755 });
  const profile = fs.readFileSync(path.join(root, 'files/usr/libexec/openrkn/profile'), 'utf8')
    .replace('. /usr/lib/openrkn/common.sh', shim).replaceAll('/etc/openrkn/profiles', t + '/profiles');
  fs.writeFileSync(path.join(temp, 'profile'), profile);
  const fixture = { config: { negotiate: true, secret: '0123456789abcdef0123456789abcdef', context: 'openrkn-v1',
    transports: [{ type: 'direct', dial: 'exit.example.org:8443', priority: 100 }] } };
  const exportProfile = f => {
    fs.writeFileSync(path.join(temp, 'fixture.json'), JSON.stringify(f));
    return JSON.parse(run([t + '/profile']));
  };
  const result = exportProfile(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.files['secret.key'], fixture.config.secret);
  assert(result.files['mobile.conf'].includes('EncryptionKeyFile = secret.key'));
  assert(result.config.includes('Role = client'));
  assert(result.config.includes('Dial = exit.example.org:8443'));
  assert(result.config.includes('SessionContext = openrkn-v1'));
  const dirs = fs.readdirSync(path.join(temp, 'profiles'));
  assert.equal(dirs.length, 1);
  assert.equal(fs.readFileSync(path.join(temp, 'profiles', dirs[0], 'secret.key'), 'utf8'), fixture.config.secret);
  assert.equal(exportProfile({ config: { ...fixture.config, context: 'bad#context' } }).error, 'unrepresentable_ini_context');
  assert.equal(exportProfile({ config: { ...fixture.config, transports: [{ type: 'direct', name: '../../escape', dial: 'x:1' }] } }).error, 'invalid_transport_name');
  assert.equal(fs.readdirSync(path.join(temp, 'profiles')).length, 1, 'failed export must clean up');
  assert.equal(exportProfile({ config: { ...fixture.config, context: '' } }).ok, true, 'empty context must not fail shell group');
  assert.equal(exportProfile({ config: { ...fixture.config, negotiate: false } }).error, 'direct_requires_session');
  const plain = exportProfile({ config: { negotiate: false, codec: 'legacy', transports: [{ type: 'mailru', url: 'https://example.com/doc' }] } });
  assert.equal(plain.ok, true);
  assert(!plain.files['secret.key']);
  assert(plain.config.includes('Transport = mailru'));
  assert(!plain.config.includes('[Transport '));
  console.log('PASS: POSIX syntax, uhttpd permissions/index, external Zapret integration, RPC/ACL, logs, transports and profiles');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
