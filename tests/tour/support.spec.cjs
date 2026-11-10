const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
test('support choices handle unpublished pages, keyboard dismissal and external provider requests',async({},info)=>{
 let app;
 try{
  const fixture=await launchWorkspace(info,30000);app=fixture.app;const page=fixture.page;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  expect(await page.evaluate(()=>window.electronAPI.openSupport('https://example.com'))).toBe(false);
  await app.evaluate(({ipcMain})=>{
   global.supportReady=false;global.supportRequests=[];
   ipcMain.removeHandler('support:availability');ipcMain.handle('support:availability',()=>({kreosus:global.supportReady,github:global.supportReady}));
   ipcMain.removeHandler('support:open');ipcMain.handle('support:open',(_,platform)=>{global.supportRequests.push(platform);return true;});
  });
  await page.evaluate(async()=>{await window.__tourTest.language('tr');const {useStore}=await import('/src/renderer/state/useStore.ts');useStore.getState().setActiveTab('settings');});
  await page.locator('#settings-category').selectOption('support',{force:true});
  const trigger=page.getByTestId('support-development');await trigger.scrollIntoViewIfNeeded();await trigger.click();
  const github=page.getByTestId('support-github'),kreosus=page.getByTestId('support-kreosus');
  await expect(github).toBeDisabled();await expect(kreosus).toBeDisabled();
  await expect(page.getByRole('status').filter({hasText:'Destek sayfaları hazırlanıyor'})).toBeVisible();
  for(const lang of ['tr','en','de','es','ko']){
   await page.evaluate(lang=>window.__tourTest.language(lang),lang);
   await expect(page.locator('[data-testid="support-github"]').locator('..').locator('..')).not.toContainText('support.');
  }
  await page.keyboard.press('Escape');await expect(github).toHaveCount(0);await expect(trigger).toBeFocused();
  await app.evaluate(()=>global.supportReady=true);
  await trigger.click();await expect(github).toBeEnabled();await github.click();await expect(github).toHaveCount(0);
  await trigger.click();await expect(kreosus).toBeEnabled();await kreosus.click();await expect(kreosus).toHaveCount(0);
  expect(await app.evaluate(()=>global.supportRequests)).toEqual(['github','kreosus']);
  expect(app.windows()).toHaveLength(1);expect(errors).toEqual([]);
 }finally{await closeWorkspace(app);}
});
