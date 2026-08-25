/* ── Phone live-screen client ───────────────────────────────────────────────
   Loaded from /screen?token=… — connects a WebSocket to the same host and
   renders JPEG frames streamed by the app fullscreen (view-only). No third
   party code, no Node, no Electron API: only images. */

(function () {
  'use strict';

  var img = document.getElementById('frame');
  var statusEl = document.getElementById('status');
  var dotEl = document.getElementById('dot');
  var endedEl = document.getElementById('ended');
  var endedTextEl = document.getElementById('endedText');

  var lang = (navigator.language || 'en').toLowerCase();
  var L = lang.indexOf('tr') === 0 ? {
    connecting: 'Bağlanıyor…',
    live: 'Canlı',
    waiting: 'Yayın Bekleniyor',
    ended: 'Yayın Sona Erdi'
  } : lang.indexOf('es') === 0 ? {
    connecting: 'Conectando…',
    live: 'En vivo',
    waiting: 'Esperando transmisión',
    ended: 'Transmisión finalizada'
  } : lang.indexOf('de') === 0 ? {
    connecting: 'Verbindung…',
    live: 'Live',
    waiting: 'Warte auf Übertragung',
    ended: 'Übertragung beendet'
  } : lang.indexOf('ko') === 0 ? {
    connecting: '연결 중…',
    live: '라이브',
    waiting: '방송 대기 중',
    ended: '방송 종료'
  } : {
    connecting: 'Connecting…',
    live: 'Live',
    waiting: 'Waiting for broadcast',
    ended: 'Broadcast ended'
  };

  var token = new URLSearchParams(location.search).get('token') || '';
  var socket = null;
  var reconnectDelay = 800;
  var reconnectTimer = null;
  var ended = false;
  var lastFrameAt = 0;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    dotEl.className = 'dot ' + (kind || 'idle');
  }

  function showEnded() {
    ended = true;
    setStatus(L.ended, 'off');
    if (endedTextEl) endedTextEl.textContent = L.ended;
    endedEl.classList.remove('hidden');
    try { socket.close(); } catch (e) { /* ignore */ }
  }

  // After 4s without a frame, show "waiting" instead of a stale "live".
  var stallTimer = null;
  function armStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(function () {
      if (!ended) setStatus(L.waiting, 'idle');
    }, 4000);
  }

  function applyFrame(data) {
    if (ended || !data) return;
    img.src = data;
    setStatus(L.live, 'on');
    lastFrameAt = Date.now();
    armStallTimer();
  }

  function connect() {
    if (ended) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    setStatus(L.connecting, 'wait');
    var url = proto + '//' + location.host + '/screen?token=' + encodeURIComponent(token);

    try {
      socket = new WebSocket(url);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      reconnectDelay = 800;
      if (!lastFrameAt) setStatus(L.connecting, 'wait');
    };

    socket.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'hello') {
        applyFrame(msg.data);
      } else if (msg.type === 'frame') {
        applyFrame(msg.data);
      } else if (msg.type === 'ended') {
        showEnded();
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

  // Tap anywhere toggles the status pill (fullscreen immersion).
  var pillHidden = false;
  document.addEventListener('click', function () {
    pillHidden = !pillHidden;
    var pill = document.getElementById('bar');
    if (pill) pill.classList.toggle('hidden', pillHidden);
  });

  connect();
})();
