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
function forkRefresh(){if(fa?.context)fa.context(DB).catch(forkError);if(forkView==='map'){forkMapStack=[];renderStorageMap();}forkDuplicateReport=null;}
function forkShow(view){
  forkView=view;
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
function renderStorageMap(){
  const panel=g('fork-panel');panel.replaceChildren();
  fhead('Storage Map','Find the files and folders taking up space. This view works with offline catalogs.',[fb('Refresh view',()=>{forkMapStack=[];renderStorageMap();})]);
  if(!docOpen || !DB.disks.length){fempty('Add a disk to explore its storage','Open a catalog or scan a drive, server share, or folder.');return;}
  if(!forkMapStack.length)forkMapStack=[ArchivoAnalysis.tree(DB.disks)];
  const current=forkMapStack.at(-1),crumb=fe('div','ft-crumb');
  forkMapStack.forEach((n,i)=>{if(i)crumb.append(document.createTextNode('/'));crumb.append(fb(n.name,()=>{forkMapStack=forkMapStack.slice(0,i+1);forkMapSelected=null;renderStorageMap();}));});panel.append(crumb);
  const sum=fe('div','ft-stat',fmt(current.size)+(current.approximate?' ≈':''));sum.append(fe('small','', '  indexed file sizes'+(current.approximate?' · includes approximate or unknown imported sizes':'')));panel.append(sum);
  if(current.diskId){const d=DB.disks.find(d=>d.id===current.diskId);panel.append(fe('p','ft-muted','Last scan: '+(d.scanned?new Date(d.scanned).toLocaleString():'Unknown')+' · Capacity: '+(d.total || 'Unknown')+' · Free: '+(d.free || 'Unknown')));}
  else panel.append(fe('p','ft-muted','Indexed sizes are logical file sizes, not filesystem allocation or total used space. Each disk retains its last scan date.'));
  const grid=fe('div','ft-grid'),left=fe('div'),map=fe('div');map.id='storage-map';map.setAttribute('aria-label','Storage map. Select a tile to inspect it; double-click a folder to open it.');
  let items=(current.children || []).slice().sort((a,b)=>b.size-a.size);
  if(items.length>300){const rest=items.slice(299);items=items.slice(0,299).concat({name:'Other '+rest.length.toLocaleString()+' items',size:rest.reduce((s,n)=>s+n.size,0),children:rest,segments:[],aggregate:true});}
  const zoom=item=>{if(item.children){forkMapStack.push(item);forkMapSelected=null;renderStorageMap();}};
  for(const r of ArchivoAnalysis.layout(items,0,0,100,100)){
    const tile=fb('',()=>{forkMapSelected=r.item;renderMapDetail();},'map-tile');tile.style.cssText='left:'+r.x+'%;top:'+r.y+'%;width:'+r.w+'%;height:'+r.h+'%;background:'+color(r.item);
    tile.title=r.item.name+' · '+fmt(r.item.size)+(r.item.children?' · Double-click to open':'');tile.setAttribute('aria-label',tile.title);tile.setAttribute('aria-pressed',String(forkMapSelected===r.item));
    if(r.w>6&&r.h>9)tile.append(document.createTextNode(r.item.name),fe('span','',fmt(r.item.size)));
    tile.addEventListener('dblclick',()=>zoom(r.item));map.append(tile);
  }
  if(!current.size)map.append(fe('div','ft-empty','No indexed bytes in this folder.'));
  left.append(map);
  const legend=fe('div','ft-tabs-help');for(const [name,hex] of [['Folders','#755147'],['Video','#556a8d'],['Images','#667b59'],['Audio','#8a657e'],['Archives','#9b7e4d']]){const label=fe('span'),dot=fe('span','ft-dot');dot.style.background=hex;label.append(dot,document.createTextNode(name));legend.append(label);}left.append(legend);
  left.append(fe('p','ft-muted','Select to inspect · Double-click a folder or use Open folder to zoom in'));
  const detail=fe('aside','ft-detail');detail.id='map-detail';grid.append(left,detail);panel.append(grid);renderMapDetail();
  const row=fe('div','ft-row');row.append(fe('h2','ft-section-title','Largest items'));
  const sort=fe('select','ft-select');sort.setAttribute('aria-label','Largest items sort');for(const [value,text]of[['size','Size, largest first'],['name','Name, A–Z']]){const o=fe('option','',text);o.value=value;sort.append(o);}row.append(sort);panel.append(row);
  const table=ftable(['Name','Indexed size','Kind','Action']);panel.append(table);
  const fill=()=>{while(table.children.length>1)table.lastChild.remove();const nodes=(current.children||[]).slice().sort(sort.value==='name'?(a,b)=>a.name.localeCompare(b.name):(a,b)=>b.size-a.size);for(const item of nodes.slice(0,100)){const action=fe('div','ft-actions');action.append(fb('Inspect',()=>{forkMapSelected=item;renderMapDetail();}));if(item.children)action.append(fb('Open folder',()=>zoom(item)));frow(table,[item.name,fmt(item.size)+(item.approximate?' ≈':''),item.children?'Folder':'File',action]);}if(nodes.length>100)left.append(fe('p','ft-muted','The list shows the first 100 items. Use the catalog to inspect all items.'));};sort.onchange=fill;fill();
}
function renderMapDetail(){
  const el=g('map-detail');if(!el)return;el.replaceChildren();const item=forkMapSelected;
  if(!item){el.append(fe('h2','','Select a file or folder'),fe('p','ft-muted','Its size and location will appear here.'));return;}
  el.append(fe('h2','',item.name),fe('div','ft-stat',fmt(item.size)),fe('p','ft-path',item.diskId?fpath(item):item.name));
  if(item.children)el.append(fb('Open folder',()=>{forkMapStack.push(item);forkMapSelected=null;renderStorageMap();},'ft-primary'));
  if(item.diskId)el.append(fb('Reveal in '+fileManager(),()=>fa.revealSource(item.diskId,item.segments)),fb('Show in catalog',()=>{forkShow('catalog');selDisk(item.diskId);const key=item.diskId+'/'+item.segments.join('/');const parts=key.split('/');for(let i=1;i<parts.length;i++)expanded.add(parts.slice(0,i).join('/'));renderTree();const row=ROWS.find(r=>r.key===key);if(row)selectRow(row,true);}));
  if(item.approximate)el.append(fe('p','ft-note','Some imported sizes are approximate or unknown. Rescan the source for exact bytes.'));
}
function duplicateDiskChoices(container){for(const d of DB.disks)container.append(fcheck(d.label,d.id,true));}
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
  try{forkDuplicateReport=await fa.findDuplicates(ids,verify);forkDuplicatePage=0;renderDuplicateResults();}catch(e){g('duplicate-results').replaceChildren(fe('div','ft-empty','Search did not finish.'));throw e;}
}
function renderDuplicateResults(){
  const el=g('duplicate-results');if(!el)return;el.replaceChildren();const report=forkDuplicateReport;
  if(!report){el.append(fe('div','ft-empty','Choose disks, then find possible copies or verify their contents. Zero-byte files are excluded.'));return;}
  const all=report.groups.flatMap(g=>g.items),verified=all.filter(i=>i.status==='Verified'),hashes=new Set(verified.map(i=>i.hash));let savings=0;
  for(const hash of hashes){const items=verified.filter(i=>i.hash===hash);savings+=(items.length-1)*items[0].size;}
  el.append(fe('div','ft-stat',fmt(savings)+' verified duplicate bytes'),fe('p','ft-muted',report.groups.length+' size group(s) · '+verified.length+' verified copies · logical sizes; filesystem space recovered may differ'+(report.cancelled?' · Verification cancelled; showing completed groups.':'')));
  if(!all.length){el.append(fe('div','ft-empty','No matching-size candidates found.'));return;}
  const pageSize=150,start=forkDuplicatePage*pageSize,table=ftable(['Select','File and location','Size','Status','Action']);
  for(const item of all.slice(start,start+pageSize)){
    const check=fe('input');check.type='checkbox';check.dataset.copyId=item.id;check.disabled=item.status!=='Verified';check.setAttribute('aria-label','Select '+fpath(item)+' for Trash');
    const name=fe('div');name.append(fe('div','',item.name),fe('div','ft-path',fpath(item)));if(item.hash)name.append(fe('small','ft-muted','Content group '+item.hash.slice(0,10)));if(item.reason)name.append(fe('p','ft-muted',item.reason));
    const badge=fbadge(item.status),action=fb('Reveal',()=>fa.revealSource(item.diskId,item.segments));
    frow(table,[check,name,fmt(item.size),badge,action]);
  }el.append(table);
  const pager=fe('div','ft-page');pager.append(fe('span','',(start+1)+'–'+Math.min(start+pageSize,all.length)+' of '+all.length+' files'));
  const buttons=fe('div','ft-actions');const prev=fb('Previous',()=>{forkDuplicatePage--;renderDuplicateResults();}),next=fb('Next',()=>{forkDuplicatePage++;renderDuplicateResults();});prev.disabled=!forkDuplicatePage;next.disabled=start+pageSize>=all.length;buttons.append(prev,next);pager.append(buttons);el.append(pager);
}
async function trashDuplicates(){
  if(!forkDuplicateReport)throw Error('Verify file contents first.');const ids=[...g('duplicate-results').querySelectorAll('input:checked')].map(i=>i.dataset.copyId);
  await fa.context(DB);const result=await fa.trashCopies(forkDuplicateReport.id,ids);if(!result.cancelled){forkDuplicateReport=null;renderDuplicateResults();toast(result.removed+' copies moved to Trash.'+(result.failures.length?' '+result.failures.join('; '):''),result.failures.length?'warn':'ok',8000);}
}
async function exportDuplicates(){
  if(!forkDuplicateReport)throw Error('Find duplicates first.');const rows=[['Disk','Path','Bytes','Status','SHA-256']];for(const item of forkDuplicateReport.groups.flatMap(g=>g.items))rows.push([item.diskLabel,item.segments.join('/'),item.size,item.status,item.hash || '']);
  await fa.exportText({content:rows.map(r=>r.map(csvField).join(',')).join('\n'),defaultName:'archivo-duplicates.csv',filterName:'Duplicate report',extensions:['csv']});
}
async function renderSchedules(){
  const request=++forkScheduleRenderId;const state=await forkSync();if(forkView!=='schedules' || request!==forkScheduleRenderId)return;
  const panel=g('fork-panel');panel.replaceChildren();
  fhead('Schedules','Keep saved catalogs up to date while Archivo Fork runs in the menu bar or system tray.',[fb(state.paused?'Resume schedules':'Pause all',async()=>{await fa.pauseSchedules(!state.paused);await renderSchedules();}),fb('Show catalog backups',()=>fa.showBackups())]);
  const login=fcheck('Launch Archivo Fork at login','login',state.login);login.querySelector('input').onchange=async e=>{try{await fa.launchAtLogin(e.target.checked);}catch(err){e.target.checked=!e.target.checked;forkError(err);}};panel.append(login);
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
  g('main').inert=!!status.busy;
  document.querySelectorAll('#fork-panel button, #fork-panel input, #fork-panel select').forEach(el=>{ if(status.busy && !el.disabled){el.dataset.jobDisabled='1';el.disabled=true;}else if(!status.busy && el.dataset.jobDisabled){delete el.dataset.jobDisabled;el.disabled=false;} });
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
