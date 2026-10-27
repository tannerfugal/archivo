'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const {Service}=require('../src/service'),sources=require('../src/sources');
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-reveal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('targeted Reveal validates paths in an independent worker while the scan queue is blocked',async t=>{
 const root=temporary(t);fs.writeFileSync(path.join(root,'copy.txt'),'hello');const service=new Service({directory:path.join(root,'settings'),document:()=>({path:null}),emit:()=>{}});t.after(()=>{service.jobs.stop();service.revealJobs.stop();service.searcher.stop();});service.context({disks:[{id:'a',label:'A',tree:[]}]});await service.bind('a',root);
 let unblock;service.jobs.pending=new Promise(resolve=>unblock=resolve);t.after(()=>unblock());
 const at=performance.now(),result=await service.reveal('a',['copy.txt']);assert.equal(fs.realpathSync(result.file),fs.realpathSync(path.join(root,'copy.txt')));assert.ok(performance.now()-at<25000);assert.ok(result.timings.resolution>=0);assert.ok(result.timings.pathValidation>=0);console.log('Local Reveal worker timings (ms)',JSON.stringify(result.timings));
 await assert.rejects(service.reveal('a',['..','outside']),/Invalid/);service.settings.bindings[service.key(null,'a')].key='identity-mismatch';await assert.rejects(service.reveal('a',['copy.txt']),/offline|changed/);
});
test('Windows UNC Reveal measures a real local SMB share when the runner supports SMB', {skip:process.platform!=='win32'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-reveal-')),share='ArchivoTest'+process.pid;fs.writeFileSync(path.join(root,'network.txt'),'network test');
 const ps=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000,windowsHide:true});
 const literal=s=>"'"+s.replace(/'/g,"''")+"'";
 try{ps(`New-SmbShare -Name ${literal(share)} -Path ${literal(root)} -FullAccess $env:USERNAME -ErrorAction Stop | Out-Null`);}catch(e){fs.rmSync(root,{recursive:true,force:true});t.skip('Runner cannot create a disposable SMB share: '+e.message.slice(0,150));return;}
 t.after(()=>{try{ps(`Remove-SmbShare -Name ${literal(share)} -Force -ErrorAction Stop`);}finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 const unc='\\\\localhost\\'+share;const binding=sources.identify(unc,[]),at=performance.now(),fresh=sources.resolveTarget(binding),file=sources.realFile(fresh.root,['network.txt']);assert.equal(fs.readFileSync(file,'utf8'),'network test');console.log('UNC source + path validation (ms)',performance.now()-at);assert.equal(fresh.network,true);
 const io=require('../src/catalog-io'),catalog=path.join(root,'Shared.archivo'),remote=unc+'\\Shared.archivo';io.write(catalog,{disks:[]});const original=io.fingerprint(remote),release=io.lock(catalog);
 try{assert.equal(io.read(remote).disks.length,0);assert.throws(()=>io.write(remote,{disks:[]},original,true),/save locked/);}finally{release();}
 io.write(remote,{disks:[{id:'a',label:'SMB writer',tree:[]}]},original,true);assert.equal(io.read(catalog).disks[0].label,'SMB writer');assert.throws(()=>io.write(catalog,{disks:[]},original,true),/changed/);console.log('PASS SMB: local and UNC writers coordinate; readers work during a lock and stale snapshots cannot overwrite.');
});
