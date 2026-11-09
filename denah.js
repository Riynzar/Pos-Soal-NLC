'use strict';
// Sinkron data Denah (jumlah item per tim) dari Google Sheets — tanpa dependensi.
// Spreadsheet diunduh sebagai .xlsx (semua tab sekaligus), lalu dicari tabel
// "Rekap Jumlah Item": baris header berisi S N H P T L M, dan baris berlabel A-1 … E-15.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const https = require('https');

const ITEMS = ['S', 'N', 'H', 'P', 'T', 'L', 'M'];

// ---------- unzip + baca xlsx ----------
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Bukan file xlsx');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.slice(ds, ds + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nl + xl + cl;
  }
  return out;
}
const unesc = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, g) => {
  const k = g.toLowerCase();
  if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
const texts = x => { let s = ''; x.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, t) => { s += t; }); return unesc(s); };
const colIdx = l => { let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function readXlsx(buf) {
  const f = unzip(buf), str = k => (f[k] ? f[k].toString('utf8') : '');
  const ss = []; str('xl/sharedStrings.xml').replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, x) => { ss.push(texts(x)); });
  const rel = {}; str('xl/_rels/workbook.xml.rels').replace(/<Relationship\b([^>]*)\/?>/g, (_, a) => {
    const id = /Id="([^"]+)"/.exec(a), t = /Target="([^"]+)"/.exec(a);
    if (id && t) rel[id[1]] = t[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  });
  const sheets = [];
  str('xl/workbook.xml').replace(/<sheet\b([^>]*)\/?>/g, (_, a) => {
    const nm = /name="([^"]*)"/.exec(a), id = /r:id="([^"]+)"/.exec(a);
    if (!nm || !id || !rel[id[1]]) return;
    const grid = [];
    str('xl/' + rel[id[1]]).replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, at, body) => {
      const r = /\br="([A-Z]+)(\d+)"/.exec(at); if (!r || !body) return;
      const t = (/\bt="([^"]+)"/.exec(at) || [])[1];
      let v;
      if (t === 'inlineStr') v = texts(body);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body); if (!vm) return;
        v = t === 's' ? ss[+vm[1]] : unesc(vm[1]);
      }
      const ri = +r[2] - 1, ci = colIdx(r[1]);
      (grid[ri] = grid[ri] || [])[ci] = v;
    });
    sheets.push({ name: unesc(nm[1]), grid });
  });
  return sheets;
}

// Cari tabel rekap di semua tab. Hasil: { "A|1": {S,N,H,P,T,L,M}, ... }
const norm = v => (v == null ? '' : String(v)).normalize('NFKC')
  .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
  .replace(/\s+/g, ' ').trim().toUpperCase();
// Cek aturan peletakan (rulebook): barang L/T/M harus bersebelahan (atas/bawah/kiri/kanan)
// dengan Shelter, dan harus punya akses jalan (sel kosong atau gerbang di sebelahnya).
function checkPlacement(sh, p, TIM, place) {
  let hr = -1, cols = null;
  for (let ri = 0; ri < sh.grid.length && hr < 0; ri++) {
    const c = Array.from(sh.grid[ri] || [], norm);
    for (let ci = 0; ci < c.length; ci++) if (c[ci] === '1') {
      const cs = []; for (let k = 0; c[ci + k] === String(k + 1); k++) cs.push(ci + k);
      if (cs.length >= 5) { hr = ri; cols = cs; break; }
    }
  }
  if (hr < 0) return 0;
  const lc = cols[0] - 1, g = [], lbl = [];
  for (let ri = hr + 1; ri < sh.grid.length; ri++) {
    const row = Array.from(sh.grid[ri] || [], norm);
    if (!/^[A-Z]$/.test(row[lc] || '')) break;
    lbl.push(row[lc]); g.push(cols.map(ci => row[ci] || ''));
  }
  const R = g.length, C = cols.length, item = /^([SNHPTLM]) ?(\d{1,2})$/;
  let n = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const m = item.exec(g[r][c]); if (!m || !'LTM'.includes(m[1])) continue;
    const t = +m[2]; if (t < 1 || t > TIM) continue;
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && x >= 0 && y < R && x < C);
    const shelter = nb.some(([y, x]) => /^S ?\d/.test(g[y][x]));
    const jalan = nb.some(([y, x]) => g[y][x] === 'GR' || (g[y][x] === '' && y > 0 && x > 0 && y < R - 1 && x < C - 1));
    const at = `${m[1]}${t} di ${lbl[r]}${c + 1}`, k = p + '|' + t;
    if (!shelter) { (place[k] = place[k] || []).push(`${at}: tidak bersebelahan dengan Shelter`); n++; }
    if (!jalan) { (place[k] = place[k] || []).push(`${at}: tidak punya akses jalan`); n++; }
  }
  return n;
}
function parseDenah(sheets, POS, TIM) {
  const items = {}, found = [], warns = [], diag = [], place = {};
  const lab = new RegExp('^([' + POS.join('') + '])\\s*-\\s*(\\d{1,2})$', 'i');
  for (const sh of sheets) {
    let hdr = null, n = 0;
    for (let ri = 0; ri < sh.grid.length; ri++) {
      const row = sh.grid[ri]; if (!row) continue;
      const cells = Array.from(row, norm);
      // header = 7 sel BERURUTAN (tanpa celah) yang isinya tepat S N H P T L M (urutan bebas).
      // Grid Denah juga punya sel "T" di baris yang sama, jadi jangan ambil huruf pertama yang ketemu.
      let w = -1;
      for (let ci = 0; ci + ITEMS.length <= cells.length; ci++) {
        const win = cells.slice(ci, ci + ITEMS.length);
        if (ITEMS.every(L => win.includes(L)) && new Set(win).size === ITEMS.length) { w = ci; break; }
      }
      if (w >= 0) {
        hdr = { min: w }; ITEMS.forEach(L => { hdr[L] = w + cells.slice(w, w + ITEMS.length).indexOf(L); });
        continue;
      }
      if (!hdr) continue;
      for (let ci = Math.min(hdr.min, cells.length) - 1; ci >= 0; ci--) {
        const m = lab.exec(cells[ci]); if (!m) continue;
        const p = m[1].toUpperCase(), t = +m[2];
        if (t < 1 || t > TIM) break;
        const k = p + '|' + t;
        if (items[k]) { warns.push(`${p}-${t} muncul dua kali (tab "${sh.name}") — yang pertama dipakai`); break; }
        const o = {};
        for (const L of ITEMS) { const x = Number(String(row[hdr[L]] == null ? 0 : row[hdr[L]]).replace(',', '.')); o[L] = Number.isFinite(x) && x > 0 ? Math.round(x) : 0; }
        items[k] = o; n++; sh.pos = sh.pos || p;
        break;
      }
    }
    if (n) found.push(`${sh.name} (${n} tim)`);
    if (n && sh.pos) checkPlacement(sh, sh.pos, TIM, place);
    // catatan diagnosis bila tab ini tidak menghasilkan data
    if (!n) {
      let labs = 0, hdrHits = 0, rekap = false;
      for (const row of sh.grid) if (row) {
        const c = Array.from(row, norm);
        if (c.some(x => lab.test(x))) labs++;
        hdrHits = Math.max(hdrHits, ITEMS.filter(L => c.includes(L)).length);
        if (c.some(x => x.includes('REKAP'))) rekap = true;
      }
      diag.push(`${sh.name}: ${sh.grid.filter(Boolean).length} baris, header ${hdrHits}/7 huruf, ${labs} label tim${rekap ? ', ada tulisan Rekap' : ''}`);
    }
  }
  return { items, found, warns, diag, place };
}

// ---------- unduh ----------
function exportUrl(link) {
  link = String(link).trim();
  let m = /docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/.exec(link);
  if (m) return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=xlsx`;
  m = /docs\.google\.com\/spreadsheets\/d\/([\w-]+)/.exec(link);
  if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  if (/^https?:\/\//i.test(link)) return link; // link langsung ke file .xlsx
  return null;
}
function download(url, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'pos-soal' }, timeout: 20000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops > 6) return reject(new Error('Terlalu banyak redirect'));
        return resolve(download(new URL(res.headers.location, url).toString(), hops + 1));
      }
      const chunks = []; let len = 0;
      res.on('data', d => { chunks.push(d); len += d.length; if (len > 30e6) req.destroy(new Error('File terlalu besar')); });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Waktu habis')));
    req.on('error', reject);
  });
}

// ---------- modul ----------
module.exports = function createDenah(opt) {
  const { dataDir, POS, TIM, onChange, defaultLinks } = opt;
  const CFG = path.join(dataDir, 'denah-config.json');
  const CACHE = path.join(dataDir, 'denah-cache.json');
  let cfg = { links: defaultLinks || [], interval: 30 };
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(CFG, 'utf8'))); } catch (e) {}
  // state yang dikirim ke client
  const st = { items: {}, at: 0, tried: 0, err: '', warns: [], found: [], place: {}, links: cfg.links, interval: cfg.interval, syncing: false };
  try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); st.items = c.items || {}; st.at = c.at || 0; st.found = c.found || []; st.warns = c.warns || []; st.place = c.place || {}; } catch (e) {}

  let timer = null, running = null;
  const pub = () => ({ items: st.items, at: st.at, tried: st.tried, err: st.err, warns: st.warns, found: st.found, place: st.place, links: st.links, interval: st.interval, syncing: st.syncing });

  async function sync() {
    if (running) return running;
    running = (async () => {
      st.syncing = true; st.tried = Date.now();
      const errs = [], all = { items: {}, found: [], warns: [], place: {} };
      if (!cfg.links.length) errs.push('Link spreadsheet Denah belum diisi (halaman Admin)');
      for (const link of cfg.links) {
        const url = exportUrl(link);
        if (!url) { errs.push(`Link tidak dikenali: ${link}`); continue; }
        try {
          const r = await download(url);
          if (r.status === 401 || r.status === 403 || r.status === 404 || (r.body.slice(0, 2).toString() !== 'PK')) {
            errs.push(r.status === 404 ? 'Spreadsheet tidak ditemukan — cek link' : 'Spreadsheet tidak bisa dibaca. Atur Share → "Siapa saja yang memiliki link" → Viewer');
            continue;
          }
          const p = parseDenah(readXlsx(r.body), POS, TIM);
          for (const k in p.items) { if (all.items[k]) all.warns.push(`${k.replace('|', '-')} ada di lebih dari satu file — yang pertama dipakai`); else all.items[k] = p.items[k]; }
          all.found.push(...p.found); all.warns.push(...p.warns);
          for (const k in p.place) if (!all.place[k]) all.place[k] = p.place[k];
          if (!p.found.length) errs.push('Tabel "Rekap Jumlah Item" tidak ketemu. Yang terbaca \u2192 ' + (p.diag.length ? p.diag.slice(0, 12).join(' | ') : 'tidak ada tab sama sekali'));
        } catch (e) {
          errs.push('Tidak bisa terhubung ke Google Sheets (' + (e.code || e.message) + '). Cek internet laptop host');
        }
      }
      st.syncing = false;
      if (!errs.length || Object.keys(all.items).length) {
        // berhasil (setidaknya sebagian): pakai data baru
        const changed = JSON.stringify([all.items, all.place]) !== JSON.stringify([st.items, st.place]);
        st.items = all.items; st.found = all.found; st.warns = all.warns; st.place = all.place; st.at = Date.now();
        st.err = errs.join(' · ');
        try { fs.writeFileSync(CACHE, JSON.stringify({ items: st.items, at: st.at, found: st.found, warns: st.warns, place: st.place })); } catch (e) {}
        onChange(pub(), changed);
      } else {
        // gagal total: data lama (cache) tetap dipakai
        st.err = errs.join(' · ');
        onChange(pub(), false);
      }
    })().finally(() => { running = null; });
    return running;
  }
  function schedule() {
    clearInterval(timer);
    timer = setInterval(sync, Math.max(10, cfg.interval) * 1000);
  }
  function setConfig(links, interval) {
    cfg.links = links.map(s => String(s).trim()).filter(Boolean).slice(0, 10);
    if (interval) cfg.interval = Math.min(600, Math.max(10, Math.round(+interval) || 30));
    st.links = cfg.links; st.interval = cfg.interval;
    fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
    schedule();
    return sync();
  }
  schedule(); setTimeout(sync, 500);
  return { state: pub, sync, setConfig, ITEMS };
};
module.exports.readXlsx = readXlsx;
module.exports.parseDenah = parseDenah;
