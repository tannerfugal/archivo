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
  function candidates(disks) {
    const groups = new Map();
    for (const item of flatten(disks)) {
      if (!item.exact || item.size === 0) continue;
      if (!groups.has(item.size)) groups.set(item.size, []);
      groups.get(item.size).push(item);
    }
    return [...groups].filter(([, items]) => items.length > 1).sort((a,b) => b[0] - a[0]).map(([size, items]) => ({ size, items }));
  }
  function tree(disks) {
    function convert(nodes, disk, segments) {
      return (nodes || []).map(n => {
        const seg = segments.concat(n.name), children = n.type === 'dir' ? convert(n.children, disk, seg) : null, b = bytes(n.size);
        return { name: n.name, diskId: disk.id, segments: seg, children,
          size: children ? children.reduce((s,c) => s + c.size, 0) : b.value,
          approximate: children ? children.some(c => c.approximate) : !b.exact };
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
  return { bytes, flatten, candidates, tree, layout };
});
