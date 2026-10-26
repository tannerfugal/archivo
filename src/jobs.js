'use strict';
const {Worker}=require('worker_threads');
const path=require('path');
class Jobs {
  constructor() {this.active=null;this.pending=Promise.resolve();this.state=null;}
  run(op,args={},progress=()=>{}) {
    const execute=()=>new Promise((resolve,reject)=>{
      const cancel=new SharedArrayBuffer(4),worker=new Worker(path.join(__dirname,'worker.js'),{workerData:{op,args,cancel}});
      const active={worker,cancel,op};this.active=active;let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(this.active===active)this.active=null;worker.terminate();error?reject(error):resolve(result);};
      // Discovery and metadata must not wait forever on an unavailable share. Scans remain user-cancellable.
      const timer=setTimeout(()=>finish(Error('Source operation timed out. Reconnect the source and try again.')),['scan','verify','digest'].includes(op)?24*60*60*1000:30000);
      worker.on('message',m=>{if(m.progress){progress(m.progress);return;}finish(m.error?Error(m.error):null,m.result);});
      worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(Error('Background job stopped ('+code+').'));});
    });
    const next=this.pending.then(execute);this.pending=next.catch(()=>{});return next;
  }
  cancel() {if(this.active){const active=this.active;Atomics.store(new Int32Array(active.cancel),0,1);const timer=setTimeout(()=>{if(this.active===active)active.worker.terminate();},2000);timer.unref();}}
  stop() {if(this.active)this.active.worker.terminate();}
}
module.exports={Jobs};
