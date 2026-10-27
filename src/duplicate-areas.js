/* Folder-level duplicate impact. Counts are summaries, never authorization to delete. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./analysis'));else root.ArchivoDuplicateAreas=factory(root.ArchivoAnalysis);})(typeof globalThis!=='undefined'?globalThis:this,function(analysis){
 'use strict';
 const key=(diskId,segments,direct=false)=>JSON.stringify([diskId,segments,direct]);
 function contains(item,area){return item.diskId===area.diskId&&item.segments.length>area.segments.length&&(!area.direct||item.segments.length===area.segments.length+1)&&area.segments.every((part,i)=>item.segments[i]===part);}
 function areaKeys(item){const parent=item.segments.slice(0,-1),out=[];for(let i=0;i<=parent.length;i++)out.push(key(item.diskId,parent.slice(0,i)));out.push(key(item.diskId,parent,true));return out;}
 function summarize(disks,report){
  const areas=new Map();
  for(const item of analysis.flatten(disks)){
   const parent=item.segments.slice(0,-1);
   for(let level=0;level<=parent.length+1;level++){
    const direct=level>parent.length,segments=direct?parent:parent.slice(0,level),id=key(item.diskId,segments,direct);
    if(!areas.has(id))areas.set(id,{id,diskId:item.diskId,diskLabel:item.diskLabel,segments,direct,name:direct?'Files in this folder':segments.at(-1)||item.diskLabel,files:0,bytes:0,approximate:false,matchedFiles:0,verifiedFiles:0,verifiedBytes:0,possibleFiles:0,possibleBytes:0,selectableFiles:0,selectableBytes:0});
    const area=areas.get(id);area.files++;area.bytes+=item.size;area.approximate||=!item.exact;
   }
  }
  // Share the exact match groups used by File matches. Never pool unrelated
  // filenames, unavailable verification results or different hashes by size.
  for(const group of analysis.duplicateGroups(report).groups){
   const counts=new Map(),verified=group.state==='Verified',total=group.items.length;
   for(const item of group.items)for(const id of areaKeys(item))counts.set(id,(counts.get(id)||0)+1);
   for(const [id,count]of counts){const area=areas.get(id);if(!area)continue;const redundant=total>count?count:count-1;area.matchedFiles+=count;if(verified){area.verifiedFiles+=redundant;area.verifiedBytes+=redundant*group.size;}else{area.possibleFiles+=redundant;area.possibleBytes+=redundant*group.size;}}
   if(verified)for(const item of group.items)if(!item.network)for(const id of areaKeys(item)){const area=areas.get(id);if(area&&total>counts.get(id)){area.selectableFiles++;area.selectableBytes+=item.size;}}
  }
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
  const locations=new Map();
  for(const group of analysis.duplicateGroups(report).groups)if(group.items.some(item=>contains(item,area)))for(const item of group.items)if(!contains(item,area)){
   const segments=item.segments.slice(0,-1),id=key(item.diskId,segments);
   if(!locations.has(id))locations.set(id,{diskId:item.diskId,diskLabel:item.diskLabel,segments,files:0,bytes:0});const location=locations.get(id);location.files++;location.bytes+=item.size;
  }
  return [...locations.values()].sort((a,b)=>b.bytes-a.bytes);
 }
 return {summarize,contains,selectArea,counterparts};
});
