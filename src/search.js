'use strict';
const {bytes}=require('./analysis'), org=require('./organization');
const types={video:'mov mp4 mxf avi mkv webm r3d braw mts m4v',image:'jpg jpeg png gif tif tiff heic raw dng exr psd svg webp',audio:'wav mp3 aif aiff flac aac m4a ogg',archive:'zip rar 7z tar gz',doc:'pdf txt doc docx xls xlsx ppt pptx csv rtf'};
function validate(q={}){
  if(!q||typeof q!=='object'||Array.isArray(q))throw Error('Invalid search.');
  const out={};for(const k of ['text','path','drive','category','location','from','to']){if(q[k]!==undefined&&typeof q[k]!=='string')throw Error('Invalid '+k);out[k]=(q[k]||'').slice(0,1024);}
  for(const k of ['from','to'])if(out[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(out[k])||!Number.isFinite(day(out[k]))||(()=>{const [y,m,d]=out[k].split('-').map(Number),date=new Date(y,m-1,d);return date.getFullYear()!==y||date.getMonth()!==m-1||date.getDate()!==d;})()))throw Error('Choose a valid date.');
  if(out.from&&out.to&&out.from>out.to)throw Error('Start date must precede end date.');
  out.date=q.date==='created'?'created':'modified';out.type=q.type||'all';if(!['all','folder','file',...Object.keys(types)].includes(out.type))throw Error('Invalid file type.');
  for(const k of ['min','max']){out[k]=q[k]===''||q[k]==null?null:Number(q[k]);if(out[k]!==null&&(!Number.isFinite(out[k])||out[k]<0))throw Error('File sizes must be nonnegative.');}
  if(out.min!==null&&out.max!==null&&out.min>out.max)throw Error('Minimum size exceeds maximum size.');
  out.exact=q.exact===true;out.sort=['name','size','modified','created','path','disk'].includes(q.sort)?q.sort:'name';out.desc=q.desc===true;
  out.page=Number.isInteger(q.page)&&q.page>=0?Math.min(q.page,10000000):0;out.pageSize=Number.isInteger(q.pageSize)?Math.max(1,Math.min(250,q.pageSize)):100;return out;
}
function day(value,end=false){if(!value)return null;const [y,m,d]=value.split('-').map(Number);return end?new Date(y,m-1,d+1).getTime():new Date(y,m-1,d).getTime();}
function evaluate(data,input){const q=validate(input),found=[],low=q.text.toLowerCase(),path=q.path.toLowerCase(),from=day(q.from),to=day(q.to,true);
  for(const d of org.scope(data,q.category,q.location)){
    if(q.drive&&q.drive!==d.id)continue;
    const stack=(d.tree||[]).map(n=>({n,segments:[n.name]}));while(stack.length){const {n,segments}=stack.pop();if(n.type==='dir')for(const child of n.children||[])stack.push({n:child,segments:segments.concat(child.name)});
      const name=n.name.toLowerCase(),ext=name.includes('.')?name.split('.').pop():'';
      if(low&&(q.exact?name!==low:!name.includes(low)))continue;
      if(path&&!segments.join('/').toLowerCase().includes(path))continue;
      if(q.type==='folder'&&n.type!=='dir'||q.type==='file'&&n.type!=='file'||types[q.type]&&(n.type!=='file'||!types[q.type].split(' ').includes(ext)))continue;
      const size=bytes(n.size),date=q.date==='created'?n.created_ms:n.mtime_ms??(n.modified?day(n.modified.slice(0,10)):undefined);
      if((from!==null||to!==null)&&(!Number.isFinite(date)||(from!==null&&date<from)||(to!==null&&date>=to)))continue;
      if((q.min!==null||q.max!==null)&&(n.type==='dir'||!size.exact||(q.min!==null&&size.value<q.min)||(q.max!==null&&size.value>q.max)))continue;
      found.push({diskId:d.id,diskLabel:d.label,segments,name:n.name,type:n.type,size:size.value,exact:size.exact,modified:n.modified||'',mtime_ms:n.mtime_ms,created_ms:n.created_ms});
    }
  }
  const value=r=>q.sort==='modified'?r.mtime_ms??day(r.modified.slice(0,10))??-1:q.sort==='created'?r.created_ms??-1:q.sort==='path'?r.segments.join('/'):q.sort==='disk'?r.diskLabel:r[q.sort];
  found.sort((a,b)=>{const av=value(a),bv=value(b),cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true,sensitivity:'base'});return (q.desc?-1:1)*cmp||a.diskId.localeCompare(b.diskId)||a.segments.join('/').localeCompare(b.segments.join('/'));});
  const page=Math.min(q.page,Math.max(0,Math.ceil(found.length/q.pageSize)-1));return {total:found.length,page,pageSize:q.pageSize,items:found.slice(page*q.pageSize,(page+1)*q.pageSize)};
}
module.exports={validate,evaluate,day};
