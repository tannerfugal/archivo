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
function forkRefresh(){if(fa?.context)fa.context(DB).catch(forkError);forkMapSelected=null;forkLargestPage=0;if(forkView==='map'){forkMapStack=[];renderStorageMap();}forkDuplicateReport=null;if(typeof forkDuplicateSelections!=='undefined')forkDuplicateSelections.clear();if(forkView==='duplicates')renderDuplicates();}
function forkDocumentChanged(){g('catalog-shared-status').hidden=true;categoryScope='';locationScope='';forkScheduleDraft=null;forkScheduleForm=null;forkSourcePickerState={};forkEditSchedule=null;forkDuplicateDriveIds=null;forkMapSelected=null;forkMapStack=[];forkDuplicateSelections.clear();forkShow('catalog');}
function forkShow(view){
  if(forkView==='schedules')rememberScheduleDraft();
  forkView=view;
  if(typeof renderOrganization==='function')renderOrganization();
  document.querySelectorAll('#fork-nav [data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  g('fork-panel').hidden=view==='catalog';g('main').style.display=view==='catalog'?'flex':'none';
  if(view==='catalog'){if(!docOpen)showWelcome();return;}
  hideWelcome();g('fork-panel').replaceChildren();
  if(view==='map'){forkMapStack=[];forkMapSelected=null;forkLargestPage=0;renderStorageMap();}
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
async function forkLocate(id){await forkSync();const source=await fa.locateSource(id);if(source){forkDuplicateReport=null;forkDuplicateSelections.clear();toast('Source linked on this computer.','ok');if(forkView==='schedules')await renderSchedules();if(forkView==='duplicates')renderDuplicates();}}
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
 const drive=DB.disks.find(d=>d.id===current.diskId),scan=drive?.scanned;
 panel.append(fe('p','ft-muted',drive?'Last scan: '+(scan&&!Number.isNaN(Date.parse(scan))?new Date(scan).toLocaleString():scan||'Unknown')+' · '+organizationPaths(drive).join(' · '):disks.length+' drives in this scope. Double-click a drive to explore it.'));
 panel.append(fe('p','ft-muted',drive?'Capacity: '+(drive.total||'Unknown')+' · Free: '+(drive.free||'Unknown')+' · Map shows indexed logical bytes.':'Map shows indexed logical bytes. Open a drive to see its scan date, capacity and free space.'));
 const grid=fe('div','ft-grid'),map=fe('div');map.id='storage-map';map.setAttribute('aria-label','Nested storage map');
 const zoom=item=>{if(item.children){forkMapStack.push(item);forkMapSelected=null;forkLargestPage=0;renderStorageMap();}};
 for(const r of ArchivoAnalysis.nested(current,1000,600,forkMapDepth,4000)){
  const tile=fb('',()=>{forkMapSelected=r.item;renderMapDetail();},'map-tile');tile.dataset.level=r.level;tile.dataset.bytes=r.item.size;
  tile.style.cssText=`left:${r.x/10}%;top:${r.y/6}%;width:${r.w/10}%;height:${r.h/6}%;background:hsl(${(r.tone*67+12)%360} 28% ${27+r.level*7}%);z-index:${r.level+1};padding:3px 6px`;
  tile.title=r.item.name+' · '+fmt(r.item.size)+(r.item.approximate?' · Approximate imported sizes':'');tile.setAttribute('aria-label',tile.title);tile.setAttribute('aria-pressed',String(forkMapSelected===r.item));tile.mapItem=r.item;if(r.w>75&&r.h>20)tile.append(fe('span','map-label',r.item.name));tile.addEventListener('dblclick',()=>zoom(r.item));tile.addEventListener('keydown',e=>{if(e.key==='Enter'&&r.item.children){e.preventDefault();zoom(r.item);}});map.append(tile);
 }
 if(!current.size)map.append(fe('div','ft-empty','No indexed bytes in this folder. Unknown imported sizes cannot be drawn.'));
 const detail=fe('aside','ft-detail');detail.id='map-detail';grid.append(map,detail);panel.append(grid);renderMapDetail();
 panel.append(fe('p','ft-muted','Up to 4,000 blocks. Smaller regions are combined without dropping their bytes; open a smaller-items region to explore it. Folder colors share related shades.'));
 const tabs=fe('div','ft-actions');for(const kind of ['files','folders'])tabs.append(fb('Largest '+kind,()=>{forkLargestKind=kind;forkLargestPage=0;renderStorageMap();},forkLargestKind===kind?'ft-primary':''));panel.append(tabs);
 const nodes=ArchivoAnalysis.descendants(current,forkLargestKind==='folders').sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name)),table=ftable(['Name / path','Indexed size','Action']),start=forkLargestPage*50;
 for(const item of nodes.slice(start,start+50)){const info=fe('div');info.append(fe('div','',item.name),fe('small','ft-path',fpath(item)));const action=fe('div','ft-actions');action.append(fb('Inspect',()=>{forkMapSelected=item;renderMapDetail();}));if(item.children)action.append(fb('Open folder',()=>zoom(item)));frow(table,[info,fmt(item.size)+(item.approximate?' ≈':''),action]);}panel.append(table);
 const pager=fe('div','ft-page'),prev=fb('Previous',()=>{forkLargestPage--;renderStorageMap();}),next=fb('Next',()=>{forkLargestPage++;renderStorageMap();});prev.disabled=!forkLargestPage;next.disabled=start+50>=nodes.length;pager.append(prev,fe('span','',nodes.length?`${start+1}–${Math.min(start+50,nodes.length)} of ${nodes.length} ${forkLargestKind}`:'No '+forkLargestKind),next);panel.append(pager);applyForkBusy();
}
function renderMapDetail(){
  const el=g('map-detail');if(!el)return;el.replaceChildren();const item=forkMapSelected;
  document.querySelectorAll('#storage-map .map-tile').forEach(tile=>tile.setAttribute('aria-pressed',String(tile.mapItem===item)));
  if(!item){el.append(fe('h2','','Select a file or folder'),fe('p','ft-muted','Its size and location will appear here.'));return;}
  el.append(fe('h2','',item.name),fe('div','ft-stat',fmt(item.size)),fe('p','ft-path',item.diskId?fpath(item):item.name));
  if(item.children)el.append(fb('Open folder',()=>{forkMapStack.push(item);forkMapSelected=null;forkLargestPage=0;renderStorageMap();},'ft-primary'));
  if(item.diskId)el.append(revealButton(item,'Reveal in '+fileManager()),fb('Show in catalog',()=>{forkShow('catalog');selDisk(item.diskId);const key=item.diskId+'/'+item.segments.join('/');const parts=key.split('/');for(let i=1;i<parts.length;i++)expanded.add(parts.slice(0,i).join('/'));renderTree();const row=ROWS.find(r=>r.key===key);if(row)selectRow(row,true);}));
  if(item.approximate)el.append(fe('p','ft-note','Some imported sizes are approximate or unknown. Rescan the source for exact bytes.'));
}
let forkDuplicateDriveIds=null;
function renderDuplicates(){
  const panel=g('fork-panel');panel.replaceChildren();fhead('Duplicates','Offline candidates need the same full filename and exact size. Verify contents also finds renamed copies on connected drives.');
  if(!docOpen||!DB.disks.length){fempty('Open a catalog to find duplicates','Scan your drives or server folders first.');return;}
  const choices=createDrivePicker({disks:scopedDisks(),ids:forkDuplicateDriveIds??scopedDisks().map(d=>d.id),label:'Drives to compare',onchange:ids=>{forkDuplicateDriveIds=ids;forkDuplicateReport=null;forkDuplicateSelections.clear();renderDuplicateResults();}});choices.id='duplicate-disks';panel.append(choices);
  const actions=fe('div','ft-actions'),exportButton=fb('Export CSV',exportDuplicates),trash=fb('Move selected copies to Trash',trashDuplicates,'ft-danger'),find=fb('Find possible copies',()=>runDuplicates(false)),verify=fb('Verify contents',()=>runDuplicates(true),'ft-primary');find.id='duplicate-find';verify.id='duplicate-verify';exportButton.id='duplicate-export';trash.id='duplicate-trash';actions.append(find,verify,exportButton,trash);panel.append(actions);
  panel.append(fe('p','ft-note','Verify contents before cleanup. A connected, verified copy must remain. Network copies are inspection-only.'));
  const results=fe('div');results.id='duplicate-results';panel.append(results);renderDuplicateResults();applyForkBusy();
}
async function runDuplicates(verify){
  const ids=g('duplicate-disks').selectedIds();if(!ids.length)throw Error('Choose at least one drive.');forkDuplicateDriveIds=ids;await forkSync();
  g('duplicate-results').replaceChildren(fe('div','ft-empty',verify?'Reading file contents… You can cancel from the job bar.':'Finding candidate files…'));
  try{forkDuplicateSelections.clear();forkDuplicateCollapsed.clear();const report=await fa.findDuplicates(ids,verify);if(JSON.stringify(forkDuplicateDriveIds)!==JSON.stringify(ids))return;forkDuplicateReport=report;forkDuplicateArea=null;forkAreaParent=null;forkAreaPage=0;forkDuplicatePage=0;renderDuplicateResults();}catch(e){g('duplicate-results')?.replaceChildren(fe('div','ft-empty','Search did not finish.'));throw e;}
}
const forkDuplicateSelections=new Set(),forkDuplicateCollapsed=new Set();let forkDuplicateOthers=false;
function renderDuplicateResults(){
 const el=g('duplicate-results');if(!el)return;el.replaceChildren();const report=forkDuplicateReport;
 updateDuplicateActions();
 if(!report){el.append(fe('div','ft-empty','Choose drives, then find possible copies or verify their contents. Zero-byte files are excluded.'));return;}
 renderDuplicateViewControls(el);
 if(forkDuplicateMode==='folders'){renderDuplicateAreas(el,report);return;}
 const derived=ArchivoAnalysis.duplicateGroups(report,forkDuplicateOthers),groups=derived.groups.filter(group=>!forkDuplicateArea||group.items.some(item=>ArchivoDuplicateAreas.contains(item,forkDuplicateArea))),verified=ArchivoAnalysis.duplicateGroups(report).groups.filter(g=>g.state==='Verified');
 if(forkDuplicateArea)renderDuplicateAreaSelection(el,forkDuplicateArea);
 el.append(fe('div','ft-stat',fmt(verified.reduce((s,g)=>s+g.duplicateBytes,0))+' verified duplicate bytes'));
 const other=fcheck('Show other results ('+derived.otherCount+' unmatched / unavailable / hard links)','other',forkDuplicateOthers);other.querySelector('input').onchange=e=>{forkDuplicateOthers=e.target.checked;forkDuplicatePage=0;renderDuplicateResults();};const count=fe('p','ft-muted');count.id='duplicate-selection-count';el.append(other,fe('p','ft-muted',groups.length+' match group(s)'+(report.cancelled?' · Verification cancelled; completed results only.':'')),count);updateDuplicateActions();
 if(!groups.length){el.append(fe('div','ft-empty','No matching copies in this view. Other results can be inspected above.'));return;}
 const size=20;forkDuplicatePage=Math.min(forkDuplicatePage,Math.ceil(groups.length/size)-1);const start=forkDuplicatePage*size;
 for(const group of groups.slice(start,start+size)){
  const box=fe('details','duplicate-group');box.open=!forkDuplicateCollapsed.has(group.id);box.dataset.groupId=group.id;box.ontoggle=()=>{if(box.open)forkDuplicateCollapsed.delete(group.id);else forkDuplicateCollapsed.add(group.id);};
  const header=fe('summary'),title=fe('strong','',group.items[0].name),state=fe('span','ft-badge',group.state);header.append(title,state,fe('span','',group.items.length+' copies · '+fmt(group.size)+' each · '+fmt(group.duplicateBytes)+(group.state==='Verified'?' duplicate bytes':' potential duplicate bytes')));box.append(header);if(group.state==='Possible matches')box.append(fe('p','ft-muted','Same full filename and exact size; file contents have not been verified.'));
  const table=ftable(['Select','Copy and location','Status','Action']);
  for(const item of group.items){const check=fe('input');check.type='checkbox';check.dataset.copyId=item.id;check.disabled=item.status!=='Verified'||item.network===true;check.checked=forkDuplicateSelections.has(item.id);check.setAttribute('aria-label','Select '+fpath(item)+' for Trash');if(item.network)check.title='Network copies are inspection-only';check.onchange=()=>{if(check.checked)forkDuplicateSelections.add(item.id);else forkDuplicateSelections.delete(item.id);updateDuplicateActions();};
   const info=fe('div');info.append(fe('strong','',item.name),fe('div','ft-path',fpath(item)),fe('div','ft-muted',organizationPaths(DB.disks.find(d=>d.id===item.diskId)).join(' · ')));if(item.network)info.append(fe('p','ft-muted','Network copy · inspection only'));if(item.reason)info.append(fe('p','ft-muted',item.reason));frow(table,[check,info,fbadge(item.status),revealButton(item)]);
  }box.append(table);el.append(box);
 }
 const pager=fe('div','ft-page'),prev=fb('Previous',()=>{forkDuplicatePage--;renderDuplicateResults();}),next=fb('Next',()=>{forkDuplicatePage++;renderDuplicateResults();});prev.disabled=!forkDuplicatePage;next.disabled=start+size>=groups.length;pager.append(prev,fe('span','',`${start+1}–${Math.min(start+size,groups.length)} of ${groups.length} groups`),next);el.append(pager);
}
function updateDuplicateActions(){
 const items=forkDuplicateReport?.groups.flatMap(group=>group.items)||[],chosen=items.filter(item=>forkDuplicateSelections.has(item.id));
 const keeperHashes=new Set(items.filter(item=>item.status==='Verified'&&!forkDuplicateSelections.has(item.id)).map(item=>item.hash));
 const invalid=chosen.some(item=>item.status!=='Verified'||!item.hash||item.network||!keeperHashes.has(item.hash));
 const count=g('duplicate-selection-count');if(count)count.textContent=chosen.length+(chosen.length===1?' copy selected · ':' copies selected · ')+fmt(chosen.reduce((sum,item)=>sum+item.size,0))+(invalid?' · Keep at least one verified copy per group':'');
 const trash=g('duplicate-trash');if(trash)trash.disabled=!chosen.length||invalid||!!forkBusy;
 const exp=g('duplicate-export');if(exp)exp.disabled=!forkDuplicateReport||!!forkBusy;
 for(const id of ['duplicate-find','duplicate-verify']){const button=g(id);if(button)button.disabled=!g('duplicate-disks')?.selectedIds().length||!!forkBusy;}
}
async function trashDuplicates(){
  if(!forkDuplicateReport)throw Error('Verify file contents first.');const ids=[...forkDuplicateSelections];
  await fa.context(DB);const result=await fa.trashCopies(forkDuplicateReport.id,ids);if(!result.cancelled){forkDuplicateReport=null;forkDuplicateSelections.clear();renderDuplicateResults();toast(result.removed+' copies moved to Trash.'+(result.failures.length?' '+result.failures.join('; '):''),result.failures.length?'warn':'ok',8000);}
}
async function exportDuplicates(){
  if(!forkDuplicateReport)throw Error('Find duplicates first.');const rows=[['Disk','Path','Bytes','Status','SHA-256','Category','Physical location']];for(const item of forkDuplicateReport.groups.flatMap(g=>g.items))rows.push([item.diskLabel,item.segments.join('/'),item.size,item.status,item.hash || '',...organizationPaths(DB.disks.find(d=>d.id===item.diskId))]);
  await fa.exportText({content:rows.map(r=>r.map(csvField).join(',')).join('\n'),defaultName:'archivo-duplicates.csv',filterName:'Duplicate report',extensions:['csv']});
}
let forkScheduleDraft=null, forkScheduleForm=null, forkSourcePickerState={};
function rememberScheduleDraft(){
 if(forkScheduleForm?.isConnected)forkScheduleDraft=forkScheduleForm.readDraft();
 const links=g('schedule-sources');if(links)forkSourcePickerState=links.pickerState();
}
function startScheduleEdit(schedule=null){
 forkEditSchedule=schedule;forkScheduleDraft={file:docPath,id:schedule?.id,diskIds:schedule?.diskIds||forkState.sources.filter(s=>s.binding).map(s=>s.id),rule:schedule?.rule||{kind:'daily',time:'02:00',days:[1,2,3,4,5]},enabled:schedule?.enabled||false};
 forkScheduleForm=null;renderSchedules().then(()=>g('schedule-form')?.scrollIntoView({block:'start'})).catch(forkError);
}
async function renderSchedules(){
  rememberScheduleDraft();
  const request=++forkScheduleRenderId, state=await forkSync();if(forkView!=='schedules'||request!==forkScheduleRenderId)return;
  const panel=g('fork-panel');panel.replaceChildren();forkScheduleForm=null;
  const pause=fb(state.paused?'Resume schedules':'Pause all',async()=>{await fa.pauseSchedules(!state.paused);await renderSchedules();});pause.disabled=!state.schedules.length;
  const backups=fb('Show catalog backups',()=>fa.showBackups());backups.disabled=!docPath;
  fhead('Schedules','Keep saved catalogs up to date while Archivo Fork runs in the menu bar or system tray.',[pause,backups]);
  const summary=fe('div','schedule-overview');
  for(const [value,label]of [[state.schedules.filter(s=>s.enabled).length,'enabled schedules'],[state.sources.filter(s=>s.binding).length+' / '+state.sources.length,'sources linked in this catalog'],[state.paused?'Paused':'Ready',state.paused?'all automatic runs paused':'background updates']]){const item=fe('div');item.append(fe('strong','',String(value)),fe('span','ft-muted',label));summary.append(item);}panel.append(summary);
  if(state.paused)panel.append(fe('p','ft-note','Automatic updates are paused for every catalog. Resume schedules to continue. Run now remains available.'));
  const login=fcheck('Launch Archivo Fork at login','login',state.login);login.querySelector('input').onchange=async e=>{try{e.target.checked=await fa.launchAtLogin(e.target.checked);}catch(err){e.target.checked=!e.target.checked;forkError(err);}};panel.append(login);
  panel.append(fe('p','ft-muted','Closing the window keeps updates running. Quit stops them. Offline drives keep their last catalog. Times follow this computer’s time zone.'));
  const heading=fe('div','ft-section-heading');heading.append(fe('h2','ft-section-title','Saved schedules'),fb('New schedule',()=>startScheduleEdit()));heading.lastChild.disabled=!docPath||!DB.disks.length;heading.lastChild.hidden=!!docPath&&!!DB.disks.length&&(!state.schedules.some(s=>s.file===docPath)||forkScheduleDraft?.file===docPath);panel.append(heading);
  if(!state.schedules.length)panel.append(fe('p','ft-muted','No schedules yet. Choose the drives and update frequency below.'));
  const table=ftable(['Catalog / schedule','Next run','Last result','Actions']);
  for(const schedule of state.schedules){
    const name=fe('div');name.append(fe('strong','',schedule.name),fe('p','ft-path',schedule.file),fbadge(schedule.enabled?'Enabled':'Paused'),fe('p','ft-muted',ruleText(schedule.rule)+' · '+schedule.diskIds.length+' drives'));
    const actions=fe('div','ft-actions');
    const edit=fb('Edit',()=>startScheduleEdit(schedule));edit.disabled=schedule.file!==docPath;edit.title=edit.disabled?'Open this catalog to edit its schedule':'';
    actions.append(fb('Run now',async()=>{const result=await fa.runSchedule(schedule.id);if(result.deferred)toast('Deferred until the active job or unsaved edits are finished.','warn');await renderSchedules();}),fb(schedule.enabled?'Pause':'Enable',async()=>{await fa.scheduleAction(schedule.id,'toggle');await renderSchedules();}),edit,fb('Remove',()=>showModal('Remove schedule?','The catalog and its files will be kept.',[{label:'Cancel',cls:'btn-g',fn:hideModal},{label:'Remove',cls:'btn-p',fn:async()=>{hideModal();try{await fa.scheduleAction(schedule.id,'remove');if(forkScheduleDraft?.id===schedule.id){forkScheduleDraft=null;forkScheduleForm=null;forkEditSchedule=null;}await renderSchedules();}catch(e){forkError(e);}}}])));
    frow(table,[name,schedule.running?'Running…':schedule.enabled?(state.paused?'Paused globally · ':'')+new Date(schedule.nextRun).toLocaleString():'Paused',schedule.lastResult,actions]);
  }
  if(state.schedules.length)panel.append(table);
  if(forkScheduleDraft?.file!==docPath){forkScheduleDraft=null;forkEditSchedule=null;}
  if(docPath&&DB.disks.length&&(!state.schedules.some(s=>s.file===docPath)||forkScheduleDraft))renderScheduleForm(state);
  else if(!docPath)panel.append(fe('p','ft-note','Save your catalog to create a schedule.'));
  if(state.sources.length){const links=createDrivePicker({sources:state.sources,showLinks:true,selectable:false,label:'Source links',saved:forkSourcePickerState});links.id='schedule-sources';panel.append(links);}
  const activity=fe('details','ft-disclosure');activity.open=state.activity.length>0;activity.append(fe('summary','','Recent activity · '+state.activity.length));
  if(!state.activity.length)activity.append(fe('p','ft-muted','Scheduled updates and cleanup results will appear here.'));
  const log=ftable(['Time','Task','Result']);for(const entry of state.activity.slice(0,30)){const result=fe('div');result.append(fbadge(entry.status),fe('p','ft-muted',entry.detail));frow(log,[new Date(entry.at).toLocaleString(),entry.title,result]);}if(state.activity.length)activity.append(log);panel.append(activity);applyForkBusy();
}
function ruleText(rule){if(rule.kind==='interval'){const value=rule.minutes%1440===0?rule.minutes/1440:rule.minutes%60===0?rule.minutes/60:rule.minutes,unit=rule.minutes%1440===0?'day':rule.minutes%60===0?'hour':'minute';return 'Every '+value+' '+unit+(value===1?'':'s');}return (rule.kind==='weekly'?'On '+rule.days.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', '):'Daily')+' at '+rule.time;}
function renderScheduleForm(state){
  const panel=g('fork-panel'),form=fe('form','ft-form'),draft=forkScheduleDraft||{file:docPath,diskIds:state.sources.filter(s=>s.binding).map(s=>s.id),rule:{kind:'daily',time:'02:00',days:[1,2,3,4,5]},enabled:false};
  form.id='schedule-form';form.append(fe('h2','ft-section-title',draft.id?'Edit schedule':'New schedule for '+docName()));
  const disks=createDrivePicker({ids:draft.diskIds,sources:state.sources,linkedOnly:true,showLinks:true,label:'Drives to update',saved:draft.picker,onchange:ids=>{save.disabled=dirty||!ids.length;}});disks.id='schedule-drives';form.append(disks);
  const row=fe('div','ft-row'),kind=fe('select','ft-select');for(const[value,text]of [['daily','Every day'],['weekly','Selected weekdays'],['interval','At an interval']]){const option=fe('option','',text);option.value=value;kind.append(option);}kind.value=draft.rule.kind;
  const time=fe('input','ft-input');time.type='time';time.required=true;time.value=draft.rule.time||'02:00';const minutes=fe('input','ft-input');minutes.type='number';minutes.min='15';minutes.max='10080';minutes.step='1';minutes.required=true;minutes.value=draft.rule.minutes??60;
  for(const[label,control]of [['Repeat',kind],['Local time',time],['Minutes',minutes]]){const wrap=fe('label','org-field',label);control.setAttribute('aria-label',label);wrap.append(control);row.append(wrap);}form.append(row);
  const weekdays=fe('div','schedule-weekdays');['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day,i)=>weekdays.append(fcheck(day,String(i),draft.rule.days?.includes(i))));weekdays.setAttribute('role','group');weekdays.setAttribute('aria-label','Weekdays');form.append(weekdays);
  const enabled=fcheck('Enable this schedule','enabled',draft.enabled);form.append(enabled,fe('p','ft-muted','Only linked sources can be selected. Successful updates save automatically with five recoverable backups. New drives can be added by editing this schedule.'));
  if(dirty){const note=fe('div','ft-note');note.append(document.createTextNode('Save your catalog edits before saving this schedule. '),fb('Save catalog',async()=>{if(await saveCatalog())await renderSchedules();}));form.append(note);}
  form.readDraft=()=>({file:docPath,id:draft.id,diskIds:disks.selectedIds(),picker:disks.pickerState(),rule:{kind:kind.value,time:time.value,minutes:Number(minutes.value),days:[...weekdays.querySelectorAll('input:checked')].map(i=>Number(i.value))},enabled:enabled.querySelector('input').checked});
  const actions=fe('div','ft-actions'),save=fb(draft.id?'Save changes':'Create schedule',async()=>{
    if(save.disabled||!form.reportValidity())return;save.disabled=true;
    try{const input=form.readDraft();await forkSync();await fa.saveSchedule(input);forkScheduleDraft=null;forkEditSchedule=null;forkScheduleForm=null;toast('Schedule saved.','ok');await renderSchedules();}catch(error){save.disabled=dirty||!disks.selectedIds().length;throw error;}
  },'ft-primary');save.disabled=dirty||!disks.selectedIds().length;actions.append(save);
  if(state.schedules.some(s=>s.file===docPath))actions.append(fb('Cancel edit',()=>{forkScheduleDraft=null;forkEditSchedule=null;forkScheduleForm=null;renderSchedules().catch(forkError);}));
  form.append(actions);form.onsubmit=e=>{e.preventDefault();save.click();};panel.append(form);forkScheduleForm=form;
  const update=()=>{time.parentElement.hidden=kind.value==='interval';time.disabled=kind.value==='interval';minutes.parentElement.hidden=kind.value!=='interval';minutes.disabled=kind.value!=='interval';weekdays.hidden=kind.value!=='weekly';};kind.onchange=update;update();
}
function applyForkBusy(){
 document.querySelectorAll('#fork-panel button, #fork-panel input, #fork-panel select').forEach(el=>{if(forkBusy&&!el.disabled&&!el.dataset.reveal){el.dataset.jobDisabled='1';el.disabled=true;}else if(!forkBusy&&el.dataset.jobDisabled){delete el.dataset.jobDisabled;el.disabled=false;}});
}
for(const b of document.querySelectorAll('#fork-nav [data-view]'))b.onclick=()=>forkShow(b.dataset.view);
g('welcome-schedules').onclick=()=>forkShow('schedules');
g('fork-locate').onclick=()=>{const disk=selected?.disk;if(!disk){toast('Select a catalog disk first.','info');return;}forkLocate(disk.id).catch(forkError);};
g('fork-cancel').onclick=()=>fa.cancelJob().catch(forkError);
fa.onFork('view',forkShow);
fa.onFork('status',status=>{
  forkBusy=status.busy;g('fork-job-status').textContent=status.busy?'Working: '+status.busy:status.paused?'Schedules paused':'Ready';g('fork-cancel').hidden=!status.busy;
  g('main').inert=false;
  applyForkBusy();updateDuplicateActions();
  updateUiState();
});
fa.onFork('progress',p=>{if(p.path)g('fork-job-status').textContent=(p.label?p.label+': ':'')+p.path;else if(p.groups)g('fork-job-status').textContent='Verified '+p.groups+' / '+p.total+' groups';});
fa.onFork('catalog',async result=>{
  if(result.path!==docPath)return;
  if(dirty){await fa.context(DB);forkCatalogStatus({path:docPath,changed:true});toast('A background update is ready. Save a copy of your edits or reload the latest catalog.','warn');return;}
  DB=result.data;refreshAll();markClean();await fa.acceptCatalog(result.path,result.fingerprint);if(forkView==='schedules')await renderSchedules();
});
fa.onFork('cleanup',result=>{DB=result.data;markDirty();refreshAll();});
fa.toolsStatus().then(status=>{forkBusy=status.busy;updateUiState();}).catch(forkError);
