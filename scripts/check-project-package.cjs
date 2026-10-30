const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const asar=require('@electron/asar');
(async()=>{
 const root=path.resolve(process.argv[2]||'release/gpres-project-20261028'),archive=path.join(root,'win-unpacked/resources/app.asar');
 const config=require('../package.json').build.fileAssociations.find(x=>x.ext==='gpres');assert.equal(config.name,'WorshipPresentationAssistant.Project');assert.equal(config.icon,'gpres');
 const icon=await fs.readFile('build/gpres.ico');assert.equal(icon.readUInt16LE(2),1);assert.equal(icon.readUInt16LE(4),6);
 const script=await fs.readFile(path.join(root,'builder-debug.yml'),'utf8');assert.ok(script.includes('resources\\gpres.ico'));assert.ok(script.includes('APP_ASSOCIATE "gpres" "WorshipPresentationAssistant.Project"'));assert.ok(script.includes('%1'));
 let checked=0;
 async function compare(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await compare(file);else {const packed=asar.extractFile(archive,file);assert.ok(packed.equals(await fs.readFile(file)),'Stale packaged asset: '+file);checked++;}}}
 await compare('dist');await compare('dist-electron');
 console.log(JSON.stringify({checkedAssets:checked,fileAssociation:config.name,documentIconFrames:6,latestBundlesMatch:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
