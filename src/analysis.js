/* Shared, deterministic offline analysis; usable by Electron's sandboxed renderer. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArchivoAnalysis = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function bytes(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return { value, exact: true };
    const m = String(value || '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)?$/i);
    if (!m) return { value: 0, exact: false };
    return { value: Number(m[1].replace(',', '.')) * 1024 ** (['b','kb','mb','gb','tb'].indexOf((m[2] || 'b').toLowerCase().replace('ib', 'b'))), exact: false };
  }
  function flatten(disks) {
    const out = [], stack = [];
    for (const disk of disks || []) for (const node of disk.tree || []) stack.push({ diskId: disk.id, diskLabel: disk.label, node, segments: [node.name] });
    while (stack.length) {
      const item = stack.pop(), b = bytes(item.node.size);
      if (item.node.type === 'dir') {
        for (const node of item.node.children || []) stack.push({ diskId: item.diskId, diskLabel: item.diskLabel, node, segments: item.segments.concat(node.name) });
      } else out.push({ diskId: item.diskId, diskLabel: item.diskLabel, segments: item.segments, name: item.node.name, size: b.value, exact: b.exact, mtime_ms:item.node.mtime_ms });
    }
    return out;
  }
  function candidateKey(item) {
    const name = item.name || item.segments?.at(-1);
    if (typeof name !== 'string' || !name || !Number.isSafeInteger(item.size) || item.size <= 0) return null;
    // Compare the entire basename, including camera clip and chunk identifiers.
    // Case/Unicode normalization allows the same name to cross Mac/PC filesystems.
    return JSON.stringify([item.size, name.normalize('NFC').toLowerCase()]);
  }
  function groupedCandidates(disks, names) {
    const groups = new Map();
    for (const item of flatten(disks)) {
      if (!item.exact || item.size === 0) continue;
      const key = names ? candidateKey(item) : item.size;
      if (key === null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.values()].filter(items => items.length > 1).sort((a,b) => b[0].size - a[0].size).map(items => ({ size: items[0].size, items }));
  }
  function candidates(disks) { return groupedCandidates(disks, true); }
  // Size buckets are only a work queue for reading contents, never match evidence.
  function verificationCandidates(disks) { return groupedCandidates(disks, false); }
  function tree(disks) {
    function convert(nodes, disk, segments) {
      return (nodes || []).map(n => {
        const seg = segments.concat(n.name), children = n.type === 'dir' ? convert(n.children, disk, seg) : null, b = bytes(n.size);
        return { name: n.name, diskId: disk.id, segments: seg, children,
          size: children?.length ? children.reduce((s,c) => s + c.size, 0) : b.value,
          approximate: children?.length ? children.some(c => c.approximate) : children ? b.value>0 || !b.exact : !b.exact };
      });
    }
    const children = (disks || []).map(d => {
      const children = convert(d.tree, d, []);
      return { name: d.label, diskId: d.id, segments: [], scanned: d.scanned, children,
        size: children.reduce((s,c) => s + c.size, 0), approximate: children.some(c => c.approximate) };
    });
    return { name: 'All disks', children, size: children.reduce((s,c) => s+c.size,0), approximate: children.some(c=>c.approximate) };
  }
  // Binary weighted treemap: O(n log n), no framework or layout-dependent state.
  function layout(items, x, y, w, h) {
    const sorted = items.filter(n=>n.size > 0).slice().sort((a,b)=>b.size-a.size), result=[];
    function split(list, x, y, w, h) {
      if (!list.length) return;
      if (list.length === 1) { result.push({ item:list[0], x,y,w,h }); return; }
      const total = list.reduce((s,n)=>s+n.size,0); let sum=0, i=0;
      while (i < list.length-1 && sum < total/2) sum += list[i++].size;
      const r = sum/total;
      if (w >= h) { split(list.slice(0,i),x,y,w*r,h); split(list.slice(i),x+w*r,y,w*(1-r),h); }
      else { split(list.slice(0,i),x,y,w,h*r); split(list.slice(i),x,y+h*r,w,h*(1-r)); }
    }
    split(sorted,x,y,w,h); return result;
  }
  function duplicateGroups(report,includeOther=false){
    const groups=[],other=[],hashes=new Map(),possible=new Map();
    for(const sizeGroup of report?.groups||[])for(const item of sizeGroup.items){
      if(item.status==='Verified'&&item.hash){if(!hashes.has(item.hash))hashes.set(item.hash,[]);hashes.get(item.hash).push(item);}
      else if(report.mode!=='content'&&['Possible','Offline','Changed','Unreadable'].includes(item.status)&&candidateKey(item)!==null){const key=candidateKey(item);if(!possible.has(key))possible.set(key,[]);possible.get(key).push(item);}
      else other.push(item);
    }
    for(const[hash,items]of hashes)if(items.length>1)groups.push({id:'hash:'+hash,state:'Verified',size:items[0].size,items,duplicateBytes:(items.length-1)*items[0].size});else other.push(...items);
    for(const[key,items]of possible)if(items.length>1)groups.push({id:'possible:'+key,state:'Possible matches',size:items[0].size,items,duplicateBytes:(items.length-1)*items[0].size});else other.push(...items);
    if(includeOther)for(const item of other)groups.push({id:'other:'+item.id,state:item.status,size:item.size,items:[item],duplicateBytes:0});
    return {groups,otherCount:other.length};
  }
  function descendants(node, folders) {
    const out=[],stack=[...(node.children||[])];while(stack.length){const n=stack.pop();if(Boolean(n.children)===folders)out.push(n);if(n.children)for(const child of n.children)stack.push(child);}return out;
  }
  function nested(node,width=1000,height=600,depth=4,budget=4000){
    const result=[];
    function draw(children,x,y,w,h,levels,slots,shade,chain=new Set()){
      if(!children?.length||slots<1||w<=0||h<=0)return;
      let list=children.filter(n=>n.size>0).slice().sort((a,b)=>b.size-a.size),small=[],kept=[],total=list.reduce((s,n)=>s+n.size,0);
      // Reserve one visible aggregate for small regions. It retains every byte and child.
      for(const n of list){if(n.size/total*w*h<90||kept.length>=Math.max(0,slots-1))small.push(n);else kept.push(n);}
      if(small.length===1&&kept.length<slots)kept.push(small[0]);else if(small.length){
        // Use openable buckets: a huge flat folder must not reopen as the same single aggregate forever.
        const count=Math.min(slots-kept.length,32,Math.max(1,Math.ceil(small.length/64))),chunk=Math.ceil(small.length/count);
        for(let i=0;i<small.length;i+=chunk){const members=small.slice(i,i+chunk);kept.push({name:members.length+' smaller items'+(count>1?' · '+(Math.floor(i/chunk)+1):''),size:members.reduce((s,n)=>s+n.size,0),children:members,aggregate:true,approximate:members.some(n=>n.approximate)});}
      }
      list=kept;let extra=slots-list.length;
      for(const [i,r] of layout(list,x,y,w,h).entries()){
        const branchSlots=1+Math.floor(extra*r.item.size/total),tone=shade??i;
        let item=r.item;
        // Wrapper folders do not consume the visible detail depth.
        if(!item.aggregate&&item.segments?.length){let wrapper=item;const names=[];while(wrapper.children?.length===1&&wrapper.children[0].children&&!chain.has(wrapper)){chain.add(wrapper);names.push(wrapper.name);wrapper=wrapper.children[0];}if(wrapper!==item)item={...wrapper,name:names.concat(wrapper.name).join(' / ')};}
        result.push({...r,item,level:depth-levels,tone});
        if(levels>1&&item.children&&branchSlots>1&&r.w>32&&r.h>40)draw(item.children,r.x+2,r.y+20,r.w-4,r.h-22,levels-1,branchSlots-1,item.diskId&&item.segments?.length===0?null:tone,new Set(chain));
      }
    }
    draw(node.children,0,0,width,height,depth,budget,null);return result;
  }
  return { bytes, flatten, candidateKey, candidates, verificationCandidates, tree, layout, nested, descendants, duplicateGroups };
});
