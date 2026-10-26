'use strict';
let categoryScope='',locationScope='';
function ensureOrganization(){if(!DB.organization)DB.organization=ArchivoOrganization.defaults();return DB.organization;}
function scopedDisks(){ensureOrganization();return ArchivoOrganization.scope(DB,categoryScope,locationScope);}
function organizationPaths(d){const org=ensureOrganization();return [ArchivoOrganization.path(org,'categories',d?.categoryId)||'Unassigned category',ArchivoOrganization.path(org,'locations',d?.locationId)||'Unassigned location'];}
function groupSelect(kind,value='',placeholder='Unassigned'){
 const select=fe('select','ft-select');const first=fe('option','',placeholder);first.value='';select.append(first);
 for(const n of [...ensureOrganization()[kind]].sort((a,b)=>ArchivoOrganization.path(DB.organization,kind,a.id).localeCompare(ArchivoOrganization.path(DB.organization,kind,b.id)))){const o=fe('option','',ArchivoOrganization.path(DB.organization,kind,n.id));o.value=n.id;select.append(o);}select.value=value||'';return select;
}
function scopeChanged(){forkMapStack=[];forkMapSelected=null;forkDuplicateReport=null;forkDuplicateSelections.clear();renderOrganization();renderTree();if(selected&&!scopedDisks().includes(selected.disk)){selected=null;updateInsp();}if(forkView==='map')renderStorageMap();if(forkView==='duplicates')renderDuplicates();if(g('srch-panel').classList.contains('on'))execSearch(g('search-inp').value);}
function renderOrganization(){
 const side=g('organization-sidebar');if(!side)return;side.replaceChildren();side.hidden=!docOpen||forkView==='schedules';if(!docOpen)return;const org=ensureOrganization();
 for(const [kind,title,scope] of [['categories','Category',categoryScope],['locations','Physical location',locationScope]]){
  if(scope&&scope!=='unassigned'&&!org[kind].some(n=>n.id===scope)){if(kind==='categories')categoryScope='';else locationScope='';}
  const head=fe('div','org-heading');head.append(fe('h2','',title),fb('Edit',()=>manageGroups(kind)));side.append(head);
  const choose=id=>{if(kind==='categories')categoryScope=id;else locationScope=id;scopeChanged();};
  function button(label,id,depth){const b=fb(label,()=>choose(id),'org-choice');b.style.paddingLeft=(10+depth*12)+'px';b.setAttribute('aria-pressed',String(scope===id));return b;}
  side.append(button('All '+(kind==='categories'?'categories':'locations'),'',0),button('Unassigned','unassigned',0));
  function add(parent,depth){for(const n of org[kind].filter(n=>n.parent===parent)){side.append(button(n.name,n.id,depth));add(n.id,depth+1);}}add(null,0);
 }
 side.append(fb('Organize drives…',organizeDrives),fe('p','ft-muted','Organization only labels catalog entries. Physical files stay where they are.'));
 const chips=g('scope-chips');chips.replaceChildren();for(const [kind,id,label]of [['categories',categoryScope,'Category'],['locations',locationScope,'Location']])if(id)chips.append(fe('span','ft-badge',label+': '+(id==='unassigned'?'Unassigned':ArchivoOrganization.path(org,kind,id))));if(categoryScope||locationScope)chips.append(fb('Reset scope',()=>{categoryScope='';locationScope='';scopeChanged();}));
}
function commitOrganization(){markDirty();refreshAll();scopeChanged();}
function inspectorOrganization(d){const box=fe('div','is');box.append(fe('div','ist','Organization'));for(const[kind,label,field]of [['categories','Category','categoryId'],['locations','Physical location','locationId']]){const wrap=fe('label','org-field',label),select=groupSelect(kind,d[field]);select.setAttribute('aria-label',label+' for '+d.label);select.onchange=()=>{if(select.value)d[field]=select.value;else delete d[field];commitOrganization();};wrap.append(select);box.append(wrap);}g('ib').append(box);}
function manageGroups(kind){
 showModal(kind==='categories'?'Edit categories':'Edit physical locations','<div id="organization-form"></div>',[{label:'Done',cls:'btn-p',fn:hideModal}]);
 const host=g('organization-form'),picker=groupSelect(kind,'','New group'),name=fe('input','ft-input'),parent=groupSelect(kind,'','Top level');name.placeholder='Group name';name.setAttribute('aria-label','Group name');picker.setAttribute('aria-label','Group to edit');parent.setAttribute('aria-label','Parent group');
 const label=(text,control)=>{const l=fe('label','org-field',text);l.append(control);host.append(l);};label('Group',picker);label('Name',name);label('Parent',parent);
 picker.onchange=()=>{const n=ensureOrganization()[kind].find(n=>n.id===picker.value);name.value=n?.name||'';parent.value=n?.parent||'';};
 host.append(fb('Save group',()=>{if(!name.value.trim())throw Error('Enter a group name.');const org=ensureOrganization();if(picker.value){ArchivoOrganization.move(org,kind,picker.value,parent.value);org[kind].find(n=>n.id===picker.value).name=name.value.trim().slice(0,128);}else org[kind].push({id:crypto.randomUUID(),name:name.value.trim().slice(0,128),parent:parent.value||null});commitOrganization();manageGroups(kind);}),fb('Delete empty group',()=>{if(!picker.value)throw Error('Choose a group to delete.');ArchivoOrganization.remove(DB,kind,picker.value);commitOrganization();manageGroups(kind);},'ft-danger'));
}
function organizeDrives(){
 if(!docOpen||busy())return;showModal('Organize drives','<div id="organize-drives"></div>',[{label:'Cancel',cls:'btn-g',fn:hideModal}]);
 const host=g('organize-drives'),choices=fe('div','org-drive-choices');for(const d of DB.disks)choices.append(fcheck(d.label,d.id,selected?.disk===d));host.append(choices);
 const cat=groupSelect('categories','','Unassigned'),loc=groupSelect('locations','','Unassigned'),useCat=fcheck('Set category','category',true),useLoc=fcheck('Set physical location','location',false);
 host.append(useCat,cat,useLoc,loc,fb('Apply to selected drives',()=>{const ids=new Set([...choices.querySelectorAll('input:checked')].map(i=>i.value));if(!ids.size)throw Error('Select at least one drive.');for(const d of DB.disks.filter(d=>ids.has(d.id)))for(const[use,select,key]of[[useCat,cat,'categoryId'],[useLoc,loc,'locationId']])if(use.querySelector('input').checked){if(select.value)d[key]=select.value;else delete d[key];}hideModal();commitOrganization();},'ft-primary'));
}
renderOrganization();
