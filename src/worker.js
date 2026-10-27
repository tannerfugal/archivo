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
    case 'duplicate-areas':result={areas:require('./duplicate-areas').summarize(args.disks,args.report),verifiedDuplicateBytes:require('./analysis').duplicateGroups(args.report).groups.filter(group=>group.state==='Verified').reduce((sum,group)=>sum+group.duplicateBytes,0)};break;
    case 'verify':result=await verify(args.disks,args.bindings,sources.resolve,cancelled,progress);break;
    case 'digest': {
      const source=sources.resolve(args.binding);
      result=await digest(source.root,args.segments,false,cancelled,bytes=>progress({bytes}));
      if (!sources.same(source,sources.identify(source.root))) throw Error('Source changed during verification.');
      result.source=source;break;
    }
    case 'reveal': {
      const started=performance.now(),source=sources.resolveTarget(args.binding),resolved=performance.now();
      result={file:sources.realFile(source.root,args.segments),source,timings:{queue:started-args.queued,resolution:resolved-started,pathValidation:performance.now()-resolved}};break;
    }
    case 'file': {
      const source=sources.resolve(args.binding);
      result={file:sources.realFile(source.root,args.segments),source};break;
    }
    case 'read':result=io.snapshot(args.file);break;
    case 'probe':result=io.probe(args.file,args.stamp);break;
    case 'destination':try{result={expected:io.fingerprint(args.file)};}catch(e){if(e.code!=='ENOENT')throw e;result={expected:null};}break;
    case 'catalog-lock':{const lease=io.acquireLock(args.file);try{if(args.expected!==undefined&&io.fingerprint(args.file)!==args.expected)throw Error('The shared catalog changed. Reload it and verify duplicates again before cleanup.');result=lease;}catch(e){io.releaseLock(lease);throw e;}break;}
    case 'catalog-unlock':io.releaseLock(args.lease);result=true;break;
    case 'write':result={fingerprint:io.write(args.file,args.data,args.expected,args.backups)};break;
    default:throw Error('Unknown background operation.');
  }
  parentPort.postMessage({result});
})().catch(e=>parentPort.postMessage({error:e.message}));
