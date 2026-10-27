'use strict';
let forkDuplicateMode='folders',forkDuplicateArea=null,forkAreaParent=null,forkAreaPage=0,forkAreaSort='verified';
function renderDuplicateViewControls(host){
 const tabs=fe('div','ft-actions duplicate-view-tabs');
 for(const [mode,title]of [['folders','Folder areas'],['files','File matches']]){const button=fb(title,()=>{forkDuplicateMode=mode;forkDuplicatePage=0;renderDuplicateResults();});button.setAttribute('aria-pressed',String(forkDuplicateMode===mode));tabs.append(button);}
 const clear=fb('Clear cleanup selection',()=>{forkDuplicateSelections.clear();renderDuplicateResults();});clear.disabled=!forkDuplicateSelections.size;tabs.append(clear);host.append(tabs);
}
function selectDuplicateArea(area){
 const result=ArchivoDuplicateAreas.selectArea(forkDuplicateReport,area,[...forkDuplicateSelections]);forkDuplicateSelections.clear();for(const id of result.ids)forkDuplicateSelections.add(id);
 renderDuplicateResults();toast(result.added+' verified copies added to the cleanup selection.'+(result.skipped?' '+result.skipped+' kept because no unselected copy remains outside this area.':''),'info',6000);
}
function renderDuplicateAreaSelection(host,area){
 const box=fe('div','duplicate-area-context');box.append(fe('strong','',fpath(area)),fe('p','ft-muted','Area selection includes verified local files with an unselected matching copy outside this area. It never removes a folder or its other contents.'));
 const actions=fe('div','ft-actions'),select=fb('Select verified copies in this area',()=>selectDuplicateArea(area));select.disabled=!area.selectableFiles||!!forkBusy;
 actions.append(select,fb('Clear this area',()=>{for(const item of forkDuplicateReport.groups.flatMap(group=>group.items))if(ArchivoDuplicateAreas.contains(item,area))forkDuplicateSelections.delete(item.id);renderDuplicateResults();}),fb('Back to folder areas',()=>{forkDuplicateMode='folders';forkDuplicateArea=null;renderDuplicateResults();}));box.append(actions);host.append(box);
}
function renderDuplicateAreas(host,report){
 const areas=report.areas||(report.areas=ArchivoDuplicateAreas.summarize(DB.disks,report));
 const total=fe('div','ft-stat',fmt(report.verifiedDuplicateBytes??ArchivoAnalysis.duplicateGroups(report).groups.filter(group=>group.state==='Verified').reduce((sum,group)=>sum+group.duplicateBytes,0))+' verified duplicate bytes');
 const hint=fe('p','ft-muted','Possible bytes are size matches only. Folder estimates overlap; they are not additive.');
 const count=fe('p','ft-muted');count.id='duplicate-selection-count';
 const controls=fe('div','ft-row'),sort=fe('select','ft-select');sort.setAttribute('aria-label','Sort duplicate areas');
 for(const [value,title]of [['verified','Most verified redundant space'],['possible','Most possible redundant space'],['files','Most matching files'],['coverage','Highest matching coverage']]){const option=fe('option','',title);option.value=value;sort.append(option);}sort.value=forkAreaSort;sort.onchange=()=>{forkAreaSort=sort.value;forkAreaPage=0;renderDuplicateResults();};controls.append(sort);
 if(forkAreaParent){controls.append(fb('All drives',()=>{forkAreaParent=null;forkAreaPage=0;renderDuplicateResults();}),fe('span','ft-muted',fpath(forkAreaParent)),fb('Up one folder',()=>{forkAreaParent=forkAreaParent.segments.length?{...forkAreaParent,segments:forkAreaParent.segments.slice(0,-1)}:null;forkAreaPage=0;renderDuplicateResults();}));}const overview=fe('div','duplicate-area-overview');overview.append(total,controls);host.append(overview,hint,count);updateDuplicateActions();
 let rows=areas.filter(area=>area.matchedFiles>=2&&(forkAreaParent?area.diskId===forkAreaParent.diskId&&forkAreaParent.segments.every((part,i)=>area.segments[i]===part)&&(area.direct?area.segments.length===forkAreaParent.segments.length:area.segments.length===forkAreaParent.segments.length+1):area.direct?area.segments.length===0:area.segments.length===1));
 const value=area=>forkAreaSort==='possible'?area.possibleBytes:forkAreaSort==='files'?area.matchedFiles:forkAreaSort==='coverage'?area.coverage:area.verifiedBytes;
 rows.sort((a,b)=>value(b)-value(a)||b.possibleBytes-a.possibleBytes||b.matchedFiles-a.matchedFiles||fpath(a).localeCompare(fpath(b)));
 if(!rows.length){host.append(fe('div','ft-empty','No areas with at least two matching files at this level. Use File matches to inspect individual copies.'));return;}
 const size=20;forkAreaPage=Math.min(forkAreaPage,Math.ceil(rows.length/size)-1);const start=forkAreaPage*size;
 const table=ftable(['Folder area','Coverage','Redundant space','Actions']);table.classList.add('duplicate-areas-table');
 for(const area of rows.slice(start,start+size)){
  const name=fe('div');name.append(fe('strong','',area.direct?'Files in '+(area.segments.at(-1)||area.diskLabel):area.name),fe('p','ft-path',fpath(area)));
  const coverage=fe('div');coverage.append(fe('strong','',Math.round(Math.min(1,area.coverage)*100)+'% matching'),fe('p','ft-muted',area.matchedFiles.toLocaleString()+' of '+area.files.toLocaleString()+' files'),fe('p','ft-muted',area.verifiedFiles+' verified redundant · '+area.possibleFiles+' possible'));
  const impact=fe('div');impact.append(fe('strong','',fmt(area.verifiedBytes)+' verified'),fe('p','ft-muted',fmt(area.possibleBytes)+' possible'),fe('p','ft-muted',area.selectableFiles+' local copies have matches outside'));
  const actions=fe('div','ft-actions');actions.append(fb('Review files',()=>{forkDuplicateArea=area;forkDuplicateMode='files';forkDuplicatePage=0;renderDuplicateResults();}),fb('Other copy locations',()=>showDuplicateAreaLocations(area)));
  if(!area.direct)actions.append(fb('Break down',()=>{forkAreaParent=area;forkAreaPage=0;renderDuplicateResults();}));
  const select=fb('Select verified copies',()=>selectDuplicateArea(area));select.disabled=!area.selectableFiles||!!forkBusy;actions.append(select);frow(table,[name,coverage,impact,actions]);
 }host.append(table);
 const pager=fe('div','ft-page'),previous=fb('Previous',()=>{forkAreaPage--;renderDuplicateResults();}),next=fb('Next',()=>{forkAreaPage++;renderDuplicateResults();});previous.disabled=!forkAreaPage;next.disabled=start+size>=rows.length;pager.append(previous,fe('span','',`${start+1}–${Math.min(start+size,rows.length)} of ${rows.length} folder areas`),next);host.append(pager);applyForkBusy();
}
function showDuplicateAreaLocations(area){
 const locations=ArchivoDuplicateAreas.counterparts(forkDuplicateReport,area);
 showModal('Other copy locations','<div id="duplicate-area-locations"></div>',[{label:'Done',cls:'btn-p',fn:hideModal}]);
 const host=g('duplicate-area-locations');host.append(fe('p','ft-muted','Copies outside '+fpath(area)+'. Size-only matches remain possible until verified.'));
 const table=ftable(['Location','Matching files','Indexed bytes']);for(const location of locations.slice(0,100))frow(table,[fpath(location),location.files.toLocaleString(),fmt(location.bytes)]);host.append(table);
 if(locations.length>100)host.append(fe('p','ft-muted','Showing the largest 100 of '+locations.length+' locations. Review files or export CSV for all paths.'));if(!locations.length)host.append(fe('p','ft-muted','Matches are inside this area. Break it down or review its files to compare the copies.'));
}
