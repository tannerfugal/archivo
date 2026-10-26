'use strict';
const {parentPort}=require('worker_threads'),{evaluate}=require('./search');let data={disks:[]},revision=0;
parentPort.on('message',m=>{try{if(m.data){data=m.data;revision=m.revision;return;}if(m.revision!==revision)throw Error('Catalog changed. Search again.');parentPort.postMessage({id:m.id,result:{...evaluate(data,m.query),revision}});}catch(e){parentPort.postMessage({id:m.id,error:e.message});}});
