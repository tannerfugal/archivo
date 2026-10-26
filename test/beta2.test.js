'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const org=require('../src/organization'),analysis=require('../src/analysis'),{sanitizeCatalog}=require('../src/catalog'),io=require('../src/catalog-io'),{evaluate,day,validate}=require('../src/search'),{SearchService}=require('../src/search-service');
const file=(name,size=10,extra={})=>({name,type:'file',size,modified:'2026-10-26',...extra});
const folder=(name,children)=>({name,type:'dir',children});
function catalog(){return sanitizeCatalog({organization:org.defaults(),disks:[{id:'a',label:'Server',categoryId:'servers',tree:[file('Clip.MOV',10,{created_ms:day('2026-10-25'),mtime_ms:day('2026-10-26')}),file('Clip.MOV.bak',20),folder('media',[file('x.mov',30)])]},{id:'b',label:'Shelf',categoryId:'large',tree:[file('clip.mov',10),file('x.txt',50)]}]});}
test('hierarchies roundtrip, stable assignments, reparenting, cycle prevention and empty-only deletion',t=>{
 const data=catalog();data.organization.locations=[{id:'room',name:'Edit room',parent:null},{id:'shelf',name:'Shelf 2',parent:'room'}];data.disks[1].locationId='shelf';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-org-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'test.archivo');io.write(file,data);assert.deepEqual(io.read(file),sanitizeCatalog(data));
 assert.deepEqual(org.scope(data,'archives','room').map(d=>d.id),['b']);assert.equal(org.scope(data,'servers','room').length,0);assert.equal(org.scope(data,'','unassigned').length,1);
 org.move(data.organization,'categories','large','servers');assert.equal(org.path(data.organization,'categories','large'),'Servers / Physically large');assert.throws(()=>org.move(data.organization,'categories','servers','large'),/inside itself/);
 assert.throws(()=>org.remove(data,'categories','large'),/assigned/);delete data.disks[1].categoryId;org.remove(data,'categories','large');assert.ok(!data.organization.categories.some(n=>n.id==='large'));
 assert.ok(!sanitizeCatalog({disks:[{id:'a',categoryId:'missing',tree:[]}]}).disks[0].categoryId);
 const invalid=org.clean({categories:[{id:'a',name:'A',parent:'b'},{id:'b',name:'B',parent:'a'}],locations:[]});assert.ok(org.path(invalid,'categories','a').length<20);
});
test('offline search combines exact names, type, scopes, path, bytes, both dates and inclusive days',()=>{
 const data=catalog();assert.equal(evaluate(data,{text:'clip.mov',exact:true}).total,2);assert.equal(evaluate(data,{text:'x'}).total,2);assert.equal(evaluate(data,{type:'video',min:11,max:35}).total,1);
 assert.equal(evaluate(data,{category:'archives',text:'clip.mov',exact:true}).items[0].diskId,'b');assert.equal(evaluate(data,{path:'media',drive:'a',type:'file'}).items[0].name,'x.mov');
 assert.equal(evaluate(data,{date:'created',from:'2026-10-25',to:'2026-10-25'}).total,1);assert.equal(evaluate(data,{date:'created',from:'2026-10-26'}).total,0);
 const end=day('2026-10-26',true);data.disks[0].tree.push(file('late',1,{mtime_ms:end-1}),file('tomorrow',1,{mtime_ms:end}));const r=evaluate(data,{date:'modified',from:'2026-10-26',to:'2026-10-26'});assert.ok(r.items.some(i=>i.name==='late'));assert.ok(!r.items.some(i=>i.name==='tomorrow'));
 assert.throws(()=>validate({min:10,max:1}),/Minimum/);assert.throws(()=>validate({from:'bad'}),/date/);
});
test('all matches are counted, sorted and paged without changing the stored disk list',()=>{
 const data=catalog();data.disks[0].tree=Array.from({length:1701},(_,i)=>file('frame'+i+'.mov',i+1));const before=JSON.stringify(data),r=evaluate(data,{type:'video',sort:'size',desc:true,page:6,pageSize:250});assert.equal(r.total,1702);assert.equal(r.items.length,202);assert.ok(r.items[0].size>r.items.at(-1).size);assert.equal(JSON.stringify(data),before);
});
test('search worker invalidates in-flight results and survives empty catalogs',async t=>{
 const service=new SearchService();t.after(()=>service.stop());service.context(catalog());assert.equal((await service.search({text:'clip',pageSize:1})).total,3);
 const result=service.search({});service.context({disks:[]});await assert.rejects(result,/Catalog changed/);assert.equal((await service.search({})).total,0);
});
test('nested map immediately contains descendants, bypasses wrapper chains, preserves weights and bounds rectangles',()=>{
 const root=analysis.tree([{id:'a',label:'Drive A',tree:[folder('wrapper',[folder('inside',[folder('Project',[file('large.mov',900),file('small.mov',100)]),folder('Audio',[file('mix.wav',100)])])])]}]);
 const rects=analysis.nested(root);assert.ok(rects.some(r=>r.item.name==='large.mov'));assert.ok(rects.some(r=>r.level>1));assert.ok(rects.some(r=>r.item.name.includes('wrapper')));
 const children=rects.filter(r=>r.level===1);assert.equal(children.reduce((s,r)=>s+r.item.size,0),1100);const siblings=analysis.layout(root.children[0].children[0].children[0].children,0,0,1000,600);assert.equal(siblings[0].item.size/siblings[1].item.size,10);
 const huge=analysis.tree([{id:'a',label:'A',tree:Array.from({length:50000},(_,i)=>file('item'+i,i+1))},{id:'b',label:'B',tree:[file('approx','2 MB')]}]);const bounded=analysis.nested(huge);assert.ok(bounded.length<=4000);assert.ok(bounded.some(r=>r.item.aggregate));const bucket=bounded.find(r=>r.item.aggregate).item;assert.ok(bucket.children.length<50000);assert.ok(analysis.nested(bucket).some(r=>!r.item.aggregate||r.item.children.length<bucket.children.length));const a=bounded.filter(r=>r.level===1&&r.item.diskId==='a'||r.level===1&&r.item.aggregate);assert.ok(a.length);assert.equal(huge.approximate,true);assert.equal(analysis.descendants(huge,false).length,50001);
 for(const r of bounded){assert.ok(r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=1000.0001&&r.y+r.h<=600.0001);}
});
test('duplicate presentation separates same-size content hashes, offline candidates and confirmed nonmatches',()=>{
 const items=[{id:'a',name:'a',size:10,status:'Verified',hash:'x'},{id:'b',name:'renamed',size:10,status:'Verified',hash:'x'},{id:'c',name:'c',size:10,status:'Verified',hash:'y'},{id:'d',name:'d',size:10,status:'Verified',hash:'y'},{id:'e',size:10,status:'Offline'},{id:'f',size:10,status:'Different'}];
 const report={groups:[{size:10,items}]},r=analysis.duplicateGroups(report);assert.equal(r.groups.length,3);assert.deepEqual(r.groups.map(g=>g.items.length),[2,2,1]);assert.equal(r.otherCount,1);assert.equal(r.groups.reduce((s,g)=>s+g.duplicateBytes,0),20);assert.equal(analysis.duplicateGroups(report,true).groups.length,4);
});
