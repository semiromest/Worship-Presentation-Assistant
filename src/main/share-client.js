/* ── Phone captions/translation client ─────────────────────────────────────
   Loaded from /share?token=… — connects a WebSocket to the same host and
   renders the normalized caption/translation snapshot streamed by the app.
   No third-party code, no Node, no Soniox access: only these strings. */

(function () {
  'use strict';

  var feed = document.getElementById('feed');
  var statusEl = document.getElementById('status');
  var dotEl = document.getElementById('dot');
  var endedEl = document.getElementById('ended');
  var endedTextEl = document.getElementById('endedText');

  var lang = (navigator.language || 'en').toLowerCase();
  var L = lang.indexOf('tr') === 0 ? {
    connecting: 'Bağlanıyor…',
    connected: 'Bağlandı',
    waiting: 'Yayın Bekleniyor',
    listening: 'Dinleniyor…',
    waitingSpeech: 'Konuşmayı bekliyorum…',
    ended: 'Yayın Sona Erdi',
    translation: 'ÇEVİRİ',
    original: 'ORİJİNAL'
  } : lang.indexOf('es') === 0 ? {
    connecting: 'Conectando…',
    connected: 'Conectado',
    waiting: 'Esperando transmisión',
    listening: 'Escuchando…',
    waitingSpeech: 'Esperando voz…',
    ended: 'Transmisión finalizada',
    translation: 'TRADUCCIÓN',
    original: 'ORIGINAL'
  } : lang.indexOf('de') === 0 ? {
    connecting: 'Verbindung…',
    connected: 'Verbunden',
    waiting: 'Warte auf Übertragung',
    listening: 'Hört zu…',
    waitingSpeech: 'Warte auf Sprache…',
    ended: 'Übertragung beendet',
    translation: 'ÜBERSETZUNG',
    original: 'ORIGINAL'
  } : lang.indexOf('ko') === 0 ? {
    connecting: '연결 중…',
    connected: '연결됨',
    waiting: '방송 대기 중',
    listening: '듣는 중…',
    waitingSpeech: '음성을 기다리는 중…',
    ended: '방송 종료',
    translation: '번역',
    original: '원문'
  } : {
    connecting: 'Connecting…',
    connected: 'Connected',
    waiting: 'Waiting for broadcast',
    listening: 'Listening…',
    waitingSpeech: 'Waiting for speech…',
    ended: 'Broadcast ended',
    translation: 'TRANSLATION',
    original: 'ORIGINAL'
  };

  var token = new URLSearchParams(location.search).get('token') || '';
  var socket = null;
  var reconnectDelay = 800;
  var reconnectTimer = null;
  var ended = false;
  var autoScroll = true;
  var snapshot = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    dotEl.className = 'dot ' + (kind || 'idle');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function isNearBottom() {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;
  }

  function line(cls, label, text) {
    var wrap = el('div', 'line ' + cls);
    if (label) wrap.appendChild(el('span', 'tag', label));
    wrap.appendChild(el('span', 'txt', text));
    return wrap;
  }

  function render() {
    feed.textContent = '';
    var s = snapshot;
    var translationEnabled = s ? s.translationEnabled : true;

    if (s && Array.isArray(s.history)) {
      for (var i = 0; i < s.history.length; i++) {
        var h = s.history[i];
        if (translationEnabled && h.translation) {
          feed.appendChild(line('tr', L.translation, h.translation));
        }
        if (h.original) {
          feed.appendChild(line('orig', translationEnabled && h.translation ? L.original : null, h.original));
        }
      }
    }

    var liveOriginal = s ? (s.original || '').trim() : '';
    var liveTranslation = s ? (s.translation || '').trim() : '';
    var useLast = !liveOriginal && !liveTranslation;
    if (useLast && s) {
      liveOriginal = (s.lastOriginal || '').trim();
      liveTranslation = (s.lastTranslation || '').trim();
    }

    var hasLive = liveOriginal || liveTranslation;
    var sessionActive = s ? s.sessionStatus === 'connected' || s.sessionStatus === 'connecting' : false;

    if (hasLive) {
      var live = el('div', 'live');
      if (translationEnabled && liveTranslation) {
        live.appendChild(line('tr', L.translation, liveTranslation));
      }
      if (liveOriginal) {
        live.appendChild(line('orig', translationEnabled && liveTranslation ? L.original : null, liveOriginal));
      }
      if (sessionActive && !useLast) live.classList.add('live-active');
      feed.appendChild(live);
    } else if (s && sessionActive) {
      feed.appendChild(el('div', 'placeholder', L.waitingSpeech));
    }

    if (autoScroll) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function apply(data) {
    snapshot = data || null;
    var active = snapshot ? snapshot.sessionStatus === 'connected' || snapshot.sessionStatus === 'connecting' : false;
    if (active) setStatus(L.listening, 'on');
    else setStatus(L.waiting, 'idle');
    render();
  }

  function connect() {
    if (ended) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    setStatus(L.connecting, 'wait');
    var url = proto + '//' + location.host + '/share?token=' + encodeURIComponent(token);

    try {
      socket = new WebSocket(url);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      reconnectDelay = 800;
      if (!snapshot) setStatus(L.connected, 'on');
    };

    socket.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'hello') {
        apply(msg.data);
      } else if (msg.type === 'snapshot') {
        apply(msg.data);
      } else if (msg.type === 'ended') {
        ended = true;
        setStatus(L.ended, 'off');
        feed.textContent = '';
        if (endedTextEl) endedTextEl.textContent = L.ended;
        endedEl.classList.remove('hidden');
        try { socket.close(); } catch (e) { /* ignore */ }
      }
    };

    socket.onclose = function () {
      if (ended) return;
      scheduleReconnect();
    };

    socket.onerror = function () {
      try { socket.close(); } catch (e) { /* ignore */ }
    };
  }

  function scheduleReconnect() {
    if (ended || reconnectTimer) return;
    setStatus(L.connecting, 'wait');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
  }

  feed.addEventListener('scroll', function () {
    if (isNearBottom()) autoScroll = true;
    else autoScroll = false;
  }, { passive: true });

  connect();
})();
