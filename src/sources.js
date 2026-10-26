/* Source identity is local trust, never an executable instruction from a catalog. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const LIMITS = { encoding:'utf8', timeout:10000, windowsHide:true, maxBuffer:8*1024*1024 };
const ps = command => JSON.parse(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ' + command], LIMITS).replace(/^\uFEFF/,'').trim() || 'null');
function normalizeShare(input) {
  let s = String(input || '').replace(/\\/g,'/').replace(/^(smb|cifs):/i,'').replace(/^\/\/[^/@]+@/,'//');
  try { s = decodeURIComponent(s); } catch {}
  const m = s.match(/^\/\/([^/]+)\/([^/]+)(.*)$/);
  if (!m) return '';
  return 'smb://' + m[1].toLowerCase() + '/' + m[2].toLowerCase() + m[3].replace(/\/+$/,'');
}
function inside(base, target, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(p.resolve(base), p.resolve(target));
  return !rel || (!rel.startsWith('..' + p.sep) && rel !== '..' && !p.isAbsolute(rel));
}
function safeJoin(root, segments, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (!Array.isArray(segments) || segments.length > 256 || segments.some(s => typeof s !== 'string' || !s || s === '.' || s === '..' || /[\\/\x00-\x1f]/.test(s) || (platform === 'win32' && /[:*?"<>|]|[. ]$/.test(s)))) throw Error('Invalid catalog path.');
  const result = p.resolve(root, ...segments);
  if (!inside(root,result,platform)) throw Error('Path leaves its registered source.');
  return result;
}
function realFile(root, segments) {
  const file = safeJoin(root,segments);
  // Do not traverse links or Windows junctions, including intermediate directories.
  let current = path.resolve(root);
  for (const s of segments) {
    current = path.join(current,s);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symbolic links and junctions cannot be used for verification or cleanup.');
  }
  if (!inside(fs.realpathSync(root),fs.realpathSync(file))) throw Error('Path leaves its registered source.');
  if (fs.statSync(root).dev !== fs.statSync(file).dev) throw Error('This file is on a nested mount. Link that volume separately.');
  return file;
}
function macInfo(root) {
  const raw = execFileSync('/usr/sbin/diskutil',['info','-plist',root],LIMITS);
  return JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-','--','-'],{ ...LIMITS,input:raw }));
}
function list() {
  if (process.platform === 'win32') {
    return windowsVolumes();
  }
  const mounts = execFileSync('/sbin/mount',[],LIMITS).split('\n').map(line=>{
    const m=line.match(/^(.+) on (.+) \(([^)]+)\)$/); return m ? {source:m[1],mount:m[2],network:/smbfs|nfs|afpfs|webdav/.test(m[3]),kind:m[3].split(',')[0]} : null;
  }).filter(Boolean);
  return execFileSync('/bin/df',['-Pk'],LIMITS).split('\n').slice(1).map(line=>{
    const m=line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
    if (!m || !(m[5] === '/' || m[5].startsWith('/Volumes/')) || !Number(m[2])) return null;
    const entry=mounts.find(e=>e.mount===m[5]);
    let network='';
    if (entry && entry.network) network=normalizeShare(entry.source) || entry.kind + '://' + entry.source.replace(/^.*@/,'').replace(/\/+$/,'');
    return {name:m[5]==='/'?'Macintosh HD':path.basename(m[5]),mount_point:m[5],total_bytes:Number(m[2])*1024,free_bytes:Number(m[4])*1024,file_system:entry?.kind || '',vol_type:network?'network':m[5]==='/'?'system':'usb',network,removable:!network && m[5]!=='/'};
  }).filter(Boolean);
}

function windowsVolumes(letter) {
  // One PowerShell startup for logical volumes AND partition identities.
  const filter=letter ? " -Filter \"DeviceID='"+letter.toUpperCase()+":'\"" : '';
  const raw=ps("$parts=@{}; Get-Partition -ErrorAction SilentlyContinue | Where-Object DriveLetter | ForEach-Object { $p=$_; $d=$p | Get-Disk; $parts[[string]$p.DriveLetter]=@{id=[string]$d.UniqueId;guid=[string]$p.Guid;offset=[string]$p.Offset;model=[string]$d.FriendlyName;serial=[string]$d.SerialNumber;bus=[string]$d.BusType} }; @(Get-CimInstance Win32_LogicalDisk"+filter+" | ForEach-Object { @{Caption=$_.DeviceID;FreeSpace=$_.FreeSpace;Size=$_.Size;FileSystem=$_.FileSystem;VolumeName=$_.VolumeName;DriveType=$_.DriveType;VolumeSerialNumber=$_.VolumeSerialNumber;ProviderName=$_.ProviderName;hardware=$parts[$_.DeviceID.Substring(0,1)]} }) | ConvertTo-Json -Depth 5 -Compress");
  return (Array.isArray(raw)?raw:raw?[raw]:[]).filter(o=>Number(o.Size)>0).map(o=>({name:o.VolumeName||o.Caption,mount_point:o.Caption+'\\',total_bytes:Number(o.Size),free_bytes:Number(o.FreeSpace),file_system:o.FileSystem,vol_type:Number(o.DriveType)===4?'network':o.Caption.toUpperCase()===path.parse(process.env.SystemRoot||'C:\\Windows').root.slice(0,2).toUpperCase()?'system':'unknown',network:normalizeShare(o.ProviderName),volumeId:String(o.VolumeSerialNumber||''),removable:Number(o.DriveType)===2,hardware:o.hardware||{}}));
}
function targetedVolumes(root) {
  if(process.platform==='win32')return /^\\\\/.test(root)?[]:windowsVolumes(/^([a-z]):/i.exec(root)?.[1]);
  return execFileSync('/sbin/mount',[],LIMITS).split('\n').map(line=>{const m=line.match(/^(.+) on (.+) \(([^)]+)\)$/);if(!m)return null;const network=/smbfs|nfs|afpfs|webdav/.test(m[3])?(normalizeShare(m[1])||m[3].split(',')[0]+'://'+m[1].replace(/^.*@/,'')):'';return {mount_point:m[2],name:path.basename(m[2]),network,vol_type:network?'network':'unknown'};}).filter(Boolean);
}
function resolveTarget(binding) {
  if(!binding)throw Error('Source is not linked on this computer. Use Locate source.');
  try{return match(binding,[identify(binding.root,targetedVolumes(binding.root))]);}catch{}
  // A moved mount / changed drive letter needs discovery; ordinary clicks do not.
  return resolve(binding);
}

function identify(root, volumes) {
  root=fs.realpathSync(path.resolve(root));
  if (!fs.statSync(root).isDirectory()) throw Error('Choose a folder or mounted drive.');
  const vols=volumes || list();
  const vol=vols.filter(v=>inside(v.mount_point,root)).sort((a,b)=>b.mount_point.length-a.mount_point.length)[0];
  let key='', network='', relative='', model='', serial='', iface='';
  if (process.platform === 'win32' && /^\\\\/.test(root)) {
    const parts=root.slice(2).split('\\');
    network=normalizeShare('//' + parts[0] + '/' + parts[1]); relative=parts.slice(2).join('/'); key='network:'+network;
  } else if (vol?.network) { network=vol.network; key='network:'+network; relative=path.relative(vol.mount_point,root).split(path.sep).join('/'); }
  else if (process.platform === 'darwin') {
    const d=macInfo(vol?.mount_point || '/'); const id=d.VolumeUUID || d.APFSVolumeUUID || d.DiskUUID;
    if (id) key='macvol:'+String(id).toLowerCase();
    relative=path.relative(d.MountPoint || vol?.mount_point || '/',root).split(path.sep).join('/');
    model=d.MediaName || ''; serial=d.MediaSerialNumber || ''; iface=d.BusProtocol || '';
  } else if (vol) {
    let d=vol.hardware || null;
    const letter=/^([A-Za-z]):/.exec(vol.mount_point)?.[1];
    if (letter && !d) {
      try { d=ps('$p = Get-Partition -DriveLetter '+letter+' -ErrorAction Stop; $d = $p | Get-Disk; @{ id=[string]$d.UniqueId; guid=[string]$p.Guid; offset=[string]$p.Offset; model=[string]$d.FriendlyName; serial=[string]$d.SerialNumber; bus=[string]$d.BusType } | ConvertTo-Json -Compress'); } catch {}
    }
    if (d?.id) key='winvol:'+d.id.trim()+':'+(d.guid || d.offset)+':'+vol.volumeId;
    else if (vol.volumeId) key='winvol:'+vol.volumeId;
    relative=path.relative(vol.mount_point,root).split(path.sep).join('/');
    model=d?.model || '';serial=d?.serial || '';iface=d?.bus || '';
  }
  // Explicitly chosen sources without persistent OS identifiers are session/device-bound.
  // Replaced devices invalidate dev+inode rather than silently trusting a label or pathname.
  const st=fs.statSync(root);
  if (!key) key='local:'+st.dev+':'+st.ino;
  return { key, relative, root, network:!!network || vol?.vol_type==='network', name:vol?.name || path.basename(root), model, serial, iface,
    total_bytes:vol?.total_bytes || 0,free_bytes:vol?.free_bytes || 0,file_system:vol?.file_system || '',vol_type:vol?.vol_type || 'unknown' };
}
function same(a,b) { return !!a && !!b && a.key===b.key && a.relative===b.relative; }
function match(binding, candidates) {
  const found=candidates.filter(c=>same(binding,c));
  if (!found.length) throw Error('Source is offline or has changed. Use Locate source to reconnect it.');
  if (found.length!==1) throw Error('More than one volume has this identity. Disconnect the extra copy or use Locate source.');
  return found[0];
}
function resolve(binding) {
  if (!binding) throw Error('Source is not linked on this computer. Use Locate source.');
  const vols=list(), roots=[];
  for (const v of vols) {
    try {
      const at=identify(v.mount_point,vols);
      if (at.key===binding.key) roots.push(path.join(v.mount_point,...binding.relative.split('/').filter(Boolean)));
    } catch {}
  }
  if (!roots.length) roots.push(binding.root);
  const candidates=[];
  for (const root of [...new Set(roots)]) { try { candidates.push(identify(root,vols)); } catch {} }
  return match(binding,candidates);
}
module.exports={list,identify,resolve,resolveTarget,same,match,safeJoin,realFile,inside,normalizeShare};
