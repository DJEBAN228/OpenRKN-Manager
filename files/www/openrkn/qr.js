/* QR encoder supplied with the user's WebOS shell. */
(function(){
const QR = (() => {
  const ECC_PER_BLOCK = {
    L:[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    M:[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28]
  };
  const NUM_BLOCKS = {
    L:[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    M:[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49]
  };
  const FMT_BITS = { L:1, M:0 };
  const rawModules = v => {
    let r = (16*v + 128)*v + 64;
    if (v >= 2) { const n = Math.floor(v/7) + 2; r -= (25*n - 10)*n - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataCodewords = (v, e) => Math.floor(rawModules(v)/8) - ECC_PER_BLOCK[e][v]*NUM_BLOCKS[e][v];
  const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const rsDivisor = deg => {
    const r = new Array(deg).fill(0); r[deg-1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j+1 < deg) r[j] ^= r[j+1]; } root = gfMul(root, 2); }
    return r;
  };
  const rsRemainder = (data, div) => {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => r[i] ^= gfMul(c, f)); }
    return r;
  };
  const utf8 = s => Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  function makeCodewords(bytes, ver, ecl) {
    const bits = []; const put = (val, len) => { for (let i = len-1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i+j]; out.push(b); }
    for (let pad = 0xEC; out.length < cap/8; pad ^= 0xEC ^ 0x11) out.push(pad);
    return out;
  }
  function addEcc(data, ver, ecl) {
    const nb = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver];
    const raw = Math.floor(rawModules(ver)/8), nShort = nb - raw % nb, shortLen = Math.floor(raw/nb);
    const div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += d.length;
      const ecc = rsRemainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(ecc));
    }
    const res = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) res.push(b[i]); });
    return res;
  }
  const MASKS = [
    (x,y)=>(x+y)%2===0, (x,y)=>y%2===0, (x,y)=>x%3===0, (x,y)=>(x+y)%3===0,
    (x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0, (x,y)=>x*y%2+x*y%3===0,
    (x,y)=>(x*y%2+x*y%3)%2===0, (x,y)=>((x+y)%2+x*y%3)%2===0
  ];
  function build(codewords, ver, ecl) {
    const size = ver*4 + 17;
    const M = Array.from({length:size}, () => new Array(size).fill(false));
    const F = Array.from({length:size}, () => new Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    const inb = (x, y) => x >= 0 && y >= 0 && x < size && y < size;
    for (let i = 0; i < size; i++) { set(6, i, i%2 === 0); set(i, 6, i%2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx+dx, y = cy+dy; if (inb(x, y)) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size-4, 3); finder(3, size-4);
    let pos = [];
    if (ver > 1) { const n = Math.floor(ver/7) + 2, step = ver === 32 ? 26 : Math.ceil((ver*4+4)/(n*2-2))*2; pos = [6]; for (let p = size-7; pos.length < n; p -= step) pos.splice(1, 0, p); }
    pos.forEach((cy, i) => pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length-1) || (i === pos.length-1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx+dx, cy+dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const fmt = mask => {
      const d = (FMT_BITS[ecl] << 3) | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = ((d << 10) | r) ^ 0x5412, b = i => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, b(i));
      set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
      for (let i = 9; i < 15; i++) set(14-i, 8, b(i));
      for (let i = 0; i < 8; i++) set(size-1-i, 8, b(i));
      for (let i = 8; i < 15; i++) set(8, size-15+i, b(i));
      set(8, size-8, true);
    };
    fmt(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const bits = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const bit = ((bits >>> i) & 1) !== 0, a = size - 11 + i%3, b = Math.floor(i/3); set(a, b, bit); set(b, a, bit); }
    }
    let i = 0;
    for (let right = size-1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right+1) & 2) === 0, y = up ? size-1-vert : vert;
        if (!F[y][x] && i < codewords.length*8) { M[y][x] = ((codewords[i>>>3] >>> (7-(i&7))) & 1) !== 0; i++; }
      }
    }
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let t = 0; t < 2; t++) for (let a = 0; a < size; a++) { let run = 1; for (let b = 1; b < size; b++) { const cur = t ? M[b][a] : M[a][b], prev = t ? M[b-1][a] : M[a][b-1]; if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (M[y][x]) dark++; if (x < size-1 && y < size-1 && M[y][x] === M[y][x+1] && M[y][x] === M[y+1][x] && M[y][x] === M[y+1][x+1]) p += 3; }
      return p + Math.floor(Math.abs(dark*20 - size*size*10) / (size*size)) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); fmt(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } applyMask(m); }
    applyMask(best); fmt(best);
    return M;
  }
  function encode(text) {
    const bytes = utf8(text);
    for (const ecl of ['M', 'L']) for (let ver = 1; ver <= 40; ver++) {
      if (4 + (ver <= 9 ? 8 : 16) + bytes.length*8 <= dataCodewords(ver, ecl)*8) return build(addEcc(makeCodewords(bytes, ver, ecl), ver, ecl), ver, ecl);
    }
    throw new Error('Данные слишком велики для QR-кода');
  }
  function toSvg(text, quiet = 4) {
    const m = encode(text), n = m.length, s = n + quiet*2; let d = '';
    for (let y = 0; y < n; y++) { let x = 0; while (x < n) { if (!m[y][x]) { x++; continue; } let w = 1; while (x+w < n && m[y][x+w]) w++; d += `M${x+quiet} ${y+quiet}h${w}v1h-${w}z`; x += w; } }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { toSvg, encode };
})();

/* =====================================================================
 *  UTILS
 * ===================================================================== */

window.OpenRKNQR=QR;
})();
