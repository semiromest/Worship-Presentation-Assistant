/* Phone reader: no external runtime, stable keyed transcript nodes. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var feed = $('feed'), picker = $('language-picker'), toggle = $('show-original'), sizePicker = $('font-size');
  var button = $('return-live'), status = $('status'), dot = $('dot');
  var locale = (navigator.language || 'en').split('-')[0];
  var labels = {
    en: ['Connecting…','Waiting for speech','Live','Connection lost · reconnecting…','Broadcast ended','All languages','Original','Also show original','Text size','Translation language','Back to live','This link has expired. Scan the current QR code.'],
    tr: ['Bağlanıyor…','Konuşma bekleniyor','Canlı','Bağlantı kesildi · yeniden bağlanıyor…','Yayın sona erdi','Tüm diller','Orijinal','Orijinali de göster','Yazı boyutu','Çeviri dili','Canlıya dön','Bu bağlantının süresi doldu. Güncel QR kodunu tarayın.'],
    de: ['Verbindung wird hergestellt…','Warte auf Sprache','Live','Verbindung unterbrochen · erneuter Versuch…','Übertragung beendet','Alle Sprachen','Original','Original zusätzlich anzeigen','Textgröße','Übersetzungssprache','Zurück zu Live','Dieser Link ist abgelaufen. Bitte den aktuellen QR-Code scannen.'],
    es: ['Conectando…','Esperando voz','En vivo','Conexión perdida · reconectando…','Transmisión finalizada','Todos los idiomas','Original','Mostrar también el original','Tamaño del texto','Idioma de traducción','Volver al directo','Este enlace ha caducado. Escanea el código QR actual.'],
    ko: ['연결 중…','음성 대기 중','실시간','연결 끊김 · 재연결 중…','방송 종료','모든 언어','원문','원문도 표시','글자 크기','번역 언어','실시간으로 돌아가기','링크가 만료되었습니다. 현재 QR 코드를 스캔하세요.']
  };
  var L = labels[locale] || labels.en;
  document.documentElement.lang = labels[locale] ? locale : 'en';
  document.title = L[2] + ' · ' + L[9];
  picker.setAttribute('aria-label', L[9]); sizePicker.setAttribute('aria-label', L[8]);
  $('original-label').textContent = L[7];
  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch { /* storage optional */ } }
  var selected = read('freebuff-share-language', '__all__');
  var showOriginal = read('freebuff-share-show-original', 'true') !== 'false';
  var fontSize = read('freebuff-share-size', '22');
  if (!['18','22','26'].includes(fontSize)) fontSize = '22';
  toggle.checked = showOriginal; sizePicker.value = fontSize;
  document.documentElement.style.setProperty('--caption-size', fontSize + 'px');
  var languageNames;
  try { languageNames = new Intl.DisplayNames([locale], { type: 'language' }); } catch { /* codes remain available */ }
  function languageName(code) { try { return languageNames ? languageNames.of(code) + ' · ' + code.toUpperCase() : code.toUpperCase(); } catch { return code; } }
  var snapshot = null, signature = null, sequence = -1, broadcastId = null;
  var autoScroll = true, unread = new Set(), known = new Set(), cards = new Map();
  var socket, retryTimer, watchdog, retryDelay = 800, ended = false;
  var token = new URLSearchParams(location.search).get('token') || '';
  function setStatus(text, kind) { if (status.textContent !== text) status.textContent = text; dot.className = 'dot ' + kind; }
  function element(tag, cls, text) { var n = document.createElement(tag); n.className = cls || ''; if (text !== undefined) n.textContent = text; return n; }
  function updatePicker() {
    var targets = snapshot.targetLanguages || Object.keys(snapshot.translations || {});
    var next = targets.join('|');
    if (next === signature) return;
    signature = next;
    picker.replaceChildren();
    [['__all__', L[5]], ['__original__', L[6]]].concat(targets.map(function(code) { return [code, languageName(code)]; })).forEach(function (item) {
      var option = element('option', '', item[1]); option.value = item[0]; picker.appendChild(option);
    });
    if (selected !== '__all__' && selected !== '__original__' && !targets.includes(selected)) selected = '__all__';
    picker.value = selected;
  }
  function updateCard(id, data, live) {
    var card = cards.get(id);
    if (!card) { card = element('section', live ? 'entry live' : 'entry'); card.dataset.id = id; card._lines = new Map(); cards.set(id, card); }
    var originalOnly = !snapshot.translationEnabled || selected === '__original__';
    var rows = [];
    if (!originalOnly) {
      var translations = data.translations || {};
      Object.keys(translations).forEach(function(code) {
        if ((selected === '__all__' || selected === code) && translations[code]) rows.push([code, languageName(code), translations[code], 'tr']);
      });
      if (!Object.keys(translations).length && data.translation && selected === '__all__') rows.push(['translation', L[9], data.translation, 'tr']);
    }
    if ((originalOnly || showOriginal) && data.original) rows.push(['original', L[6], data.original, originalOnly ? 'tr' : 'orig']);
    var wanted = new Set(rows.map(function(row) { return row[0]; }));
    card._lines.forEach(function(line, key) { if (!wanted.has(key)) { line.remove(); card._lines.delete(key); } });
    rows.forEach(function(row) {
      var line = card._lines.get(row[0]);
      if (!line) { line = element('div'); line.appendChild(element('span','tag',row[1])); var text = element('span','txt'); text.dir = 'auto'; line.appendChild(text); card._lines.set(row[0],line); card.appendChild(line); }
      line.className = 'line ' + row[3];
      if (line.lastChild.textContent !== row[2]) line.lastChild.textContent = row[2];
    });
    card.hidden = !rows.length;
    return card;
  }
  var placeholder = element('p', 'placeholder', L[1]);
  function updateButton() {
    button.classList.toggle('hidden', autoScroll || ended);
    button.textContent = L[10] + (unread.size ? ' (' + unread.size + ')' : '');
  }
  function render() {
    if (!snapshot) return;
    var anchor = Array.from(feed.children).find(function(n) { return !n.hidden && n.getBoundingClientRect().bottom > feed.getBoundingClientRect().top; });
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    var oldTop = feed.scrollTop, oldHeight = feed.scrollHeight;
    var wanted = new Set();
    var items = (snapshot.history || []).map(function(h) { return [h.id, h, false]; });
    items.push(['__live__', snapshot, true]);
    var previous = null;
    items.forEach(function(item) {
      var id = item[0]; wanted.add(id);
      var card = updateCard(id, item[1], item[2]);
      // Only insert/move when order actually changes: selection and nodes survive tokens.
      var expected = previous ? previous.nextSibling : feed.firstChild;
      if (expected !== card) feed.insertBefore(card, expected);
      previous = card;
      if (!item[2] && !known.has(id) && known.size && !autoScroll && !card.hidden) unread.add(id);
    });
    known = new Set((snapshot.history || []).map(function(h) { return h.id; }));
    cards.forEach(function(card, id) { if (!wanted.has(id)) { card.remove(); cards.delete(id); unread.delete(id); } });
    var liveHasText = !cards.get('__live__').hidden;
    placeholder.hidden = liveHasText || ended;
    if (!placeholder.isConnected) feed.appendChild(placeholder);
    toggle.disabled = !snapshot.translationEnabled || selected === '__original__';
    if (autoScroll) feed.scrollTop = feed.scrollHeight;
    else if (anchor && anchor.isConnected && !anchor.hidden) feed.scrollTop = oldTop + anchor.getBoundingClientRect().top - anchorTop;
    else feed.scrollTop = Math.max(0, oldTop + feed.scrollHeight - oldHeight);
    updateButton();
  }
  function apply(msg) {
    if (msg.broadcastId && msg.broadcastId !== broadcastId) {
      broadcastId = msg.broadcastId; sequence = -1; known.clear(); unread.clear();
    }
    if (typeof msg.sequence === 'number' && msg.sequence <= sequence) return;
    if (typeof msg.sequence === 'number') sequence = msg.sequence;
    snapshot = msg.data;
    if (!snapshot) { setStatus(L[1], 'wait'); return; }
    updatePicker();
    document.documentElement.dataset.motion = snapshot.uiMotionEnabled === false ? 'false' : 'true';
    var hasText = snapshot.original || Object.values(snapshot.translations || {}).some(Boolean);
    setStatus(snapshot.sessionStatus === 'connecting' ? L[0] : hasText && snapshot.sessionStatus === 'connected' ? L[2] : L[1], hasText ? 'on' : 'wait');
    render();
  }
  function end(invalid) {
    ended = true; clearTimeout(retryTimer); clearTimeout(watchdog);
    setStatus(L[4], 'off'); $('endedText').textContent = invalid ? L[11] : L[4]; $('ended').classList.remove('hidden');
    placeholder.hidden = true; updateButton(); if (socket) socket.close();
  }
  function armWatchdog() { clearTimeout(watchdog); watchdog = setTimeout(function() { if (socket) socket.close(); }, 30000); }
  function schedule() {
    if (ended || retryTimer) return;
    setStatus(L[3], 'off');
    retryTimer = setTimeout(function() { retryTimer = null; connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 1.7, 8000);
  }
  function connect() {
    if (ended) return;
    setStatus(snapshot ? L[3] : L[0], 'wait');
    try { socket = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/share?token=' + encodeURIComponent(token)); }
    catch { schedule(); return; }
    var current = socket;
    current.onopen = function() { if (current !== socket) return; retryDelay = 800; armWatchdog(); };
    current.onmessage = function(event) {
      if (current !== socket || ended) return;
      armWatchdog(); var msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ended') end(false);
      else if (msg.type === 'hello' || msg.type === 'snapshot') { if (msg.type === 'hello') sequence = -1; apply(msg); }
    };
    current.onclose = function(event) { if (current !== socket) return; clearTimeout(watchdog); if (event.code === 1008) end(true); else schedule(); };
    current.onerror = function() { current.close(); };
  }
  picker.addEventListener('change',function() { selected = picker.value; save('freebuff-share-language',selected); render(); });
  toggle.addEventListener('change',function() { showOriginal = toggle.checked; save('freebuff-share-show-original',String(showOriginal)); render(); });
  sizePicker.addEventListener('change',function() { save('freebuff-share-size',sizePicker.value); document.documentElement.style.setProperty('--caption-size',sizePicker.value+'px'); render(); });
  feed.addEventListener('scroll',function() { autoScroll = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56; if (autoScroll) unread.clear(); updateButton(); }, {passive:true});
  button.addEventListener('click',function() { autoScroll = true; unread.clear(); feed.scrollTop = feed.scrollHeight; updateButton(); });
  window.addEventListener('online',function() { if (!ended && (!socket || socket.readyState > 1)) { clearTimeout(retryTimer); retryTimer = null; connect(); } });
  connect();
})();
