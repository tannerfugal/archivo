'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {validateRule,nextRun,advance}=require('../src/schedule');
const sources=require('../src/sources'),io=require('../src/catalog-io'),analysis=require('../src/analysis');
const {sanitizeCatalog}=require('../src/catalog');
const {digest,verify,trashSelection}=require('../src/duplicates');
const {Service}=require('../src/service');
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-fork-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const disk=(id,tree)=>({id,label:id,tree,file_count:tree.length});
const node=(name,size)=>({name,size,type:'file'});
test('source matching uses volume identity, not labels or drive letters',()=>{
 const b={key:'volume:a:partition1',relative:'',root:'E:\\',name:'ARCHIVE'};
 assert.equal(sources.match(b,[{...b,root:'G:\\'}]).root,'G:\\');
 assert.throws(()=>sources.match(b,[{...b,key:'volume:b:partition1'}]),/offline/);
 assert.throws(()=>sources.match(b,[{...b,key:'volume:a:partition2'}]),/offline/);
 assert.throws(()=>sources.match(b,[b,{...b,root:'F:\\'}]),/More than one/);
 assert.throws(()=>sources.match(b,[{...b,relative:'other'}]),/offline/);
});
test('server paths normalize credentials, hosts and mapped UNC identity',()=>{
 assert.equal(sources.normalizeShare('//user@NAS/Video%20Assets'),'smb://nas/video assets');
 assert.equal(sources.normalizeShare('\\\\NAS\\Video Assets\\Project'),'smb://nas/video assets/Project');
 assert.equal(sources.normalizeShare('C:\\files'),'');
});
test('catalog paths cannot escape roots on either platform',()=>{
 for(const platform of ['darwin','win32'])for(const segments of [['..','secret'],['x/y'],['x\\y'],['.'],['\u0000']])assert.throws(()=>sources.safeJoin(platform==='win32'?'E:\\':'/Volumes/X',segments,platform));
 assert.throws(()=>sources.safeJoin('E:\\',['a:stream'],'win32'));
 assert.throws(()=>sources.safeJoin('E:\\',['file.'],'win32'));
 assert.equal(sources.safeJoin('E:\\',['Project','file.mov'],'win32'),'E:\\Project\\file.mov');
 assert.equal(sources.safeJoin('/Volumes/A',['Project','file.mov'],'darwin'),'/Volumes/A/Project/file.mov');
 assert.equal(sources.inside('/Volumes/A','/Volumes/AB/file','darwin'),false);
});
test('junctions and links are never followed for file operations',t=>{
 const root=temporary(t),outside=temporary(t);fs.writeFileSync(path.join(outside,'secret'),'x');fs.symlinkSync(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>sources.realFile(root,['link','secret']),/links|junctions/);
});
test('interval bounds, weekly validation and one catch-up advancement',()=>{
 assert.throws(()=>validateRule({kind:'interval',minutes:1}));assert.throws(()=>validateRule({kind:'weekly',time:'02:00',days:[]}));assert.throws(()=>validateRule({kind:'daily',time:'25:00'}));
 const now=Date.now(),s=advance({rule:{kind:'interval',minutes:60},nextRun:now-9*3600000},now);
 assert.equal(s.nextRun,now+3600000);assert.equal(s.lastRun,now);
});
test('daily and weekly schedules preserve local time over DST and avoid duplicate fall-back runs',()=>{
 const prev=process.env.TZ;process.env.TZ='America/Boise';
 try{
   assert.equal(new Date(nextRun({kind:'daily',time:'02:00'},new Date(2026,2,7,3).getTime())).getHours(),3); // missing 02:00 moves to 03:00
   const first=new Date(2026,10,1,1,31),next=new Date(nextRun({kind:'daily',time:'01:30'},first.getTime()));assert.equal(next.getDate(),2);assert.equal(next.getHours(),1);
   const monday=new Date(nextRun({kind:'weekly',time:'09:15',days:[1]},new Date(2026,9,23,10).getTime()));assert.equal(monday.getDay(),1);assert.equal(monday.getHours(),9);
 }finally{if(prev===undefined)delete process.env.TZ;else process.env.TZ=prev;}
});
test('atomic saves retain five recoverable backups and detect external changes',t=>{
 const root=temporary(t),file=path.join(root,'catalog.archivo');let data={disks:[disk('a',[node('f',1)])]};io.write(file,data);
 let expected=io.fingerprint(file);for(let i=0;i<7;i++){data.disks[0].label='Revision '+i;expected=io.write(file,data,expected,true);}
 const backups=fs.readdirSync(file+'.backups');assert.equal(backups.length,5);assert.ok(io.read(path.join(file+'.backups',backups[0])).disks.length);
 const original=fs.readFileSync(file);fs.appendFileSync(file,'external');const changed=fs.readFileSync(file);
 assert.throws(()=>io.write(file,data,expected,true),/changed/);assert.deepEqual(fs.readFileSync(file),changed);assert.notDeepEqual(original,changed);
});
test('legacy catalogs retain usable fields and cannot import schedules or source bindings',()=>{
 const result=sanitizeCatalog({schedules:[{enabled:true}],bindings:{root:'/evil'},disks:[{...disk('a',[node('legacy','1,5 MB')]),note:'keep me',source:'/evil'}]});
 assert.equal(result.disks[0].note,'keep me');assert.equal(result.disks[0].tree[0].size,'1,5 MB');assert.equal(result.schedules,undefined);assert.equal(result.disks[0].source,undefined);
});
test('offline map totals are exact for scanned bytes, approximate for imported sizes',()=>{
 const d=disk('d',[{name:'folder',type:'dir',size:9999,children:[node('a',100),node('b',200)]},node('import','1,5 MB'),node('unknown','?')]);
 const tree=analysis.tree([d]);assert.equal(tree.children[0].children[0].size,300);assert.equal(tree.size,300+1.5*1024*1024);assert.equal(tree.approximate,true);
 const tiles=analysis.layout(tree.children[0].children,0,0,100,100);assert.ok(Math.abs(tiles.reduce((n,r)=>n+r.w*r.h,0)-10000)<0.0001);
});
test('large offline catalogs can be analyzed and treemap rectangles remain bounded',()=>{
 const tree=analysis.tree([disk('a',Array.from({length:50000},(_,i)=>node('file'+i,i+1)))]);assert.equal(tree.size,50000*50001/2);
 const layout=analysis.layout(tree.children[0].children.slice(-300),0,0,100,100);assert.equal(layout.length,300);assert.ok(layout.every(r=>r.w>0&&r.h>0&&r.x+r.w<100.00001&&r.y+r.h<100.00001));
});
test('duplicate candidates include renamed copies, exclude zero bytes and approximate sizes',()=>{
 const g=analysis.candidates([disk('a',[node('one',10),node('two',0),node('rounded','10 B')]),disk('b',[node('renamed',10)])]);assert.equal(g.length,1);assert.equal(g[0].items.length,2);
});
test('content verification distinguishes equal size, renamed copies, hardlinks, offline and changed files',async t=>{
 const root=temporary(t);for(const[name,body]of[['one','same'],['renamed','same'],['different','nope'],['changed','bigger']])fs.writeFileSync(path.join(root,name),body);fs.linkSync(path.join(root,'one'),path.join(root,'hardlink'));
 const d=disk('a',['one','renamed','different','changed','hardlink'].map(n=>node(n,4))),offline=disk('b',[node('off',4)]);
 const report=await verify([d,offline],{a:{key:'a',root}},binding=>{if(!binding)throw Error('offline');return binding;});
 const items=report.groups[0].items;assert.equal(items.filter(i=>i.status==='Verified').length,2);assert.equal(items.filter(i=>i.status==='Same file').length,1);assert.equal(items.find(i=>i.name==='different').status,'Different');assert.equal(items.find(i=>i.name==='changed').status,'Changed');assert.equal(items.find(i=>i.name==='off').status,'Offline');
 const copies=items.filter(i=>i.status==='Verified');assert.equal(trashSelection(report,[copies[0].id]).length,1);assert.throws(()=>trashSelection(report,copies.map(i=>i.id)),/Keep at least one/);assert.throws(()=>trashSelection(report,[items.find(i=>i.status==='Offline').id]),/Only verified/);
});
test('hashing is cancellable without cleanup and rejects links',async t=>{
 const root=temporary(t);fs.writeFileSync(path.join(root,'one'),Buffer.alloc(200000));await assert.rejects(digest(root,['one'],false,()=>true),/Cancelled/);assert.ok(fs.existsSync(path.join(root,'one')));
});
function serviceFixture(t){const root=temporary(t),file=path.join(root,'test.archivo'),data={disks:[disk('a',[node('old',5)])]};io.write(file,data);const doc={path:file,dirty:false,scanning:false},events=[];
 const service=new Service({directory:path.join(root,'state'),document:()=>doc,emit:(kind,data)=>events.push({kind,data}),trash:()=>{throw Error('No real trash in tests');},confirmTrash:async()=>true});service.context(data);service.settings.bindings[service.key(file,'a')]={key:'volume-a',root};
 return {service,root,file,data,doc,events};}
test('scheduler defers dirty catalogs and overlapping jobs',async t=>{
 const {service,doc}=serviceFixture(t),s=service.addSchedule({diskIds:['a'],enabled:true,rule:{kind:'interval',minutes:15}});doc.dirty=true;assert.deepEqual(await service.runSchedule(s.id),{deferred:true});doc.dirty=false;service.busy='manual scan';assert.deepEqual(await service.runSchedule(s.id),{deferred:true});
});
test('scheduler preserves previous trees on disconnection and incomplete scans',async t=>{
 for(const mode of ['offline','partial']){const {service,file}=serviceFixture(t),s=service.addSchedule({diskIds:['a'],enabled:true,rule:{kind:'daily',time:'02:00'}});
 service.jobs.run=async(op,args)=>{if(op==='read')return{data:io.read(file),fingerprint:io.fingerprint(file)};if(mode==='offline')throw Error('Source is offline');return{tree:[node('new',20)],fileCount:1,skipped:{count:2},source:{}};};
 const before=fs.readFileSync(file),r=await service.runSchedule(s.id);assert.equal(r.updated,0);assert.deepEqual(fs.readFileSync(file),before);assert.ok(s.nextRun>Date.now());}
});
test('scheduler commits successful sources, backs up and pushes updates to clean open catalog',async t=>{
 const {service,file,events}=serviceFixture(t),s=service.addSchedule({diskIds:['a'],enabled:true,rule:{kind:'interval',minutes:15}});
 service.jobs.run=async(op,args)=>{if(op==='read')return{data:io.read(file),fingerprint:io.fingerprint(file)};if(op==='scan')return{tree:[node('new',20)],fileCount:1,skipped:{count:0},source:{total_bytes:1000,free_bytes:500}};if(op==='write')return{fingerprint:io.write(args.file,args.data,args.expected,args.backups)};};
 const r=await service.runSchedule(s.id);assert.equal(r.updated,1);assert.equal(io.read(file).disks[0].tree[0].name,'new');assert.equal(fs.readdirSync(file+'.backups').length,1);assert.ok(events.some(e=>e.kind==='catalog'));
});
test('scheduler refuses to overwrite a catalog changed while scanning',async t=>{
 const {service,file}=serviceFixture(t),s=service.addSchedule({diskIds:['a'],enabled:true,rule:{kind:'daily',time:'02:00'}});
 service.jobs.run=async(op,args)=>{if(op==='read')return{data:io.read(file),fingerprint:io.fingerprint(file)};if(op==='scan'){const other=io.read(file);other.disks[0].note='external edit';io.write(file,other);return{tree:[node('new',20)],fileCount:1,source:{}};}if(op==='write')return io.write(file,args.data,args.expected,true);};
 const r=await service.runSchedule(s.id);assert.match(r.error,/changed/);assert.equal(io.read(file).disks[0].note,'external edit');assert.equal(io.read(file).disks[0].tree[0].name,'old');
});
test('schedules survive relaunch and imported catalogs do not activate schedules',t=>{
 const {service,root,file}=serviceFixture(t);service.addSchedule({diskIds:['a'],enabled:false,rule:{kind:'daily',time:'02:00'}});
 const restored=new Service({directory:path.join(root,'state'),document:()=>({path:file}),emit:()=>{}});assert.equal(restored.settings.schedules.length,1);assert.equal(restored.settings.schedules[0].enabled,false);
 restored.context({disks:[],schedules:[{enabled:true}]});assert.equal(restored.settings.schedules.length,1);
});
test('cleanup refuses stale reports, network files, changed copies and OS recycle failures',async t=>{
 for(const mode of ['network','changed','failure']){
  const {service,file,data}=serviceFixture(t);let calls=0;service.trash=async()=>{calls++;throw Error('Recycle Bin unavailable');};
  const items=['keeper','remove'].map((name,i)=>({id:name,diskId:'a',segments:[name],status:'Verified',hash:'identical',stamp:'stamp',size:5}));
  const report={id:'report',file,catalog:JSON.stringify(service.live),groups:[{items}]};service.reports.set(report.id,report);
  service.jobs.run=async()=>({hash:'identical',stamp:mode==='changed'?'changed':'stamp',file:'/unused',source:{network:mode==='network'}});
  const result=await service.trashCopies(report.id,['remove']);assert.equal(result.removed,0);assert.ok(result.failures.length);assert.equal(calls,0);
 }
});
test('cleanup revalidates full contents, keeps a survivor, updates catalog and handles recycle failure',async t=>{
 for(const fail of [false,true]){
  const {service,root,file}=serviceFixture(t);
  for(const name of ['keeper','remove'])fs.writeFileSync(path.join(root,name),'identical');
  service.context({disks:[disk('a',[node('keeper',9),node('remove',9)])]});
  const items=[];for(const name of ['keeper','remove']){const d=await digest(root,[name],false);items.push({id:name,diskId:'a',segments:[name],status:'Verified',hash:d.hash,stamp:d.stamp,size:9});}
  const report={id:'actual',file,catalog:JSON.stringify(service.live),groups:[{items}]};service.reports.set(report.id,report);
  service.jobs.run=async(op,args)=>{if(op==='digest')return{...await digest(root,args.segments,false),source:{network:false}};if(op==='file')return{file:sources.realFile(root,args.segments)};};
  let recycled=0;service.trash=async file=>{if(fail)throw Error('Recycle Bin unavailable');fs.renameSync(file,path.join(root,'mock-recycled'));recycled++;};
  const result=await service.trashCopies(report.id,['remove']);assert.equal(result.removed,fail?0:1);assert.equal(recycled,fail?0:1);assert.ok(fs.existsSync(path.join(root,'keeper')));assert.equal(fs.existsSync(path.join(root,'remove')),fail);assert.equal(service.live.disks[0].tree.length,fail?2:1);assert.equal(service.reports.size,0);
 }
});
test('a modification during a full hash cannot produce a verified result',async t=>{
 const root=temporary(t),file=path.join(root,'changing');fs.writeFileSync(file,Buffer.alloc(3000000));let edited=false;
 await assert.rejects(digest(root,['changing'],false,()=>false,()=>{if(!edited){edited=true;fs.appendFileSync(file,'changed');}}),/changed/);
});
