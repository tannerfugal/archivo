/* Catalog-owned organization. IDs, rather than labels, survive renames and moves. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ArchivoOrganization=factory();})(globalThis,function(){
'use strict';
const defaults=()=>({categories:[{id:'servers',name:'Servers',parent:null},{id:'archives',name:'Archive drives',parent:null},{id:'large',name:'Physically large',parent:'archives'},{id:'small',name:'Physically small',parent:'archives'}],locations:[]});
function clean(input){
  const out={};for(const kind of ['categories','locations']){
    const rows=[],seen=new Set();for(const n of (Array.isArray(input?.[kind])?input[kind]:defaults()[kind]).slice(0,2000)){
      if(!n||typeof n.id!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(n.id)||seen.has(n.id)||typeof n.name!=='string')continue;
      seen.add(n.id);rows.push({id:n.id,name:n.name.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,128)||'Untitled group',parent:typeof n.parent==='string'?n.parent:null});
    }
    const ids=new Map(rows.map(n=>[n.id,n]));for(const n of rows){if(!ids.has(n.parent))n.parent=null;const chain=new Set([n.id]);let p=n.parent;while(p){if(chain.has(p)){n.parent=null;break;}chain.add(p);p=ids.get(p)?.parent;}}
    out[kind]=rows;
  }return out;
}
function path(org,kind,id){const rows=org?.[kind]||[],parts=[],seen=new Set();while(id&&!seen.has(id)){seen.add(id);const n=rows.find(n=>n.id===id);if(!n)break;parts.unshift(n.name);id=n.parent;}return parts.join(' / ');}
function within(org,kind,id,scope){if(!scope)return true;if(scope==='unassigned')return !id;const seen=new Set();while(id&&!seen.has(id)){if(id===scope)return true;seen.add(id);id=org?.[kind]?.find(n=>n.id===id)?.parent;}return false;}
function scope(data,category,location){return data.disks.filter(d=>within(data.organization,'categories',d.categoryId,category)&&within(data.organization,'locations',d.locationId,location));}
function move(org,kind,id,parent){if(id===parent||within(org,kind,parent,id))throw Error('A group cannot be placed inside itself.');const n=org[kind].find(n=>n.id===id);if(!n)throw Error('Group not found.');if(parent&&!org[kind].some(n=>n.id===parent))throw Error('Parent group not found.');n.parent=parent||null;}
function remove(data,kind,id){const field=kind==='categories'?'categoryId':'locationId';if(data.organization[kind].some(n=>n.parent===id)||data.disks.some(d=>d[field]===id))throw Error('Move assigned drives and child groups before deleting this group.');data.organization[kind]=data.organization[kind].filter(n=>n.id!==id);}
return {defaults,clean,path,within,scope,move,remove};});
