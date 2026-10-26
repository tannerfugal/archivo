'use strict';
const {_electron:electron}=require('@playwright/test');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const io=require('../src/catalog-io');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-background-')),file=path.join(root,'Empty.archivo');io.write(file,{disks:[]});let app;
 try{
  const env={...process.env,ARCHIVO_TEST_DATA:path.join(root,'state')};delete env.ARCHIVO_TEST_MODE;
  app=await electron.launch({executablePath:process.env.ARCHIVO_APP_EXECUTABLE || undefined,args:process.env.ARCHIVO_APP_EXECUTABLE?[file]:[path.resolve(__dirname,'..'),file],env,timeout:60000});
  const page=await app.firstWindow();await page.waitForFunction(()=>typeof docOpen!=='undefined'&&docOpen===true);
  const hidden=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.close();return {visible:win.isVisible(),count:BrowserWindow.getAllWindows().length};});
  assert.equal(hidden.visible,false);assert.equal(hidden.count,1);
  const shown=await app.evaluate(({app,BrowserWindow})=>{app.emit('activate');return BrowserWindow.getAllWindows()[0].isVisible();});assert.equal(shown,true);
  console.log('PASS background lifecycle: closing window hides it without discarding the catalog or quitting; activate reopens it.');
 }finally{if(app){const timer=setTimeout(()=>app.process().kill(),5000);await app.close().catch(()=>{});clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
