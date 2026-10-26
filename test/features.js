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
    console.log('UI launched');const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);console.log('UI first window');page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof docOpen!=='undefined'&&docOpen===true);await expect(page.getByRole('button',{name:'Storage Map',exact:true})).toBeVisible();
    assert.ok((await page.title()).includes('Archivo Fork'));assert.ok(page.url().startsWith('file:'));
    console.log('UI catalog loaded');await app.evaluate(async({app},data)=>{const service=app.__archivoTestService;await service.bind('a',data.a);await service.bind('b',data.b);},{a,b});
    console.log('UI sources linked');
    // Exercise the real add dialog and native folder-picker IPC, including scanning and update.
    await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},a);
    await page.locator('#btn-add-disk').click();await expect(page.locator('#btn-pick-source')).toBeVisible();
    await page.locator('#btn-hide-system').click();if(await page.locator('#vol-list .vol-item').count()){await page.locator('#vol-list .vol-item').first().click();await expect(page.locator('#scan-root')).not.toContainText('Select a mounted');}
    console.log('UI picker click');await page.locator('#btn-pick-source').click();await expect(page.locator('#scan-root')).toContainText(path.basename(a),{timeout:60000});
    await expect(page.locator('#add-label')).toHaveValue('Camera originals');console.log('UI picker selected');await page.locator('#btn-confirm-add').click();await expect(page.getByRole('button',{name:'Update',exact:true})).toBeVisible({timeout:60000});await page.getByRole('button',{name:'Update',exact:true}).click();await expect(page.locator('#add-modal')).toBeHidden();await page.evaluate(()=>saveCatalog());
    console.log('UI scan finished');
    await app.evaluate(({app,shell})=>{const service=app.__archivoTestService;shell.showItemInFolder=file=>{app.__lastReveal=file;};app.__unblockRevealTest=null;service.jobs.pending=new Promise(resolve=>{app.__unblockRevealTest=resolve;});});
    const reveal=await page.evaluate(()=>window.archivo.revealSource('a',['Project','master.mov']));assert.ok(reveal.timings.queue>=0);assert.ok(reveal.timings.resolution>=0);console.log('UI Reveal timings (ms)',JSON.stringify(reveal.timings));
    assert.equal(await app.evaluate(({app})=>app.__lastReveal),fs.realpathSync(path.join(a,'Project','master.mov')));await app.evaluate(({app})=>{app.__unblockRevealTest();delete app.__unblockRevealTest;});
    // Organize through the bulk dialog; the two scopes intersect without mutating disk storage.
    await page.locator('.org-heading').filter({hasText:'Physical location'}).getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Group name',{exact:true}).fill('Office');await page.getByRole('button',{name:'Save group',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Organize drives…',exact:true}).click();await page.locator('#organize-drives input[value="a"]').check();await page.locator('#organize-drives input[value="b"]').uncheck();await page.locator('#organize-drives select').first().selectOption('servers');await page.getByRole('checkbox',{name:'Set physical location',exact:true}).check();await page.locator('#organize-drives select').nth(1).selectOption({label:'Office'});await page.getByRole('button',{name:'Apply to selected drives'}).click();
    await page.getByRole('button',{name:'Servers',exact:true}).click();await page.getByRole('button',{name:'Office',exact:true}).click();await page.getByRole('button',{name:'Archive drives',exact:true}).click();assert.equal(await page.evaluate(()=>scopedDisks().length),0);await page.getByRole('button',{name:'Servers',exact:true}).click();assert.equal(await page.evaluate(()=>DB.disks.length),2);assert.equal(await page.evaluate(()=>scopedDisks().length),1);
    await page.getByRole('button',{name:'Storage Map',exact:true}).click();await expect(page.getByRole('heading',{name:'Storage Map',exact:true})).toBeVisible();
    await expect(page.locator('#storage-map .map-tile').filter({hasText:'master.mov'})).toBeVisible();await expect(page.locator('#storage-map .map-tile[data-level="1"]')).not.toHaveCount(0);
    await expect(page.getByText('Last scan:',{exact:false})).toBeVisible();await page.locator('#storage-map .map-tile').filter({hasText:'Project'}).locator('.map-label').click();await expect(page.locator('#map-detail')).toContainText('Project');
    await page.locator('#map-detail').getByRole('button',{name:'Open folder',exact:true}).click();await expect(page.locator('#storage-map .map-tile')).toHaveCount(2);
    await page.getByRole('button',{name:'Reset scope',exact:true}).click();await page.getByRole('button',{name:'Catalog',exact:true}).click();
    await page.locator('#search-options summary').click();await page.locator('#search-path').fill('Project');await page.locator('#search-path').dispatchEvent('change');await expect(page.locator('#sc')).toHaveText('3 results');
    await page.locator('#search-inp').fill('MASTER.MOV');await page.locator('#search-exact').check();await expect(page.locator('#sc')).toHaveText('1 results');await page.getByRole('button',{name:'Reset search',exact:true}).click();await page.locator('#search-options summary').click();
    await page.evaluate(()=>saveCatalog());
    await page.getByRole('button',{name:'Storage Map',exact:true}).click();
    if(process.env.ARCHIVO_SCREENSHOTS){fs.mkdirSync(process.env.ARCHIVO_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'storage-map.png')});}
    await page.getByRole('button',{name:'Duplicates',exact:true}).click();await page.getByRole('button',{name:'Find possible copies',exact:true}).click();await expect(page.locator('#duplicate-results')).toContainText('match group(s)',{timeout:60000});await expect(page.locator('#duplicate-results input:checked')).toHaveCount(0);
    await page.getByRole('button',{name:'Verify contents',exact:true}).click();await expect(page.locator('#duplicate-results .verified')).toHaveCount(2,{timeout:120000});await expect(page.locator('#duplicate-results')).not.toContainText('Different');await expect(page.locator('#duplicate-results .duplicate-group')).toHaveCount(1);await page.getByRole('checkbox',{name:'Show other results',exact:false}).check();await expect(page.locator('#duplicate-results')).toContainText('Different');await page.getByRole('checkbox',{name:'Show other results',exact:false}).uncheck();
    await expect(page.locator('#duplicate-results input:checked')).toHaveCount(0);await expect(page.locator('#duplicate-results input[data-copy-id]:not([disabled])')).toHaveCount(2);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'duplicates.png')});
    const group=page.locator('#duplicate-results .duplicate-group').first();await group.locator('input').first().check();await group.locator('summary').click();await group.locator('summary').click();await expect(group.locator('input').first()).toBeChecked();await group.locator('input').first().uncheck();
    // Whole-group paging keeps explicit selections, including while their page is hidden.
    await page.evaluate(()=>{window.__realReport=forkDuplicateReport;const template=forkDuplicateReport.groups[0].items.filter(i=>i.status==='Verified');forkDuplicateReport={...forkDuplicateReport,groups:Array.from({length:25},(_,i)=>({size:16000000,items:template.map((item,j)=>({...item,id:'fixture-'+i+'-'+j,hash:'content-'+i}))}))};forkDuplicateSelections.clear();forkDuplicatePage=0;renderDuplicateResults();});
    await expect(page.locator('#duplicate-results .duplicate-group')).toHaveCount(20);await page.locator('#duplicate-results input[data-copy-id]').first().check();await page.locator('#duplicate-results').getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('#duplicate-results .duplicate-group')).toHaveCount(5);await expect(page.locator('#duplicate-results .duplicate-group').first().locator('input[data-copy-id]')).toHaveCount(2);await page.locator('#duplicate-results').getByRole('button',{name:'Previous',exact:true}).click();await expect(page.locator('#duplicate-results input[data-copy-id]').first()).toBeChecked();
    await page.evaluate(()=>{forkDuplicateReport=window.__realReport;delete window.__realReport;forkDuplicateSelections.clear();forkDuplicatePage=0;renderDuplicateResults();});
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
    assert.equal(io.read(file).disks.find(d=>d.id==='a').categoryId,'servers');assert.ok(io.read(file).disks.find(d=>d.id==='a').locationId);assert.ok(io.read(file).organization.categories.some(n=>n.id==='servers'));assert.ok(io.read(file).disks.find(d=>d.id==='a').tree.some(n=>n.name==='new-file.txt'));assert.ok(fs.readdirSync(file+'.backups').length);
    await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Enable',exact:true})).toBeVisible();
    // Lost roots leave the previous disk tree intact; a mounted local volume alone is insufficient.
    const expectedB=io.read(file).disks.find(d=>d.id==='b').tree.length;
    fs.renameSync(b,b+'-offline');await page.getByRole('button',{name:'Run now',exact:true}).click();await expect(page.getByText('1 source(s) updated',{exact:false}).first()).toBeVisible({timeout:120000});assert.equal(io.read(file).disks.find(d=>d.id==='b').tree.length,expectedB);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'schedules.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,700));
    await page.getByRole('button',{name:'Storage Map',exact:true}).click();await expect(page.locator('#storage-map')).toBeVisible();
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,panel:document.getElementById('fork-panel').getBoundingClientRect().right}));assert.ok(bounds.scroll<=bounds.width);assert.ok(bounds.panel<=bounds.width);
    if(process.env.ARCHIVO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.ARCHIVO_SCREENSHOTS,'storage-map-1100.png')});
    const saveAs=path.join(root,'Copy.archivo');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saveAs);assert.equal(await page.evaluate(()=>saveCatalogAs()),true);assert.ok(io.read(saveAs).organization.locations.some(n=>n.name==='Office'));assert.equal(io.read(saveAs).disks[0].categoryId,'servers');const links=await page.evaluate(()=>window.archivo.toolsStatus());assert.ok(links.sources.find(s=>s.id==='a').binding);
    const csvFile=path.join(root,'Export.csv');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},csvFile);await page.evaluate(()=>exportCsv());assert.ok(fs.readFileSync(csvFile,'utf8').includes('Servers,Office'));
    assert.deepEqual(errors,[]);console.log('PASS Electron UI: source links, map drill-down, possible/verified copies, safe defaults, schedule save/run/pause, offline preservation, backups, 1100px layout, no renderer errors.');
  }catch(e){if(app){try{const p=await app.firstWindow();await p.screenshot({path:path.join(os.tmpdir(),'archivo-beta2-ui-failure.png'),timeout:3000});}catch{}}throw e;}finally{if(app){const timer=setTimeout(()=>app.process().kill('SIGKILL'),5000);await app.close().catch(()=>{});clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
