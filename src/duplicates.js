'use strict';
const fs=require('fs');
const crypto=require('crypto');
const { candidates }=require('./analysis');
const { realFile }=require('./sources');
function stamp(s) { return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'); }
async function digest(root, segments, sample, cancelled=()=>false, progress=()=>{}) {
  const file=realFile(root,segments), before=await fs.promises.stat(file);
  if (!before.isFile()) throw Error('Not a regular file.');
  const handle=await fs.promises.open(file,'r');
  const hash=crypto.createHash('sha256');
  try {
    if (stamp(await handle.stat())!==stamp(before)) throw Error('File changed before verification.');
    const block=Buffer.alloc(sample?65536:1024*1024);
    const positions=sample?[...new Set([0,Math.max(0,Math.floor(before.size/2)-32768),Math.max(0,before.size-65536)])]:null;
    let offset=0, index=0;
    while (positions ? index<positions.length : offset<before.size) {
      if (cancelled()) throw Error('Cancelled');
      const pos=positions?positions[index++]:offset;
      const {bytesRead}=await handle.read(block,0,Math.min(block.length,before.size-pos),pos);
      if (!bytesRead) { if (pos<before.size) throw Error('File changed during verification.'); break; }
      hash.update(block.subarray(0,bytesRead));offset+=bytesRead;progress(bytesRead);
    }
    if (stamp(await handle.stat())!==stamp(before) || stamp(await fs.promises.stat(file))!==stamp(before)) throw Error('File changed during verification.');
    return { hash:hash.digest('hex'),stamp:stamp(before),file,dev:before.dev,ino:before.ino,size:before.size,nlink:before.nlink,mtimeMs:before.mtimeMs };
  } finally { await handle.close(); }
}
async function verify(disks, bindings, resolve, cancelled=()=>false, progress=()=>{}) {
  const groups=candidates(disks), results=[], sources=new Map(), physical=new Set();let done=0;
  for (const disk of disks) {
    try { sources.set(disk.id,await resolve(bindings[disk.id])); } catch(e) { sources.set(disk.id,{error:e.message}); }
  }
  for (const group of groups) {
    if (cancelled()) return {cancelled:true,groups:results};
    const items=[];
    for (const item of group.items) {
      const entry={...item,id:crypto.randomUUID(),status:'Possible'};items.push(entry);
      const source=sources.get(item.diskId);
      if (!source || source.error) { entry.status='Offline';entry.reason=source?.error || 'Source not linked.';continue; }
      try {
        const s=await digest(source.root,item.segments,true,cancelled);
        if (s.size!==item.size || (typeof item.mtime_ms==='number' && Math.abs(s.mtimeMs-item.mtime_ms)>1)) {entry.status='Changed';continue;}
        const inode=source.key+':'+s.dev+':'+s.ino;
        if (physical.has(inode)) {entry.hardlink=true;entry.status='Same file';continue;}
        physical.add(inode);entry.sample=s.hash;entry.stamp=s.stamp;
      } catch(e) {if(cancelled()) return {cancelled:true,groups:results};entry.status=/changed/i.test(e.message)?'Changed':'Unreadable';entry.reason=e.message;}
    }
    const sampled=items.filter(i=>i.sample),sampleCounts=new Map();
    for(const item of sampled)sampleCounts.set(item.sample,(sampleCounts.get(item.sample)||0)+1);
    for (const item of sampled) {
      if (sampleCounts.get(item.sample)<2) {item.status='Different';continue;}
      try {
        const full=await digest(sources.get(item.diskId).root,item.segments,false,cancelled,n=>progress({bytes:n}));
        item.hash=full.hash;item.stamp=full.stamp;item.status='Verified';
      } catch(e) {if(cancelled()) return {cancelled:true,groups:results};item.status=/changed/i.test(e.message)?'Changed':'Unreadable';item.reason=e.message;}
      progress({files:++done,path:item.segments.join('/')});
    }
    const fullCounts=new Map();for(const item of items)if(item.hash)fullCounts.set(item.hash,(fullCounts.get(item.hash)||0)+1);
    for(const item of items)if(item.hash && fullCounts.get(item.hash)<2)item.status='Different';
    results.push({size:group.size,items});
    progress({groups:results.length,total:groups.length});
  }
  for (const disk of disks) {
    const initial=sources.get(disk.id);if(!initial || initial.error)continue;
    try { const final=await resolve(bindings[disk.id]);if(final.key!==initial.key || final.relative!==initial.relative)throw Error('Source changed during verification.'); }
    catch(e) { for(const item of results.flatMap(g=>g.items).filter(i=>i.diskId===disk.id)){item.status='Offline';item.reason=e.message;delete item.hash;} }
  }
  const verified=results.flatMap(g=>g.items).filter(i=>i.status==='Verified');
  const verifiedCounts=new Map();for(const item of verified)verifiedCounts.set(item.hash,(verifiedCounts.get(item.hash)||0)+1);
  for(const item of verified)if(verifiedCounts.get(item.hash)<2){item.status='Possible';delete item.hash;}
  return {groups:results,cancelled:false};
}
function trashSelection(report, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size!==ids.length) throw Error('Select the copies to move to Trash.');
  const all=report.groups.flatMap(g=>g.items), selected=ids.map(id=>all.find(i=>i.id===id));
  if (selected.some(i=>!i || i.status!=='Verified' || !i.hash)) throw Error('Only verified matching copies can be moved to Trash.');
  const groups=[];
  for (const hash of new Set(selected.map(i=>i.hash))) {
    const copies=all.filter(i=>i.hash===hash && i.status==='Verified'), remove=selected.filter(i=>i.hash===hash), keep=copies.filter(i=>!ids.includes(i.id));
    if (!keep.length) throw Error('Keep at least one verified copy in each group.');
    groups.push({hash,remove,keep});
  }
  return groups;
}
module.exports={digest,verify,stamp,trashSelection};
