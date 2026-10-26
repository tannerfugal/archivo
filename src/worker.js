'use strict';
const {parentPort,workerData}=require('worker_threads');
const sources=require('./sources'),io=require('./catalog-io');
const {scanVolume}=require('./scanner');
const {verify,digest}=require('./duplicates');
const cancelled=()=>Atomics.load(new Int32Array(workerData.cancel),0)!==0;
const progress=p=>parentPort.postMessage({progress:p});
(async()=>{
  const {op,args}=workerData;let result;
  switch(op) {
    case 'list': result=sources.list();break;
    case 'identify': result=sources.identify(args.root);break;
    case 'resolve': result=sources.resolve(args.binding);break;
    case 'scan': {
      const source=args.binding?sources.resolve(args.binding):sources.identify(args.root);
      result=await scanVolume(source.root,{isCancelled:cancelled,send:progress,system:source.vol_type==='system' && !source.relative,exclude:args.exclude});
      if (!result.cancelled && !sources.same(source,sources.identify(source.root))) throw Error('Source changed during scanning; previous catalog preserved.');
      result.source=source;break;
    }
    case 'candidates': result=require('./analysis').candidates(args.disks);break;
    case 'verify':result=await verify(args.disks,args.bindings,sources.resolve,cancelled,progress);break;
    case 'digest': {
      const source=sources.resolve(args.binding);
      result=await digest(source.root,args.segments,false,cancelled,bytes=>progress({bytes}));
      if (!sources.same(source,sources.identify(source.root))) throw Error('Source changed during verification.');
      result.source=source;break;
    }
    case 'file': {
      const source=sources.resolve(args.binding);
      result={file:sources.realFile(source.root,args.segments),source};break;
    }
    case 'read':result={data:io.read(args.file),fingerprint:io.fingerprint(args.file)};break;
    case 'write':result={fingerprint:io.write(args.file,args.data,args.expected,args.backups)};break;
    default:throw Error('Unknown background operation.');
  }
  parentPort.postMessage({result});
})().catch(e=>parentPort.postMessage({error:e.message}));
