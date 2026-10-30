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
      await page.bringToFront();
      await page.waitForFunction(()=>{
        let element=document.querySelector('.design-slide-grid');
        if(!element)return false;
        for(;element;element=element.parentElement)if(parseFloat(getComputedStyle(element).opacity)<0.99)return false;
        return true;
      });
      // Measure scrolling after startup fonts and finite layout animations settle.
      await page.evaluate(async()=>{
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
      });
      const toolbar=page.locator('.design-toolbar');await expect(toolbar).toBeVisible();
      const metrics=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect();return{overflow:el.scrollWidth>el.clientWidth,buttons:[...el.querySelectorAll('button')].filter(b=>b.getClientRects().length&&b.getBoundingClientRect().width>0).map(b=>{const x=b.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1;})};});
      expect(metrics.overflow).toBe(false);expect(metrics.buttons.every(Boolean)).toBe(true);
      await expect(toolbar.locator('.design-undo')).toHaveCount(0);
      await expect(page.locator('.design-searchbar .design-search-history')).toBeVisible();
      await expect(page.locator('.design-search-navigation>span')).toHaveCount(0);
      await expect(page.locator('.design-search-history>span')).toHaveCount(0);
      const historyBounds=await page.locator('.design-search-history').boundingBox();
      const inputBounds=await page.locator('#slide-search').boundingBox();
      expect(inputBounds.x+inputBounds.width).toBeLessThanOrEqual(historyBounds.x);
      await expect(toolbar.locator('.design-navigation')).toHaveCount(0);
      if(width>=1024)await expect(page.locator('.design-searchbar .design-search-navigation')).toBeVisible();
      const broadcast=page.locator('[data-testid="broadcast-controls"]:visible');
      await expect(broadcast).toHaveCount(1);
      const broadcastBounds=await broadcast.boundingBox();
      const previewBounds=await page.locator('.design-live-preview').boundingBox();
      expect(broadcastBounds.y+broadcastBounds.height).toBeLessThanOrEqual(previewBounds.y+1);
      await expect(toolbar.locator('.design-document-status .output-status-items')).toBeVisible();
      await expect(page.locator('.output-status-bar')).toHaveCount(0);
      if(width>=1024){
        const live=await toolbar.locator('.design-broadcast-button').boundingBox();
        expect(broadcastBounds.x+broadcastBounds.width).toBeLessThanOrEqual(live.x);
      }
      expect(broadcastBounds.x+broadcastBounds.width).toBeLessThanOrEqual(width);
      const heading=await page.locator('.design-editor-heading').boundingBox();
      const position=await page.locator('.inspector-slide-position').boundingBox();
      expect(position.x+position.width).toBeLessThanOrEqual(heading.x+heading.width+1);
      expect(position.y).toBeGreaterThanOrEqual(heading.y);
      expect(position.y+position.height).toBeLessThanOrEqual(heading.y+heading.height+1);
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
    // The same controls stay available when the narrow inspector is closed.
    await page.evaluate(()=>window.__layoutStore.getState().setIsRightPanelOpen(false));
    const searchInput=page.locator('#slide-search');
    await searchInput.fill('Second slide');
    await expect(page.locator('[data-slide-id="one"]')).toHaveCount(0);
    await expect(page.locator('[data-slide-id="two"]')).toBeVisible();
    await page.locator('.slide-search-clear').click();
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('[data-slide-id="one"]')).toBeVisible();
    const broadcast=page.locator('[data-testid="broadcast-controls"]:visible');
    await expect(broadcast).toHaveCount(1);
    await expect(page.locator('.design-output>.broadcast-controls')).toBeVisible();
    const closedMetrics=await page.locator('.design-toolbar').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,buttons:[...el.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect().right<=el.getBoundingClientRect().right+1)}));
    expect(closedMetrics.overflow).toBe(false);expect(closedMetrics.buttons.every(Boolean)).toBe(true);
    await page.evaluate(()=>window.__layoutStore.getState().selectSlides({activeId:'two',ids:new Set(['two']),anchorIndex:1}));
    await broadcast.getByRole('button').nth(1).click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().liveIndex)).toBe(1);
    const navigation=page.locator('.design-search-navigation');
    await navigation.getByRole('button').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().liveIndex)).toBe(0);
    await navigation.getByRole('button').nth(1).click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().liveIndex)).toBe(1);
    await page.evaluate(()=>{const s=window.__layoutStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,name:'History check'}});});
    const history=page.locator('.design-search-history');
    await history.getByRole('button').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().presentation.name)).toBe('Layout');
    await history.getByRole('button').nth(1).click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().presentation.name)).toBe('History check');
    expect(await page.evaluate(()=>window.__layoutStore.getState().liveIndex)).toBe(1);
    const effect=page.locator('.effect-select-trigger').first();
    await effect.click();
    await expect(page.locator('.effect-select-popup')).toBeVisible();
    const effectBounds=await page.locator('.effect-select-popup').boundingBox();
    expect(effectBounds.y).toBeGreaterThanOrEqual(0);
    expect(effectBounds.y+effectBounds.height).toBeLessThanOrEqual(601);
    await page.screenshot({path:info.outputPath('effect-menu-800.png')});
    await page.keyboard.press('Escape');
    await expect(effect).toBeFocused();
    await page.evaluate(()=>window.__layoutStore.getState().selectSlides({activeId:'one',ids:new Set(['one']),anchorIndex:0}));
    await page.mouse.move(0,0);
    await effect.press('ArrowDown');
    await expect(page.locator('.effect-select-popup')).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.locator('[role="option"][data-value="flip"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().presentation.transition?.type)).toBe('flip');
    expect(await page.evaluate(()=>window.__layoutStore.getState().selectedSlideId)).toBe('one');
    expect(await page.evaluate(()=>window.__layoutStore.getState().liveIndex)).toBe(1);
    await page.locator('.effect-select-trigger').nth(1).click();
    await page.locator('[role="option"][data-value="600"]').click();
    await expect.poll(()=>page.evaluate(()=>window.__layoutStore.getState().presentation.transition?.duration)).toBe(600);
    await broadcast.getByRole('button').first().click();
    await expect(broadcast.getByRole('button').first()).toHaveAttribute('aria-pressed','true');
    await broadcast.getByRole('button').first().click();
    await expect(broadcast.getByRole('button').first()).toHaveAttribute('aria-pressed','false');
    await page.evaluate(()=>window.__layoutStore.getState().toggleSlideLock('two'));
    await expect(broadcast.getByRole('button').nth(1)).toBeDisabled();
    await expect(broadcast.getByRole('button').first()).toBeEnabled();
  }finally{await closeWorkspace(app);}
});


test('control hints open on focus and hover, close on Escape and scroll, and preserve real button layout',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{
      const s=(await import('/src/renderer/state/useStore.ts')).useStore.getState();window.__uxStore=(await import('/src/renderer/state/useStore.ts')).useStore;
      await window.__tourTest.language('en');s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(false);s.setUiMotionEnabled(false);
      s.dispatchUndo({type:'RESET',payload:{id:'ux-hints',name:'Hints',slides:[{id:'one',type:'text',content:'First slide'},{id:'two',type:'text',content:'Second slide'}]}});
      s.selectSlides({activeId:'one',ids:new Set(['one']),anchorIndex:0});
    });
    const more=page.locator('[data-columns-action="increase"]');
    await expect(more).not.toHaveAttribute('title');
    await page.keyboard.press('Tab');await more.focus();
    const hint=page.getByRole('tooltip');await expect(hint).toContainText('More slides per row');
    expect(await more.evaluate(el=>el.parentElement.classList.contains('design-slide-columns'))).toBe(true);
    const ids=await page.evaluate(()=>[...window.__uxStore.getState().selectedSlideIds]);
    await page.keyboard.press('Escape');await expect(hint).toHaveCount(0);
    expect(await page.evaluate(()=>[...window.__uxStore.getState().selectedSlideIds])).toEqual(ids);
    await page.locator('.slide-search-input').focus();await more.hover();await expect(hint).toBeVisible();
    await page.locator('.design-slide-grid>[data-guide-scroll]').evaluate(el=>el.dispatchEvent(new Event('scroll')));
    await expect(hint).toHaveCount(0);
    const copy=page.locator('.design-selection-actions button').nth(2);
    await page.keyboard.press('Tab');await copy.focus();await expect(hint).toContainText('Ctrl+D');
    await page.keyboard.press('Escape');
    const less=page.locator('[data-columns-action="decrease"]');
    await page.evaluate(()=>window.__uxStore.getState().setSlideColumns(1));await expect(less).toBeDisabled();
    await less.hover();await expect(hint).toHaveCount(0);
    await more.hover();await expect(hint).toBeVisible();
    await page.evaluate(()=>window.__uxStore.getState().setSlideColumns(8));await expect(hint).toHaveCount(0);
    await page.locator('.slide-search-input').focus();await page.keyboard.press('Tab');
    await page.locator('.design-slide-grid > [data-guide-scroll]').click({position:{x:5,y:5}});
    await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>window.__uxStore.getState().selectedSlideIds.size)).toBe(0);
    await page.evaluate(()=>{const s=window.__uxStore.getState();s.selectSlides({activeId:'one',ids:new Set(['one']),anchorIndex:0});s.setSlideColumns(4);});
    // Search empty states have an action in both layouts and restore input focus.
    for(const sections of [false,true]){
      await page.evaluate(sections=>window.__uxStore.getState().setServiceSectionsEnabled(sections),sections);
      const search=page.locator('.slide-search-input');await search.fill('unfindable-xyz');
      const empty=page.getByTestId('slides-empty-search');await expect(empty).toContainText('No matching slides found.');
      await page.evaluate(()=>{const s=window.__uxStore.getState();s.selectSlides({activeId:'two',ids:new Set(['two']),anchorIndex:1});s.setLiveIndex(0);});
      await empty.getByRole('button').focus();await page.keyboard.press('Enter');await expect(search).toHaveValue('');await expect(search).toBeFocused();
      expect(await page.evaluate(()=>window.__uxStore.getState().liveSlideId)).toBe('one');
      await expect(page.locator('[data-slide-id="one"]')).toBeVisible();
    }
    await page.screenshot({path:info.outputPath('ux-controls.png')});
  }finally{await closeWorkspace(app);}
});

test('important notifications persist independently of undo feedback and can be dismissed',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{window.__uxStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');window.__uxStore.getState().setUiMotionEnabled(false);});
    await page.clock.install();
    await page.evaluate(()=>{const s=window.__uxStore.getState();s.setToastMessage('displayDisconnected');s.dispatchUndo({type:'SET',payload:{...s.presentation,name:'Notification followed by edit'}});});
    const alert=page.getByTestId('important-notification');await expect(alert).toHaveRole('alert');await expect(alert).toContainText('A display was disconnected');
    await page.clock.fastForward(10000);await expect(alert).toBeVisible();
    await page.evaluate(()=>window.__uxStore.getState().setToastMessage('undoNotification'));
    const transient=page.getByTestId('transient-notification');await expect(transient).toBeVisible();await expect(alert).toBeVisible();
    await page.clock.fastForward(2500);await expect(transient).toHaveCount(0);await expect(alert).toBeVisible();
    await page.screenshot({path:info.outputPath('persistent-warning.png')});
    const liveBefore=await page.evaluate(()=>window.__uxStore.getState().liveSlideId);
    await alert.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter');await expect(alert).toHaveCount(0);
    expect(await page.evaluate(()=>window.__uxStore.getState().liveSlideId)).toBe(liveBefore);
    await page.evaluate(()=>window.__uxStore.getState().setToastMessage('Phone sharing failed: test error'));
    await expect(alert).toContainText('Phone sharing failed: test error');await page.clock.fastForward(10000);await expect(alert).toBeVisible();
    await alert.getByRole('button').click();await expect(alert).toHaveCount(0);
  }finally{await closeWorkspace(app);}
});


test('shared icon hints cover sidebar, style controls and composed toolbar popovers without changing actions',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{
      window.__hintStore=(await import('/src/renderer/state/useStore.ts')).useStore;
      const s=window.__hintStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(true);s.setUiMotionEnabled(false);
      s.dispatchUndo({type:'RESET',payload:{id:'all-hints',name:'Hints',slides:[{id:'one',type:'text',content:'First slide'},{id:'two',type:'text',content:'Second slide'}]}});
      s.selectSlides({activeId:'two',ids:new Set(['two']),anchorIndex:1});s.setLiveIndex(0);
    });
    const tooltip=page.getByRole('tooltip');
    for(const lang of ['tr','en','de','es','ko']){
      await page.evaluate(lang=>window.__tourTest.language(lang),lang);
      const nav=page.locator('[data-guide-anchor="nav-slides"]');
      await page.keyboard.press('Tab');await nav.focus();
      await expect(tooltip).toContainText(await nav.getAttribute('aria-label'));await expect(tooltip).toHaveAttribute('data-side','right');
      await page.keyboard.press('Escape');
      const upper=page.locator('[aria-pressed][aria-label]').filter({hasText:'AA'}).last();
      await upper.focus();await expect(tooltip).toContainText(await upper.getAttribute('aria-label'));
      await page.keyboard.press('Escape');
    }
    await page.evaluate(()=>window.__tourTest.language('en'));
    const upper=page.getByRole('button',{name:'Uppercase',exact:true});
    await upper.focus();await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>window.__hintStore.getState().presentation.slides[1].styles?.textTransform)).toBe('uppercase');
    expect(await page.evaluate(()=>window.__hintStore.getState().liveSlideId)).toBe('one');
    const gradient=page.getByTestId('gradient-quick-apply');await gradient.focus();await expect(tooltip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.base-popover-popup')).toBeVisible();await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Escape');await expect(page.locator('.base-popover-popup')).toHaveCount(0);
    const music=page.getByTestId('background-music-toggle');await music.focus();await expect(tooltip).toBeVisible();
    await page.keyboard.press('Enter');await expect(page.getByTestId('music-dialog-close')).toBeVisible();
    await page.getByTestId('music-dialog-close').click();await expect(music).toBeFocused();
    // Ref composition must also preserve output-menu opening and closing.
    await page.evaluate(()=>window.__hintStore.getState().setDisplays([{id:'external',label:'External',isPrimary:false,scaleFactor:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1080}}]));
    const output=page.locator('.design-connections button').first();await output.focus();await expect(tooltip).toBeVisible();
    await page.keyboard.press('Enter');await expect(page.locator('.base-popover-popup')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('.base-popover-popup')).toHaveCount(0);
    await page.screenshot({path:info.outputPath('shared-icon-hints.png')});
  }finally{await closeWorkspace(app);}
});


test('narrow toolbars expose overflow and keep focused actions clear of the edge buttons',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(800,600);});
    await page.evaluate(async()=>{window.__toolsStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');const s=window.__toolsStore.getState();s.setActiveTab('slides');s.setIsRightPanelOpen(false);s.setLiveSaveEnabled(false);s.setUiMotionEnabled(false);s.dispatchUndo({type:'RESET',payload:{id:'tools',name:'Tools',slides:[{id:'a',type:'text',content:'A'},{id:'b',type:'text',content:'B'}]}});s.selectSlides({activeId:'a',ids:new Set(['a']),anchorIndex:0});});
    const bar=page.locator('.design-searchbar');await bar.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event('scroll'));});
    const right=page.getByRole('button',{name:'Show more tools',exact:true});await expect(right).toBeVisible();
    expect((await page.locator('#slide-search').boundingBox()).width).toBeGreaterThan(160);
    const before=(await bar.boundingBox()).height;
    await right.click();await expect.poll(()=>bar.evaluate(el=>el.scrollLeft)).toBeGreaterThan(100);
    await expect(page.getByRole('button',{name:'Show previous tools',exact:true})).toBeVisible();
    await bar.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event('scroll'));});
    await page.keyboard.press('Tab');
    const remove=page.locator('.design-selection-actions button').last();await remove.focus();
    await expect(remove).toBeFocused();
    const bounds=await bar.boundingBox(),button=await remove.boundingBox();expect(button.x+button.width).toBeLessThanOrEqual(bounds.x+bounds.width-8);
    await expect(right).toBeHidden();
    await expect(page.getByRole('tooltip')).toContainText('Delete');await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__toolsStore.getState().selectSlides({ids:new Set(['a','b'])}));
    expect((await bar.boundingBox()).height).toBe(before);
    await page.screenshot({path:info.outputPath('toolbar-overflow-800.png')});
  }finally{await closeWorkspace(app);}
});

test('action menus support keyboard navigation, focus return and safe single-action application',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{window.__menuStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');const s=window.__menuStore.getState();s.setActiveTab('slides');s.setIsRightPanelOpen(true);s.setLiveSaveEnabled(false);s.setUiMotionEnabled(false);s.dispatchUndo({type:'RESET',payload:{id:'menus',name:'Menus',sections:[{id:'alpha',title:'Alpha'},{id:'beta',title:'Beta'}],slides:[{id:'a',type:'text',content:'A',sectionId:'alpha',styles:{fontSize:50}},{id:'b',type:'text',content:'B',sectionId:'alpha',styles:{fontSize:90}},{id:'c',type:'text',content:'C',sectionId:'beta',styles:{fontSize:40}}]}});s.selectSlides({activeId:'b',ids:new Set(['b']),anchorIndex:1});s.setLiveIndex(0);});
    const apply=page.locator('.apply-styles-dropdown button').first();await apply.scrollIntoViewIfNeeded();await apply.focus();await page.keyboard.press('ArrowDown');
    let menu=page.getByRole('menu');await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(apply).toBeFocused();
    await apply.click();const text=menu.getByRole('menuitem').filter({hasText:'Text'}).first();await text.click();
    await expect(menu).toHaveCount(0);expect(await page.evaluate(()=>window.__menuStore.getState().presentation.slides.map(s=>s.styles.fontSize))).toEqual([90,90,90]);
    expect(await page.evaluate(()=>window.__menuStore.getState().liveSlideId)).toBe('a');
    await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>window.__menuStore.getState().presentation.slides.map(s=>s.styles.fontSize))).toEqual([50,90,40]);
    await page.evaluate(()=>window.__menuStore.getState().setServiceSectionsEnabled(true));
    const actions=page.locator('[data-section-actions="alpha"]');await actions.focus();await page.keyboard.press('ArrowDown');
    menu=page.getByRole('menu');await expect(menu.getByRole('menuitem').first()).toBeFocused();
    const disabled=menu.locator('[data-disabled]');await expect(disabled).toHaveCount(1);
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();await page.keyboard.press('Home');
    expect(await page.evaluate(()=>window.__menuStore.getState().selectedSlideId)).toBe('b');
    await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(menu).toHaveCount(0);
    await dialog.getByLabel('Close',{exact:true}).click();await expect(actions).toBeFocused();
    await page.evaluate(()=>window.__menuStore.getState().setActiveTab('media'));
    const media=page.locator('[data-guide-anchor="media-menu"]');await media.focus();await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(3);
    await page.keyboard.press('End');await expect(page.getByRole('menu').getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(media).toBeFocused();
  }finally{await closeWorkspace(app);}
});


test('status text is readable and configuration selections remain neutral without changing live or lock emphasis',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{
      window.__readableStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');const s=window.__readableStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(true);s.setUiMotionEnabled(false);
      s.dispatchUndo({type:'RESET',payload:{id:'readable-ui',name:'Readable UI',slides:[{id:'a',type:'text',content:'Live text'},{id:'image',type:'image',content:'',mediaUrl:'',styles:{objectFit:'contain',imageFlipX:true}},{id:'loop',type:'loop',content:'',loopItems:[{id:'clip',type:'video',mediaUrl:'',fileName:'Example video clip',duration:5000,useVideoDuration:true}]}]}});
      s.selectSlides({activeId:'image',ids:new Set(['image']),anchorIndex:1});s.setLiveIndex(0);
    });
    const status=page.locator('.output-status-items');expect(await status.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
    const positions=page.locator('.inspector-slide-position');expect(await positions.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
    const details=page.locator('.design-image-settings');await details.locator('summary').click();
    const selected=details.locator('button[aria-pressed="true"]');await expect(selected).toHaveCount(2);
    for(const button of await selected.all()){
      const rgb=await button.evaluate(el=>getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number));
      expect(rgb[0]).toBe(rgb[1]);expect(rgb[1]).toBe(rgb[2]);
    }
    const fit=details.locator('[data-guide-anchor="image-fit"]');await expect(fit).toHaveAttribute('aria-pressed','true');
    // Controls keep their existing action; the style change is independent of playback.
    await details.locator('button[aria-pressed="true"]').last().click();
    await expect.poll(()=>page.evaluate(()=>window.__readableStore.getState().presentation.slides[1].styles.imageFlipX)).toBe(false);
    expect(await page.evaluate(()=>window.__readableStore.getState().liveSlideId)).toBe('a');
    await page.evaluate(()=>{const s=window.__readableStore.getState();s.selectSlides({activeId:'loop',ids:new Set(['loop']),anchorIndex:2});});
    const name=page.locator('.inspector-item-name');await expect(name).toHaveText('Example video clip');
    expect(await name.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
    await expect(page.getByRole('button',{pressed:true}).filter({hasText:'▶'})).toHaveClass(/workspace-selected-option/);
    const metrics=await page.locator('.output-status-items, .inspector-item-name').evaluateAll(elements=>{
      const rgba=c=>{const n=c.match(/[\d.]+/g).map(Number);return [n[0],n[1],n[2],n[3]??1];};
      const mix=(fg,bg)=>fg.slice(0,3).map((c,i)=>c*fg[3]+bg[i]*(1-fg[3]));
      const lum=rgb=>rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
      return elements.map(el=>{
        let chain=[],node=el;while(node){chain.unshift(node);node=node.parentElement;}
        let bg=[0,0,0];for(const n of chain)bg=mix(rgba(getComputedStyle(n).backgroundColor),bg);
        const fg=mix(rgba(getComputedStyle(el).color),bg);const a=lum(fg),b=lum(bg);
        return {text:el.textContent,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    });
    for(const metric of metrics)expect(metric.contrast).toBeGreaterThanOrEqual(4.5);
    require('node:fs').writeFileSync(info.outputPath('readability-metrics.json'),JSON.stringify(metrics,null,2));
    await page.screenshot({path:info.outputPath('readable-inspector.png')});
  }finally{await closeWorkspace(app);}
});

test('remaining section and image menus support keyboard, safe dismissal and dialog focus return',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{window.__finalUx=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');const s=window.__finalUx.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setUiMotionEnabled(false);s.setIsRightPanelOpen(true);s.setServiceSectionsEnabled(true);s.dispatchUndo({type:'RESET',payload:{id:'final-menus',name:'Menus',sections:[{id:'alpha',title:'Alpha'},{id:'beta',title:'Beta'}],slides:[{id:'a',type:'image',content:'',sectionId:'alpha',styles:{objectFit:'cover'}},{id:'b',type:'image',content:'',sectionId:'beta',styles:{objectFit:'contain'}}]}});s.selectSlides({activeId:'a',ids:new Set(['a']),anchorIndex:0});s.setLiveIndex(1);});
    const outline=page.locator('[data-testid="section-workspace"] button').filter({hasText:'Presentation outline'}).first();
    await outline.focus();await page.keyboard.press('ArrowDown');
    let menu=page.getByRole('menu');await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(outline).toBeFocused();
    const card=page.locator('[data-slide-id="a"]');await card.focus();await page.keyboard.press('Shift+F10');
    menu=page.getByRole('menu');await expect(menu.getByRole('menuitem')).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(card).toBeFocused();
    await card.click({button:'right'});await expect(menu).toBeVisible();await menu.getByRole('menuitem').click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(menu).toHaveCount(0);await dialog.getByLabel('Close',{exact:true}).click();await expect(card).toBeFocused();
    const apply=page.locator('.design-image-inspector .apply-styles-dropdown button').first();
    // The inspector class may vary with the selected slide; use its unique apply menu when needed.
    const trigger=await apply.count()?apply:page.locator('.design-editor-scroll .apply-styles-dropdown button').first();
    await trigger.scrollIntoViewIfNeeded();await trigger.focus();await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem')).toHaveCount(3);await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    await trigger.click();await menu.getByRole('menuitem').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__finalUx.getState().presentation.slides.map(s=>s.styles.objectFit))).toEqual(['cover','cover']);
    await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>window.__finalUx.getState().presentation.slides.map(s=>s.styles.objectFit))).toEqual(['cover','contain']);
    expect(await page.evaluate(()=>window.__finalUx.getState().liveSlideId)).toBe('b');
    await card.click({button:'right'});await menu.getByRole('menuitem').click();
    await dialog.getByLabel('Destination section').selectOption('beta');await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.__finalUx.getState().presentation.slides.find(s=>s.id==='a').sectionId)).toBe('beta');
    await expect(page.locator('[data-slide-id="a"]')).toBeFocused();
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(800,600);});
    await page.evaluate(()=>window.__finalUx.getState().setIsRightPanelOpen(false));
    await outline.scrollIntoViewIfNeeded();await outline.click();await expect(menu).toBeVisible();
    const bounds=await menu.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(800);expect(bounds.y+bounds.height).toBeLessThanOrEqual(600);
    await page.keyboard.press('Escape');await expect(outline).toBeFocused();

  }finally{await closeWorkspace(app);}
});

test('informational phone notices are polite and temporary while errors remain persistent',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{window.__noticeStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');window.__noticeStore.getState().setUiMotionEnabled(false);});
    await page.clock.install();const notice=page.getByTestId('important-notification');
    await page.evaluate(()=>window.__noticeStore.getState().setToastMessage('phoneShareLocalOnly','info'));
    await expect(notice).toHaveRole('status');await expect(notice).toContainText('same local network');await expect(notice).not.toHaveClass(/bg-red/);
    await page.clock.fastForward(6001);await expect(notice).toHaveCount(0);
    await page.evaluate(()=>window.__noticeStore.getState().setToastMessage('phoneShareLocalOnly','info'));await page.clock.fastForward(5000);
    await page.evaluate(()=>window.__noticeStore.getState().setToastMessage('Phone failure','error'));await page.clock.fastForward(10000);
    await expect(notice).toHaveRole('alert');await expect(notice).toHaveText(/Phone failure/);
    await page.evaluate(()=>window.__noticeStore.getState().setToastMessage('phoneShareLocalOnly','info'));await expect(notice).toHaveText(/Phone failure/);
    await notice.getByRole('button').click();await expect(notice).toHaveCount(0);
  }finally{await closeWorkspace(app);}
});

test('font size stepper keeps large neutral targets and supports typing, keyboard and undo',async({},info)=>{
  let app;
  try{
    const fixture=await launchWorkspace(info,60000);app=fixture.app;const page=fixture.page;
    await page.evaluate(async()=>{window.__fontStore=(await import('/src/renderer/state/useStore.ts')).useStore;await window.__tourTest.language('en');const s=window.__fontStore.getState();s.setActiveTab('slides');s.setIsRightPanelOpen(true);s.setLiveSaveEnabled(false);s.setUiMotionEnabled(false);s.dispatchUndo({type:'RESET',payload:{id:'font-stepper',name:'Font',slides:[{id:'a',type:'text',content:'Sample',styles:{fontSize:48}},{id:'b',type:'text',content:'Live'}]}});s.selectSlides({activeId:'a',ids:new Set(['a']),anchorIndex:0});s.setLiveIndex(1);});
    const input=page.locator('#slide-font-size'),plus=page.getByRole('button',{name:'Increase font size',exact:true}),minus=page.getByRole('button',{name:'Decrease font size',exact:true});
    await plus.click();await expect(input).toHaveValue('49');await minus.click();await expect(input).toHaveValue('48');
    await input.fill('72');await expect.poll(()=>page.evaluate(()=>window.__fontStore.getState().presentation.slides[0].styles.fontSize)).toBe(72);
    await plus.focus();await page.keyboard.press('Enter');await expect(input).toHaveValue('73');expect(await page.evaluate(()=>window.__fontStore.getState().liveSlideId)).toBe('b');
    await plus.focus();await page.keyboard.press('Control+z');await expect(input).toHaveValue('72');
    for(const [w,h]of [[1366,768],[800,600]]){
      await app.evaluate(({BrowserWindow},size)=>{const win=BrowserWindow.getAllWindows()[0];win.unmaximize();win.setContentSize(...size);},[w,h]);
      await input.scrollIntoViewIfNeeded();const field=await page.locator('.design-font-size').boundingBox(),a=await minus.boundingBox(),b=await plus.boundingBox(),n=await input.boundingBox();
      expect(a.width).toBeGreaterThanOrEqual(32);expect(a.height).toBeGreaterThanOrEqual(32);expect(b.width).toBeGreaterThanOrEqual(32);expect(n.width).toBeGreaterThanOrEqual(32);expect(a.x+a.width).toBeLessThanOrEqual(n.x+1);expect(n.x+n.width).toBeLessThanOrEqual(b.x+1);expect(field.x+field.width).toBeLessThanOrEqual(w);
      await page.locator('.design-font-size').screenshot({path:info.outputPath(`font-size-${w}.png`)});
    }
  }finally{await closeWorkspace(app);}
});
