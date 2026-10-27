'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const analysis=require('../src/analysis'),areas=require('../src/duplicate-areas'),{digest,verify}=require('../src/duplicates');
const file=(name,size)=>({type:'file',name,size}),folder=(name,children)=>({type:'dir',name,children});
const first='A296_C097_0417P8_005.R3D',second='A298_C001_0420C0_001.R3D',chunk=4294967296;
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-match-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function contentFixture(t,entries){const root=temporary(t),disks=[],bindings={};for(const[id,name,body]of entries){const directory=path.join(root,id);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,name),body);disks.push({id,label:id,tree:[file(name,body.length)]});bindings[id]={key:id,root:directory};}return{root,disks,bindings};}
function offlineReport(disks){return{mode:'metadata',groups:analysis.candidates(disks).map(group=>({...group,items:group.items.map((item,index)=>({...item,id:item.diskId+':'+index,status:'Offline'}))}))};}

test('unrelated RED clips and chunk numbers never match offline solely because of equal sizes',()=>{
 const disk={id:'archive',label:'Archive',tree:[folder('Shoot A',[file(first,chunk)]),folder('Shoot B',[file(second,chunk),file('A296_C097_0417P8_001.R3D',chunk)])]};
 assert.deepEqual(analysis.candidates([disk]),[]);assert.equal(analysis.verificationCandidates([disk])[0].items.length,3);
 assert.deepEqual(areas.summarize([disk],offlineReport([disk])),[]);
 const copied={id:'backup',label:'Backup',tree:[file(first.toLowerCase(),chunk),file(first,chunk-1),file(first,'4 GB'),file('empty',0)]};
 const groups=analysis.candidates([disk,copied]);assert.equal(groups.length,1);assert.equal(groups[0].items.length,2);assert.ok(groups[0].items.every(item=>item.name.toLowerCase()===first.toLowerCase()));
});

test('metadata groups and folder counterparts retain full-name identity within a shared size bucket',()=>{
 const disks=[{id:'a',label:'A',tree:[folder('Shoot A',[file(first,chunk),file('audio.wav',chunk)])]},{id:'b',label:'B',tree:[folder('Unrelated',[file(second,chunk),file('other.wav',chunk)])]},{id:'c',label:'C',tree:[folder('Copy',[file(first,chunk),file('audio.wav',chunk)])]}];
 // Defend presentation and folder summaries even against an old size-only report.
 const items=analysis.flatten(disks).map((item,index)=>({...item,id:String(index),status:'Offline'})),report={groups:[{size:chunk,items}]},derived=analysis.duplicateGroups(report);
 assert.equal(derived.groups.length,2);assert.equal(new Set(derived.groups.map(group=>group.id)).size,2);assert.equal(derived.otherCount,2);assert.ok(derived.groups.every(group=>new Set(group.items.map(item=>item.name)).size===1));
 const rows=areas.summarize(disks,report);assert.ok(!rows.some(area=>area.diskId==='b'));const area=rows.find(area=>area.diskId==='a'&&!area.direct&&area.segments.length===1);assert.equal(area.possibleBytes,2*chunk);assert.deepEqual(areas.counterparts(report,area).map(location=>location.diskId),['c']);
});

test('complete case-insensitive Unicode filenames match, without stripping extensions or chunk suffixes',()=>{
 const disks=[{id:'a',tree:[file('Re\u0301sume\u0301_005.MOV',12)]},{id:'b',tree:[file('RÉSUMÉ_005.mov',12),file('Résumé_001.mov',12),file('Résumé_005.mxf',12),file('Résumé_005.mov',13)]}];
 assert.equal(analysis.candidates(disks).length,1);assert.equal(analysis.candidates(disks)[0].items.length,2);
});

test('content verification finds genuine renamed copies and rejects unrelated equal-sized RED chunks',async t=>{
 const {disks,bindings}=contentFixture(t,[['a',first,Buffer.alloc(1048576,5)],['b',second,Buffer.alloc(1048576,6)],['c','renamed-copy.R3D',Buffer.alloc(1048576,5)]]);
 assert.equal(analysis.candidates(disks).length,0);const report=await verify(disks,bindings,binding=>binding),groups=analysis.duplicateGroups(report).groups;
 assert.equal(report.mode,'content');assert.equal(groups.length,1);assert.deepEqual(new Set(groups[0].items.map(item=>item.diskId)),new Set(['a','c']));assert.equal(report.groups[0].items.find(item=>item.diskId==='b').status,'Different');assert.ok(!areas.summarize(disks,report).some(area=>area.diskId==='b'));
});

test('equal samples cannot establish a match when full contents differ outside sampled blocks',async t=>{
 const original=Buffer.alloc(1048576,7),different=Buffer.from(original);different[131072]=9;
 const {disks,bindings}=contentFixture(t,[['a',first,original],['b',second,different]]);
 assert.equal((await digest(bindings.a.root,[first],true)).hash,(await digest(bindings.b.root,[second],true)).hash);
 const report=await verify(disks,bindings,binding=>binding);assert.ok(report.groups[0].items.every(item=>item.status==='Different'));assert.equal(analysis.duplicateGroups(report).groups.length,0);assert.equal(areas.summarize(disks,report).length,0);
});

test('unavailable same-name copies remain unverified and cannot inflate content-match areas',async t=>{
 const {disks,bindings}=contentFixture(t,[['a',first,Buffer.alloc(64,1)],['b',first,Buffer.alloc(64,1)]]);delete bindings.b;
 assert.equal(analysis.duplicateGroups(offlineReport(disks)).groups.length,1);
 const report=await verify(disks,bindings,binding=>{if(!binding)throw Error('offline');return binding;});
 assert.equal(analysis.duplicateGroups(report).groups.length,0);assert.equal(analysis.duplicateGroups(report,true).otherCount,2);assert.equal(areas.summarize(disks,report).length,0);assert.ok(report.groups[0].items.some(item=>item.status==='Unverified'));
});

test('a change between sampling and the full read cannot become a verified copy',async t=>{
 const {disks,bindings}=contentFixture(t,[['a',first,Buffer.alloc(64,1)],['b',second,Buffer.alloc(64,1)]]),target=path.join(bindings.a.root,first),open=fs.promises.open;let opened=0;
 fs.promises.open=async function(filename,...args){if(filename===target&&++opened===2)fs.appendFileSync(target,'changed');return open.call(this,filename,...args);};t.after(()=>{fs.promises.open=open;});
 const report=await verify(disks,bindings,binding=>binding);assert.equal(report.groups[0].items.find(item=>item.diskId==='a').status,'Changed');assert.equal(analysis.duplicateGroups(report).groups.length,0);
});
