'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { sanitizeCatalog } = require('./catalog');
const MAX = 512 * 1024 * 1024;
function fingerprint(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function snapshot(file) {
  if (fs.statSync(file).size > MAX) throw Error('Catalog exceeds the 512 MB limit.');
  const original = fs.readFileSync(file);
  if (original.length > MAX) throw Error('Catalog exceeds the 512 MB limit.');
  let body = original;
  if (body[0] === 31 && body[1] === 139) body = zlib.gunzipSync(body, { maxOutputLength: MAX });
  return { data: sanitizeCatalog(JSON.parse(body.toString('utf8'))), fingerprint: crypto.createHash('sha256').update(original).digest('hex') };
}
function read(file) { return snapshot(file).data; }
function atomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + crypto.randomUUID();
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch {} }
}
function write(file, data, expected, backups) {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX) throw Error('Catalog exceeds the 512 MB limit.');
  const body = file.toLowerCase().endsWith('.json') ? Buffer.from(json) : zlib.gzipSync(Buffer.from(json));
  if (expected !== undefined && (!fs.existsSync(file) || fingerprint(file) !== expected)) throw Error('Catalog changed outside Archivo Fork. Reload it before saving.');
  if (backups && fs.existsSync(file)) {
    const dir = file + '.backups'; fs.mkdirSync(dir, { recursive: true });
    const name = Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.archivo';
    atomic(path.join(dir, name), fs.readFileSync(file));
    const old = fs.readdirSync(dir).filter(n => /^\d+-[a-f0-9]+\.archivo$/.test(n)).sort().reverse();
    for (const name of old.slice(5)) fs.unlinkSync(path.join(dir, name));
  }
  // Recheck after backup creation as well. Other processes must not be silently overwritten.
  if (expected !== undefined && fingerprint(file) !== expected) throw Error('Catalog changed while saving. No update was applied.');
  atomic(file, body);
  return fingerprint(file);
}
module.exports = { read, snapshot, write, fingerprint, atomic };
