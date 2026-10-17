/* eslint-disable @typescript-eslint/no-require-imports -- Electron test fixture. */
// app.close() requests app.quit(); Practice intentionally vetoes quitting until
// renderer persistence succeeds. Failed tests may leave that renderer unusable.
const processes = new WeakMap();
const {execFile}=require('node:child_process');
exports.trackElectron = function(app) {
  const state={child:app.process(),closed:false};
  app.once('close',()=>{state.closed=true;});
  processes.set(app,state);
  return app;
};
exports.closeElectron = async function(app, { graceMs=10000, killMs=2000 } = {}) {
  const state=processes.get(app);
  if(state?.closed) return;
  let timer;
  const child=state?.child ?? app.process();
  const closed=app.close();
  try {
    await Promise.race([closed, new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`Electron did not acknowledge graceful teardown within ${graceMs}ms`)),graceMs);
    })]);
  } catch(error) {
    console.error('Electron teardown:',error.message,'pid:',child.pid);
    if(child.exitCode===null && child.signalCode==null) {
      // Kill the owned tree before its parent disappears: on Windows child.kill()
      // alone can leave Electron renderers holding the isolated profile lock.
      if(process.platform==='win32' && Number.isInteger(child.pid) && child.pid>0) await new Promise(resolve=>execFile('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,timeout:2000},resolve));
      if(child.exitCode===null && child.signalCode==null) child.kill();
    }
    clearTimeout(timer);
    await Promise.race([closed.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,killMs);})]);
    throw error;
  } finally { clearTimeout(timer); }
};
