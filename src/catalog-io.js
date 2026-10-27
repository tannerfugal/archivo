'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const os = require('os');
const { sanitizeCatalog } = require('./catalog');
const MAX = 512 * 1024 * 1024;
function fingerprint(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function snapshot(file) {
  // Metadata and bytes refer to the same opened file, even if another writer renames it.
  const fd=fs.openSync(file,'r');let original,stat;
  try{stat=fs.fstatSync(fd);if(stat.size>MAX)throw Error('Catalog exceeds the 512 MB limit.');original=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
  if (original.length > MAX) throw Error('Catalog exceeds the 512 MB limit.');
  let body = original;
  if (body[0] === 31 && body[1] === 139) body = zlib.gunzipSync(body, { maxOutputLength: MAX });
  return { data: sanitizeCatalog(JSON.parse(body.toString('utf8'))), fingerprint: crypto.createHash('sha256').update(original).digest('hex'), stamp:stamp(stat) };
}
function stamp(stat){return [stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':');}
function probe(file,previous){const current=stamp(fs.statSync(file));return current===previous?{stamp:current}:{stamp:current,fingerprint:fingerprint(file)};}
function canonical(file){const absolute=path.resolve(file);try{return fs.realpathSync(absolute);}catch(e){if(e.code!=='ENOENT')throw e;return path.join(fs.realpathSync(path.dirname(absolute)),path.basename(absolute));}}
function acquireLock(file){
  // A directory create is shared by cooperating clients, including different SMB paths.
  // Never steal a lock based on clocks or another machine's process ID.
  const directory=canonical(file)+'.lock',owner={token:crypto.randomUUID(),host:os.hostname(),pid:process.pid,at:new Date().toISOString()};
  try{fs.mkdirSync(directory);}catch(e){if(e.code!=='EEXIST')throw e;let detail='another Archivo Fork instance';try{const held=JSON.parse(fs.readFileSync(path.join(directory,'owner.json'),'utf8'));detail=String(held.host||detail)+' since '+String(held.at||'an unknown time');}catch{}throw Error('Catalog save locked by '+detail+'. Retry after its save finishes. If it crashed, close all writers before removing '+directory);}
  try{fs.writeFileSync(path.join(directory,'owner.json'),JSON.stringify(owner),{flag:'wx',mode:0o600});}catch(e){try{fs.rmdirSync(directory);}catch{}throw e;}
  return {directory,token:owner.token};
}
function releaseLock({directory,token}){try{const held=JSON.parse(fs.readFileSync(path.join(directory,'owner.json'),'utf8'));if(held.token===token){fs.unlinkSync(path.join(directory,'owner.json'));fs.rmdirSync(directory);}}catch{ /* Keep uncertain ownership locked; never remove another client's lock. */ }}
function lock(file){const lease=acquireLock(file);return ()=>releaseLock(lease);}
function read(file) { return snapshot(file).data; }
function atomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + crypto.randomUUID();
  let fd,mode=0o600;try{mode=fs.statSync(file).mode&0o777;}catch(e){if(e.code!=='ENOENT')throw e;}
  try {
    fd = fs.openSync(tmp, 'wx', mode);fs.fchmodSync(fd,mode);
    fs.writeFileSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch {} }
}
function write(file, data, expected, backups) {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX) throw Error('Catalog exceeds the 512 MB limit.');
  const body = file.toLowerCase().endsWith('.json') ? Buffer.from(json) : zlib.gzipSync(Buffer.from(json));
  fs.mkdirSync(path.dirname(file),{recursive:true});file=canonical(file);
  const release=lock(file);
  try{
  const unchanged=()=>{if(expected===undefined)return true;const exists=fs.existsSync(file);return expected===null?!exists:exists&&fingerprint(file)===expected;};
  if (!unchanged()) throw Error(expected===null?'A file already exists at this destination. Choose another name for the separate copy.':'Catalog changed outside Archivo Fork. Your edits are still open. Save a copy or reload the latest catalog before saving.');
  if (backups && fs.existsSync(file)) {
    const dir = file + '.backups'; fs.mkdirSync(dir, { recursive: true });
    const name = Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.archivo';
    atomic(path.join(dir, name), fs.readFileSync(file));
    const old = fs.readdirSync(dir).filter(n => /^\d+-[a-f0-9]+\.archivo$/.test(n)).sort().reverse();
    for (const name of old.slice(5)) fs.unlinkSync(path.join(dir, name));
  }
  // Recheck after backup creation as well. Other processes must not be silently overwritten.
  if (!unchanged()) throw Error('Catalog changed while saving. No update was applied.');
  atomic(file, body);
  return fingerprint(file);
  }finally{release();}
}
module.exports = { read, snapshot, write, fingerprint, atomic, probe, lock, acquireLock, releaseLock };
