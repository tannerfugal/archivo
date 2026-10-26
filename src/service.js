/* Archivo Fork background coordinator. Only this process may authorize paths and cleanup. */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Jobs}=require('./jobs');
const {atomic}=require('./catalog-io');
const {sanitizeCatalog}=require('./catalog');
const {validateRule,nextRun,advance}=require('./schedule');
const {trashSelection}=require('./duplicates');
class Service {
  constructor({directory,document,emit,trash,confirmTrash}) {
    this.directory=directory;this.file=path.join(directory,'background.json');this.jobs=new Jobs();
    this.document=document;this.emit=emit;this.trash=trash;this.confirmTrash=confirmTrash;
    this.busy=null;this.reports=new Map();this.tokens=new Map();this.live={disks:[]};
    try {this.settings=JSON.parse(fs.readFileSync(this.file,'utf8'));} catch {this.settings={};}
    this.settings={bindings:{},schedules:[],activity:[],paused:false,...this.settings};
    this.settings.schedules=this.settings.schedules.map(s=>({...s,running:false}));
  }
  save() {atomic(this.file,JSON.stringify(this.settings,null,2));this.emit('status',this.status());}
  status() {return {busy:this.busy,paused:this.settings.paused,schedules:this.settings.schedules,activity:this.settings.activity.slice(0,100)};}
  record(title,status,detail) {this.settings.activity.unshift({at:Date.now(),title,status,detail});this.settings.activity=this.settings.activity.slice(0,100);this.save();}
  key(file,diskId) {return JSON.stringify([file?path.resolve(file):'@current',diskId]);}
  binding(file,diskId) {return this.settings.bindings[this.key(file,diskId)];}
  bindings(file,disks) {return Object.fromEntries(disks.map(d=>[d.id,this.binding(file,d.id)]));}
  context(data) {this.live=sanitizeCatalog(data);return true;}
  migrate(from,to,disks) {for(const d of disks){const b=this.binding(from,d.id);if(b)this.settings.bindings[this.key(to,d.id)]=b;}this.save();}
  clearSession() {for(const key of Object.keys(this.settings.bindings))if(JSON.parse(key)[0]==='@current')delete this.settings.bindings[key];this.live={disks:[]};this.reports.clear();}
  async exclusive(label,fn) {
    if(this.busy)throw Error(this.busy+' is already running. Wait for it to finish, or cancel it.');
    this.cancelRequested=false;this.busy=label;this.emit('status',this.status());
    try{return await fn();}finally{this.busy=null;this.emit('status',this.status());}
  }
  cancel() { this.cancelRequested=true; this.jobs.cancel(); }
  async scan(root,binding) {
    return this.exclusive('scan',async()=>{
      const res=await this.jobs.run('scan',{root,binding,exclude:[this.document().path,this.document().path && this.document().path+'.backups',this.directory].filter(Boolean)},p=>this.emit('scan',p));
      if(!res.cancelled){res.sourceToken=crypto.randomUUID();this.tokens.set(res.sourceToken,res.source);if(this.tokens.size>32)this.tokens.delete(this.tokens.keys().next().value);}
      return res;
    });
  }
  linkScanned(diskId,token) {
    const source=this.tokens.get(token);if(!source)throw Error('Scan link expired. Use Locate source.');
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(diskId))throw Error('Invalid disk.');
    this.settings.bindings[this.key(this.document().path,diskId)]=source;this.tokens.delete(token);this.save();return source;
  }
  async bind(diskId,root) {
    if(!this.live.disks.some(d=>d.id===diskId))throw Error('Select a catalog disk.');
    const b=await this.jobs.run('identify',{root});
    this.settings.bindings[this.key(this.document().path,diskId)]=b;this.reports.clear();this.save();return b;
  }
  async resolve(diskId) {return this.jobs.run('resolve',{binding:this.binding(this.document().path,diskId)});}
  async reveal(diskId,segments) {return this.jobs.run('file',{binding:this.binding(this.document().path,diskId),segments});}
  sourceStatus() {const file=this.document().path;return this.live.disks.map(d=>({id:d.id,label:d.label,binding:this.binding(file,d.id)||null}));}
  addSchedule(input) {
    const file=this.document().path;if(!file)throw Error('Save this catalog before creating a schedule.');
    if(this.document().dirty)throw Error('Save your catalog edits before creating a schedule.');
    const rule=validateRule(input.rule),ids=[...new Set(input.diskIds || [])];
    if(!ids.length || ids.some(id=>!this.live.disks.some(d=>d.id===id)||!this.binding(file,id)))throw Error('Link each selected source with Locate source first.');
    const existing=this.settings.schedules.find(s=>s.id===input.id);
    if(existing && existing.file!==file)throw Error('Open this schedule’s catalog before editing it.');
    const schedule={id:existing?.id || crypto.randomUUID(),file,name:path.basename(file),diskIds:ids,rule,enabled:input.enabled===true,nextRun:nextRun(rule,Date.now()),lastRun:existing?.lastRun || null,lastResult:existing?.lastResult || 'Not run yet'};
    if(existing)Object.assign(existing,schedule);else this.settings.schedules.push(schedule);this.save();return schedule;
  }
  scheduleAction(id,action) {
    const s=this.settings.schedules.find(s=>s.id===id);if(!s)throw Error('Schedule not found.');
    if(action==='remove')this.settings.schedules=this.settings.schedules.filter(s=>s!==s);
    else if(action==='toggle'){s.enabled=!s.enabled;if(s.enabled)s.nextRun=nextRun(s.rule,Date.now());}
    else throw Error('Unknown schedule action.');this.save();return true;
  }
  async runSchedule(id) {
    const s=this.settings.schedules.find(s=>s.id===id);if(!s)throw Error('Schedule not found.');
    const doc=this.document();
    if(this.busy || (doc.path===s.file && (doc.dirty || doc.scanning)))return {deferred:true};
    return this.exclusive('scheduled rescan',async()=>{
      s.running=true;this.save();let updated=0;const notes=[];
      try {
        const snapshot=await this.jobs.run('read',{file:s.file});
        for(const id of s.diskIds) {
          if(this.cancelRequested){notes.push('Cancelled');break;}
          const disk=snapshot.data.disks.find(d=>d.id===id);if(!disk){notes.push('Removed catalog entry skipped');continue;}
          try {
            const result=await this.jobs.run('scan',{binding:this.binding(s.file,id),exclude:[s.file,s.file+'.backups',this.directory]},p=>this.emit('progress',{...p,label:disk.label}));
            if(result.cancelled) {notes.push(disk.label+': cancelled');break;}
            if(result.skipped?.count){notes.push(disk.label+': incomplete scan; previous entry preserved');continue;}
            Object.assign(disk,{tree:result.tree,file_count:result.fileCount,scanned:new Date().toISOString(),total:this.formatBytes(result.source.total_bytes),free:this.formatBytes(result.source.free_bytes)});
            delete disk.skipped;updated++;
          }catch(e){notes.push(disk.label+': '+e.message);}
        }
        const current=this.document();
        if(current.path===s.file && (current.dirty || current.scanning))throw Error('Catalog has unsaved edits; rescan will retry when saved.');
        if(updated) {
          const written=await this.jobs.run('write',{file:s.file,data:snapshot.data,expected:snapshot.fingerprint,backups:true});
          this.reports.clear();
          if(current.path===s.file){this.live=snapshot.data;this.emit('catalog',{path:s.file,data:snapshot.data,fingerprint:written.fingerprint});}
        }
        s.lastResult=updated+' source(s) updated'+(notes.length?' · '+notes.join('; '):'');
        const needsAction=notes.some(n=>!/offline|not linked|Source is offline/.test(n));
        this.record(s.name,needsAction?'attention':'complete',s.lastResult);
        return {updated,notes};
      }catch(e){s.lastResult=e.message;this.record(s.name,'attention',e.message);return {error:e.message};}
      finally{Object.assign(s,advance(s,Date.now()),{running:false});this.save();}
    });
  }
  async tick() {
    if(this.settings.paused || this.busy)return;
    for(const s of this.settings.schedules)if(s.enabled && s.nextRun<=Date.now()){
      const r=await this.runSchedule(s.id);if(r.deferred)continue;break;
    }
  }
  formatBytes(n) {if(!n)return '';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i>1?1:0)+' '+u[i];}
  async duplicates(ids,verify) {
    if(!Array.isArray(ids) || !ids.length)throw Error('Choose at least one disk.');
    const disks=this.live.disks.filter(d=>ids.includes(d.id)),file=this.document().path;
    return this.exclusive(verify?'duplicate verification':'duplicate search',async()=>{
      let report;
      if(verify)report=await this.jobs.run('verify',{disks,bindings:this.bindings(file,disks)},p=>this.emit('progress',p));
      else report={groups:(await this.jobs.run('candidates',{disks})).map(g=>({...g,items:g.items.map(i=>({...i,id:crypto.randomUUID(),status:this.binding(file,i.diskId)?'Possible':'Offline'}))}))};
      report.id=crypto.randomUUID();report.file=file;report.catalog=JSON.stringify(this.live);this.reports.clear();this.reports.set(report.id,report);
      return report;
    });
  }
  async trashCopies(reportId,ids) {
    const report=this.reports.get(reportId);
    if(!report || report.file!==this.document().path || report.catalog!==JSON.stringify(this.live))throw Error('Results are stale. Run verification again.');
    const groups=trashSelection(report,ids);
    return this.exclusive('duplicate cleanup',async()=>{
      if(!await this.confirmTrash(ids.length))return {cancelled:true};
      const removed=[],failures=[];
      for(const group of groups) {
        try {
          // Fresh full reads, including a keeper, are mandatory. Cached hashes never authorize cleanup.
          const verified=[];
          for(const item of [...group.keep,...group.remove]) {
            const result=await this.jobs.run('digest',{binding:this.binding(report.file,item.diskId),segments:item.segments},p=>this.emit('progress',p));
            if(result.hash!==group.hash || result.stamp!==item.stamp)throw Error('A copy changed since verification. Run verification again.');
            if(result.source.network && group.remove.includes(item))throw Error('Network copies cannot be safely recycled here. Use Finder or Explorer.');
            verified.push({item,result});
          }
          for(const item of group.remove) {
            if(this.cancelRequested)throw Error('Cleanup cancelled.');
            const v=verified.find(v=>v.item===item),keeper=verified.find(v=>group.keep.includes(v.item));
            // Re-resolve both identities and recheck path/stat immediately before each OS trash request.
            for(const check of [keeper,v]) {
              const fresh=await this.jobs.run('file',{binding:this.binding(report.file,check.item.diskId),segments:check.item.segments});
              if(fresh.file!==check.result.file || require('./duplicates').stamp(await fs.promises.stat(fresh.file))!==check.result.stamp)throw Error('A copy changed or disconnected before cleanup.');
            }
            await this.trash(v.result.file);removed.push(item);
          }
        }catch(e){failures.push(e.message);}
      }
      for(const item of removed) {
        const disk=this.live.disks.find(d=>d.id===item.diskId);if(!disk)continue;
        let nodes=disk.tree;const ancestors=[];
        for(const segment of item.segments.slice(0,-1)){const n=nodes.find(n=>n.name===segment && n.type==='dir');if(!n){nodes=null;break;}ancestors.push(n);nodes=n.children;}
        if(nodes){const i=nodes.findIndex(n=>n.name===item.segments.at(-1));if(i>=0){nodes.splice(i,1);disk.file_count=Math.max(0,disk.file_count-1);for(const a of ancestors)a.size=Math.max(0,(typeof a.size==='number'?a.size:0)-item.size);}}
      }
      this.reports.clear();if(removed.length)this.emit('cleanup',{data:this.live});
      this.record('Duplicate cleanup',failures.length?'attention':'complete',removed.length+' copies moved to Trash'+(failures.length?' · '+failures.join('; '):''));
      return {removed:removed.length,failures};
    });
  }
}
module.exports={Service};
