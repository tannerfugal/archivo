'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||major===22&&minor<12){console.error('Use Node.js 22.12 or newer (nvm use), then npm ci.');process.exit(1);}
for(const name of ['electron','@playwright/test','electron-builder']){
 try{require.resolve(name,{paths:[root]});}catch{console.error('Missing '+name+'. Run npm ci first.');process.exit(1);}
}
let count=0;
for(const dir of ['src','test','scripts'])for(const name of fs.readdirSync(path.join(root,dir)).filter(name=>name.endsWith('.js'))){
 const result=spawnSync(process.execPath,['--check',path.join(root,dir,name)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);count++;
}
const packageInfo=require('../package.json'),lock=require('../package-lock.json');
if(packageInfo.version!==lock.version||packageInfo.version!==lock.packages[''].version){console.error('Package and lockfile versions differ.');process.exit(1);}
for(const file of ['build/icon.icns','build/icon.ico','build/entitlements.mac.plist','src/assets/app-icon.png'])if(!fs.existsSync(path.join(root,file))){console.error('Missing build asset: '+file);process.exit(1);}
console.log('Setup OK: Node '+process.versions.node+', dependencies, build assets and '+count+' JavaScript files checked.');
