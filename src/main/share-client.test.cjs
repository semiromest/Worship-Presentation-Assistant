const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.listeners = {}; this.hidden = false; this.scrollTop = 0; this.clientHeight = 500; this._text = ''; this.classes = new Set(); this.classList = { toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c), add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; this.style = { setProperty() {} }; }
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
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  getBoundingClientRect() { const top = this.parentNode ? this.parentNode.children.indexOf(this) * 80 - this.parentNode.scrollTop : 0; return { top, bottom: top + 80 }; }
}
function boot(preferences = {}) {
  const ids = Object.fromEntries(['feed','language-picker','show-original','font-size','return-live','status','dot','original-label','ended','endedText'].map(id => { const e = new Element(); e.root = true; return [id,e]; }));
  const sockets = [], timers = new Map(); let timerId = 0;
  class Socket { constructor() { sockets.push(this); this.readyState = 1; } close() { this.readyState = 3; } }
  const document = { getElementById: id => ids[id], createElement: tag => new Element(tag), documentElement: new Element('html') };
  vm.runInNewContext(fs.readFileSync(__dirname + '/share-client.js','utf8'), { document, navigator: { language: 'tr' }, localStorage: { getItem: k => preferences[k], setItem: (k,v) => { preferences[k] = v; } }, location: { search: '?token=test', protocol: 'http:', host:'localhost' }, URLSearchParams, Intl, WebSocket:Socket, setTimeout: f => { timers.set(++timerId, f); return timerId; }, clearTimeout: id => timers.delete(id), window: { addEventListener(){} } });
  let sequence = 0;
  return { ids, sockets, timers, apply: data => sockets.at(-1).onmessage({ data: JSON.stringify({ type:'snapshot', broadcastId:'b', sequence: ++sequence, data }) }) };
}
const base = { sessionStatus:'connected', translationEnabled:true, targetLanguages:['en','de'], original:'Merhaba', translations:{en:'Hello',de:'Hallo'}, history:[{id:'one',original:'Önceki',translations:{en:'Previous',de:'Vorher'}}] };
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
  const app=boot();app.apply(base);const history=app.ids.feed.firstChild; const text=history.firstChild.lastChild;
  app.apply({...base,original:'',translations:{de:'Nur Deutsch'}});
  assert.equal(app.ids.feed.firstChild,history);assert.equal(history.firstChild.lastChild,text);
  assert.match(visible(app.ids.feed),/Nur Deutsch/);
});
test('expired token stops retry loop and retains readable history', () => {
  const app=boot();app.apply(base);app.sockets[0].onclose({code:1008});
  assert.equal(app.timers.size,0);assert.match(app.ids.endedText.textContent,/süresi doldu/);assert.match(visible(app.ids.feed),/Previous/);
});
test('missing saved language falls back to all; chosen language and size persist', () => {
  const prefs={'freebuff-share-language':'ko'}; const app=boot(prefs);app.apply(base);
  assert.equal(app.ids['language-picker'].value,'__all__');app.ids['language-picker'].value='de';app.ids['language-picker'].listeners.change();
  app.ids['font-size'].value='26';app.ids['font-size'].listeners.change();assert.equal(prefs['freebuff-share-language'],'de');assert.equal(prefs['freebuff-share-size'],'26');
});
test('return-live appears while reading history and clears after activating', () => {
  const app=boot();app.apply({...base,history:Array.from({length:15},(_,i)=>({id:String(i),original:'Text'}))});
  app.ids.feed.scrollTop=0;app.ids.feed.listeners.scroll();assert.equal(app.ids['return-live'].classes.has('hidden'),false);
  app.ids['return-live'].listeners.click();assert.equal(app.ids['return-live'].classes.has('hidden'),true);
});
