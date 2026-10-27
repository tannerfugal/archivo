'use strict';
let searchRequest=0,searchPage=0,searchActive=false;
const searchOptions=fe('details','search-options');searchOptions.id='search-options';searchOptions.append(fe('summary','','Search filters'));
const searchFields=fe('div','search-fields');searchOptions.append(searchFields);g('cat').prepend(searchOptions);
const searchControls={};
function updateSearchSummary(){const count=['exact','from','to','drive','path','min','max'].filter(key=>{const el=searchControls[key];return el&&(el.type==='checkbox'?el.checked:el.value!=='');}).length;searchOptions.querySelector('summary').textContent='Search filters'+(count?' · '+count+' active':'');}
function searchField(key,title,type,options){const label=fe('label','',title),el=fe(options?'select':'input','ft-input');if(options){for(const[value,text]of options){const o=fe('option','',text);o.value=value;el.append(o);}}else el.type=type||'text';el.id='search-'+key;el.setAttribute('aria-label',title);label.append(el);searchFields.append(label);searchControls[key]=el;el.onchange=()=>{searchPage=0;execSearch(g('search-inp').value);};return el;}
searchField('exact','Exact filename','checkbox');
searchField('date','Date field',null,[['modified','Modified'],['created','Created']]);
searchField('from','From (inclusive)','date');searchField('to','Through (inclusive)','date');
searchField('drive','Drive',null,[['','All drives']]);searchField('path','Path contains');
for(const key of ['min','max']){const el=searchField(key,key==='min'?'Minimum bytes':'Maximum bytes','number');el.min='0';el.step='1';}
searchField('sort','Sort by',null,[['name','Filename'],['size','Size'],['modified','Modified date'],['created','Creation date'],['path','Path'],['disk','Drive']]);searchField('desc','Descending','checkbox');
searchFields.append(fb('Search',()=>{searchPage=0;execSearch(g('search-inp').value);}),fb('Reset search',clearSearch));
const searchPager=fe('div','ft-page');searchPager.id='search-pager';g('srch-panel').append(searchPager);
function refreshSearchDrives(){const el=searchControls.drive,value=el.value;el.replaceChildren();const all=fe('option','','All drives');all.value='';el.append(all);for(const d of DB.disks){const o=fe('option','',d.label);o.value=d.id;el.append(o);}el.value=DB.disks.some(d=>d.id===value)?value:'';}
function resetAdvancedSearch(){++searchRequest;searchActive=false;searchPage=0;for(const[k,el]of Object.entries(searchControls)){if(el.type==='checkbox')el.checked=false;else el.value=k==='date'?'modified':k==='sort'?'name':'';}updateSearchSummary();srchFilter='all';document.querySelectorAll('.sf').forEach(el=>{el.classList.toggle('on',el.dataset.f==='all');el.setAttribute('aria-pressed',String(el.dataset.f==='all'));});searchPager.replaceChildren();}
function searchInvalidate(){++searchRequest;refreshSearchDrives();if(searchActive){clearTimeout(srchTimer);srchTimer=setTimeout(()=>execSearch(g('search-inp').value),100);}}
async function advancedSearch(text){
 if(!docOpen)return;updateSearchSummary();const request=++searchRequest,q={text,category:categoryScope,location:locationScope,type:srchFilter,page:searchPage,pageSize:100};for(const[k,el]of Object.entries(searchControls))q[k]=el.type==='checkbox'?el.checked:el.value;
 const filtered=text.trim()||q.exact||q.from||q.to||q.drive||q.path||q.min!==''||q.max!==''||q.type!=='all'||q.category||q.location;
 g('search-clear').style.display=filtered?'inline-flex':'none';if(!filtered){searchActive=false;hideSearchPanel();return;}
 searchActive=true;g('tree-scroll').style.display='none';g('srch-panel').classList.add('on');g('sc').textContent='Searching…';
 try{await fa.context(DB);const result=await fa.searchCatalog(q);if(request!==searchRequest)return;searchPage=result.page;
 g('sc').textContent=result.total.toLocaleString()+(result.total===1?' result':' results');const list=g('srch-list');list.replaceChildren();srchResults=[];
 for(const item of result.items){const disk=DB.disks.find(d=>d.id===item.diskId);srchResults.push({disk,node:item,pp:item.segments});const row=fe('div','sr');row.tabIndex=0;row.setAttribute('role','button');row.dataset.i=srchResults.length-1;row.append(fe('div','sr-ic',item.type==='dir'?'▸':'·'),fe('div','sr-nm',item.name),fe('div','sr-dk',disk.label),fe('div','sr-pt',item.segments.join('/')),fe('div','sr-sz',fmt(item.size)+(item.exact?'':' ≈')),fe('div','sr-dt',q.date==='created'?(item.created_ms?new Date(item.created_ms).toLocaleDateString():'Unknown'):item.modified||'Unknown'));row.querySelector('.sr-nm').innerHTML=hlMatch(item.name,text.trim());list.append(row);}
 if(!result.total)list.append(fe('div','ft-empty srch-empty','No items match all the active filters.'));
 searchPager.replaceChildren();const prev=fb('Previous',()=>{searchPage--;execSearch(text);}),next=fb('Next',()=>{searchPage++;execSearch(text);});prev.disabled=!result.page;next.disabled=(result.page+1)*result.pageSize>=result.total;searchPager.append(prev,fe('span','',result.total?`${result.page*result.pageSize+1}–${Math.min((result.page+1)*result.pageSize,result.total)} of ${result.total.toLocaleString()}`:'0 results'),next);
 }catch(e){if(request!==searchRequest)return;g('sc').textContent='Search needs attention';g('srch-list').replaceChildren(fe('div','ft-empty',String(e.message)));}
}
refreshSearchDrives();
