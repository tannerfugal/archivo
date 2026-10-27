/* Folder-level duplicate impact. Counts are summaries, never authorization to delete. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./analysis'));else root.ArchivoDuplicateAreas=factory(root.ArchivoAnalysis);})(typeof globalThis!=='undefined'?globalThis:this,function(analysis){
 'use strict';
 const eligible=new Set(['Verified','Possible','Offline','Changed','Unreadable']);
 const key=(diskId,segments,direct=false)=>JSON.stringify([diskId,segments,direct]);
 function contains(item,area){return item.diskId===area.diskId&&item.segments.length>area.segments.length&&(!area.direct||item.segments.length===area.segments.length+1)&&area.segments.every((part,i)=>item.segments[i]===part);}
 function areaKeys(item){const parent=item.segments.slice(0,-1),out=[];for(let i=0;i<=parent.length;i++)out.push(key(item.diskId,parent.slice(0,i)));out.push(key(item.diskId,parent,true));return out;}
 function summarize(disks,report){
  const areas=new Map(),pools=new Map(),verified=new Map();
  for(const item of analysis.flatten(disks)){
   const parent=item.segments.slice(0,-1);
   for(let level=0;level<=parent.length+1;level++){
    const direct=level>parent.length,segments=direct?parent:parent.slice(0,level),id=key(item.diskId,segments,direct);
    if(!areas.has(id))areas.set(id,{id,diskId:item.diskId,diskLabel:item.diskLabel,segments,direct,name:direct?'Files in this folder':segments.at(-1)||item.diskLabel,files:0,bytes:0,approximate:false,matchedFiles:0,verifiedFiles:0,verifiedBytes:0,possibleFiles:0,possibleBytes:0,selectableFiles:0,selectableBytes:0});
    const area=areas.get(id);area.files++;area.bytes+=item.size;area.approximate||=!item.exact;
   }
  }
  function add(map,id,item,ids){
   if(!map.has(id))map.set(id,{size:item.size,total:0,counts:new Map(),uncertain:new Map()});const pool=map.get(id);pool.total++;
   for(const areaId of ids){pool.counts.set(areaId,(pool.counts.get(areaId)||0)+1);if(item.status!=='Verified')pool.uncertain.set(areaId,(pool.uncertain.get(areaId)||0)+1);}
  }
  const items=(report?.groups||[]).flatMap(group=>group.items).filter(item=>eligible.has(item.status));
  for(const item of items){const ids=areaKeys(item);add(pools,item.size,item,ids);if(item.status==='Verified'&&item.hash)add(verified,item.hash,item,ids);}
  for(const pool of verified.values())if(pool.total>1)for(const [id,count]of pool.counts){const area=areas.get(id);if(!area)continue;const redundant=pool.total>count?count:count-1;area.matchedFiles+=count;area.verifiedFiles+=redundant;area.verifiedBytes+=redundant*pool.size;}
  for(const pool of pools.values())if(pool.total>1)for(const [id,count]of pool.uncertain){const area=areas.get(id);if(!area)continue;const redundant=Math.min(count,pool.total>pool.counts.get(id)?count:pool.counts.get(id)-1);area.matchedFiles+=count;area.possibleFiles+=redundant;area.possibleBytes+=redundant*pool.size;}
  for(const item of items)if(item.status==='Verified'&&item.hash&&!item.network){const pool=verified.get(item.hash);for(const id of areaKeys(item)){const area=areas.get(id);if(area&&pool.total>pool.counts.get(id)){area.selectableFiles++;area.selectableBytes+=item.size;}}}
  return [...areas.values()].filter(area=>area.matchedFiles>0).map(area=>({...area,coverage:area.files?area.matchedFiles/area.files:0}));
 }
 function selectArea(report,area,current=[]){
  const ids=new Set(current),hashes=new Map();let added=0,skipped=0;
  for(const item of report.groups.flatMap(group=>group.items))if(item.status==='Verified'&&item.hash){if(!hashes.has(item.hash))hashes.set(item.hash,[]);hashes.get(item.hash).push(item);}
  for(const copies of hashes.values()){
   const inside=copies.filter(item=>contains(item,area)&&!item.network);
   const keeper=copies.some(item=>!contains(item,area)&&!ids.has(item.id));
   for(const item of inside){if(keeper){if(!ids.has(item.id)){ids.add(item.id);added++;}}else if(!ids.has(item.id))skipped++;}
  }
  return {ids:[...ids],added,skipped};
 }
 function counterparts(report,area){
  const items=report.groups.flatMap(group=>group.items),hashes=new Set(),sizes=new Set(),locations=new Map();
  for(const item of items)if(contains(item,area)){if(item.status==='Verified'&&item.hash)hashes.add(item.hash);else if(eligible.has(item.status))sizes.add(item.size);}
  for(const item of items)if(!contains(item,area)&&((item.status==='Verified'&&hashes.has(item.hash))||(eligible.has(item.status)&&sizes.has(item.size)))){
   const segments=item.segments.slice(0,-1),id=key(item.diskId,segments);
   if(!locations.has(id))locations.set(id,{diskId:item.diskId,diskLabel:item.diskLabel,segments,files:0,bytes:0});const location=locations.get(id);location.files++;location.bytes+=item.size;
  }
  return [...locations.values()].sort((a,b)=>b.bytes-a.bytes);
 }
 return {summarize,contains,selectArea,counterparts};
});
