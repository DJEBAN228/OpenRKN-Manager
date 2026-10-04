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
for (const f of ['files/etc/init.d/openrkn', 'files/usr/lib/openrkn/common.sh',
  'files/usr/libexec/rpcd/openrkn', ...fs.readdirSync(path.join(root, 'files/usr/libexec/openrkn')).map(n => 'files/usr/libexec/openrkn/' + n)]) {
  assert(!fs.readFileSync(path.join(root, f)).includes(13), `CR in ${f}`);
  run(['-n', f]);
}
const rpc = fs.readFileSync(path.join(root, 'files/usr/libexec/rpcd/openrkn'), 'utf8');
const list = JSON.parse(run(['files/usr/libexec/rpcd/openrkn', 'list']));
assert.deepEqual(Object.keys(list).sort(), ['status', 'start_service', 'stop_service', 'gen_mobile_profile', 'get_logs'].sort());
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
json_init() { JOUT='{}'; }
json_load() { JIN=$1; JPATH=; jshim load "$JIN"; }
json_select() {
  if [ "$1" = .. ]; then JPATH=\${JPATH%/*}; return; fi
  jshim select "$JIN" "$JPATH" "$1" || return 1
  JPATH="$JPATH/$1"
}
json_get_var() { jvalue=$(jshim get "$JIN" "$JPATH" "$2"); eval "$1=\\$jvalue"; }
json_get_type() { jvalue=$(jshim type "$JIN" "$JPATH" "$2"); eval "$1=\\$jvalue"; }
json_get_keys() { jvalue=$(jshim keys "$JIN" "$JPATH"); eval "$1=\\$jvalue"; }
json_add_string() { JOUT=$(jshim add-string "$JOUT" '' "$1" "$2"); }
json_add_int() { JOUT=$(jshim add-int "$JOUT" '' "$1" "$2"); }
json_add_boolean() { JOUT=$(jshim add-boolean "$JOUT" '' "$1" "$2"); }
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
  assert.equal(exportProfile({ config: { ...fixture.config, negotiate: false } }).error, 'profile_requires_negotiated_session');
  console.log('PASS: POSIX syntax, RPC schema/ACL, log validation/escaping/bounds, profile export and cleanup');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
