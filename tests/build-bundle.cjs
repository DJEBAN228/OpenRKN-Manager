// Deterministic POSIX ustar bundle; production runtime needs no Node.js.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const blocks = [];
function entry(name, data) {
  if (Buffer.byteLength(name) > 100) throw new Error('Tar path too long: ' + name);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  const executable = name === 'deploy.sh' || name.includes('/init.d/') || name.includes('/uci-defaults/') || name.includes('/libexec/');
  function octal(offset, length, value) { header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii'); }
  octal(100, 8, executable ? 0o755 : 0o644);
  octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, data.length); octal(136, 12, 0);
  header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6); header.write('00', 263, 2);
  header.write('root', 265); header.write('root', 297);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
}
function add(name) {
  const file = path.join(root, name);
  if (fs.statSync(file).isDirectory()) {
    for (const child of fs.readdirSync(file).sort()) add(name + '/' + child);
  } else entry(name, fs.readFileSync(file));
}
add('deploy.sh'); add('files');
blocks.push(Buffer.alloc(1024));
const archive = zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
archive[9] = 255; // OS-independent gzip header, including on Windows.
fs.writeFileSync(path.join(root, 'openrkn-deploy.tar.gz'), archive);
console.log('Built openrkn-deploy.tar.gz from current deploy.sh and files/');
