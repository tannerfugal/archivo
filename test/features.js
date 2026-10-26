/* Real Electron UI integration via Playwright. All file fixtures are disposable. */
'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {scanVolume}=require('../src/scanner'),io=require('../src/catalog-io');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-ui-')),a=path.join(root,'Camera originals'),b=path.join(root,'Archive copy'),file=path.join(root,'Studio.archivo');
  fs.mkdirSync(a);fs.mkdirSync(b);fs.mkdirSync(path.join(a,'Project'));fs.mkdirSync(path.join(a,'Audio'));
  fs.writeFileSync(path.join(a,'Project','master.mov'),Buffer.alloc(16000000,1));fs.writeFileSync(path.join(b,'renamed-master.mov'),Buffer.alloc(16000000,1));
  fs.writeFileSync(path.join(a,'Project','proxy.mp4'),Buffer.alloc(9000000,2));fs.writeFileSync(path.join(a,'Audio','mix.wav'),Buffer.alloc(4000000,3));fs.writeFileSync(path.join(b,'different.mov'),Buffer.alloc(16000000,4));
  const disks=[];for(const[id,label,dir]of[['a','Camera originals',a],['b','Archive copy',b]]){const scan=await scanVolume(dir);disks.push({id,label,total:'1 TB',free:'200 GB',scanned:new Date().toISOString(),file_count:scan.fileCount,tree:scan.tree});}io.write(file,{disks});
  let app;
  try{
    const project=path.resolve(__dirname,'..');
    app=await electron.launch({executablePath:process.env.ARCHIVO_APP_EXECUTABLE || undefined,args:process.env.ARCHIVO_APP_EXECUTABLE?[file]:[project,file],env:{...process.env,ARCHIVO_TEST_MODE:'1',ARCHIVO_TEST_DATA:path.join(root,'app-data')},timeout:60000});
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof docOpen!=='undefined'&&docOpen===true);await expect(page.getByRole('button',{name:'Storage Map',exact:true})).toBeVisible();
    assert.ok((await page.title()).includes('Archivo Fork'));assert.ok(page.url().startsWith('file:'));
    await app.evaluate(async({app},data)=>{const service=app.__archivoTestService;await service.bind('a',data.a);await service.bind('b',data.b);},{a,b});
    await page.getByRole('button',{name:'Storage Map',exact:true}).click();await expect(page.getByRole('heading',{name:'Storage Map',exact:true})).toBeVisible();
    await expect(page.locator('#storage-map .map-tile')).toHaveCount(2);
    await page.locator('#storage-map .map-tile').filter({hasText:'Camera originals'}).dblclick();await expect(page.getByText('Last scan:',{exact:false})).toBeVisible();
    await page.locator('#storage-map .map-tile').filter({hasText:'Project'}).click();await expect(page.locator('#map-detail')).toContainText('Project');
    await page.locator('#map-detail').getByRole('button',{name:'Open folder',exact:true}).click();await expect(page.locator('#storage-map .map-tile')).toHaveCount(2);
    if(process.env.ARCHIVO_SCREENSHOTS){fs.mkdirSync(process.env.ARCHIVO_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'storage-map.png')});}
    await page.getByRole('button',{name:'Duplicates',exact:true}).click();await page.getByRole('button',{name:'Find possible copies',exact:true}).click();await expect(page.locator('#duplicate-results')).toContainText('size group(s)',{timeout:60000});await expect(page.locator('#duplicate-results input:checked')).toHaveCount(0);
    await page.getByRole('button',{name:'Verify contents',exact:true}).click();await expect(page.locator('#duplicate-results .verified')).toHaveCount(2,{timeout:120000});await expect(page.locator('#duplicate-results')).toContainText('Different');
    await expect(page.locator('#duplicate-results input:checked')).toHaveCount(0);await expect(page.locator('#duplicate-results input:not([disabled])')).toHaveCount(2);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'duplicates.png')});
    // Only the disposable generated duplicate is eligible for this real OS Trash test.
    await app.evaluate(({app})=>{app.__archivoTestService.confirmTrash=async()=>true;});
    const cleanup=await page.evaluate(async()=>{const copy=forkDuplicateReport.groups.flatMap(g=>g.items).find(i=>i.diskId==='b'&&i.status==='Verified');return window.archivo.trashCopies(forkDuplicateReport.id,[copy.id]);});
    assert.ok(fs.existsSync(path.join(a,'Project','master.mov')));
    if(cleanup.removed){assert.equal(fs.existsSync(path.join(b,'renamed-master.mov')),false);await page.evaluate(()=>saveCatalog());console.log('PASS real OS Trash: disposable duplicate recycled; verified original retained.');}
    else{assert.ok(cleanup.failures.length);assert.ok(fs.existsSync(path.join(b,'renamed-master.mov')));console.log('OS Trash unavailable: safe failure preserved disposable files.');}
    await page.getByRole('button',{name:'Schedules',exact:true}).click();await expect(page.getByRole('heading',{name:'Schedules',exact:true})).toBeVisible();
    await expect(page.getByRole('checkbox',{name:'Enable this schedule',exact:true})).not.toBeChecked();
    await page.getByRole('checkbox',{name:'Enable this schedule',exact:true}).check();await page.getByRole('button',{name:'Create schedule',exact:true}).click();await expect(page.getByRole('button',{name:'Run now',exact:true})).toBeVisible();
    fs.writeFileSync(path.join(a,'new-file.txt'),'new data');
    await page.getByRole('button',{name:'Run now',exact:true}).click();await expect(page.getByText('2 source(s) updated',{exact:false}).first()).toBeVisible({timeout:120000});
    assert.ok(io.read(file).disks.find(d=>d.id==='a').tree.some(n=>n.name==='new-file.txt'));assert.ok(fs.readdirSync(file+'.backups').length);
    await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Enable',exact:true})).toBeVisible();
    // Lost roots leave the previous disk tree intact; a mounted local volume alone is insufficient.
    const expectedB=io.read(file).disks.find(d=>d.id==='b').tree.length;
    fs.renameSync(b,b+'-offline');await page.getByRole('button',{name:'Run now',exact:true}).click();await expect(page.getByText('1 source(s) updated',{exact:false}).first()).toBeVisible({timeout:120000});assert.equal(io.read(file).disks.find(d=>d.id==='b').tree.length,expectedB);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'schedules.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,700));
    await page.getByRole('button',{name:'Storage Map',exact:true}).click();await expect(page.locator('#storage-map')).toBeVisible();
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,panel:document.getElementById('fork-panel').getBoundingClientRect().right}));assert.ok(bounds.scroll<=bounds.width);assert.ok(bounds.panel<=bounds.width);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'storage-map-1100.png')});
    assert.deepEqual(errors,[]);console.log('PASS Electron UI: source links, map drill-down, possible/verified copies, safe defaults, schedule save/run/pause, offline preservation, backups, 1100px layout, no renderer errors.');
  }finally{if(app){const timer=setTimeout(()=>app.process().kill(),5000);await app.close().catch(()=>{});clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
