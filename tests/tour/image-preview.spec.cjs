const {test,expect}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs/promises');const {pathToFileURL}=require('node:url');const sharp=require('sharp');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
test('small image surfaces preserve source crops, originals and phone previews',async({},info)=>{
 const fixture=info.outputPath('quadrants.png');await fs.mkdir(path.dirname(fixture),{recursive:true});
 await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="2000"><rect width="2000" height="2000" fill="#ff0000"/><rect x="2000" width="2000" height="2000" fill="#0000ff"/></svg>')).png().toFile(fixture);
 const source=pathToFileURL(fixture).href;const {app,page}=await launchWorkspace(info,30000);
 try{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1366,768);});
  await page.evaluate(async source=>{window.imageStore=(await import('/src/renderer/state/useStore.ts')).useStore;const s=window.imageStore.getState();s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(false);s.setActiveTab('slides');s.setSlideColumns(4);s.dispatchUndo({type:'RESET',payload:{id:'image-preview-test',name:'Image preview',slides:[{id:'plain',type:'image',content:'',mediaUrl:source,styles:{objectFit:'contain'}},{id:'crop',type:'image',content:'',items:[{id:'cropped-image',type:'image',mediaUrl:source,x:0,y:0,width:100,height:100,zIndex:0,imageStyles:{cropMode:'source',crop:{x:0,y:0,width:50,height:100}}}]}]}});s.selectSlides({activeId:'plain',ids:new Set(['plain']),anchorIndex:0});},source);
  const plain=page.locator('[data-slide-id="plain"] img');await expect.poll(()=>plain.evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
  expect(await plain.getAttribute('src')).toMatch(/^local-resource:\/\/thumbs\//);
  expect(await plain.evaluate(el=>el.naturalWidth)).toBeLessThanOrEqual(512);
  const crop=page.locator('[data-slide-id="crop"] svg image');await expect(crop).toBeAttached();
  expect(await crop.getAttribute('href')).toMatch(/^local-resource:\/\/thumbs\//);
  await page.screenshot({path:info.outputPath('small-preview-crop.png')});
  const rendered=await page.locator('[data-slide-id="crop"] .aspect-video').screenshot();const {data,info:dim}=await sharp(rendered).removeAlpha().raw().toBuffer({resolveWithObject:true});const at=(Math.floor(dim.height/2)*dim.width+Math.floor(dim.width/2))*dim.channels;
  expect(data[at]).toBeGreaterThan(220);expect(data[at+2]).toBeLessThan(40);
  // The saved/editor model retains originals; generated previews never enter it.
  expect(await page.evaluate(()=>window.imageStore.getState().presentation.slides[0].mediaUrl)).toBe(source);
  expect(await page.evaluate(()=>window.imageStore.getState().presentation.slides[1].items[0].mediaUrl)).toBe(source);
  await page.evaluate(async()=>{const {generateSlideThumbnail}=await import('/src/renderer/utils.ts');window.encodedPreview=await generateSlideThumbnail(window.imageStore.getState().presentation.slides[0]);});
  expect(await page.evaluate(()=>window.encodedPreview)).toMatch(/^data:image\/webp;base64,/);
  // A larger presentation/broadcast thumbnail requests an appropriately larger source.
  const large=await page.evaluate(async()=>{const {generateSlideThumbnail}=await import('/src/renderer/utils.ts');const uri=await generateSlideThumbnail(window.imageStore.getState().presentation.slides[0],{scale:4});const image=new Image();image.src=uri;await image.decode();return [image.naturalWidth,image.naturalHeight];});
  expect(large).toEqual([1280,720]);expect(errors).toEqual([]);
 }finally{await closeWorkspace(app);}
});
test('visible image requests recover after the bounded queue saturates',async({},info)=>{
 test.setTimeout(90000);
 const fixture=info.outputPath('burst.png');await fs.mkdir(path.dirname(fixture),{recursive:true});
 await sharp({create:{width:2000,height:1000,channels:3,background:'#ff0000'}}).png().toFile(fixture);
 const {app,page}=await launchWorkspace(info,30000);
 try{
  await page.evaluate(async source=>{
   const {useStore}=await import('/src/renderer/state/useStore.ts');const s=useStore.getState();
   s.setLiveSaveEnabled(false);s.setActiveTab('slides');s.setSlideColumns(4);
   s.dispatchUndo({type:'RESET',payload:{id:'burst',name:'Burst',slides:Array.from({length:20},(_,i)=>({id:'burst-'+i,type:'text',content:'',items:Array.from({length:12},(_,j)=>({id:'item-'+j,type:'image',mediaUrl:source+'?variant='+(i*12+j),x:j%4*25,y:Math.floor(j/4)*33,width:25,height:33,zIndex:j}))}))}});
  },pathToFileURL(fixture).href);
  // Lazy images may be outside the viewport; every mounted image must still
  // receive a source after temporary admission pressure clears.
  await expect.poll(()=>page.locator('[data-slide-id^="burst-"] img').count()).toBeGreaterThan(130);
  await expect.poll(()=>page.locator('[data-slide-id^="burst-"] img').evaluateAll(imgs=>imgs.filter(img=>!img.getAttribute('src')).length),{timeout:60000}).toBe(0);
  const stats=await page.evaluate(async()=>{const {imagePreviewSources}=await import('/src/renderer/imagePreviewSource.ts');return imagePreviewSources.snapshot();});
  expect(stats.waiting).toBeLessThanOrEqual(128);expect(stats.running).toBeLessThanOrEqual(2);
 }finally{await closeWorkspace(app);}
});
test('fast scrolling starts small, upgrades when idle and retains loaded quality',async({},info)=>{
 const fixture=info.outputPath('policy.png');await fs.mkdir(path.dirname(fixture),{recursive:true});await sharp({create:{width:2000,height:1000,channels:3,background:'#ff0000'}}).png().toFile(fixture);
 const {app,page}=await launchWorkspace(info,30000);
 try{
  await page.evaluate(async source=>{
   const {mountPreviewPolicyProbe}=await import('/tests/tour/preview-policy-probe.tsx');window.policyProbe=mountPreviewPolicyProbe(source);
  },pathToFileURL(fixture).href);
  await expect.poll(()=>page.locator('[data-policy-source]').evaluate(img=>img.naturalWidth)).toBe(256);
  await page.evaluate(()=>window.policyProbe.idle());
  await expect.poll(()=>page.locator('[data-policy-source]').evaluate(img=>img.naturalWidth)).toBe(1024);
  await page.evaluate(()=>window.policyProbe.scroll());
  await expect.poll(()=>page.locator('[data-policy-source]').evaluate(img=>img.naturalWidth)).toBe(1024);
 }finally{await page.evaluate(()=>window.policyProbe?.close()).catch(()=>{});await closeWorkspace(app);}
});
