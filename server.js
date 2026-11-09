'use strict';
// Server Pos Soal — tanpa dependensi, cukup Node.js >= 16.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'tecinikal'; // ganti: set ADMIN_PASSWORD=... sebelum start
const DATA_DIR = process.env.DATA_DIR || __dirname;
const EVENTS = path.join(DATA_DIR, 'events.jsonl');
const POS = ['A', 'B', 'C', 'D', 'E'];
const TIM = 15;

// Kode soal (sesuai Excel). Stok global per kode: Essential 6, Non-Essential 15.
const CODES = [];
// [harga beli, reward Benar] dalam Neleci
const PRICE = { H: [10, 15], N: [15, 25], P: [20, 35], L: [15, 15], T: [20, 25], M: [25, 35] };
const START = 100; // saldo awal tiap tim (Neleci)
[['Essential', 'HNP', 6, 6], ['Non-Essential', 'LTM', 7, 15]].forEach(([cat, letters, n, limit]) => {
  for (const L of letters) for (let i = 1; i <= n; i++) CODES.push({ code: `${L}-${i}`, cat, grp: L, limit, price: PRICE[L][0], reward: PRICE[L][1] });
});
const CMAP = Object.fromEntries(CODES.map(c => [c.code, c]));

// ---------- State (di memori, dibangun dari events.jsonl) ----------
let seq = 0;
const rows = {};            // "A|1|H-1" -> [beli, salah, benar]
const used = {};            // kode -> sum(beli - salah) di semua pos & tim
const log = [];             // semua entri log (lama -> baru)
const byN = new Map();
const stacks = {};          // key baris -> daftar n aksi yang belum di-undo
CODES.forEach(c => (used[c.code] = 0));
const saldo = {};           // "A|3" (pos|tim) -> saldo Neleci; tiap pos-tim adalah tim berbeda
for (const p of POS) for (let t = 1; t <= TIM; t++) saldo[p + '|' + t] = START;
const rkey = (p, t, c) => `${p}|${t}|${c}`;

// ---------- Item Denah (beli langsung di Pos Denah tiap kubu) ----------
// Shelter (S) selalu dibeli. L/T/M: yang dibayar = jumlah di Denah − jumlah soal Benar jenis itu (kupon).
// H/N/P tidak bisa dibeli, hanya dari soal Benar.
const ITEM_PRICE = { S: 5, L: 25, T: 35, M: 55 };
const DEFAULT_LINK = 'https://docs.google.com/spreadsheets/d/1BQ7-g9CV6u9IFy0tUtmydtrnZK4jwIr9jPy4n784Gmg/edit?gid=1762298749';
function benarOf(p, t) {
  const o = { H: 0, N: 0, P: 0, L: 0, T: 0, M: 0 };
  for (const c of CODES) { const r = rows[rkey(p, t, c.code)]; if (r && r[2] >= 1) o[c.grp]++; }
  return o;
}
function itemInfo(p, t) { // belanja item satu pos-tim
  const cnt = (denah && denah.state().items[p + '|' + t]) || { S: 0, N: 0, H: 0, P: 0, T: 0, L: 0, M: 0 };
  const ben = benarOf(p, t), bayar = { S: cnt.S }, warn = [];
  for (const L of ['L', 'T', 'M']) bayar[L] = Math.max(0, cnt[L] - ben[L]);
  for (const L of ['H', 'N', 'P']) if (cnt[L] > ben[L]) warn.push(`${L} di Denah ${cnt[L]}, soal ${L} Benar ${ben[L]}`);
  if (denah) warn.push(...(denah.state().place[p + '|' + t] || []));
  let spend = 0; for (const L in ITEM_PRICE) spend += bayar[L] * ITEM_PRICE[L];
  return { cnt, ben, bayar, spend, warn };
}
const efektif = (p, t) => saldo[p + '|' + t] - itemInfo(p, t).spend;
let denah = null;

function valid(e) {
  return CMAP[e.code] && POS.includes(e.pos) && Number.isInteger(e.tim) && e.tim >= 1 && e.tim <= TIM;
}

function doAct(e, replay) {
  if (!valid(e)) return { err: 'Data tidak valid' };
  const k = rkey(e.pos, e.tim, e.code), c = CMAP[e.code];
  const r = rows[k] || [0, 0, 0];
  const [b, s, z] = r;
  if (z >= 1) return { err: 'Soal ini sudah Selesai (Benar)' };
  let d = 0;
  const sk = e.pos + '|' + e.tim, before = saldo[sk];
  if (e.act === 'beli') {
    if (!replay && b > s) return { err: 'Sudah dibeli — menunggu hasil. Beli lagi hanya setelah Salah' };
    if (c.limit - used[e.code] <= 0) return { err: `Stok ${e.code} habis` };
    r[0]++; used[e.code]++; d = -c.price;
  } else if (e.act === 'salah' || e.act === 'benar') {
    if (s + z + 1 > b) return { err: 'Salah + Benar tidak boleh melebihi Beli' };
    if (e.act === 'salah') { r[1]++; used[e.code]--; } else { r[2]++; d = c.reward; }
  } else return { err: 'Aksi tidak dikenal' };
  saldo[sk] += d;
  rows[k] = r;
  let warn = '';
  const item = replay ? 0 : itemInfo(e.pos, e.tim).spend, ef = saldo[sk] - item;
  if (ef < 0) warn = e.act === 'beli' ? `Saldo kurang: harga ${c.price}, saldo ${before - item} → ${ef}` : `Saldo minus: ${ef}`;
  return { ok: true, k, d, bal: saldo[sk], warn };
}

function doUndo(e, replay) {
  if (!valid(e)) return { err: 'Data tidak valid' };
  const k = rkey(e.pos, e.tim, e.code), c = CMAP[e.code];
  const st = stacks[k];
  if (!st || !st.length) return { err: 'Tidak ada aksi untuk dibatalkan' };
  const target = byN.get(st[st.length - 1]);
  const r = rows[k];
  let d = 0;
  const sk = e.pos + '|' + e.tim;
  if (target.act === 'beli') {
    if (r[0] - 1 < r[1] + r[2]) return { err: 'Tidak bisa batal Beli' };
    r[0]--; used[e.code]--; d = c.price;
  } else if (target.act === 'salah') {
    if (c.limit - used[e.code] - 1 < 0) return { err: 'Tidak bisa batal Salah: stok sudah terpakai' };
    r[1]--; used[e.code]++;
  } else {
    r[2]--; d = -c.reward;
  }
  saldo[sk] += d;
  st.pop();
  target.undone = true;
  const ef = replay ? saldo[sk] : saldo[sk] - itemInfo(e.pos, e.tim).spend;
  return { ok: true, k, target, d, bal: saldo[sk], warn: ef < 0 ? `Saldo minus: ${ef}` : '' };
}

function doReset(pos) { // hapus semua data 1 pos: saldo kembali START, stok dikembalikan
  for (const k of Object.keys(rows)) {
    if (!k.startsWith(pos + '|')) continue;
    const [b, s] = rows[k];
    used[k.split('|')[2]] -= (b - s);
    delete rows[k]; delete stacks[k];
  }
  for (let t = 1; t <= TIM; t++) saldo[pos + '|' + t] = START;
}

function record(ev) { // tambahkan ke log in-memory
  log.push(ev); byN.set(ev.n, ev);
}

// ---------- Replay dari disk ----------
if (fs.existsSync(EVENTS)) {
  for (const line of fs.readFileSync(EVENTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'act') {
      const r = doAct(ev, true);
      if (r.ok) { (stacks[r.k] = stacks[r.k] || []).push(ev.n); ev.undone = false; ev.d = r.d; ev.bal = r.bal; ev.warn = r.warn; record(ev); }
    } else if (ev.type === 'undo') {
      const r = doUndo(ev, true);
      if (r.ok) { ev.d = r.d; ev.bal = r.bal; ev.warn = r.warn; record(ev); }
    }
    else if (ev.type === 'reset' && POS.includes(ev.pos)) { doReset(ev.pos); ev.d = 0; record(ev); }
    seq = Math.max(seq, ev.n || 0);
  }
}
const fd = fs.openSync(EVENTS, 'a');

// ---------- SSE ----------
const clients = new Set();
function broadcast(ev, row) {
  const msg = JSON.stringify(ev);
  for (const res of clients) res.write(`data: ${msg}\n\n`);
}

// ---------- Admin ----------
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const failed = new Map(); // ip -> { n, until }
function checkAdmin(ip, pw) {
  const f = failed.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return 'Terlalu banyak percobaan salah. Coba lagi sebentar.';
  if (crypto.timingSafeEqual(sha(pw), sha(ADMIN_PW))) { failed.delete(ip); return null; }
  if (++f.n >= 5) { f.n = 0; f.until = Date.now() + 60000; }
  failed.set(ip, f);
  return 'Password salah';
}
function handleReset(body, ip) {
  const bad = checkAdmin(ip, body.password);
  if (bad) return { ok: false, err: bad };
  const pos = String(body.pos || '');
  if (!POS.includes(pos)) return { ok: false, err: 'Pos tidak valid' };
  doReset(pos);
  const n = ++seq;
  const ent = { n, t: Date.now(), type: 'reset', pos, tim: 0, code: '-', act: 'reset', ip, user: String(body.user || 'admin').trim().slice(0, 30) || 'admin', d: 0 };
  record(ent);
  fs.writeSync(fd, JSON.stringify(ent) + '\n');
  broadcast({ n, reset: pos, log: ent });
  return { ok: true };
}

function handleDenahConfig(body, ip) {
  const bad = checkAdmin(ip, body.password);
  if (bad) return Promise.resolve({ ok: false, err: bad });
  const links = Array.isArray(body.links) ? body.links : String(body.links || '').split(/\s+/);
  return denah.setConfig(links, body.interval).then(() => ({ ok: true, denah: denah.state() }));
}

const seen = new Map(); // id permintaan -> hasil (idempoten bila dikirim ulang)

function handleAction(body, ip, undo) {
  if (body.id && seen.has(body.id)) return seen.get(body.id);
  const e = { pos: body.pos, tim: +body.tim, code: body.code, act: body.act };
  const user = String(body.user || '').trim().slice(0, 30);
  if (!user) return { ok: false, err: 'Nama/ID belum diisi' };
  const r = undo ? doUndo(e) : doAct(e);
  let out;
  if (r.err) out = { ok: false, err: r.err };
  else {
    const n = ++seq;
    const ent = undo
      ? { n, t: Date.now(), type: 'undo', pos: e.pos, tim: e.tim, code: e.code, act: r.target.act, ref: r.target.n, ip, user, d: r.d, bal: r.bal, warn: r.warn }
      : { n, t: Date.now(), type: 'act', pos: e.pos, tim: e.tim, code: e.code, act: e.act, ip, user, d: r.d, bal: r.bal, warn: r.warn, undone: false };
    if (!undo) (stacks[r.k] = stacks[r.k] || []).push(n);
    record(ent);
    fs.writeSync(fd, JSON.stringify(ent) + '\n');
    const row = rows[r.k];
    const ev = { n, row: [e.pos, e.tim, e.code, row[0], row[1], row[2]], used: [e.code, used[e.code]], bal: [e.pos, e.tim, saldo[e.pos + '|' + e.tim]], log: ent, undid: undo ? r.target.n : null };
    broadcast(ev);
    out = { ok: true, ev };
  }
  if (body.id) { seen.set(body.id, out); if (seen.size > 3000) seen.delete(seen.keys().next().value); }
  return out;
}

// ---------- CSV ----------
const q = v => { v = String(v); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function statusOf(p, t, c) {
  const [b, s, z] = rows[rkey(p, t, c.code)] || [0, 0, 0];
  if (z >= 1) return 'Selesai (Benar)';
  if (b > s) return 'Menunggu Jawaban';
  return CMAP[c.code].limit - used[c.code] <= 0 ? 'HABIS' : 'Tersedia';
}
function csvData() {
  const out = ['Pos,Tim,Kode Pos-Tim,Kategori,Kode Soal,Beli,Salah,Benar,Status'];
  for (const p of POS) for (let t = 1; t <= TIM; t++) for (const c of CODES) {
    const [b, s, z] = rows[rkey(p, t, c.code)] || [0, 0, 0];
    out.push([p, t, `${p}-${t}`, c.cat, c.code, b, s, z, statusOf(p, t, c)].map(q).join(','));
  }
  out.push('', 'Kode Soal,Stok Terpakai,Batas,Sisa');
  for (const c of CODES) out.push([c.code, used[c.code], c.limit, c.limit - used[c.code]].join(','));
  return '﻿' + out.join('\r\n');
}
const lbl = e => e.type === 'reset' ? `${e.pos} (semua tim)` : `${e.pos}-${e.tim}`;
function csvLog() {
  const out = ['No,Waktu,Nama/ID,Pos-Tim,Kode Soal,Aksi,Dibatalkan,Perangkat (IP)'];
  for (const e of log) {
    const aksi = e.type === 'undo' ? `UNDO ${e.act}` : e.type === 'reset' ? 'RESET POS' : e.act;
    out.push([e.n, new Date(e.t).toLocaleString('id-ID'), e.user || '', lbl(e), e.code, aksi, e.undone ? 'ya' : '', e.ip].map(q).join(','));
  }
  return '﻿' + out.join('\r\n');
}

// ---------- XLSX (tanpa dependensi) ----------
const zlib = require('zlib');
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }; })();
function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const f of files) {
    const nm = Buffer.from(f.name), raw = Buffer.from(f.data), def = zlib.deflateRawSync(raw), crc = CRC(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, def);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(def.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, nm); off += 30 + nm.length + def.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
const xe = v => String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colL = i => String.fromCharCode(65 + i);
function sheetXml(rows, widths) {
  const cols = '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  const data = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = colL(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
    return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + cols + `<sheetData>${data}</sheetData></worksheet>`;
}
function xlsx(sheets) {
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', data: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })),
  ];
  return zip(files);
}
function tally() { // per pos-tim, diurut per pos lalu saldo akhir (sudah dipotong belanja item)
  const T = {};
  for (const p of POS) for (let t = 1; t <= TIM; t++) { const it = itemInfo(p, t); T[p + '|' + t] = { pos: p, tim: t, saldo: saldo[p + '|' + t] - it.spend, it, beli: 0, salah: 0, benar: 0, keluar: 0, masuk: 0 }; }
  for (const k in rows) {
    const [p, t, code] = k.split('|'), r = rows[k], c = CMAP[code], x = T[p + '|' + t];
    x.beli += r[0]; x.salah += r[1]; x.benar += r[2]; x.keluar += r[0] * c.price; x.masuk += r[2] * c.reward;
  }
  return Object.values(T).sort((a, b) => a.pos.localeCompare(b.pos) || b.saldo - a.saldo || a.tim - b.tim);
}
function xlsxBook() {
  const data = [['Pos', 'Tim', 'Pos-Tim', 'Kategori', 'Kode Soal', 'Beli', 'Salah', 'Benar', 'Status']];
  const benar = [['Pos-Tim', 'Jumlah Benar', 'Kode Soal Benar']];
  for (const p of POS) for (let t = 1; t <= TIM; t++) {
    const ok = [];
    for (const c of CODES) {
      const [b, s, z] = rows[rkey(p, t, c.code)] || [0, 0, 0];
      data.push([p, t, `${p}-${t}`, c.cat, c.code, b, s, z, statusOf(p, t, c)]);
      if (z >= 1) ok.push(c.code);
    }
    benar.push([`${p}-${t}`, ok.length, ok.join(', ')]);
  }
  const stok = [['Kode Soal', 'Kategori', 'Batas', 'Terpakai', 'Sisa']].concat(CODES.map(c => [c.code, c.cat, c.limit, used[c.code], c.limit - used[c.code]]));
  const lg = [['No', 'Waktu', 'Nama/ID', 'Pos-Tim', 'Kode Soal', 'Aksi', 'Neleci', 'Saldo Tim', 'Catatan', 'Dibatalkan', 'Perangkat (IP)']].concat(log.map(e =>
    [e.n, new Date(e.t).toLocaleString('id-ID'), e.user || '', lbl(e), e.code, e.type === 'undo' ? `UNDO ${e.act}` : e.type === 'reset' ? 'RESET POS' : e.act, typeof e.d === 'number' ? e.d : '', typeof e.bal === 'number' ? e.bal : '', e.warn || '', e.undone ? 'ya' : '', e.ip]));
  let rank = 0, prev = null, pp = '';
  const TL = tally();
  const hasil = [['Pos', 'Peringkat (dalam pos)', 'Tim', 'Saldo Akhir (Neleci)', 'Total Beli', 'Salah', 'Benar', 'Keluar Beli Soal', 'Keluar Beli Item', 'Masuk Reward']].concat(TL.map((x, i, arr) => {
    if (x.pos !== pp) { pp = x.pos; prev = null; }
    if (x.saldo !== prev) rank = arr.filter(y => y.pos === x.pos && y.saldo > x.saldo).length + 1;
    prev = x.saldo;
    return [x.pos, rank, `${x.pos}-${x.tim}`, x.saldo, x.beli, x.salah, x.benar, x.keluar, x.it.spend, x.masuk];
  }));
  const ds = denah.state();
  const putar = [['Pos', 'Tim', 'Modal Awal', 'Keluar Beli Soal', 'Keluar Beli Item', 'Masuk Reward', 'Saldo Akhir', 'Denah S', 'Denah N', 'Denah H', 'Denah P', 'Denah T', 'Denah L', 'Denah M', 'Dibayar L', 'Dibayar T', 'Dibayar M', 'Catatan']];
  const tot = {};
  for (const p of POS) {
    tot[p] = [0, 0, 0, 0, 0];
    for (let t = 1; t <= TIM; t++) {
      const x = TL.find(y => y.pos === p && y.tim === t), it = x.it, c = it.cnt;
      putar.push([p, `${p}-${t}`, START, x.keluar, it.spend, x.masuk, x.saldo, c.S, c.N, c.H, c.P, c.T, c.L, c.M, it.bayar.L, it.bayar.T, it.bayar.M, it.warn.join('; ')]);
      [START, x.keluar, it.spend, x.masuk, x.saldo].forEach((v, i) => { tot[p][i] += v; });
    }
  }
  putar.push([]);
  putar.push(['Kubu', '', 'Modal Awal', 'Keluar Beli Soal', 'Keluar Beli Item', 'Masuk Reward', 'Saldo Akhir']);
  const g = [0, 0, 0, 0, 0];
  for (const p of POS) { putar.push([p, 'Total', ...tot[p]]); tot[p].forEach((v, i) => { g[i] += v; }); }
  putar.push(['Semua', 'Total', ...g]);
  putar.push([]);
  putar.push(['Harga item', `S ${ITEM_PRICE.S}, L ${ITEM_PRICE.L}, T ${ITEM_PRICE.T}, M ${ITEM_PRICE.M}. L/T/M dibayar = jumlah di Denah − soal Benar jenis itu.`]);
  putar.push(['Data Denah', ds.at ? 'sinkron terakhir ' + new Date(ds.at).toLocaleString('id-ID') : 'belum pernah sinkron']);
  return xlsx([
    { name: 'Hasil Akhir', rows: hasil, widths: [6, 20, 8, 20, 11, 8, 8, 16, 16, 14] },
    { name: 'Perputaran Neleci', rows: putar, widths: [7, 9, 12, 16, 16, 14, 12, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 40] },
    { name: 'Data', rows: data, widths: [6, 6, 9, 15, 11, 7, 7, 7, 20] },
    { name: 'Benar per Tim', rows: benar, widths: [10, 14, 70] },
    { name: 'Stok', rows: stok, widths: [11, 15, 8, 10, 8] },
    { name: 'Log', rows: lg, widths: [7, 22, 18, 10, 11, 14, 9, 11, 36, 11, 18] },
  ]);
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((res, rej) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 10000) { rej(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (e) { rej(e); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  try {
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    const im = req.method === 'GET' && /^\/img\/(beli|salah|benar)\.png$/.exec(url);
    if (im) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'img', im[1] + '.png')));
    }
    const tm = req.method === 'GET' && /^\/img\/theme\/([a-z0-9-]+)\.(webp|jpg)$/.exec(url);
    if (tm) {
      const f = path.join(__dirname, 'public', 'img', 'theme', tm[1] + '.' + tm[2]);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': tm[2] === 'jpg' ? 'image/jpeg' : 'image/webp', 'Cache-Control': 'public, max-age=86400' });
      return res.end(fs.readFileSync(f));
    }
    const fm = req.method === 'GET' && /^\/fonts\/poppins-(400|500|600|700|800)\.woff2$/.exec(url);
    if (fm) {
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=604800' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'fonts', 'poppins-' + fm[1] + '.woff2')));
    }
    if (req.method === 'GET' && url === '/api/state') {
      const nz = {};
      for (const k in rows) if (rows[k][0] || rows[k][1] || rows[k][2]) nz[k] = rows[k];
      return json(res, 200, { codes: CODES, pos: POS, tim: TIM, rows: nz, used, start: START, saldo, log: log.slice(-500).reverse(), seq, itemPrice: ITEM_PRICE, denah: denah.state() });
    }
    if (req.method === 'GET' && url === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url === '/api/admin/login') {
      const body = await readBody(req), bad = checkAdmin(ip, body.password);
      return json(res, 200, bad ? { ok: false, err: bad } : { ok: true });
    }
    if (req.method === 'POST' && url === '/api/admin/denah') return json(res, 200, await handleDenahConfig(await readBody(req), ip));
    if (req.method === 'POST' && url === '/api/admin/denah-sync') {
      const bad = checkAdmin(ip, (await readBody(req)).password);
      if (bad) return json(res, 200, { ok: false, err: bad });
      await denah.sync();
      return json(res, 200, { ok: true, denah: denah.state() });
    }
    if (req.method === 'POST' && url === '/api/admin/reset') return json(res, 200, handleReset(await readBody(req), ip));
    if (req.method === 'POST' && (url === '/api/act' || url === '/api/undo')) {
      const body = await readBody(req);
      return json(res, 200, handleAction(body, ip, url === '/api/undo'));
    }
    if (req.method === 'GET' && url === '/export.xlsx') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="pos-soal.xlsx"' });
      return res.end(xlsxBook());
    }
    if (req.method === 'GET' && url === '/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pos-soal-data.csv"' });
      return res.end(csvData());
    }
    if (req.method === 'GET' && url === '/export-log.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pos-soal-log.csv"' });
      return res.end(csvLog());
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    json(res, 400, { ok: false, err: 'Permintaan tidak valid' });
  }
});
denah = require('./denah')({
  dataDir: DATA_DIR, POS, TIM, defaultLinks: [DEFAULT_LINK],
  onChange: (st, changed) => broadcast({ denah: st }),
});

server.on('connection', s => s.setNoDelay(true));
setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPos Soal berjalan (${seq} aksi dimuat). Buka dari device lain di WiFi yang sama:`);
  const nets = os.networkInterfaces();
  for (const n in nets) for (const a of nets[n]) if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}   (${n})`);
  console.log(`  http://localhost:${PORT}   (laptop ini)\n`);
});
