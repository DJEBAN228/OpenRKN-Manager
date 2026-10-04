const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const zlib = require('node:zlib'), crypto = require('node:crypto'), jsQR = require('jsqr');
const context = { window: {}, module: { exports: {} }, TextEncoder };
vm.runInNewContext(fs.readFileSync('files/www/openrkn/qr.js', 'utf8'), context);
const renderer = context.window.OpenRKNQR;
for (const length of [8, 80, 300, 700, 1400]) {
  const config = { negotiate: true, secret: '0123456789abcdef0123456789abcdef', context: 'openrkn-v1', transports: [
    { type: 'mailru', url: 'https://cloud.mail.ru/public/' + crypto.randomBytes(length).toString('base64url'), priority: 100 }
  ] };
  const link = 'openflux://v1/' + zlib.deflateRawSync(Buffer.from(JSON.stringify(config))).toString('base64url');
  const svg = renderer.toSvg(link, 4);
  const size = Number(svg.match(/viewBox="0 0 (\d+) /)[1]), scale = 5, width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < Number(run) * scale; dx++) {
      const offset = ((Number(y) * scale + dy) * width + Number(x) * scale + dx) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  const decoded = jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
  assert.equal(decoded?.data, link, `QR must round-trip ${link.length} byte link`);
  assert.deepEqual(JSON.parse(zlib.inflateRawSync(Buffer.from(decoded.data.slice(14), 'base64url'))), config);
  const matrix = renderer.encode(link), quiet = 4, pngScale = 8, pngWidth = (matrix.length + quiet * 2) * pngScale;
  const pngPixels = new Uint8ClampedArray(pngWidth * pngWidth * 4).fill(255);
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < pngScale; dy++) for (let dx = 0; dx < pngScale; dx++) {
      const pos = (((y + quiet) * pngScale + dy) * pngWidth + (x + quiet) * pngScale + dx) * 4;
      pngPixels[pos] = pngPixels[pos + 1] = pngPixels[pos + 2] = 0;
    }
  }));
  assert.equal(jsQR(pngPixels, pngWidth, pngWidth, { inversionAttempts: 'dontInvert' })?.data, link);
}
assert.throws(() => renderer.toSvg('x'.repeat(4000)), /слишком велики/);
console.log('PASS: independent QR decoding of real DEFLATE profiles, including long links');
