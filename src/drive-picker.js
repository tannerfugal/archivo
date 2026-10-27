/* Shared, bounded drive selection for schedules, duplicates and organization. */
'use strict';
function createDrivePicker({disks=DB.disks, ids=[], sources=null, linkedOnly=false, showLinks=false, selectable=true, label='Choose drives', open=false, saved={}, onchange=()=>{}}={}) {
  const selectedIds=new Set(ids), host=fe('details','drive-picker'), summary=fe('summary');
  host.open=saved.open??open;host.append(summary);
  const body=fe('div','drive-picker-body'), filters=fe('div','drive-picker-filters');
  const search=fe('input','ft-input');search.type='search';search.placeholder='Search drives or locations…';search.setAttribute('aria-label',label+': search');search.value=saved.search||'';
  const category=groupSelect('categories','','All categories'), location=groupSelect('locations','','All locations'), status=fe('select','ft-select');
  for(const control of [category,location]){const option=fe('option','','Unassigned');option.value='unassigned';control.append(option);}
  for(const [control,title] of [[category,'category'],[location,'location'],[status,'status']])control.setAttribute('aria-label',label+': '+title);
  for(const [value,text] of [['','All drives'],...(selectable?[['selected','Selected only']]:[]),...(sources?[['linked','Linked sources'],['unlinked','Needs source link']]:[])]){const option=fe('option','',text);option.value=value;status.append(option);}
  category.value=saved.category||'';location.value=saved.location||'';status.value=saved.status||'';
  filters.append(search,category,location,status);body.append(filters);
  const bulk=fe('div','drive-picker-bulk'), all=fcheck('Select shown','shown',false), allInput=all.querySelector('input'), count=fe('span','ft-muted');
  const clear=fb('Clear selection',()=>{selectedIds.clear();render();onchange([...selectedIds]);});
  all.hidden=!selectable;clear.hidden=!selectable;bulk.append(all,count,clear);body.append(bulk);
  const list=fe('div','drive-picker-list');list.setAttribute('role','group');list.setAttribute('aria-label',label);body.append(list);host.append(body);
  const linked=id=>sources?.find(s=>s.id===id)?.binding;
  const eligible=d=>!linkedOnly||!!linked(d.id);
  for(const id of selectedIds)if(!disks.some(d=>d.id===id))selectedIds.delete(id);
  let shown=[];
  function render(){
    const scopeIds=new Set(ArchivoOrganization.scope(DB,category.value,location.value).map(d=>d.id)), query=search.value.trim().toLocaleLowerCase();
    shown=disks.filter(d=>scopeIds.has(d.id)&&(!query||[d.label,...organizationPaths(d),linked(d.id)?.root||''].join(' ').toLocaleLowerCase().includes(query))&&(!status.value||status.value==='selected'&&selectedIds.has(d.id)||status.value==='linked'&&linked(d.id)||status.value==='unlinked'&&!linked(d.id))).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
    summary.replaceChildren(fe('strong','',label),fe('span','drive-picker-summary',selectable?selectedIds.size+' of '+disks.length+' drives selected':disks.filter(d=>linked(d.id)).length+' of '+disks.length+' linked'));
    const eligibleShown=shown.filter(eligible), checked=eligibleShown.filter(d=>selectedIds.has(d.id)).length;
    allInput.checked=!!eligibleShown.length&&checked===eligibleShown.length;allInput.indeterminate=checked>0&&checked<eligibleShown.length;allInput.disabled=!eligibleShown.length;
    clear.disabled=!selectedIds.size;const hidden=[...selectedIds].filter(id=>!shown.some(d=>d.id===id)).length;
    count.textContent=shown.length+' shown'+(hidden?' · '+hidden+' selected outside this filter':'');
    const scroll=list.scrollTop;list.replaceChildren();
    for(const d of shown){
      const row=fe('div','drive-picker-row'), choice=fcheck(d.label,d.id,selectedIds.has(d.id)), input=choice.querySelector('input');
      input.disabled=!eligible(d)&&!selectedIds.has(d.id);input.onchange=()=>{if(input.checked&&eligible(d))selectedIds.add(d.id);else selectedIds.delete(d.id);render();[...list.querySelectorAll('input')].find(el=>el.value===d.id)?.focus({preventScroll:true});onchange([...selectedIds]);};
      if(!selectable)choice.replaceChildren(document.createTextNode(d.label));
      const info=fe('div','drive-picker-info');info.append(choice,fe('small','ft-muted',organizationPaths(d).join(' · ')));
      if(sources){const binding=linked(d.id);info.append(fe('small','ft-path',binding?binding.root:'Needs source link'));}
      row.append(info);
      if(showLinks)row.append(fb(linked(d.id)?'Relink…':'Locate source…',async()=>{await forkLocate(d.id);},'drive-link'));
      list.append(row);
    }
    if(!shown.length)list.append(fe('div','drive-picker-empty','No drives match these filters.'));list.scrollTop=scroll;
  }
  allInput.onchange=()=>{for(const d of shown.filter(eligible)){if(allInput.checked)selectedIds.add(d.id);else selectedIds.delete(d.id);}render();onchange([...selectedIds]);};
  search.oninput=render;for(const control of [category,location,status])control.onchange=render;
  host.selectedIds=()=>[...selectedIds];host.pickerState=()=>({open:host.open,search:search.value,category:category.value,location:location.value,status:status.value});
  summary.addEventListener('click',()=>requestAnimationFrame(()=>{if(host.open)host.scrollIntoView({block:'nearest'});}));
  render();return host;
}
