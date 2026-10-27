'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const io=require('../src/catalog-io'),areas=require('../src/duplicate-areas'),{Service}=require('../src/service');
const file=(name,size=10)=>({type:'file',name,size});
const folder=(name,children)=>({type:'dir',name,children});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-shared-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return root;}
function reportFor(disks,verified=true){const items=require('../src/analysis').flatten(disks).filter(item=>!item.name.startsWith('unique')).map((item,index)=>({...item,id:'copy-'+index,status:verified?'Verified':'Offline',hash:verified?item.name.replace(/^renamed-/,''):undefined}));return {groups:[{size:10,items}]};}
test('folder areas cover transferred trees, partial coverage, differing roots and ranked redundant bytes',()=>{
 const clips=[file('clip1'),file('clip2'),file('clip3')],disks=[{id:'a',label:'Originals',tree:[folder('Shoot',[folder('Card',clips),file('unique',10)])]},{id:'b',label:'Backup',tree:[folder('Transfer',[folder('Different root',clips.map(item=>({...item,name:'renamed-'+item.name})))])]}],report=reportFor(disks),rows=areas.summarize(disks,report);
 const a=rows.find(area=>area.diskId==='a'&&area.segments.join('/')==='Shoot'&&!area.direct),b=rows.find(area=>area.diskId==='b'&&area.segments.join('/')==='Transfer'&&!area.direct);
 assert.equal(a.verifiedBytes,30);assert.equal(a.files,4);assert.equal(a.coverage,.75);assert.equal(b.coverage,1);assert.equal(b.selectableFiles,3);
 const selected=areas.selectArea(report,b);assert.equal(selected.ids.length,3);assert.equal(areas.selectArea(report,a,selected.ids).added,0);assert.equal(areas.selectArea(report,a,selected.ids).skipped,3);
 assert.equal(areas.counterparts(report,b)[0].segments.join('/'),'Shoot/Card');assert.equal(disks[0].tree[0].children.length,2);
});
test('internal duplicate sets remain discoverable without claiming all copies can be removed',()=>{
 const disks=[{id:'a',label:'Drive',tree:[folder('Media',[folder('A',[file('clip1'),file('clip2')]),folder('B',[file('clip1'),file('clip2')])])]}],report=reportFor(disks),rows=areas.summarize(disks,report),parent=rows.find(area=>area.segments.join('/')==='Media'&&!area.direct),child=rows.find(area=>area.segments.join('/')==='Media/B'&&!area.direct);
 assert.equal(parent.verifiedBytes,20);assert.equal(parent.selectableFiles,0);assert.equal(child.verifiedBytes,20);assert.equal(areas.selectArea(report,child).ids.length,2);
});
test('offline candidates, hard links, nonmatches and network copies never become automatic cleanup',()=>{
 const disks=[{id:'a',label:'A',tree:[folder('Shoot',[file('one'),file('two')])]},{id:'b',label:'B',tree:[folder('Shoot',[file('one'),file('two')])]}],report=reportFor(disks,false),rows=areas.summarize(disks,report),area=rows.find(area=>area.diskId==='b'&&!area.direct&&area.segments.length===1);
 assert.equal(area.verifiedBytes,0);assert.equal(area.possibleBytes,20);assert.equal(areas.selectArea(report,area).ids.length,0);
 for(const item of report.groups[0].items){item.status='Verified';item.hash=item.name;if(item.diskId==='b')item.network=true;}
 const network=areas.summarize(disks,report).find(row=>row.id===area.id);assert.equal(network.selectableFiles,0);assert.equal(network.verifiedBytes,20);assert.equal(areas.selectArea(report,network).ids.length,0);
 report.groups[0].items.forEach(item=>item.status='Same file');assert.equal(areas.summarize(disks,report).length,0);
});
test('large folder sets aggregate in bounded time without pairwise file comparisons',()=>{
 const clips=Array.from({length:12000},(_,i)=>file('clip'+i)),disks=['a','b','c'].map(id=>({id,label:id,tree:[folder('Shoot',[folder('Card',clips)])]})),report=reportFor(disks),started=performance.now(),rows=areas.summarize(disks,report);
 assert.equal(rows.length,12);assert.equal(rows.find(row=>row.diskId==='b'&&row.segments.length===1).verifiedFiles,12000);assert.ok(performance.now()-started<5000);assert.equal(areas.selectArea(report,rows.find(row=>row.diskId==='b'&&row.segments.length===1)).added,12000);
});
test('independent processes cannot pass the save check together; readers see a complete version',async t=>{
 const root=fixture(t),file=path.join(root,'Shared.archivo'),release=path.join(root,'release');io.write(file,{disks:[{id:'a',label:'Original',tree:[]}]});const expected=io.fingerprint(file);
 const script=`const fs=require('fs'),io=require(${JSON.stringify(path.resolve(__dirname,'../src/catalog-io'))});const file=${JSON.stringify(file)},release=${JSON.stringify(release)},rename=fs.renameSync,target=fs.realpathSync(file);fs.renameSync=(from,to)=>{if(to===target){process.send('committing');const start=Date.now();while(!fs.existsSync(release)){if(Date.now()-start>10000)throw Error('Barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return rename(from,to);};io.write(file,{disks:[{id:'a',label:'First writer',tree:[]}]},${JSON.stringify(expected)},true);process.disconnect();`;
 const child=spawn(process.execPath,['-e',script],{stdio:['ignore','ignore','pipe','ipc']});t.after(()=>child.kill());let stderr='';child.stderr.on('data',data=>stderr+=data);
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(stderr||'Writer exited '+code)));});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Writer never reached commit')),10000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',reject);});
 try{assert.equal(io.read(file).disks[0].label,'Original');assert.throws(()=>io.write(file,{disks:[]},expected,true),/save locked/);}finally{fs.writeFileSync(release,'go');}
 await exited;assert.equal(io.read(file).disks[0].label,'First writer');assert.throws(()=>io.write(file,{disks:[]},expected,true),/changed outside/);assert.equal(fs.existsSync(file+'.lock'),false);assert.equal(fs.readdirSync(file+'.backups').length,1);
});
test('locks fail closed after a crash; stale timestamps and missing owners never authorize stealing',t=>{
 const root=fixture(t),file=path.join(root,'Shared.archivo');io.write(file,{disks:[]});fs.mkdirSync(file+'.lock');fs.writeFileSync(path.join(file+'.lock','owner.json'),JSON.stringify({token:'other',host:'Windows scheduler',pid:1,at:'2000-01-01'}));
 assert.throws(()=>io.write(file,{disks:[]}),/Windows scheduler/);assert.equal(fs.existsSync(file+'.lock'),true);fs.unlinkSync(path.join(file+'.lock','owner.json'));assert.throws(()=>io.write(file,{disks:[]}),/another Archivo/);
});
test('save-as can require a new destination; permissions and lock cleanup survive conflicts',t=>{
 const root=fixture(t),file=path.join(root,'Shared.archivo');io.write(file,{disks:[]},null);assert.throws(()=>io.write(file,{disks:[]},null),/exists/);assert.equal(fs.existsSync(file+'.lock'),false);
 if(process.platform!=='win32'){fs.chmodSync(file,0o640);io.write(file,{disks:[]},io.fingerprint(file));assert.equal(fs.statSync(file).mode&0o777,0o640);}
});
test('two client snapshots detect updates and disconnections without losing unsaved in-memory work',async t=>{
 const root=fixture(t),file=path.join(root,'Shared.archivo');io.write(file,{disks:[{id:'a',label:'Original',tree:[]}]});const events=[],services=['one','two'].map(name=>new Service({directory:path.join(root,name),document:()=>({path:file,dirty:true}),emit:(kind,data)=>events.push({kind,data})}));
 t.after(()=>{for(const service of services){service.jobs.stop();service.monitorJobs.stop();service.revealJobs.stop();service.searcher.stop();}});
 const snapshot=io.snapshot(file);for(const service of services){service.context(snapshot.data);service.watchCatalog(file,snapshot.fingerprint,snapshot.stamp);}
 assert.equal((await services[1].checkCatalog()).changed,false);io.write(file,{disks:[{id:'a',label:'Server update',tree:[]}]},snapshot.fingerprint,true);
 assert.equal((await services[1].checkCatalog()).changed,true);assert.equal(services[1].live.disks[0].label,'Original');assert.ok(events.some(event=>event.kind==='catalog-status'&&event.data.changed));
 fs.renameSync(file,file+'.offline');assert.equal((await services[1].checkCatalog()).unavailable,true);assert.equal(services[1].live.disks[0].label,'Original');
});
test('bulk cleanup planning and tree pruning stay linear and retain unique files and directories',()=>{
 const {trashSelection,pruneCopies}=require('../src/duplicates'),clips=Array.from({length:10000},(_,i)=>file('clip'+i)),disks=['a','b'].map(id=>({id,label:id,file_count:10001,tree:[folder('Shoot',[...clips,file('unique')])]})),report=reportFor(disks),area=areas.summarize(disks,report).find(row=>row.diskId==='b'&&row.segments.length===1&&!row.direct),selected=areas.selectArea(report,area),start=performance.now();
 const plan=trashSelection(report,selected.ids);assert.equal(plan.length,10000);pruneCopies({disks},plan.flatMap(group=>group.remove));assert.equal(disks[1].tree[0].children.length,1);assert.equal(disks[1].tree[0].children[0].name,'unique');assert.equal(disks[1].file_count,1);assert.equal(disks[0].tree[0].children.length,10001);assert.ok(performance.now()-start<3000);
});
test('cleanup cannot start against a locked or changed shared catalog',async t=>{
 const root=fixture(t),file=path.join(root,'Shared.archivo'),data={disks:[{id:'a',label:'Original',tree:[]}]};io.write(file,data);let reads=0,trash=0;
 const service=new Service({directory:path.join(root,'state'),document:()=>({path:file}),emit:()=>{},confirmTrash:async()=>true,trash:async()=>trash++});t.after(()=>{service.monitorJobs.stop();service.jobs.stop();service.revealJobs.stop();service.searcher.stop();});service.context(data);service.jobs.run=async()=>{reads++;};
 const report={id:'report',file,fingerprint:io.fingerprint(file),catalog:JSON.stringify(service.live),groups:[{items:[{id:'keep',status:'Verified',hash:'same'},{id:'remove',status:'Verified',hash:'same'}]}]};service.reports.set(report.id,report);
 const release=io.lock(file);try{await assert.rejects(service.trashCopies('report',['remove']),/save locked/);}finally{release();}
 io.write(file,{disks:[]},report.fingerprint,true);await assert.rejects(service.trashCopies('report',['remove']),/shared catalog changed/);assert.equal(reads,0);assert.equal(trash,0);assert.equal(fs.existsSync(file+'.lock'),false);
});
