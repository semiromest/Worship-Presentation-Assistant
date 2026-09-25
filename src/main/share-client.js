/* Phone reader: dependency-free, stable keyed transcript nodes. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var feed = $('feed'), picker = $('language-picker'), toggle = $('show-original');
  var button = $('return-live'), status = $('status'), dot = $('dot');
  var panel = $('settings-panel'), settingsButton = $('settings-button'), closeButton = $('settings-close');
  var locale = (navigator.language || 'en').split('-')[0];
  var labels = {
    en: { connecting:'Connecting…', waiting:'Waiting for speech', live:'Live', reconnecting:'Connection lost · reconnecting…', ended:'Broadcast ended', all:'All languages', original:'Original', showOriginal:'Also show original', textSize:'Text size', language:'Translation language', returnLive:'Back to live', expired:'This link has expired. Scan the current QR code.', settings:'Reading settings', close:'Close', theme:'Appearance', dark:'Dark', light:'Light', system:'System', smaller:'Smaller text', normal:'Default text', larger:'Larger text', newItems:'new updates' },
    tr: { connecting:'Bağlanıyor…', waiting:'Konuşma bekleniyor', live:'Canlı', reconnecting:'Bağlantı kesildi · yeniden bağlanıyor…', ended:'Yayın sona erdi', all:'Tüm diller', original:'Orijinal', showOriginal:'Orijinali de göster', textSize:'Yazı boyutu', language:'Çeviri dili', returnLive:'Canlıya dön', expired:'Bu bağlantının süresi doldu. Güncel QR kodunu tarayın.', settings:'Okuma ayarları', close:'Kapat', theme:'Görünüm', dark:'Koyu', light:'Açık', system:'Sistem', smaller:'Küçük yazı', normal:'Normal yazı', larger:'Büyük yazı', newItems:'yeni kayıt' },
    de: { connecting:'Verbindung wird hergestellt…', waiting:'Warte auf Sprache', live:'Live', reconnecting:'Verbindung unterbrochen · erneuter Versuch…', ended:'Übertragung beendet', all:'Alle Sprachen', original:'Original', showOriginal:'Original zusätzlich anzeigen', textSize:'Textgröße', language:'Übersetzungssprache', returnLive:'Zur Live-Ansicht', expired:'Dieser Link ist abgelaufen. Bitte den aktuellen QR-Code scannen.', settings:'Leseeinstellungen', close:'Schließen', theme:'Darstellung', dark:'Dunkel', light:'Hell', system:'System', smaller:'Kleiner Text', normal:'Standardtext', larger:'Größerer Text', newItems:'neue Einträge' },
    es: { connecting:'Conectando…', waiting:'Esperando voz', live:'En vivo', reconnecting:'Conexión perdida · reconectando…', ended:'Transmisión finalizada', all:'Todos los idiomas', original:'Original', showOriginal:'Mostrar también el original', textSize:'Tamaño del texto', language:'Idioma de traducción', returnLive:'Volver al directo', expired:'Este enlace ha caducado. Escanea el código QR actual.', settings:'Ajustes de lectura', close:'Cerrar', theme:'Apariencia', dark:'Oscuro', light:'Claro', system:'Sistema', smaller:'Texto pequeño', normal:'Texto normal', larger:'Texto grande', newItems:'nuevas entradas' },
    ko: { connecting:'연결 중…', waiting:'음성 대기 중', live:'실시간', reconnecting:'연결 끊김 · 재연결 중…', ended:'방송 종료', all:'모든 언어', original:'원문', showOriginal:'원문도 표시', textSize:'글자 크기', language:'번역 언어', returnLive:'실시간으로 돌아가기', expired:'링크가 만료되었습니다. 현재 QR 코드를 스캔하세요.', settings:'읽기 설정', close:'닫기', theme:'화면 모드', dark:'어둡게', light:'밝게', system:'시스템', smaller:'작은 글자', normal:'기본 글자', larger:'큰 글자', newItems:'새 항목' }
  };
  var L = labels[locale] || labels.en;
  document.documentElement.lang = labels[locale] ? locale : 'en';
  document.title = L.live + ' · ' + L.language;
  picker.setAttribute('aria-label', L.language);
  settingsButton.setAttribute('aria-label', L.settings);
  closeButton.setAttribute('aria-label', L.close);
  $('settings-title').textContent = L.settings;
  $('size-label').textContent = L.textSize;
  $('original-label').textContent = L.showOriginal;
  $('theme-label').textContent = L.theme;
  $('theme-dark-label').textContent = L.dark;
  $('theme-light-label').textContent = L.light;
  $('theme-system-label').textContent = L.system;

  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch { /* storage is optional */ } }
  var selected = read('freebuff-share-language', '__all__');
  var showOriginal = read('freebuff-share-show-original', 'true') !== 'false';
  var fontSize = read('freebuff-share-size', '22');
  var theme = read('freebuff-share-theme', 'dark');
  var systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  if (!['18','22','26'].includes(fontSize)) fontSize = '22';
  if (!['dark','light','system'].includes(theme)) theme = 'dark';
  toggle.checked = showOriginal;

  var sizeButtons = ['18','22','26'].map(function (value) { return $('size-' + value); });
  var themeButtons = ['dark','light','system'].map(function (value) { return $('theme-' + value); });
  sizeButtons[0].setAttribute('aria-label', L.smaller);
  sizeButtons[1].setAttribute('aria-label', L.normal);
  sizeButtons[2].setAttribute('aria-label', L.larger);
  function applySize(value) {
    fontSize = value;
    document.documentElement.style.setProperty('--caption-size', value + 'px');
    sizeButtons.forEach(function (item) { item.setAttribute('aria-pressed', String(item.dataset.size === value)); });
  }
  function applyTheme(value) {
    theme = value;
    document.documentElement.dataset.theme = value;
    themeButtons.forEach(function (item) { item.setAttribute('aria-pressed', String(item.dataset.themeValue === value)); });
    var meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
    var systemIsLight = value === 'system' && systemThemeQuery && systemThemeQuery.matches;
    if (meta) meta.setAttribute('content', value === 'light' || systemIsLight ? '#f4f6fa' : '#0a0f1a');
  }
  applySize(fontSize);
  applyTheme(theme);

  var languageNames;
  try { languageNames = new Intl.DisplayNames([locale], { type: 'language' }); } catch { /* codes remain available */ }
  function languageName(code) { try { return languageNames ? languageNames.of(code) + ' · ' + code.toUpperCase() : code.toUpperCase(); } catch { return code.toUpperCase(); } }
  var snapshot = null, signature = null, sequence = -1, broadcastId = null;
  var autoScroll = true, unread = new Set(), known = new Set(), cards = new Map(), hasRendered = false;
  var socket, retryTimer, watchdog, connectTimer, retryDelay = 800, ended = false, renderFrame = 0;
  var token = new URLSearchParams(location.search).get('token') || '';
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
  var suppressMotion = false;
  var reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var segmenter;
  try { segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch { /* older Safari uses a conservative boundary */ }

  // Never start a span inside an emoji, combining sequence or Korean syllable.
  function safePrefix(value, limit) {
    if (limit >= value.length) return value.length;
    if (!segmenter) {
      // Older iOS: keep combining marks, ZWJ sequences, flag pairs and Hangul
      // Jamo together. Ordinary Unicode text can still append incrementally.
      var offset = 0, previous = '', regionalCount = 0, fallback = 0;
      for (var character of value) {
        var code = character.codePointAt(0);
        var regional = code >= 0x1f1e6 && code <= 0x1f1ff;
        var joins = /\p{Mark}/u.test(character) || character === '\u200d' || previous === '\u200d' ||
          (code >= 0x1f3fb && code <= 0x1f3ff) || (code >= 0xe0020 && code <= 0xe007f) ||
          (regional && regionalCount % 2 === 1) || (character === '\n' && previous === '\r') ||
          (/[\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u.test(character) && /[\u1100-\u11ff\ua960-\ua97f\uac00-\ud7ff]/u.test(previous));
        if (offset > limit) break;
        if (!joins) fallback = offset;
        regionalCount = regional ? regionalCount + 1 : 0;
        previous = character; offset += character.length;
      }
      return fallback;
    }
    var boundary = 0;
    for (var part of segmenter.segment(value)) {
      if (part.index > limit) break;
      boundary = part.index;
    }
    return boundary;
  }
  function disposeChunk(chunk) { clearTimeout(chunk._timer); chunk._timer = null; chunk.classList.remove('fresh'); }
  function disposeLine(line) { line._chunks.forEach(disposeChunk); }
  function paintChunks(line) {
    var offset = 0;
    line._chunks.forEach(function(chunk) {
      var split = Math.max(0, Math.min(chunk._value.length, line._finalLength - offset));
      var finalText = chunk._value.slice(0, split), partialText = chunk._value.slice(split);
      if (chunk._final.textContent !== finalText) chunk._final.textContent = finalText;
      if (chunk._partial.textContent !== partialText) chunk._partial.textContent = partialText;
      offset += chunk._value.length;
    });
  }
  function compactChunks(line) {
    // Do not replace nodes holding a user's text selection.
    var selection = window.getSelection && window.getSelection();
    for (var i = line._chunks.length - 1; i > 0; i--) {
      var left = line._chunks[i - 1], right = line._chunks[i];
      if (selection && !selection.isCollapsed && (selection.containsNode(left, true) || selection.containsNode(right, true))) continue;
      if (!left._timer && !right._timer) {
        left._value += right._value; right.remove(); line._chunks.splice(i, 1);
      }
    }
    paintChunks(line);
  }
  function updateText(line, finalText, partialText, animate) {
    var value = finalText + partialText, old = line._value;
    var prefix = 0;
    while (prefix < old.length && prefix < value.length && old[prefix] === value[prefix]) prefix++;
    prefix = safePrefix(value, prefix);
    var append = prefix === old.length && value.length > old.length;
    line._finalLength = safePrefix(value, finalText.length);
    if (!animate) line._chunks.forEach(disposeChunk);
    if (value !== old) {
      var offset = 0;
      line._chunks = line._chunks.filter(function(chunk) {
        var start = offset; offset += chunk._value.length;
        if (start >= prefix) { disposeChunk(chunk); chunk.remove(); return false; }
        if (offset > prefix) { chunk._value = chunk._value.slice(0, prefix - start); disposeChunk(chunk); }
        return true;
      });
      var suffix = value.slice(prefix);
      if (suffix) {
        var chunk = element('span', 'text-chunk'); chunk._value = suffix;
        chunk._final = element('span', 'final'); chunk._partial = element('span', 'partial');
        chunk.appendChild(chunk._final); chunk.appendChild(chunk._partial);
        line._chunks.push(chunk); line._text.appendChild(chunk);
        if (animate && append) {
          chunk.classList.add('fresh');
          chunk._timer = setTimeout(function() { disposeChunk(chunk); compactChunks(line); }, 120);
        }
      }
      line._value = value;
    }
    // Bound concurrent fades even if the device receives a burst of updates.
    var active = line._chunks.filter(function(chunk) { return chunk._timer; });
    active.slice(0, Math.max(0, active.length - 8)).forEach(disposeChunk);
    paintChunks(line);
    compactChunks(line);
  }

  function setStatus(text, kind) { if (status.textContent !== text) status.textContent = text; dot.className = 'dot ' + kind; }
  function element(tag, cls, text) { var node = document.createElement(tag); node.className = cls || ''; if (text !== undefined) node.textContent = text; return node; }
  function updatePicker() {
    if (!snapshot) return;
    var targets = snapshot.targetLanguages || Object.keys(snapshot.translations || {});
    var next = targets.join('|');
    if (next === signature) return;
    signature = next;
    picker.replaceChildren();
    [['__all__', L.all], ['__original__', L.original]].concat(targets.map(function(code) { return [code, languageName(code)]; })).forEach(function (item) {
      var option = element('option', '', item[1]); option.value = item[0]; picker.appendChild(option);
    });
    if (selected !== '__all__' && selected !== '__original__' && !targets.includes(selected)) { selected = '__all__'; save('freebuff-share-language', selected); }
    picker.value = selected;
  }
  function updateCard(id, data, live, animate) {
    var card = cards.get(id);
    if (!card) {
      card = element('section', live ? 'entry live' : 'entry');
      card.dataset.id = id;
      card._lines = new Map();
      cards.set(id, card);
    }
    var originalOnly = !snapshot.translationEnabled || selected === '__original__';
    var rows = [];
    if (!originalOnly) {
      var translations = data.translations || {};
      var partialTranslations = live ? (data.partialTranslations || {}) : {};
      var codes = Array.from(new Set(Object.keys(translations).concat(Object.keys(partialTranslations))));
      var primaryCode = (snapshot.targetLanguages || [])[0] || 'translation';
      // `translation` is a legacy scalar mirror of the entry's translation.
      // Only infer the primary language when no language-keyed value exists;
      // otherwise a secondary-language history entry (for example Korean)
      // would be rendered a second time under the primary English label.
      if (!codes.length && (data.translation || data.partialTranslation)) codes.push(primaryCode);
      codes.forEach(function(code) {
        var finalText = translations[code] || (code === primaryCode ? (data.translation || '') : '');
        var partialText = partialTranslations[code] || (live && code === primaryCode ? (data.partialTranslation || '') : '');
        if ((selected === '__all__' || selected === code) && (finalText || partialText)) rows.push([code, languageName(code), finalText, partialText, 'tr']);
      });
    }
    if (originalOnly || showOriginal) {
      var original = data.original || '';
      var partialOriginal = live ? (data.partialOriginal || '') : '';
      if (original || partialOriginal) rows.push(['original', L.original, original, partialOriginal, originalOnly ? 'original-only' : 'orig']);
    }
    var wanted = new Set(rows.map(function(row) { return row[0]; }));
    card._lines.forEach(function(line, key) { if (!wanted.has(key)) { disposeLine(line); line.remove(); card._lines.delete(key); } });
    rows.forEach(function(row) {
      var line = card._lines.get(row[0]);
      if (!line) {
        line = element('div');
        line.appendChild(element('span', 'tag', row[1]));
        line._text = element('span', 'txt'); line._text.dir = 'auto';
        line._chunks = []; line._value = '';
        line.appendChild(line._text);
        card._lines.set(row[0], line); card.appendChild(line);
      }
      line.className = 'line ' + row[4];
      updateText(line, row[2], row[3], animate);
    });
    card.hidden = !rows.length;
    return card;
  }
  var placeholder = element('p', 'placeholder', L.waiting);
  function updateButton() {
    button.classList.toggle('hidden', autoScroll || ended);
    var accessible = L.returnLive + (unread.size ? ', ' + unread.size + ' ' + L.newItems : '');
    button.setAttribute('aria-label', accessible); button.setAttribute('title', L.returnLive);
  }
  function render() {
    if (!snapshot) return;
    var animate = hasRendered && !suppressMotion && snapshot.uiMotionEnabled !== false && !(reducedMotion && reducedMotion.matches) && !document.hidden;
    suppressMotion = false;
    var anchor = Array.from(feed.children).find(function(node) { return !node.hidden && node.getBoundingClientRect().bottom > feed.getBoundingClientRect().top; });
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    var oldTop = feed.scrollTop, oldHeight = feed.scrollHeight;
    var wanted = new Set();
    var items = (snapshot.history || []).map(function(item) { return [item.id, item, false]; });
    items.push(['__live__', snapshot, true]);
    var previous = null;
    items.forEach(function(item) {
      var id = item[0]; wanted.add(id);
      var isNewHistory = !item[2] && hasRendered && !known.has(id);
      var card = updateCard(id, item[1], item[2], item[2] && animate);
      var expected = previous ? previous.nextSibling : feed.firstChild;
      if (expected !== card) feed.insertBefore(card, expected);
      previous = card;
      if (isNewHistory && !autoScroll && !card.hidden) unread.add(id);
    });
    known = new Set((snapshot.history || []).map(function(item) { return item.id; }));
    cards.forEach(function(card, id) { if (!wanted.has(id)) { card._lines.forEach(disposeLine); card.remove(); cards.delete(id); unread.delete(id); } });
    var liveCard = cards.get('__live__');
    var liveHasText = liveCard && !liveCard.hidden;
    placeholder.hidden = liveHasText || ended;
    if (!placeholder.isConnected) feed.appendChild(placeholder);
    toggle.disabled = !snapshot.translationEnabled || selected === '__original__';
    if (autoScroll) feed.scrollTop = feed.scrollHeight;
    else if (anchor && anchor.isConnected && !anchor.hidden) feed.scrollTop = oldTop + anchor.getBoundingClientRect().top - anchorTop;
    else feed.scrollTop = Math.max(0, oldTop + feed.scrollHeight - oldHeight);
    hasRendered = true;
    updateButton();
  }
  function scheduleRender(suppress) {
    if (suppress) suppressMotion = true;
    if (renderFrame) return;
    renderFrame = 1;
    raf(function () { renderFrame = 0; render(); });
  }
  function apply(msg) {
    if (msg.broadcastId && msg.broadcastId !== broadcastId) {
      broadcastId = msg.broadcastId; sequence = -1; known.clear(); unread.clear(); hasRendered = false;
    }
    if (typeof msg.sequence === 'number' && msg.sequence <= sequence) return;
    if (typeof msg.sequence === 'number') sequence = msg.sequence;
    snapshot = msg.data;
    if (!snapshot) { setStatus(L.waiting, 'wait'); return; }
    updatePicker();
    document.documentElement.dataset.motion = snapshot.uiMotionEnabled === false ? 'false' : 'true';
    var hasText = !!(snapshot.original || snapshot.partialOriginal || snapshot.translation || snapshot.partialTranslation || Object.values(snapshot.translations || {}).some(Boolean) || Object.values(snapshot.partialTranslations || {}).some(Boolean));
    setStatus(snapshot.sessionStatus === 'connecting' ? L.connecting : hasText && snapshot.sessionStatus === 'connected' ? L.live : L.waiting, hasText ? 'on' : 'wait');
    scheduleRender();
  }
  function end(invalid) {
    ended = true; clearTimeout(retryTimer); clearTimeout(watchdog); clearTimeout(connectTimer);
    setStatus(L.ended, 'off'); $('endedText').textContent = invalid ? L.expired : L.ended; $('ended').classList.remove('hidden');
    placeholder.hidden = true; updateButton(); if (socket) socket.close();
  }
  function armWatchdog() { clearTimeout(watchdog); watchdog = setTimeout(function() { if (socket) socket.close(); }, 30000); }
  function schedule() {
    if (ended || retryTimer) return;
    setStatus(L.reconnecting, 'off');
    retryTimer = setTimeout(function() { retryTimer = null; connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 1.7, 8000);
  }
  function connect() {
    if (ended) return;
    clearTimeout(connectTimer);
    setStatus(snapshot ? L.reconnecting : L.connecting, 'wait');
    try { socket = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/share?token=' + encodeURIComponent(token)); }
    catch { schedule(); return; }
    var current = socket;
    connectTimer = setTimeout(function() { if (current === socket && current.readyState === 0) current.close(); }, 12000);
    current.onopen = function() { if (current !== socket) return; clearTimeout(connectTimer); connectTimer = null; retryDelay = 800; armWatchdog(); };
    current.onmessage = function(event) {
      if (current !== socket || ended) return;
      armWatchdog(); var msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ended') end(false);
      else if (msg.type === 'hello' || msg.type === 'snapshot') { if (msg.type === 'hello') { sequence = -1; suppressMotion = true; } apply(msg); }
    };
    current.onclose = function(event) { if (current !== socket) return; clearTimeout(connectTimer); connectTimer = null; clearTimeout(watchdog); if (event.code === 1008) end(true); else schedule(); };
    current.onerror = function() { current.close(); };
  }
  function openSettings() {
    settingsButton.setAttribute('aria-expanded', 'true');
    if (typeof panel.showModal === 'function') panel.showModal();
    else {
      panel.setAttribute('open', '');
      document.body.classList.add('sheet-open');
      $('wrap').setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-hidden', 'true');
      if ('inert' in $('wrap')) $('wrap').inert = true;
      if ('inert' in button) button.inert = true;
    }
    if (closeButton.focus) closeButton.focus();
  }
  function closeSettings() {
    if (typeof panel.close === 'function') panel.close();
    else panel.removeAttribute('open');
    document.body.classList.remove('sheet-open');
    $('wrap').removeAttribute('aria-hidden');
    button.removeAttribute('aria-hidden');
    if ('inert' in $('wrap')) $('wrap').inert = false;
    if ('inert' in button) button.inert = false;
    settingsButton.setAttribute('aria-expanded', 'false'); if (settingsButton.focus) settingsButton.focus();
  }
  picker.addEventListener('change', function() { selected = picker.value; save('freebuff-share-language', selected); scheduleRender(true); });
  toggle.addEventListener('change', function() { showOriginal = toggle.checked; save('freebuff-share-show-original', String(showOriginal)); scheduleRender(true); });
  sizeButtons.forEach(function(item) { item.addEventListener('click', function() { applySize(item.dataset.size); save('freebuff-share-size', fontSize); scheduleRender(true); }); });
  themeButtons.forEach(function(item) { item.addEventListener('click', function() { applyTheme(item.dataset.themeValue); save('freebuff-share-theme', theme); scheduleRender(true); }); });
  settingsButton.addEventListener('click', openSettings); closeButton.addEventListener('click', closeSettings);
  panel.addEventListener('close', function() { settingsButton.setAttribute('aria-expanded', 'false'); });
  panel.addEventListener('click', function(event) { if (event.target === panel) closeSettings(); });
  panel.addEventListener('keydown', function(event) {
    if (typeof panel.showModal === 'function' || event.key !== 'Tab') return;
    var focusable = [closeButton].concat(sizeButtons, [toggle], themeButtons);
    var index = focusable.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
    else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
  });
  feed.addEventListener('scroll', function() { autoScroll = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56; if (autoScroll) unread.clear(); updateButton(); }, { passive:true });
  button.addEventListener('click', function() { autoScroll = true; unread.clear(); feed.scrollTop = feed.scrollHeight; updateButton(); });
  function recoverConnection() {
    if (ended || (socket && socket.readyState === 1)) return;
    clearTimeout(retryTimer); retryTimer = null;
    clearTimeout(connectTimer); connectTimer = null;
    if (socket && socket.readyState === 0) socket.close();
    connect();
  }
  window.addEventListener('online', recoverConnection);
  window.addEventListener('pageshow', recoverConnection);
  window.addEventListener('keydown', function(event) { if (event.key === 'Escape' && panel.hasAttribute('open') && typeof panel.showModal !== 'function') closeSettings(); });
  if (systemThemeQuery) {
    var syncSystemTheme = function() { if (theme === 'system') applyTheme(theme); };
    if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', syncSystemTheme);
    else if (systemThemeQuery.addListener) systemThemeQuery.addListener(syncSystemTheme);
  }
  if (reducedMotion) {
    var syncMotion = function() { scheduleRender(true); };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncMotion);
    else if (reducedMotion.addListener) reducedMotion.addListener(syncMotion);
  }
  updateButton(); connect();
})();
