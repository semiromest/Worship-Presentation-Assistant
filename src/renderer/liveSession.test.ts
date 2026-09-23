import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSessionOnlyChange, restoreLiveSession, writeLiveSession } from './liveSession';
import type { Presentation } from './types';
test('session stores only positions and restores parts without overwriting edited content', () => {
  const store = new Map<string,string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value: {
    getItem:(key:string) => store.get(key) ?? null, setItem:(key:string,value:string) => store.set(key,value),
  } });
  const deck: Presentation = { id:'deck', name:'Test', slides:[{ id:'s', type:'text', content:'One', partsMode:true, parts:['One','Two'], activePart:0 }] };
  const navigated = { ...deck, slides:[{ ...deck.slides[0], content:'Two', activePart:1 }] };
  assert.equal(isSessionOnlyChange(deck,navigated),true);
  assert.equal(isSessionOnlyChange(deck,{...deck,slides:[{...deck.slides[0],operatorNotes:'Wait'}]}),false);
  assert.equal(isSessionOnlyChange(deck,{...deck,slides:[{...deck.slides[0],content:'Edited'}]}),false);
  writeLiveSession(navigated,'s');
  assert.equal([...store.values()][0].includes('Two'),false);
  const restored = restoreLiveSession(deck,0);
  assert.equal(restored.slides[0].activePart,1);
  assert.equal(restored.slides[0].content,'Two');
  assert.equal(restored.liveSlideId,'s');
  assert.equal(restoreLiveSession({...deck,id:'other'},0).slides[0].activePart,0);
  store.set('presenter.liveSession.v1','invalid');
  assert.equal(restoreLiveSession(deck,0),deck);
});
