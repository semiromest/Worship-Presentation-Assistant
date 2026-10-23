const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
test('slides workspace keeps live controls fixed and selection tools stable across sizes',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{
      window.__layoutStore=(await import('/src/renderer/state/useStore.ts')).useStore;
      const s=window.__layoutStore.getState();s.setActiveTab('slides');s.setIsRightPanelOpen(true);s.setLiveSaveEnabled(false);s.setIsProjectorWindowOpen(false);
      s.dispatchUndo({type:'RESET',payload:{id:'workspace-layout',name:'Layout',slides:[
        {id:'one',type:'text',content:'Workspace layout',styles:{fontSize:70,textColor:'#fff',backgroundColor:'#000'}},
        {id:'two',type:'text',content:'Second slide',styles:{fontSize:90,textColor:'#fff',backgroundColor:'#000'}},
      ]}});s.selectSlides({activeId:'one',ids:new Set(['one']),anchorIndex:0});
    });
    for(const language of ['tr','de'])for(const [width,height]of [[1920,1080],[1366,768],[1024,768],[800,600]]){
      await page.evaluate(language=>window.__tourTest.language(language),language);
      await app.evaluate(({BrowserWindow},{width,height})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(width,height);},{width,height});
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(width);
      const toolbar=page.locator('.design-toolbar');await expect(toolbar).toBeVisible();
      const metrics=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect();return{overflow:el.scrollWidth>el.clientWidth,buttons:[...el.querySelectorAll('button')].filter(b=>b.getClientRects().length&&b.getBoundingClientRect().width>0).map(b=>{const x=b.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1;})};});
      expect(metrics.overflow).toBe(false);expect(metrics.buttons.every(Boolean)).toBe(true);
      const editor=page.locator('.design-editor-scroll');expect(await editor.evaluate(el=>el.clientHeight)).toBeGreaterThan(130);
      const before=await page.locator('.design-live-core').boundingBox();
      await editor.evaluate(el=>el.scrollTop=el.scrollHeight);const after=await page.locator('.design-live-core').boundingBox();
      expect(Math.abs(before.y-after.y)).toBeLessThan(1);expect(after.y+after.height).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));
      await editor.evaluate(el=>el.scrollTop=0);
      const search=await page.locator('.design-searchbar').boundingBox();
      await page.evaluate(()=>window.__layoutStore.getState().selectSlides({ids:new Set(['one','two'])}));
      const multi=await page.locator('.design-searchbar').boundingBox();expect(Math.abs(search.height-multi.height)).toBeLessThan(1);
      await page.evaluate(()=>window.__layoutStore.getState().selectSlides({ids:new Set(['one'])}));
      await page.screenshot({path:info.outputPath(`workspace-${language}-${width}.png`)});
    }
  }finally{await closeWorkspace(app);}
});
