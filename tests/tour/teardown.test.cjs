/* eslint-disable @typescript-eslint/no-require-imports -- Node fixture regression tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {trackElectron,closeElectron}=require('./teardown.cjs');
function fixture(close) {
  const app=new EventEmitter();
  const child={pid:0,exitCode:null,killed:false,kill(){this.killed=true;}};
  app.process=()=>child; app.close=close;
  trackElectron(app);
  return {app,child};
}
test('healthy teardown preserves graceful close',async()=>{
  let called=false;
  const {app,child}=fixture(async()=>{called=true;});
  await closeElectron(app);
  assert.equal(called,true); assert.equal(child.killed,false);
});
test('native close does not reaccess the disposed Playwright process',async()=>{
  const {app}=fixture(()=>assert.fail('Already closed'));
  app.emit('close'); app.process=()=>assert.fail('Disposed process');
  await closeElectron(app);
});
test('unsettled close after kill is bounded and remains a failure',async()=>{
  const {app,child}=fixture(()=>new Promise(()=>{}));
  await assert.rejects(closeElectron(app,{graceMs:10,killMs:10}),/did not acknowledge/);
  assert.equal(child.killed,true);
});
test('signaled child with an unsettled close is never killed again',async()=>{
  const {app,child}=fixture(()=>new Promise(()=>{}));
  child.signalCode='SIGTERM';
  await assert.rejects(closeElectron(app,{graceMs:10,killMs:10}),/did not acknowledge/);
  assert.equal(child.killed,false);
});
