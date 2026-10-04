// Test-only stand-in for jshn; production uses OpenWrt's real jshn library.
const fields = require('node:fs').readFileSync(0, 'utf8').split('\n');
const [op, raw, path = '', key = ''] = fields;
const value = fields.slice(4).join('\n');
try {
  const data = JSON.parse(raw);
  let selected = data;
  for (const p of path.split('/').filter(Boolean)) selected = selected[p];
  switch (op) {
    case 'load': break;
    case 'select': if (selected[key] === undefined) process.exit(1); break;
    case 'keys': process.stdout.write(Object.keys(selected).join(' ')); break;
    case 'get': {
      const v = selected[key];
      process.stdout.write(v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      break;
    }
    case 'type': {
      const v = selected[key];
      process.stdout.write(v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double') : typeof v);
      break;
    }
    case 'add-string': data[key] = value; process.stdout.write(JSON.stringify(data)); break;
    case 'add-int': data[key] = Number(value); process.stdout.write(JSON.stringify(data)); break;
    case 'add-boolean': data[key] = value === '1'; process.stdout.write(JSON.stringify(data)); break;
    default: throw Error(op);
  }
} catch { process.exit(1); }
