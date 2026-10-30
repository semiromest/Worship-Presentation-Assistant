let testInfo;
const path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const {test,_electron:electron,expect}=require('@playwright/test');const root=path.resolve('.');let app,media;
async function main(){
  const wav=require('./workspace-test-utils.cjs').silentWav();
  media=http.createServer((_,r)=>{r.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length});r.end(wav);});await new Promise(r=>media.listen(0,'127.0.0.1',r));
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5199')).ok;}catch{return false;}},{timeout:45000}).toBe(true);
  const env={...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5199'};delete env.ELECTRON_RUN_AS_NODE;
  env.WPA_TEST_PROFILE=testInfo.outputPath('profile');
  app=await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs')],cwd:root,env});
  await app.evaluate(({ipcMain},url)=>{
    global.__attachmentPlays=[];
    for(const name of ['youtube-music:search','youtube-music:play','youtube-music:prepare','youtube-music:stop'])ipcMain.removeHandler(name);
    ipcMain.handle('youtube-music:search',()=>({ok:true,results:[{id:'KI33ItOO_M4',title:'Bağlanan müzik',duration:60},{id:'SIfMHRHdTAI',title:'Başka müzik',duration:60}]}));
    ipcMain.handle('youtube-music:prepare',()=>({ok:true}));ipcMain.handle('youtube-music:stop',()=>{});
    ipcMain.handle('youtube-music:play',async(_,id)=>{global.__attachmentPlays.push(id);if(global.__holdPreview)await new Promise(r=>setTimeout(r,800));return{ok:true,streamId:'fixture-'+id,url:url+'/'+id};});
  },`http://127.0.0.1:${media.address().port}`);
  const page=await app.firstWindow();page.setDefaultTimeout(10000);await page.waitForFunction(()=>!!window.__tourTest);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1366,768);});
  await page.evaluate(async()=>{
    await window.__tourTest.language('tr');window.__attachStore=(await import('/src/renderer/state/useStore.ts')).useStore;const s=window.__attachStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(true);s.setIsProjectorWindowOpen(false);window.__attachStore.setState({autoGoLive:false});
    s.dispatchUndo({type:'RESET',payload:{id:'attach-test',name:'Slayt müziği',slides:[
      {id:'text',type:'text',content:'Metin ve görünüm korunur',styles:{fontSize:70,textColor:'#fff',backgroundColor:'#123456',backgroundImage:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/%3E'}},
      {id:'image',type:'image',content:'Resim',mediaUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="9"%3E%3Crect width="16" height="9" fill="navy"/%3E%3C/svg%3E'},
      {id:'countdown',type:'countdown',content:'Geri sayım'},
      {id:'video',type:'video',content:'Video'}, {id:'screen',type:'screen',content:'screen:1'},
      {id:'hymn',type:'text',content:'Kıta',partsMode:true,parts:['Kıta','Nakarat'],group:{id:'h',title:'İlahi',part:1,parts:2}},
      {id:'split-hymn',type:'text',content:'Ayrı kıta',group:{id:'h2',title:'İlahi',part:1,parts:2,color:'#abc',kind:'hymn'}},
      {id:'video-loop',type:'loop',content:'Video döngüsü',loopItems:[{id:'v',type:'video',mediaUrl:'',duration:10}]},
    ]}});s.setLiveIndex(0);
  });
  const select=async id=>{await page.evaluate(id=>{const s=window.__attachStore.getState();s.selectSlides({activeId:id,ids:new Set([id]),anchorIndex:s.presentation.slides.findIndex(x=>x.id===id)});},id);};
  const plays=()=>app.evaluate(()=>global.__attachmentPlays.length);
  const audio=page.getByTestId('background-music-audio');
  for(const id of ['video','screen','video-loop']){await select(id);await expect(page.getByTestId('slide-music-attachment')).toHaveCount(0);}
  for(const id of ['text','image','countdown','hymn','split-hymn']){await select(id);await expect(page.getByTestId('slide-music-add')).toBeVisible();}
  await select('text');const original=await page.evaluate(()=>window.__attachStore.getState().presentation.slides[0]);
  const attach=async(change=false,track='KI33ItOO_M4')=>{
    await page.getByTestId(change?'slide-music-change':'slide-music-add').click();await expect(page.getByRole('dialog')).toHaveAccessibleName('Seçili slayta müzik ekle');await expect(page.getByTestId('music-source-local')).toHaveCount(0);
    const query=page.getByTestId('youtube-music-query');await query.fill('müzik');await query.press('Enter');await expect(page.getByTestId('youtube-add-slide-'+track)).toHaveText('Bu slayta bağla');await page.getByTestId('youtube-add-slide-'+track).click();await expect(page.getByRole('dialog')).toBeHidden();
  };
  await attach();await expect(page.getByTestId('slide-music-autoplay')).not.toBeChecked();
  await expect(page.locator('#background-dim')).toHaveCount(0);await expect(page.getByRole('button',{name:require('../../src/renderer/locales/tr/translation.json').common.removeImage,exact:true})).toBeAttached();
  const attached=await page.evaluate(()=>window.__attachStore.getState().presentation.slides[0]);expect(attached.content).toBe(original.content);expect(attached.styles).toEqual(original.styles);expect(await page.evaluate(()=>window.__attachStore.getState().presentation.slides.length)).toBe(8);expect(await plays()).toBe(0);
  await page.evaluate(()=>window.__attachStore.getState().setIsProjectorWindowOpen(true));await expect(page.getByTestId('slide-music-play')).toBeEnabled();expect(await plays()).toBe(0);
  await page.getByTestId('slide-music-play').click();await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);expect(await plays()).toBe(1);
  await page.getByTestId('background-music-toggle').click();await page.getByTestId('background-music-stop').click();await page.getByTestId('music-dialog-close').click();
  await page.getByTestId('slide-music-autoplay').check();expect(await plays()).toBe(1);
  await select('image');expect(await plays()).toBe(1);
  await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(1));await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(0));await expect.poll(plays).toBe(2);
  await select('text');await page.getByTestId('slide-music-autoplay').uncheck();expect(await plays()).toBe(2);
  await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(1));await expect(audio).not.toHaveAttribute('src');await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(0));expect(await plays()).toBe(2);
  await attach(true,'SIfMHRHdTAI');expect(await plays()).toBe(2);expect(await page.evaluate(()=>window.__attachStore.getState().presentation.slides[0].content)).toBe(original.content);
  await select('image');await attach();await page.getByTestId('slide-music-autoplay').check();expect(await plays()).toBe(2);
  await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(1));await expect.poll(plays).toBe(3);await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
  await page.getByTestId('slide-music-remove').click();await expect(page.getByTestId('slide-music-add')).toBeVisible();await expect(audio).not.toHaveAttribute('src');
  await page.keyboard.press('Control+z');await expect(page.getByTestId('slide-music-autoplay')).toBeChecked();expect(await plays()).toBe(3);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,600));await page.getByTestId('slide-music-attachment').scrollIntoViewIfNeeded();await page.getByTestId('slide-music-attachment').screenshot({path:testInfo.outputPath('slide-audio-800.png')});
  const bounds=await page.getByTestId('slide-music-attachment').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1366,768));
  await page.evaluate(()=>{const s=window.__attachStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:s.presentation.slides.map(x=>({...x,youtubeMusic:undefined,musicSettings:undefined}))}});s.setLiveIndex(0);});
  await app.evaluate(()=>global.__holdPreview=true);await page.getByTestId('background-music-toggle').click();
  await page.getByTestId('youtube-music-query').fill('müzik');await page.getByTestId('youtube-music-query').press('Enter');await page.getByTestId('youtube-result-KI33ItOO_M4').click();await page.getByTestId('music-dialog-close').click();
  await page.evaluate(()=>window.__attachStore.getState().setLiveIndex(1));await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
  await page.getByTestId('background-music-toggle').click();await page.getByTestId('background-music-stop').click();await page.getByTestId('music-dialog-close').click();
  await page.getByTestId('slide-music-add').click();await page.getByTestId('youtube-music-query').fill('müzik');await page.getByTestId('youtube-music-query').press('Enter');await page.getByTestId('youtube-result-KI33ItOO_M4').click();await page.getByTestId('youtube-add-slide-KI33ItOO_M4').click();
  await expect(page.getByTestId('slide-music-autoplay')).not.toBeChecked();await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
  fs.writeFileSync(testInfo.outputPath('slide-audio-report.json'),JSON.stringify({passed:true,plays:await plays(),checks:['excluded types','attach preserves appearance and count','no selection autoplay','manual play','autoplay on live entry only','toggle no start','image playback','replace','remove and undo do not auto-start','800px compact UI']},null,2));
  console.log('PASS: eligible/excluded types, shared modal, metadata preservation, manual/automatic live playback, no selection/toggle/undo auto-start, removal, compact 800px UI');
}
test("slide music attachments preserve content and autoplay only on live entry", async ({}, info) => { testInfo=info;try { await main(); } finally { if(app){await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});await app.close().catch(()=>{});}if(media)await new Promise(r=>media.close(r)); } });
