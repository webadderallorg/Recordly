// ASAR repacker with correct pickle framing, multi-patch support, and
// byte-exact verification.
//
//   node asar-pack.js info    <src>
//   node asar-pack.js identity <src> <dst>
//   node asar-pack.js probe    <src>            (needs PATCHES_JSON)
//   node asar-pack.js autopatch <src> <dst>     (needs PATCHES_JSON)
//   node asar-pack.js verify  <f1> <f2>
//
// PATCHES_JSON = [{"name":"...","find":"...","repl":"..."}, ...]
//
// Entry kinds: packed (bytes inside the archive), unpacked (bytes live in
// app.asar.unpacked, header has size+integrity but NO offset), link.
const fs = require('fs');
const crypto = require('crypto');

const mode = process.argv[2];
const arg = process.argv.slice(3);

function loadPatches() {
  const raw = process.env.PATCHES_JSON;
  if (!raw) throw new Error('PATCHES_JSON is not set');
  let list = JSON.parse(raw);
  if (!Array.isArray(list)) list = [list];   // tolerate a single-object payload
  if (!list.length) throw new Error('PATCHES_JSON must be a non-empty array');
  for (const p of list) {
    if (typeof p.find !== 'string' || typeof p.repl !== 'string' || !p.find) {
      throw new Error('each patch needs string "find" and "repl"');
    }
    if (p.find === p.repl) throw new Error('patch with find === repl: ' + p.name);
  }
  return list;
}

function readAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const pickleSize = head.readUInt32LE(4);
  const payloadSize = head.readUInt32LE(8);
  const jsonLen = head.readUInt32LE(12);
  const padLen = payloadSize - jsonLen - 4;
  const headerBuf = Buffer.alloc(jsonLen);
  fs.readSync(fd, headerBuf, 0, jsonLen, 16);
  const baseOffset = 8 + pickleSize;
  const header = JSON.parse(headerBuf.toString('utf8'));
  const totalSize = fs.fstatSync(fd).size;

  const entries = [];
  (function walk(node, prefix) {
    for (const [name, val] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + '/' + name : name;
      if (val.files) { walk(val, p); continue; }
      if (val.link) { entries.push({ p, node: val, kind: 'link', buf: null }); continue; }
      if (val.unpacked) { entries.push({ p, node: val, kind: 'unpacked', buf: null }); continue; }
      const size = Number(val.size);
      const off = Number(val.offset);
      if (!Number.isFinite(size) || !Number.isFinite(off)) throw new Error('bad packed entry ' + p);
      const buf = Buffer.alloc(size);
      if (size) fs.readSync(fd, buf, 0, size, baseOffset + off);
      entries.push({ p, node: val, kind: 'packed', buf });
    }
  })(header, '');
  fs.closeSync(fd);
  return { header, entries, padLen, head, baseOffset, totalSize };
}

function writeAsar(file, header, entries, padLen) {
  let offset = 0;
  for (const e of entries) {
    if (e.kind !== 'packed') continue;
    e.node.size = e.buf.length;
    e.node.offset = String(offset);
    offset += e.buf.length;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadSize = json.length + 4 + padLen;
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(payloadSize + 4, 4);
  pre.writeUInt32LE(payloadSize, 8);
  pre.writeUInt32LE(json.length, 12);

  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, pre);
  fs.writeSync(fd, json);
  if (padLen) fs.writeSync(fd, Buffer.alloc(padLen));
  for (const e of entries) if (e.kind === 'packed') fs.writeSync(fd, e.buf);
  fs.closeSync(fd);
  return { payloadBytes: offset, jsonLen: json.length, padLen };
}

function digest(a) {
  if (a.kind === 'packed') return 'sha256:' + crypto.createHash('sha256').update(a.buf).digest('hex');
  if (a.kind === 'unpacked') return 'unpacked:' + (a.node.integrity || '') + ':' + a.node.size;
  return 'link:' + a.node.link;
}

function survey(archive, patches) {
  const state = patches.map((p) => ({ patch: p, orig: 0, patched: 0, where: [] }));
  for (const e of archive.entries) {
    if (e.kind !== 'packed') continue;
    const s = e.buf.toString('utf8');
    state.forEach((st) => {
      const o = s.split(st.patch.find).length - 1;
      const q = s.split(st.patch.repl).length - 1;
      if (o || q) {
        st.orig += o;
        st.patched += q;
        st.where.push(e.p + ' (find ' + o + ', already-patched ' + q + ')');
      }
    });
  }
  return state;
}

if (mode === 'info') {
  const [src] = arg;
  const a = readAsar(src);
  const k = { packed: 0, unpacked: 0, link: 0 };
  for (const e of a.entries) k[e.kind]++;
  const packedBytes = a.entries.filter((e) => e.kind === 'packed').reduce((s, e) => s + e.buf.length, 0);
  console.log('file   :', src);
  console.log('size   :', a.totalSize, 'bytes');
  console.log('header : json', a.head.readUInt32LE(12), 'pad', a.padLen, 'baseOffset', a.baseOffset);
  console.log('entries:', a.entries.length, k);
  console.log('packed bytes:', packedBytes, '| body check:', a.baseOffset + packedBytes === a.totalSize);
}

if (mode === 'identity') {
  const [src, dst] = arg;
  const a = readAsar(src);
  const w = writeAsar(dst, a.header, a.entries, a.padLen);
  console.log('identity repack ->', dst);
  console.log('  payload', w.payloadBytes, 'json', w.jsonLen, 'pad', w.padLen, 'fileSize', fs.statSync(dst).size);
}

if (mode === 'probe') {
  const [src] = arg;
  const patches = loadPatches();
  const a = readAsar(src);
  const state = survey(a, patches);
  let bad = 0;
  for (const st of state) {
    const verdict = st.orig === 1 && st.patched === 0 ? 'PENDING'
      : st.orig === 0 && st.patched === 1 ? 'APPLIED'
        : 'UNKNOWN';
    if (verdict === 'UNKNOWN') bad++;
    console.log(String(st.patch.name || '?').padEnd(22) + verdict.padEnd(10) +
      'find=' + st.orig + ' patched=' + st.patched +
      (st.where.length ? '  [' + st.where.join('; ') + ']' : ''));
  }
  console.log('summary: ' + state.filter((s) => s.orig === 1 && s.patched === 0).length + ' pending, ' +
    state.filter((s) => s.orig === 0 && s.patched === 1).length + ' applied, ' + bad + ' unknown');
  process.exit(bad ? 2 : 0);
}

if (mode === 'autopatch') {
  const [src, dst] = arg;
  const patches = loadPatches();
  const a = readAsar(src);
  const state = survey(a, patches);

  for (const st of state) {
    const name = st.patch.name || st.patch.find.slice(0, 30);
    if (st.orig === 0 && st.patched === 1) { console.log('  skip (already applied): ' + name); continue; }
    if (st.orig !== 1 || st.patched !== 0) {
      throw new Error('anchor for "' + name + '" must appear exactly once; find=' + st.orig +
        ' patched=' + st.patched + ' ' + JSON.stringify(st.where));
    }
    const hits = a.entries.filter((e) => e.kind === 'packed' &&
      e.buf.toString('utf8').split(st.patch.find).length - 1 === 1);
    if (hits.length !== 1) throw new Error('anchor for "' + name + '" spans ' + hits.length + ' entries');
    const e = hits[0];
    const before = e.buf.length;
    e.buf = Buffer.from(e.buf.toString('utf8').replace(st.patch.find, st.patch.repl), 'utf8');
    console.log('  applied: ' + name + '  [' + e.p + '  ' + before + ' -> ' + e.buf.length +
      ' bytes, delta ' + (e.buf.length - before) + ']');
  }

  const w = writeAsar(dst, a.header, a.entries, a.padLen);
  console.log('wrote ->', dst);
  console.log('  payload', w.payloadBytes, 'files', a.entries.length, 'fileSize', fs.statSync(dst).size);
}

if (mode === 'verify') {
  const [f1, f2] = arg;
  const a = readAsar(f1);
  const b = readAsar(f2);
  const m1 = new Map(a.entries.map((e) => [e.p, digest(e)]));
  const m2 = new Map(b.entries.map((e) => [e.p, digest(e)]));
  let differ = 0, missing = 0, extra = 0;
  for (const [p, h] of m1) {
    if (!m2.has(p)) { missing++; console.log('  missing in result:', p); continue; }
    if (m2.get(p) !== h) { differ++; console.log('  differs:', p); }
  }
  for (const p of m2.keys()) if (!m1.has(p)) { extra++; console.log('  extra in result:', p); }
  console.log('entries ' + m1.size + ' | identical ' + (m1.size - differ - missing) +
    ' | differing ' + differ + ' | missing ' + missing + ' | extra ' + extra);
  console.log('file sizes', a.totalSize, 'vs', b.totalSize);
  if (missing || extra) { console.log('RESULT: MISMATCH'); process.exit(1); }
  console.log(differ === 0 ? 'RESULT: IDENTICAL' : 'RESULT: OK');
}
