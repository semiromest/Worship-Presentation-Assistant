const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.hidden = false; this.scrollTop = 0; this.clientHeight = 500; this._text = ''; this.classes = new Set(); this.classList = { toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c), add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; this.style = { setProperty() {} }; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children.at(-1) || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get isConnected() { return !!this.root || !!this.parentNode?.isConnected; }
  get scrollHeight() { return this.children.filter(n => !n.hidden).length * 80; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  replaceChildren() { this.children.forEach(c => { c.parentNode = null; }); this.children = []; }
  appendChild(child) { this.insertBefore(child, null); return child; }
  insertBefore(child, before) { if (child === before) return; child.remove(); const i = before ? this.children.indexOf(before) : this.children.length; this.children.splice(i, 0, child); child.parentNode = this; }
  remove() { if (this.parentNode) { const a = this.parentNode.children; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); this[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; delete this[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; if (this.listeners.close) this.listeners.close(); }
  getBoundingClientRect() { const top = this.parentNode ? this.parentNode.children.indexOf(this) * 80 - this.parentNode.scrollTop : 0; return { top, bottom: top + 80 }; }
}
function boot(preferences = {}, options = {}) {
  const ids = Object.fromEntries(['wrap','feed','language-picker','show-original','return-live','status','dot','original-label','ended','endedText','settings-panel','settings-button','settings-close','settings-title','size-label','theme-label','theme-dark-label','theme-light-label','theme-system-label','size-18','size-22','size-26','theme-dark','theme-light','theme-system'].map(id => { const e = new Element(id === 'settings-panel' ? 'dialog' : 'div'); e.root = true; return [id,e]; }));
  if (options.dialog === false) { ids['settings-panel'].showModal = undefined; ids['settings-panel'].close = undefined; }
  ['18','22','26'].forEach(value => { ids['size-' + value].dataset.size = value; });
  ['dark','light','system'].forEach(value => { ids['theme-' + value].dataset.themeValue = value; });
  const sockets = [], timers = new Map(), windowListeners = {}, frames = [];
  const selection = { isCollapsed: true, selected: new Set(), containsNode(node) { return this.selected.has(node); } };
  const motion = { matches: !!options.reducedMotion, addEventListener(name, fn) { this.listener = fn; } };
  let timerId = 0;
  class Socket { constructor() { sockets.push(this); this.readyState = 0; } close() { this.readyState = 3; } }
  const document = { getElementById: id => ids[id], createElement: tag => new Element(tag), documentElement: new Element('html'), body: new Element('body'), querySelector: () => null, activeElement: null };
  vm.runInNewContext(fs.readFileSync(__dirname + '/share-client.js','utf8'), { document, navigator: { language: 'tr' }, localStorage: { getItem: k => preferences[k], setItem: (k,v) => { preferences[k] = v; } }, location: { search: '?token=test', protocol: 'http:', host:'localhost' }, URLSearchParams, Intl: options.legacyIntl ? {DisplayNames:Intl.DisplayNames} : Intl, WebSocket:Socket, setTimeout: f => { timers.set(++timerId, f); return timerId; }, clearTimeout: id => timers.delete(id), window: { getSelection: () => selection, matchMedia: q => q.includes('reduced-motion') ? motion : null, addEventListener(name, fn){ windowListeners[name] = fn; }, requestAnimationFrame(fn) { if(options.batch) frames.push(fn); else fn(); return 1; } } });
  let sequence = 0;
  return { ids, sockets, timers, windowListeners, motion, document, selection, flush: () => frames.splice(0).forEach(fn => fn()), apply: data => sockets.at(-1).onmessage({ data: JSON.stringify({ type:'snapshot', broadcastId:'b', sequence: ++sequence, data }) }) };
}
const base = { sessionStatus:'connected', translationEnabled:true, targetLanguages:['en','de'], original:'Merhaba', translations:{en:'Hello',de:'Hallo'}, history:[{id:'one',original:'Önceki',translations:{en:'Previous',de:'Vorher'}}] };
function currentLine(app, code = 'en') { return app.ids.feed.children.find(n => n.dataset.id === '__live__')._lines.get(code); }
function fresh(line) { return line._chunks.filter(n => n.classes.has('fresh')); }
function stream(app, final, partial = '', extra = {}) { app.apply({...base, original:'', history:[], translations:{en:final}, partialTranslations:{en:partial}, ...extra}); }
function visible(node) { return node.hidden ? '' : node._text + node.children.map(visible).join(''); }
test('translation off always shows original even if preference disabled', () => {
  const app=boot({'freebuff-share-show-original':'false'}); app.apply({...base,translationEnabled:false});
  assert.match(visible(app.ids.feed),/Merhaba/); assert.doesNotMatch(visible(app.ids.feed),/Hello/); assert.equal(app.ids['show-original'].disabled,true);
});
test('original picker overrides hidden-original preference; single-language filters', () => {
  const app=boot({'freebuff-share-show-original':'false'});app.apply(base);
  app.ids['language-picker'].value='__original__';app.ids['language-picker'].listeners.change();
  assert.match(visible(app.ids.feed),/Merhaba/);
  app.ids['language-picker'].value='de';app.ids['language-picker'].listeners.change();
  assert.match(visible(app.ids.feed),/Hallo/);assert.doesNotMatch(visible(app.ids.feed),/Hello|Merhaba/);
});
test('token update preserves history DOM and only updates current text; secondary-only live text appears', () => {
  const app=boot();app.apply(base);const history=app.ids.feed.firstChild; const line=history.firstChild;
  app.apply({...base,original:'',translations:{de:'Nur Deutsch'}});
  assert.equal(app.ids.feed.firstChild,history);assert.equal(history.firstChild,line);
  assert.match(visible(app.ids.feed),/Nur Deutsch/);
});
test('expired token stops retry loop and retains readable history', () => {
  const app=boot();app.apply(base);app.sockets[0].onclose({code:1008});
  assert.equal(app.timers.size,0);assert.match(app.ids.endedText.textContent,/süresi doldu/);assert.match(visible(app.ids.feed),/Previous/);
});
test('missing saved language falls back to all; chosen language and size persist', () => {
  const prefs={'freebuff-share-language':'ko'}; const app=boot(prefs);app.apply(base);
  assert.equal(app.ids['language-picker'].value,'__all__');app.ids['language-picker'].value='de';app.ids['language-picker'].listeners.change();
  app.ids['size-26'].listeners.click();assert.equal(prefs['freebuff-share-language'],'de');assert.equal(prefs['freebuff-share-size'],'26');
});
test('return-live appears while reading history and clears after activating', () => {
  const app=boot();app.apply({...base,history:Array.from({length:15},(_,i)=>({id:String(i),original:'Text'}))});
  app.ids.feed.scrollTop=0;app.ids.feed.listeners.scroll();assert.equal(app.ids['return-live'].classes.has('hidden'),false);
  app.ids['return-live'].listeners.click();assert.equal(app.ids['return-live'].classes.has('hidden'),true);
});
test('joining before the first snapshot shows waiting state without crashing', () => {
  const app = boot();
  assert.doesNotThrow(() => app.sockets[0].onmessage({ data: JSON.stringify({ type: 'hello', broadcastId: 'b', sequence: 0, data: null }) }));
  assert.match(app.ids.status.textContent, /bekleniyor/i);
});

test('provisional text is separate and live token updates never add entrance animation', () => {
  const app = boot();
  app.apply({ ...base, original:'Mer', partialOriginal:'haba', translations:{en:'Hel'}, partialTranslations:{en:'lo'} });
  const live = app.ids.feed.children.find(node => node.dataset.id === '__live__');
  assert.match(visible(live), /Merhaba/);
  assert.equal(live.classes.has('entering'), false);
  const liveNode = live;
  app.apply({ ...base, original:'Merh', partialOriginal:'aba', translations:{en:'Hell'}, partialTranslations:{en:'o'} });
  assert.equal(app.ids.feed.children.find(node => node.dataset.id === '__live__'), liveNode);
  assert.equal(live.classes.has('entering'), false);
});

test('history insertion and later corrections never animate the card', () => {
  const app = boot(); app.apply({ ...base, history:[] });
  app.apply({ ...base, history:[{id:'new',original:'Tamamlandı',translations:{en:'Finished'}}] });
  const card = app.ids.feed.children.find(node => node.dataset.id === 'new');
  assert.equal(card.classes.has('entering'), false);
  app.apply({ ...base, history:[{id:'new',original:'Tamamlandı!',translations:{en:'Finished!'}}] });
  assert.equal(app.ids.feed.children.find(node => node.dataset.id === 'new'), card);
});

test('saved single-language selection renders legacy scalar translation snapshots', () => {
  const app = boot({'freebuff-share-language':'en','freebuff-share-show-original':'false'});
  app.apply({ ...base, translations:undefined, translation:'Hel', partialTranslation:'lo', original:'' });
  assert.match(visible(app.ids.feed), /Hello/);
  assert.match(app.ids.status.textContent, /Canlı/);
});

test('secondary-language history scalar mirror is not duplicated under the primary label', () => {
  const app = boot();
  app.apply({
    ...base,
    original:'',
    translation:'',
    translations:{},
    history:[{
      id:'ko-entry',
      original:'',
      translation:'안녕하세요 여러분',
      translations:{ko:'안녕하세요 여러분'},
    }],
  });
  const history = app.ids.feed.children.find(node => node.dataset.id === 'ko-entry');
  assert.equal((visible(history).match(/안녕하세요 여러분/g) || []).length, 1);
  assert.match(visible(history), /Korece · KO/);
  assert.doesNotMatch(visible(history), /İngilizce · EN/);
});

test('dialog fallback hides the page, closes cleanly and restores it', () => {
  const app = boot({}, {dialog:false});
  app.ids['settings-button'].listeners.click();
  assert.equal(app.ids['settings-panel'].attributes.open, '');
  assert.equal(app.ids.wrap.attributes['aria-hidden'], 'true');
  assert.equal(app.ids['return-live'].attributes['aria-hidden'], 'true');
  assert.equal(app.ids['settings-button'].attributes['aria-expanded'], 'true');
  app.windowListeners.keydown({key:'Escape'});
  assert.equal(app.ids['settings-panel'].attributes.open, undefined);
  assert.equal(app.ids.wrap.attributes['aria-hidden'], undefined);
  assert.equal(app.ids['return-live'].attributes['aria-hidden'], undefined);
});

test('pageshow replaces a WebSocket stuck in CONNECTING', () => {
  const app = boot(); const first = app.sockets[0];
  app.windowListeners.pageshow();
  assert.equal(first.readyState, 3);
  assert.equal(app.sockets.length, 2);
});

test('return-live is an icon-only control with a localized accessible label', () => {
  const app=boot();app.apply({...base,history:Array.from({length:15},(_,i)=>({id:String(i),original:'Text'}))});
  app.ids.feed.scrollTop=0;app.ids.feed.listeners.scroll();
  assert.equal(app.ids['return-live'].textContent,'');
  assert.match(app.ids['return-live'].attributes['aria-label'],/Canlıya dön/);
});

test('reading settings persist theme and keep the sheet accessible', () => {
  const prefs={}; const app=boot(prefs);
  app.ids['settings-button'].listeners.click();
  assert.equal(app.ids['settings-panel'].open,true);
  assert.equal(app.ids['settings-button'].attributes['aria-expanded'],'true');
  app.ids['theme-light'].listeners.click();
  assert.equal(prefs['freebuff-share-theme'],'light');
  app.ids['settings-close'].listeners.click();
  assert.equal(app.ids['settings-panel'].open,false);
  assert.equal(app.ids['settings-button'].attributes['aria-expanded'],'false');
});

test('only appended suffixes fade; prior chunk timers and nodes survive updates and promotion', () => {
  const app=boot(); stream(app,'Hello'); const line=currentLine(app), first=line._chunks[0];
  assert.equal(fresh(line).length,0);
  stream(app,'Hello',' world'); const chunk=fresh(line)[0], timer=chunk._timer;
  assert.equal(chunk.textContent,' world'); assert.equal(line._chunks[0],first);
  stream(app,'Hello world','!');
  assert.equal(chunk._timer,timer); assert.equal(chunk._final.textContent,' world');
  assert.equal(fresh(line).at(-1).textContent,'!');
  stream(app,'Hello world!'); assert.equal(fresh(line)[0],chunk);
  [...fresh(line)].forEach(n => app.timers.get(n._timer)());
  assert.equal(line._chunks.length,1); assert.equal(line._text.textContent,'Hello world!');
});

test('recognition corrections update immediately without fading the replacement', () => {
  const app=boot(); stream(app,'Hello cat'); const line=currentLine(app), first=line._chunks[0];
  stream(app,'Hello car');
  assert.equal(line._chunks[0],first); assert.equal(line._text.textContent,'Hello car'); assert.equal(fresh(line).length,0);
  stream(app,'Hello'); assert.equal(line._text.textContent,'Hello'); assert.equal(fresh(line).length,0);
});

test('history transfer, reconnect and preference changes do not fade existing content', () => {
  const app=boot(); stream(app,'Hello'); stream(app,'Hello world');
  app.sockets[0].onmessage({data:JSON.stringify({type:'hello',broadcastId:'b',sequence:0,data:{...base,translations:{en:'Hello world again',de:'Hallo'}}})});
  assert.equal(fresh(currentLine(app)).length,0);
  app.ids['language-picker'].value='de'; app.ids['language-picker'].listeners.change();
  assert.equal(fresh(currentLine(app,'de')).length,0);
  app.ids['language-picker'].value='__all__'; app.ids['language-picker'].listeners.change();
  assert.equal(fresh(currentLine(app)).length,0);
  stream(app,'Hello world again!', '', {history:[{id:'done',translations:{en:'Hello world again',de:'Hallo'}}]});
  const history=app.ids.feed.children.find(n=>n.dataset.id==='done');
  assert.equal(fresh(history._lines.get('en')).length,0);
  app.ids['size-26'].listeners.click(); assert.equal(fresh(currentLine(app)).length,0);
});

test('app motion and reduced-motion settings settle active fades and prevent new ones', () => {
  const app=boot(); stream(app,'Hello'); stream(app,'Hello!'); const line=currentLine(app);
  assert.equal(fresh(line).length,1); app.motion.matches=true; app.motion.listener();
  assert.equal(fresh(line).length,0); stream(app,'Hello!!'); assert.equal(fresh(line).length,0);
  app.motion.matches=false; app.motion.listener(); stream(app,'Hello!!!','',{uiMotionEnabled:false});
  assert.equal(fresh(line).length,0);
});

test('grapheme extensions are instant and never split emoji, Korean or combining marks', () => {
  for (const [before, after] of [['👩','👩‍💻'],['e','é'],['🇹','🇹🇷'],['ᄒ','한']]) {
    const app=boot(); stream(app,before); stream(app,after);
    const line=currentLine(app); assert.equal(line._text.textContent,after); assert.equal(fresh(line).length,0);
    stream(app,after+' 안녕하세요'); assert.equal(fresh(line)[0].textContent,' 안녕하세요');
  }
  const legacy=boot({}, {legacyIntl:true}); stream(legacy,'👩'); stream(legacy,'👩‍💻');
  assert.equal(currentLine(legacy)._text.textContent,'👩‍💻'); assert.equal(fresh(currentLine(legacy)).length,0);
});

test('burst updates keep bounded chunk counts and preserve the history scroll anchor', () => {
  const app=boot(); const history=Array.from({length:15},(_,i)=>({id:String(i),original:'Text'}));
  stream(app,'Start','',{history}); app.ids.feed.scrollTop=80; app.ids.feed.listeners.scroll();
  let value='Start';
  for(let i=0;i<300;i++) { value+=' x'; stream(app,value,'',{history}); assert.ok(currentLine(app)._chunks.length<=9); }
  const line=currentLine(app); assert.equal(line._text.textContent,value); assert.equal(app.ids.feed.scrollTop,80);
  [...fresh(line)].forEach(n => app.timers.get(n._timer)()); assert.equal(line._chunks.length,1);
});

test('rAF batches updates and keeps UI-change suppression until the frame is drawn', () => {
  const app=boot({}, {batch:true}); stream(app,'Hello'); app.flush();
  stream(app,'Hello world'); stream(app,'Hello world!'); app.flush();
  assert.equal(fresh(currentLine(app)).length,1); assert.equal(fresh(currentLine(app))[0].textContent,' world!');
  stream(app,'Hello world!!'); app.ids['size-26'].listeners.click(); app.flush();
  assert.equal(fresh(currentLine(app)).length,0);
});

test('older Safari keeps finalized Unicode text styling and only fades new suffixes', () => {
  const app=boot({}, {legacyIntl:true}); stream(app,'Hello',' dünya'); const line=currentLine(app);
  assert.equal(line._chunks[0]._final.textContent,'Hello'); assert.equal(line._chunks[0]._partial.textContent,' dünya');
  stream(app,'Hello dünya',' 안녕하세요'); assert.equal(fresh(line)[0].textContent,' 안녕하세요');
  assert.equal(line._chunks[0]._final.textContent,'Hello dünya');
  for(const [before,after] of [['👩','👩‍💻'],['e','é'],['🇹','🇹🇷'],['ᄒ','한']]) {
    stream(app,before); stream(app,after); assert.equal(line._text.textContent,after); assert.equal(fresh(line).length,0);
  }
});

test('completed neighboring chunks merge without replacing selected text nodes', () => {
  const app=boot(); stream(app,'Selected'); const line=currentLine(app), selected=line._chunks[0];
  app.selection.isCollapsed=false; app.selection.selected.add(selected);
  stream(app,'Selected one'); stream(app,'Selected one two');
  [...fresh(line)].forEach(n => app.timers.get(n._timer)());
  assert.equal(line._chunks[0],selected); assert.equal(selected.textContent,'Selected');
  assert.equal(line._chunks.length,2); assert.equal(line._text.textContent,'Selected one two');
});
