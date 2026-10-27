/* Shared catalogs remain local snapshots until the user chooses to reload. */
'use strict';
let forkSharedStatus=null;
function forkCatalogStatus(status){
 if(status.path!==docPath&&status.path!==null)return;
 forkSharedStatus=status;
 const banner=g('catalog-shared-status');banner.hidden=!status.changed&&!status.unavailable;
 g('catalog-shared-message').textContent=status.unavailable?'Catalog file unavailable. You can keep searching the loaded snapshot.':status.changed?'A newer catalog is available. Your current search uses the version you opened.':'';
 g('catalog-reload').disabled=!!forkBusy||status.unavailable;
}
function reloadSharedCatalog(){
 if(!docPath||busy())return;const original=docPath;
 if(!dirty){openCatalog(original);return;}
 showModal('Reload the shared catalog?','You have unsaved edits. Save a separate copy to keep them before loading the newer version.',[
  {label:'Cancel',cls:'btn-g',fn:hideModal},
  {label:'Save a copy',cls:'btn-p',fn:async()=>{hideModal();if(await saveCatalogAs(true))openCatalog(original);}},
  {label:'Discard edits and reload',cls:'btn-r',fn:()=>{hideModal();markClean();openCatalog(original);}},
 ]);
}
const checkCatalogButton=fb('Check catalog updates',async()=>{if(!docPath)return;const status=await fa.checkCatalog();forkCatalogStatus(status);if(!status.changed&&!status.unavailable)toast('This catalog is up to date.','ok');});
checkCatalogButton.id='fork-check-catalog';checkCatalogButton.disabled=!docPath;g('fork-nav').insertBefore(checkCatalogButton,g('fork-job-status'));
g('catalog-reload').onclick=reloadSharedCatalog;g('catalog-save-copy').onclick=()=>saveCatalogAs(true);
fa.onFork('catalog-status',forkCatalogStatus);
fa.onFork('status',()=>{if(forkSharedStatus)forkCatalogStatus(forkSharedStatus);});
