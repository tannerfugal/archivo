/* Archivo Fork tools — plain DOM, same sandbox and design tokens as upstream. */
'use strict';
let forkScheduleRenderId=0;
let forkBusy=null, forkView='catalog', forkState=null, forkMapStack=[], forkMapSelected=null, forkDuplicateReport=null, forkDuplicatePage=0, forkEditSchedule=null;
const fa=window.archivo;
function forkError(e){toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'err',7000);}
function fe(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function fb(text,fn,cls=''){const el=fe('button','ft-button '+cls,text);el.type='button';el.addEventListener('click',()=>Promise.resolve().then(fn).catch(forkError));return el;}
function fmt(n){return fmtB(n)||'0 B';}
function fbadge(text){return fe('span','ft-badge '+text.toLowerCase(),text);}
function fcheck(text,value,checked=true){const label=fe('label','ft-check'),input=fe('input');input.type='checkbox';input.value=value;input.checked=checked;label.append(input,document.createTextNode(text));return label;}
function fhead(title,description,actions=[]){const head=fe('div','ft-head'),left=fe('div');left.append(fe('h1','',title),fe('p','',description));head.append(left);const right=fe('div','ft-actions');right.append(...actions);head.append(right);g('fork-panel').append(head);}
async function forkSync(){await fa.context(DB);forkState=await fa.toolsStatus();return forkState;}
function forkRefresh(){if(fa?.context)fa.context(DB).catch(forkError);if(forkView==='map'){forkMapStack=[];renderStorageMap();}forkDuplicateReport=null;if(typeof forkDuplicateSelections!=='undefined')forkDuplicateSelections.clear();}
function forkShow(view){
  forkView=view;
  if(typeof renderOrganization==='function')renderOrganization();
  document.querySelectorAll('#fork-nav [data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  g('fork-panel').hidden=view==='catalog';g('main').style.display=view==='catalog'?'flex':'none';
  if(view==='catalog'){if(!docOpen)showWelcome();return;}
  hideWelcome();g('fork-panel').replaceChildren();
  if(view==='map'){forkMapStack=[];renderStorageMap();}
  if(view==='duplicates')renderDuplicates();
  if(view==='schedules')renderSchedules().catch(forkError);
}
async function reviewIncomplete(result){
  if(!result.skipped?.count)return true;
  return new Promise(resolve=>showModal('Incomplete scan',esc(result.skipped.count)+' items could not be read. Keeping the previous catalog is recommended. You can review skipped paths in the scan result if you choose to keep it.',[
    {label:'Keep previous catalog',cls:'btn-p',fn:()=>{hideModal();resolve(false);}},
    {label:'Use partial scan',cls:'btn-g',fn:()=>{hideModal();resolve(true);}},
  ]));
}
async function forkLocate(id){await forkSync();const source=await fa.locateSource(id);if(source){toast('Source linked on this computer.','ok');if(forkView==='schedules')await renderSchedules();}}
function fempty(title,text){const el=fe('div','ft-empty');el.append(fe('strong','',title),document.createTextNode(text));g('fork-panel').append(el);}
function frow(table,values){const tr=fe('tr');for(const v of values){const td=fe('td');if(v instanceof Node)td.append(v);else td.textContent=v;tr.append(td);}table.append(tr);return tr;}
function ftable(headers){const table=fe('table','ft-table'),head=fe('tr');for(const h of headers)head.append(fe('th','',h));table.append(head);return table;}
function fpath(item){return (item.diskLabel || DB.disks.find(d=>d.id===item.diskId)?.label || '')+' / '+item.segments.join('/');}
function color(item){if(item.children)return '#755147';const ext=item.name.split('.').pop().toLowerCase();if(V.has(ext))return '#556a8d';if(I.has(ext))return '#667b59';if(A.has(ext))return '#8a657e';if(AR.has(ext))return '#9b7e4d';return '#626875';}
let forkMapDepth=4,forkLargestKind='files',forkLargestPage=0;
function revealButton(item,label='Reveal'){
 const button=fb(label,async()=>{button.disabled=true;button.textContent='Locating…';try{const result=await fa.revealSource(item.diskId,item.segments);button.textContent='Sent to '+fileManager();button.title=result?.timings?JSON.stringify(result.timings):'';setTimeout(()=>{button.textContent=label;button.disabled=false;},1200);}catch(e){button.textContent='Try Reveal again';button.disabled=false;button.title=String(e.message);throw e;}});button.dataset.reveal='1';return button;
}
function renderStorageMap(){
 const panel=g('fork-panel');panel.replaceChildren();if(typeof renderOrganization==='function')renderOrganization();
 fhead('Storage Map','Folder and file sizes from your offline catalog. Select a block to inspect it; double-click a folder to zoom.');
 const disks=scopedDisks();if(!docOpen||!disks.length){fempty('No drives in this scope','Open a catalog or reset the category and location filters.');return;}
 if(!forkMapStack.length){const root=ArchivoAnalysis.tree(disks);forkMapStack=[root];const chosen=root.children.find(n=>n.diskId===selected?.disk?.id)||(disks.length===1?root.children[0]:null);if(chosen)forkMapStack.push(chosen);}
 const current=forkMapStack.at(-1),crumb=fe('div','ft-crumb');forkMapStack.forEach((n,i)=>{if(i)crumb.append(document.createTextNode('/'));crumb.append(fb(n.name,()=>{forkMapStack=forkMapStack.slice(0,i+1);forkLargestPage=0;forkMapSelected=null;renderStorageMap();}));});panel.append(crumb);
 const controls=fe('div','ft-row'),depth=fe('select','ft-select');for(let i=1;i<=8;i++){const o=fe('option','',i+' detail levels');o.value=i;depth.append(o);}depth.value=forkMapDepth;depth.setAttribute('aria-label','Map detail depth');depth.onchange=()=>{forkMapDepth=Number(depth.value);renderStorageMap();};controls.append(fe('div','ft-stat',fmt(current.size)+(current.approximate?' ≈':'')+' indexed bytes'),depth);panel.append(controls);
 panel.append(fe('p','ft-muted',current.diskId?'Last scan: '+(DB.disks.find(d=>d.id===current.diskId)?.scanned||'Unknown')+' · '+organizationPaths(DB.disks.find(d=>d.id===current.diskId)).join(' · '):'Each labeled drive contains its folders and files.'));panel.append(fe('p','ft-muted','Logical indexed sizes; capacity and free space are separate. '+disks.map(d=>d.label+': '+(d.total||'unknown capacity')+' / '+(d.free||'unknown free')).join(' · ')));
 const grid=fe('div','ft-grid'),map=fe('div');map.id='storage-map';map.setAttribute('aria-label','Nested storage map');
 const zoom=item=>{if(item.children){forkMapStack.push(item);forkMapSelected=null;forkLargestPage=0;renderStorageMap();}};
 for(const r of ArchivoAnalysis.nested(current,1000,600,forkMapDepth,4000)){
  const tile=fb('',()=>{forkMapSelected=r.item;renderMapDetail();},'map-tile');tile.dataset.level=r.level;tile.dataset.bytes=r.item.size;
  tile.style.cssText=`left:${r.x/10}%;top:${r.y/6}%;width:${r.w/10}%;height:${r.h/6}%;background:hsl(${(r.tone*67+12)%360} 28% ${27+r.level*7}%);z-index:${r.level+1};padding:3px 6px`;
  tile.title=r.item.name+' · '+fmt(r.item.size)+(r.item.approximate?' · Approximate imported sizes':'');tile.setAttribute('aria-label',tile.title);if(r.w>75&&r.h>20)tile.append(fe('span','map-label',r.item.name));tile.addEventListener('dblclick',()=>zoom(r.item));map.append(tile);
 }
 if(!current.size)map.append(fe('div','ft-empty','No indexed bytes in this folder. Unknown imported sizes cannot be drawn.'));
 const detail=fe('aside','ft-detail');detail.id='map-detail';grid.append(map,detail);panel.append(grid);renderMapDetail();
 panel.append(fe('p','ft-muted','Up to 4,000 blocks. Smaller regions are combined without dropping their bytes; open a smaller-items region to explore it. Folder colors share related shades.'));
 const tabs=fe('div','ft-actions');for(const kind of ['files','folders'])tabs.append(fb('Largest '+kind,()=>{forkLargestKind=kind;forkLargestPage=0;renderStorageMap();},forkLargestKind===kind?'ft-primary':''));panel.append(tabs);
 const nodes=ArchivoAnalysis.descendants(current,forkLargestKind==='folders').sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name)),table=ftable(['Name / path','Indexed size','Action']),start=forkLargestPage*50;
 for(const item of nodes.slice(start,start+50)){const info=fe('div');info.append(fe('div','',item.name),fe('small','ft-path',fpath(item)));const action=fe('div','ft-actions');action.append(fb('Inspect',()=>{forkMapSelected=item;renderMapDetail();}));if(item.children)action.append(fb('Open folder',()=>zoom(item)));frow(table,[info,fmt(item.size)+(item.approximate?' ≈':''),action]);}panel.append(table);
 const pager=fe('div','ft-page'),prev=fb('Previous',()=>{forkLargestPage--;renderStorageMap();}),next=fb('Next',()=>{forkLargestPage++;renderStorageMap();});prev.disabled=!forkLargestPage;next.disabled=start+50>=nodes.length;pager.append(prev,fe('span','',nodes.length?`${start+1}–${Math.min(start+50,nodes.length)} of ${nodes.length} ${forkLargestKind}`:'No '+forkLargestKind),next);panel.append(pager);
}
function renderMapDetail(){
  const el=g('map-detail');if(!el)return;el.replaceChildren();const item=forkMapSelected;
  if(!item){el.append(fe('h2','','Select a file or folder'),fe('p','ft-muted','Its size and location will appear here.'));return;}
  el.append(fe('h2','',item.name),fe('div','ft-stat',fmt(item.size)),fe('p','ft-path',item.diskId?fpath(item):item.name));
  if(item.children)el.append(fb('Open folder',()=>{forkMapStack.push(item);forkMapSelected=null;renderStorageMap();},'ft-primary'));
  if(item.diskId)el.append(revealButton(item,'Reveal in '+fileManager()),fb('Show in catalog',()=>{forkShow('catalog');selDisk(item.diskId);const key=item.diskId+'/'+item.segments.join('/');const parts=key.split('/');for(let i=1;i<parts.length;i++)expanded.add(parts.slice(0,i).join('/'));renderTree();const row=ROWS.find(r=>r.key===key);if(row)selectRow(row,true);}));
  if(item.approximate)el.append(fe('p','ft-note','Some imported sizes are approximate or unknown. Rescan the source for exact bytes.'));
}
function duplicateDiskChoices(container){for(const d of scopedDisks())container.append(fcheck(d.label,d.id,true));}
function renderDuplicates(){
  const panel=g('fork-panel');panel.replaceChildren();fhead('Duplicates','Find possible copies offline, then verify their full contents when the drives are connected.');
  if(!docOpen||!DB.disks.length){fempty('Open a catalog to find duplicates','Scan your drives or server folders first.');return;}
  const choices=fe('div');choices.id='duplicate-disks';duplicateDiskChoices(choices);panel.append(choices);
  const actions=fe('div','ft-actions');actions.append(fb('Find possible copies',()=>runDuplicates(false)),fb('Verify contents',()=>runDuplicates(true),'ft-primary'),fb('Export CSV',exportDuplicates),fb('Move selected copies to Trash',trashDuplicates,'ft-danger'));panel.append(actions);
  panel.append(fe('p','ft-note','Nothing is selected for cleanup. “Verified” means full SHA-256 contents matched. One connected, verified copy must remain. Network copies are inspection-only.'));
  const results=fe('div');results.id='duplicate-results';panel.append(results);renderDuplicateResults();
}
async function runDuplicates(verify){
  const ids=[...g('duplicate-disks').querySelectorAll('input:checked')].map(i=>i.value);await forkSync();
  g('duplicate-results').replaceChildren(fe('div','ft-empty',verify?'Reading file contents… You can cancel from the job bar.':'Finding candidate files…'));
  try{forkDuplicateSelections.clear();forkDuplicateCollapsed.clear();forkDuplicateReport=await fa.findDuplicates(ids,verify);forkDuplicatePage=0;renderDuplicateResults();}catch(e){g('duplicate-results').replaceChildren(fe('div','ft-empty','Search did not finish.'));throw e;}
}
const forkDuplicateSelections=new Set(),forkDuplicateCollapsed=new Set();let forkDuplicateOthers=false;
function renderDuplicateResults(){
 const el=g('duplicate-results');if(!el)return;el.replaceChildren();const report=forkDuplicateReport;
 if(!report){el.append(fe('div','ft-empty','Choose disks, then find possible copies or verify their contents. Zero-byte files are excluded.'));return;}
 const derived=ArchivoAnalysis.duplicateGroups(report,forkDuplicateOthers),groups=derived.groups,verified=ArchivoAnalysis.duplicateGroups(report).groups.filter(g=>g.state==='Verified');
 el.append(fe('div','ft-stat',fmt(verified.reduce((s,g)=>s+g.duplicateBytes,0))+' verified duplicate bytes'));
 const other=fcheck('Show other results ('+derived.otherCount+' nonmatches / hard links)','other',forkDuplicateOthers);other.querySelector('input').onchange=e=>{forkDuplicateOthers=e.target.checked;forkDuplicatePage=0;renderDuplicateResults();};el.append(other,fe('p','ft-muted',groups.length+' match group(s) · '+forkDuplicateSelections.size+' copies selected'+(report.cancelled?' · Verification cancelled; completed results only.':'')));
 if(!groups.length){el.append(fe('div','ft-empty','No matching copies in this view. Other results can be inspected above.'));return;}
 const size=20;forkDuplicatePage=Math.min(forkDuplicatePage,Math.ceil(groups.length/size)-1);const start=forkDuplicatePage*size;
 for(const group of groups.slice(start,start+size)){
  const box=fe('details','duplicate-group');box.open=!forkDuplicateCollapsed.has(group.id);box.dataset.groupId=group.id;box.ontoggle=()=>{if(box.open)forkDuplicateCollapsed.delete(group.id);else forkDuplicateCollapsed.add(group.id);};
  const header=fe('summary'),title=fe('strong','',group.items[0].name),state=fe('span','ft-badge',group.state);header.append(title,state,fe('span','',group.items.length+' copies · '+fmt(group.size)+' each · '+fmt(group.duplicateBytes)+(group.state==='Verified'?' duplicate bytes':' potential duplicate bytes')));box.append(header);
  const table=ftable(['Select','Copy and location','Status','Action']);
  for(const item of group.items){const check=fe('input');check.type='checkbox';check.dataset.copyId=item.id;check.disabled=item.status!=='Verified';check.checked=forkDuplicateSelections.has(item.id);check.setAttribute('aria-label','Select '+fpath(item)+' for Trash');check.onchange=()=>{if(check.checked)forkDuplicateSelections.add(item.id);else forkDuplicateSelections.delete(item.id);};
   const info=fe('div');info.append(fe('strong','',item.name),fe('div','ft-path',fpath(item)),fe('div','ft-muted',organizationPaths(DB.disks.find(d=>d.id===item.diskId)).join(' · ')));if(item.reason)info.append(fe('p','ft-muted',item.reason));frow(table,[check,info,fbadge(item.status),revealButton(item)]);
  }box.append(table);el.append(box);
 }
 const pager=fe('div','ft-page'),prev=fb('Previous',()=>{forkDuplicatePage--;renderDuplicateResults();}),next=fb('Next',()=>{forkDuplicatePage++;renderDuplicateResults();});prev.disabled=!forkDuplicatePage;next.disabled=start+size>=groups.length;pager.append(prev,fe('span','',`${start+1}–${Math.min(start+size,groups.length)} of ${groups.length} groups`),next);el.append(pager);
}
async function trashDuplicates(){
  if(!forkDuplicateReport)throw Error('Verify file contents first.');const ids=[...forkDuplicateSelections];
  await fa.context(DB);const result=await fa.trashCopies(forkDuplicateReport.id,ids);if(!result.cancelled){forkDuplicateReport=null;renderDuplicateResults();toast(result.removed+' copies moved to Trash.'+(result.failures.length?' '+result.failures.join('; '):''),result.failures.length?'warn':'ok',8000);}
}
async function exportDuplicates(){
  if(!forkDuplicateReport)throw Error('Find duplicates first.');const rows=[['Disk','Path','Bytes','Status','SHA-256','Category','Physical location']];for(const item of forkDuplicateReport.groups.flatMap(g=>g.items))rows.push([item.diskLabel,item.segments.join('/'),item.size,item.status,item.hash || '',...organizationPaths(DB.disks.find(d=>d.id===item.diskId))]);
  await fa.exportText({content:rows.map(r=>r.map(csvField).join(',')).join('\n'),defaultName:'archivo-duplicates.csv',filterName:'Duplicate report',extensions:['csv']});
}
async function renderSchedules(){
  const request=++forkScheduleRenderId;const state=await forkSync();if(forkView!=='schedules' || request!==forkScheduleRenderId)return;
  const panel=g('fork-panel');panel.replaceChildren();
  fhead('Schedules','Keep saved catalogs up to date while Archivo Fork runs in the menu bar or system tray.',[fb(state.paused?'Resume schedules':'Pause all',async()=>{await fa.pauseSchedules(!state.paused);await renderSchedules();}),fb('Show catalog backups',()=>fa.showBackups())]);
  const login=fcheck('Launch Archivo Fork at login','login',state.login);login.querySelector('input').onchange=async e=>{try{e.target.checked=await fa.launchAtLogin(e.target.checked);}catch(err){e.target.checked=!e.target.checked;forkError(err);}};panel.append(login);
  panel.append(fe('p','ft-muted','Closing the window keeps schedules running. Quit stops them. After sleep or relaunch, one catch-up run is made for each overdue schedule. Times use this computer’s local time zone.'));
  panel.append(fe('h2','ft-section-title','Saved schedules'));
  if(!state.schedules.length)panel.append(fe('p','ft-muted','No schedules yet. Save a catalog and link its sources below.'));
  const table=ftable(['Catalog / schedule','Next run','Last result','Actions']);
  for(const s of state.schedules){const name=fe('div');name.append(fe('div','',s.name),fe('p','ft-path',s.file),fbadge(s.enabled?'Enabled':'Paused'),fe('p','ft-muted',ruleText(s.rule)));
    const actions=fe('div','ft-actions');actions.append(fb('Run now',async()=>{const result=await fa.runSchedule(s.id);if(result.deferred)toast('Deferred until the active job or unsaved edits are finished.','warn');await renderSchedules();}),fb(s.enabled?'Pause':'Enable',async()=>{await fa.scheduleAction(s.id,'toggle');await renderSchedules();}),fb('Edit',()=>{if(s.file!==docPath)throw Error('Open '+s.name+' before editing this schedule.');forkEditSchedule=s;renderSchedules();}),fb('Remove',()=>showModal('Remove schedule?','The catalog and its files will be kept.',[{label:'Cancel',cls:'btn-g',fn:hideModal},{label:'Remove',cls:'btn-p',fn:async()=>{hideModal();await fa.scheduleAction(s.id,'remove');await renderSchedules();}}])));frow(table,[name,s.enabled?new Date(s.nextRun).toLocaleString():'Paused',s.running?'Running…':s.lastResult,actions]);}
  if(state.schedules.length)panel.append(table);
  panel.append(fe('h2','ft-section-title','Sources in this catalog'));
  const sources=ftable(['Catalog disk','Linked folder / drive','Action']);
  for(const source of state.sources)frow(sources,[source.label,source.binding?source.binding.root:'Not linked on this computer',fb(source.binding?'Relink…':'Locate source…',()=>forkLocate(source.id))]);
  if(state.sources.length)panel.append(sources);else panel.append(fe('p','ft-muted','Open a catalog to manage its source links.'));
  if(docPath&&DB.disks.length)renderScheduleForm(state);else panel.append(fe('p','ft-note','Open and save a catalog to create a schedule. Each source must be linked on this computer.'));
  panel.append(fe('h2','ft-section-title','Recent activity'));
  if(!state.activity.length)panel.append(fe('p','ft-muted','Scheduled rescans and cleanup results will appear here.'));
  const log=ftable(['Time','Task','Result']);for(const a of state.activity.slice(0,30)){const result=fe('div');result.append(fbadge(a.status),fe('p','ft-muted',a.detail));frow(log,[new Date(a.at).toLocaleString(),a.title,result]);}if(state.activity.length)panel.append(log);
}
function ruleText(rule){if(rule.kind==='interval')return 'Every '+rule.minutes+' minutes';return (rule.kind==='weekly'?'On '+rule.days.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', '):'Daily')+' at '+rule.time;}
function renderScheduleForm(state){
  const panel=g('fork-panel'),form=fe('form','ft-form'),edit=forkEditSchedule?.file===docPath?forkEditSchedule:null;
  form.append(fe('h2','ft-section-title',edit?'Edit schedule':'New schedule for '+docName()));
  const disks=fe('div');for(const d of DB.disks){const linked=state.sources.find(s=>s.id===d.id)?.binding,label=fcheck(d.label+(linked?'':' (link source first)'),d.id,edit?edit.diskIds.includes(d.id):!!linked);label.querySelector('input').disabled=!linked;disks.append(label);}form.append(disks);
  const row=fe('div','ft-row'),kind=fe('select','ft-select');for(const [value,text]of[['daily','Every day'],['weekly','Selected weekdays'],['interval','At an interval']]){const o=fe('option','',text);o.value=value;kind.append(o);}kind.value=edit?.rule.kind || 'daily';
  const time=fe('input','ft-input');time.type='time';time.value=edit?.rule.time || '02:00';const minutes=fe('input','ft-input');minutes.type='number';minutes.min='15';minutes.max='10080';minutes.value=edit?.rule.minutes || 60;
  for(const [label,control]of[['Repeat',kind],['Local time',time],['Minutes',minutes]]){const wrap=fe('div'),lab=fe('label','',label);lab.append(control);wrap.append(lab);row.append(wrap);}form.append(row);
  const weekdays=fe('div');['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day,i)=>weekdays.append(fcheck(day,String(i),edit?.rule.days?.includes(i) || (!edit && i>0&&i<6))));form.append(weekdays);
  const enabled=fcheck('Enable this schedule','enabled',edit?.enabled || false);form.append(enabled,fe('p','ft-muted','Successful scans auto-save with five recoverable backups. Offline or incomplete sources retain their last saved entries. Catalogs with unsaved edits wait until saved.'));
  const actions=fe('div','ft-actions');const save=fb(edit?'Save changes':'Create schedule',async()=>{
    await forkSync();const rule={kind:kind.value,time:time.value,minutes:Number(minutes.value),days:[...weekdays.querySelectorAll('input:checked')].map(i=>Number(i.value))};
    await fa.saveSchedule({id:edit?.id,rule,diskIds:[...disks.querySelectorAll('input:checked')].map(i=>i.value),enabled:enabled.querySelector('input').checked});forkEditSchedule=null;toast('Schedule saved.','ok');await renderSchedules();
  },'ft-primary');actions.append(save);if(edit)actions.append(fb('Cancel edit',()=>{forkEditSchedule=null;renderSchedules();}));form.append(actions);form.onsubmit=e=>e.preventDefault();panel.append(form);
  const update=()=>{time.parentElement.hidden=kind.value==='interval';minutes.parentElement.hidden=kind.value!=='interval';weekdays.hidden=kind.value!=='weekly';};kind.onchange=update;update();
}
for(const b of document.querySelectorAll('#fork-nav [data-view]'))b.onclick=()=>forkShow(b.dataset.view);
g('welcome-schedules').onclick=()=>forkShow('schedules');
g('fork-locate').onclick=()=>{const disk=selected?.disk;if(!disk){toast('Select a catalog disk first.','info');return;}forkLocate(disk.id).catch(forkError);};
g('fork-cancel').onclick=()=>fa.cancelJob().catch(forkError);
fa.onFork('view',forkShow);
fa.onFork('status',status=>{
  forkBusy=status.busy;g('fork-job-status').textContent=status.busy?'Working: '+status.busy:status.paused?'Schedules paused':'Ready';g('fork-cancel').hidden=!status.busy;
  g('main').inert=false;
  document.querySelectorAll('#fork-panel button, #fork-panel input, #fork-panel select').forEach(el=>{ if(status.busy && !el.disabled && !el.dataset.reveal){el.dataset.jobDisabled='1';el.disabled=true;}else if(!status.busy && el.dataset.jobDisabled){delete el.dataset.jobDisabled;el.disabled=false;} });
  updateUiState();
});
fa.onFork('progress',p=>{if(p.path)g('fork-job-status').textContent=(p.label?p.label+': ':'')+p.path;else if(p.groups)g('fork-job-status').textContent='Verified '+p.groups+' / '+p.total+' groups';});
fa.onFork('catalog',async result=>{
  if(result.path!==docPath)return;
  if(dirty){toast('A background update is ready. Save or reopen the catalog to review it.','warn');return;}
  DB=result.data;refreshAll();markClean();if(forkView==='schedules')await renderSchedules();
});
fa.onFork('cleanup',result=>{DB=result.data;markDirty();refreshAll();});
fa.toolsStatus().then(status=>{forkBusy=status.busy;updateUiState();}).catch(forkError);
