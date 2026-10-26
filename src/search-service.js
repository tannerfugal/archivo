'use strict';
const {Worker}=require('worker_threads'),path=require('path'),{validate}=require('./search');
class SearchService{
 constructor(){this.worker=new Worker(path.join(__dirname,'search-worker.js'));this.worker.unref();this.revision=0;this.seq=0;this.pending=new Map();this.worker.on('message',m=>{const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(!this.pending.size)this.worker.unref();m.error?p.reject(Error(m.error)):p.resolve(m.result);});this.worker.on('error',e=>{for(const p of this.pending.values())p.reject(e);this.pending.clear();});this.worker.unref();}
 context(data){this.revision++;this.worker.postMessage({data,revision:this.revision});}
 async search(query){query=validate(query);const revision=this.revision,result=await new Promise((resolve,reject)=>{this.worker.ref();const id=++this.seq;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,query,revision});});if(revision!==this.revision)throw Error('Catalog changed. Search again.');return result;}
 stop(){this.worker.terminate();}
}
module.exports={SearchService};
