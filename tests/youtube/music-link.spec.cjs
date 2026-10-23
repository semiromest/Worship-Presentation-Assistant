const {test,expect,_electron:electron}=require('@playwright/test');
const path=require('node:path');
test('real YouTube Music link resolves exactly one song without starting playback',async({},info)=>{
  const env={...process.env,WPA_TEST_PROFILE:info.outputPath('profile')};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
  const app=await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs'),'--wpa-smoke'],env});
  try{
    const page=await app.firstWindow();await page.locator('nav').waitFor();await page.getByTestId('background-music-toggle').click();
    const query=page.getByTestId('youtube-music-query');await expect(query).toHaveAttribute('placeholder','Song name or YouTube link…');
    await query.fill('https://music.youtube.com/watch?v=KI33ItOO_M4');await query.press('Enter');
    await expect(page.getByTestId('youtube-result-KI33ItOO_M4')).toBeVisible({timeout:30000});
    expect(await page.getByTestId('youtube-music-results').locator('[data-testid^="youtube-result-"]').count()).toBe(1);
    await expect(page.getByTestId('youtube-load-more')).toHaveCount(0);await expect(page.getByTestId('background-music-audio')).not.toHaveAttribute('src');
    await page.screenshot({path:info.outputPath('youtube-link.png')});
    await query.fill('https://youtube.com/playlist?list=PL123');await query.press('Enter');await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Enter a valid YouTube video link.');
  }finally{await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});await app.close().catch(()=>{});}
});
