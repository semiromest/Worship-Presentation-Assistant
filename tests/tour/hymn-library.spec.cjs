const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
const seed=Array.from({length:2817},(_,i)=>({id:`library-${i}`,title:i===0?'Beni Sevdin Rab':i===1?'Çok uzun ilahi adı '.repeat(12):`İlahi ${i}`,lyrics:`\nİlk dize ${i}\nYalnız sözlerde bulunur ${i}`,author:i%3?'Ali Övek ve Diğer Yazarlar '.repeat(i===1?8:1):undefined,source:i%4?'TY621, RT7, TY527, RT38':undefined}));
async function setup(info,records=seed){const f=await launchWorkspace(info,30000);await f.page.evaluate(async records=>{
  await window.__tourTest.language('tr');window.__hymnStore=(await import('/src/renderer/state/useStore.ts')).useStore;
  window.__hymnStore.getState().setActiveTab('slides');localStorage.removeItem('defaultHymnArchivePath');localStorage.setItem('hymnsCache:v3:__online__',JSON.stringify(records));
  window.__hymnStore.getState().setActiveTab('hymns');
},records);await expect(f.page.locator('[data-hymn-id="'+records[0].id+'"]')).toBeVisible();return f;}
const row=(page,id)=>page.locator(`[data-hymn-id="${id}"]`);
test('hymn pointer activation adds immediately once without changing live',async({},info)=>{
  let app;
  try{
    const f=await setup(info,[{id:'click-hymn',title:'Tek tıklama ilahisi',lyrics:'Birinci dize\nİkinci dize'}]);app=f.app;const page=f.page;
    const before=await page.evaluate(()=>{const s=window.__hymnStore.getState();return{count:s.presentation.slides.length,live:s.liveSlideId};});
    // Check state in the same task as the click: a delayed callback cannot satisfy this.
    const after=await row(page,'click-hymn').locator('[data-hymn-action=add]').evaluate(button=>{
      button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      const s=window.__hymnStore.getState();return{count:s.presentation.slides.length,live:s.liveSlideId,tab:s.activeTab};
    });
    expect(after.count).toBe(before.count+1);expect(after.live).toBe(before.live);expect(after.tab).toBe('slides');
    await page.evaluate(()=>window.__hymnStore.getState().setActiveTab('hymns'));
    await row(page,'click-hymn').locator('[data-hymn-action=add]').dblclick({delay:100});
    await expect.poll(()=>page.evaluate(()=>window.__hymnStore.getState().activeTab)).toBe('slides');
    const doubled=await page.evaluate(()=>{const s=window.__hymnStore.getState();return{count:s.presentation.slides.length,live:s.liveSlideId};});
    expect(doubled.count).toBe(after.count+1);expect(doubled.live).toBe(before.live);
  }finally{await closeWorkspace(app);}
});

test('hymn library layout, zoom, virtualization, tooltip and focus survive container changes',async({},info)=>{
  test.setTimeout(180000);let app;
  try{const f=await setup(info);app=f.app;const page=f.page;const measurements=[];
    for(const [width,height]of [[1920,1080],[1366,768],[1024,768],[800,600]])for(const zoom of [1,1.25,1.5]){
      await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(width,height);w.webContents.setZoomFactor(zoom);},{width,height,zoom});
      await page.waitForTimeout(120);
      const m=await page.locator('.hymn-library').evaluate(el=>{const list=el.querySelector('[data-testid="hymn-list"]'),r=el.querySelector('.hymn-row'),h=el.querySelector('.hymn-column-header');return{width:el.clientWidth,row:r.getBoundingClientRect().height,wide:getComputedStyle(h).display!=='none',count:el.querySelectorAll('.hymn-row').length,expected:Math.ceil(list.clientHeight/r.getBoundingClientRect().height)+11,overflow:el.scrollWidth>el.clientWidth,listOverflow:list.scrollWidth>list.clientWidth,buttons:[...el.querySelectorAll('.hymn-row-actions button')].every(b=>{const r=b.getBoundingClientRect();return r.width>=32&&r.height>=32&&r.right<=innerWidth;})};});
      expect(m.overflow).toBe(false);expect(m.listOverflow).toBe(false);expect(m.buttons).toBe(true);expect(m.row).toBe(m.wide?56:72);expect(m.count).toBeLessThanOrEqual(m.expected);measurements.push({width,height,zoom,...m});
      if(zoom===1)await page.screenshot({path:info.outputPath(`hymns-${width}.png`)});
    }
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setContentSize(1366,768);});
    for(const [width,wide]of [[967,false],[969,true]]){
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,768),width);
      await expect.poll(()=>page.locator('.hymn-column-header').evaluate(el=>getComputedStyle(el).display!=='none')).toBe(wide);
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1366,768));
    await page.locator('[data-testid="hymn-list"]').evaluate(el=>el.scrollTop=56*100);
    await expect(row(page,'library-100')).toBeVisible();
    await row(page,'library-100').locator('[data-hymn-action=edit]').focus();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,600));
    await expect(row(page,'library-100').locator('[data-hymn-action=edit]')).toBeFocused();
    await expect.poll(()=>page.locator('[data-testid="hymn-list"]').evaluate(el=>Math.floor(el.scrollTop/72))).toBe(100);
    await page.locator('[data-testid="hymn-list"]').evaluate(el=>el.scrollTop=0);
    await row(page,'library-1').locator('[data-hymn-action=add]').focus();await expect(page.getByRole('tooltip')).toBeVisible();await expect(page.getByRole('tooltip')).toContainText(seed[1].title);
    const tip=page.getByRole('tooltip');const tipBox=await tip.boundingBox();expect(tipBox.y).toBeGreaterThanOrEqual(0);expect(tipBox.y+tipBox.height).toBeLessThanOrEqual(600);
    await tip.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.locator('[data-testid="hymn-list"]').evaluate(el=>el.scrollTop=72*2000);
    await expect(row(page,'library-1').locator('[data-hymn-action=add]')).toBeFocused();
    expect(await page.locator('.hymn-row').count()).toBeLessThan(35);
    // Tab must cross beyond the mounted range, then Shift+Tab must return.
    await row(page,'library-1').locator('[data-hymn-action=remove]').focus();await page.keyboard.press('Tab');await expect(row(page,'library-2').locator('[data-hymn-action=add]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(row(page,'library-1').locator('[data-hymn-action=remove]')).toBeFocused();
    for(const language of ['en','de','es','ko','tr']){
      await page.evaluate(language=>window.__tourTest.language(language),language);
      expect(await page.locator('.hymn-library').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    }
    require('fs').writeFileSync(info.outputPath('layout-metrics.json'),JSON.stringify(measurements,null,2));
  }finally{await closeWorkspace(app);}
});

test('new hymn, independent delete focus and clear confirmation preserve the library',async({},info)=>{
  let app;
  try{const f=await setup(info,[{id:'a',title:'A ilahisi',lyrics:'Birinci söz'},{id:'b',title:'B ilahisi',lyrics:'İkinci söz'},{id:'c',title:'C ilahisi',lyrics:'Üçüncü söz'}]);app=f.app;const page=f.page;
    await row(page,'b').locator('[data-hymn-action=remove]').focus();await page.keyboard.press('Enter');
    await expect(row(page,'c').locator('[data-hymn-action=add]')).toBeFocused();
    await row(page,'c').locator('[data-hymn-action=remove]').focus();await page.keyboard.press('Space');
    await expect(row(page,'a').locator('[data-hymn-action=add]')).toBeFocused();
    await page.getByRole('button',{name:'Yeni İlahi',exact:true}).click();
    await page.locator('#new-hymn-title').fill('Yeni Kütüphane İlahisi');await page.locator('#new-hymn-author').fill('Yeni Yazar');await page.locator('#new-hymn-lyrics').fill('Yeni sözler');
    await page.getByRole('button',{name:'EKLE',exact:true}).click();await expect(page.locator('[data-hymn-id]')).toHaveCount(2);
    expect(await page.evaluate(()=>window.__hymnStore.getState().activeTab)).toBe('hymns');
    await app.evaluate(({dialog})=>{global.__clearPrompts=0;global.__confirmClear=false;dialog.showMessageBox=async()=>{global.__clearPrompts++;return{response:global.__confirmClear?1:0};};});
    await page.getByRole('button',{name:'Temizle',exact:true}).click();await expect(page.locator('[data-hymn-id]')).toHaveCount(2);
    expect(await app.evaluate(()=>global.__clearPrompts)).toBe(1);
    await app.evaluate(()=>global.__confirmClear=true);await page.getByRole('button',{name:'Temizle',exact:true}).click();await expect(page.locator('[data-hymn-id]')).toHaveCount(0);
    expect(await app.evaluate(()=>global.__clearPrompts)).toBe(2);
  }finally{await closeWorkspace(app);}
});

test('hymn library search, sorting, edit focus, add and deletion persistence',async({},info)=>{
  test.setTimeout(90000);let app;
  try{const f=await setup(info);app=f.app;const page=f.page;
    const search=page.getByRole('searchbox');const sort=page.getByRole('combobox',{name:'Sıralama'});
    await page.locator('[data-testid="hymn-list"]').evaluate(el=>el.scrollTop=el.scrollHeight);
    await search.fill('Yalnız sözlerde bulunur 2800');await expect(page.getByText('Aramanızla eşleşen ilahi bulunamadı.')).toBeVisible();
    await page.getByLabel('Sözlerde de ara').check();await expect(row(page,'library-2800')).toBeVisible();
    await page.getByRole('button',{name:'Aramayı temizle',exact:true}).click();await expect(search).toBeFocused();
    await expect(row(page,'library-0')).toBeVisible();
    await sort.focus();await sort.selectOption('title-asc');await expect(sort).toBeFocused();
    await row(page,'library-0').locator('[data-hymn-action=edit]').click();const dialog=page.getByRole('dialog');
    await dialog.locator('#edit-hymn-title').fill('ZZZ Düzenlenen İlahi');await dialog.getByRole('button',{name:'Kaydet',exact:true}).click();
    await expect(row(page,'library-0').locator('[data-hymn-action=edit]')).toBeFocused();
    await expect(row(page,'library-0')).toBeVisible();
    expect(await page.evaluate(()=>window.__hymnStore.getState().activeTab)).toBe('hymns');
    const slidesBefore=await page.evaluate(()=>window.__hymnStore.getState().presentation.slides.length);
    await page.keyboard.press('Space');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>window.__hymnStore.getState().presentation.slides.length)).toBe(slidesBefore);
    // Single activation uses the existing real presentation append callback.
    await row(page,'library-0').locator('[data-hymn-action=add]').focus();await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>window.__hymnStore.getState().activeTab)).toBe('slides');
    expect(await page.evaluate(()=>window.__hymnStore.getState().presentation.slides.length)).toBeGreaterThan(slidesBefore);
    await page.evaluate(()=>window.__hymnStore.getState().setActiveTab('hymns'));await expect(sort).toHaveValue('title-asc');
    await search.fill('ZZZ Düzenlenen İlahi');await row(page,'library-0').locator('[data-hymn-action=edit]').click();
    await dialog.locator('#edit-hymn-title').fill('Aramadan çıkan ilahi');await dialog.getByRole('button',{name:'Kaydet',exact:true}).click();
    await expect(page.getByText('Aramanızla eşleşen ilahi bulunamadı.')).toBeVisible();await expect(search).toBeFocused();
    // Replace only this isolated test library with one record, and verify deleting the last record persists.
    await page.evaluate(()=>window.__hymnStore.getState().setActiveTab('slides'));await expect(page.locator('.hymn-library')).toHaveCount(0);
    await page.evaluate(()=>{localStorage.setItem('hymnsCache:v3:__online__',JSON.stringify([{id:'last',title:'Son ilahi',lyrics:'Söz'}]));window.__hymnStore.getState().setActiveTab('hymns');});
    await row(page,'last').locator('[data-hymn-action=remove]').click();await expect(search).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hymnsCache:v3:__online__')).length)).toBe(0);
    await page.reload();await page.waitForFunction(()=>!!window.__tourTest);await page.evaluate(async()=>{window.__hymnStore=(await import('/src/renderer/state/useStore.ts')).useStore;window.__hymnStore.getState().setActiveTab('hymns');});
    await expect(page.locator('[data-hymn-id]')).toHaveCount(0);await expect(sort).toHaveValue('title-asc');
  }finally{await closeWorkspace(app);}
});
