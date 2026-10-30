const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');

test('slides per row fills flat and section grids across window sizes',async({},info)=>{
  test.setTimeout(180000);let app;
  const measurements=[];
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{
      window.__columnsStore=(await import('/src/renderer/state/useStore.ts')).useStore;
      const s=window.__columnsStore.getState();s.setLiveSaveEnabled(false);s.setActiveTab('slides');s.setIsRightPanelOpen(true);
      s.dispatchUndo({type:'RESET',payload:{id:'columns-e2e',name:'Columns',slides:Array.from({length:30},(_,i)=>({id:'columns-'+i,type:'text',content:'Slide '+i,styles:{fontSize:80,textColor:'#fff',backgroundColor:'#000'}}))}});
      s.selectSlides({activeId:'columns-0',ids:new Set(['columns-0']),anchorIndex:0});
    });
    const control=await app.browserWindow(page);
    const selectColumns=async count=>{
      const current=await page.evaluate(()=>window.__columnsStore.getState().slideColumns);
      const action=count>current?'increase':'decrease';
      for(let step=0;step<Math.abs(count-current);step++)await page.locator('[data-columns-action="'+action+'"]').click();
      await expect(page.locator('.design-slide-columns output')).toContainText(String(count));
      await expect(page.locator('[data-columns-action="decrease"]')).toBeEnabled({enabled:count>1});
      await expect(page.locator('[data-columns-action="increase"]')).toBeEnabled({enabled:count<8});
    };
    for(const width of [1920,1366,1024,800]){
      await control.evaluate((win,width)=>{win.unmaximize();win.webContents.setZoomFactor(1);win.setContentSize(width,900);},width);
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(width);
      await page.evaluate(width=>window.__columnsStore.getState().setIsRightPanelOpen(width>=1024),width);
      for(const sections of [false,true]){
        await page.evaluate(sections=>window.__columnsStore.getState().setServiceSectionsEnabled(sections),sections);
        const scroll=page.locator('.design-slide-grid>[data-guide-scroll]');
        await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
        for(let count=1;count<=8;count++){
          await selectColumns(count);
          const card=page.locator('[data-slide-id="columns-0"]');
          await expect.poll(()=>card.evaluate((el,count)=>{
            let row=el.parentElement;while(row&&getComputedStyle(row).display!=='grid')row=row.parentElement;
            const tracks=getComputedStyle(row).gridTemplateColumns.split(' ');
            return tracks.length===count&&Math.abs(row.clientWidth-(el.getBoundingClientRect().width*count+12*(count-1)))<1;
          },count)).toBe(true);
          measurements.push({windowWidth:width,sections,count,width:await card.evaluate(el=>el.getBoundingClientRect().width)});
          expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
          if(width===1920&&[3,4,6].includes(count))await page.screenshot({path:info.outputPath('columns-'+(sections?'sections':'flat')+'-'+count+'.png')});
        }
        if(!sections){
          await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
          const ghost=page.locator('[data-guide-anchor="add-slide"]');await expect(ghost).toBeVisible();
          expect(await ghost.evaluate(el=>el.getBoundingClientRect().width)).toBeCloseTo(measurements.at(-1).width,1);
        }
      }
    }
    await page.evaluate(()=>{
      const s=window.__columnsStore.getState();s.setServiceSectionsEnabled(false);s.setSlideColumns(3);
      s.dispatchUndo({type:'RESET',payload:{id:'deep-columns',name:'Deep columns',slides:Array.from({length:1000},(_,i)=>({id:'deep-'+i,type:'text',content:'Slide '+i,styles:{fontSize:80,textColor:'#fff',backgroundColor:'#000'}}))}});
      s.selectSlides({activeId:'deep-0',ids:new Set(['deep-0']),anchorIndex:0});
    });
    const scroll=page.locator('.design-slide-grid>[data-guide-scroll]');
    await expect(page.locator('[data-slide-id="deep-0"]')).toBeVisible();
    await scroll.evaluate(el=>{el.scrollTop=Math.floor(el.scrollHeight*.8);el.dispatchEvent(new Event('scroll'));});
    await expect.poll(()=>page.locator('[data-slide-id="deep-0"]').count()).toBe(0);
    const anchor=await scroll.evaluate(el=>{
      const view=el.getBoundingClientRect();
      return [...el.querySelectorAll('[data-slide-id]')].find(card=>card.getBoundingClientRect().bottom>view.top+16)?.dataset.slideId;
    });
    expect(anchor).toBeTruthy();
    await selectColumns(6);
    await expect(page.locator('[data-slide-id="'+anchor+'"]')).toBeInViewport();
    const before=await page.evaluate(()=>JSON.stringify(window.__columnsStore.getState().presentation));
    await page.locator('[data-columns-action="increase"]').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+0');
    await expect.poll(()=>page.evaluate(()=>window.__columnsStore.getState().slideColumns)).toBe(6);
    // Keyboard commands outside the selector control the count, not hidden percentage state.
    await scroll.focus();
    await page.locator('[data-slide-id="'+anchor+'"]').focus();
    await page.keyboard.press('Control+0');
    await expect.poll(()=>page.evaluate(()=>window.__columnsStore.getState().slideColumns)).toBe(4);
    expect(await page.evaluate(()=>JSON.stringify(window.__columnsStore.getState().presentation))).toBe(before);
    require('node:fs').writeFileSync(info.outputPath('columns-measurements.json'),JSON.stringify(measurements,null,2));
  }finally{await closeWorkspace(app);}
});
