/* ── State ──────────────────────────────────────────────────────────── */
let ws, rTimer, rDelay = 1200;
let st = {
  slideCount: 0, currentIndex: 0,
  isBlackout: false, isProjectorOpen: false,
  slideTransition: 'fade', transitionDurationMs: 400,
  activePart: null,   // number | null — set when live slide is partsMode
  partsCount: null,   // number | null
};
let allPreviews = []; // string[]
let slideMeta = null; // {partsMode,parts,title}[] | null — per-slide metadata
let lastMetaKey = ''; // JSON snapshot of slideMeta, used to skip redundant renders
let partsChipsKey = ''; // JSON snapshot of live parts, used to rebuild bar chips only on change

/* ── Timer state ─────────────────────────────────────────────────────── */
let timerStart    = null; // ms epoch when timer last started, null = never started
let timerInterval = null;

/* ── DOM refs ────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dot       = $('dot');
const pill      = $('pill');
const connTxt   = $('connTxt');
const imgA      = $('imgA');
const imgB      = $('imgB');
const ph        = $('ph');
const slideChip = $('slideChip');
const bbOverlay = $('bbOverlay');
const bbTag     = $('bbTag');
const bbBtn     = $('bbBtn');
const bbTxt     = $('bbTxt');
const progFill  = $('progFill');
const cCur      = $('cCur');
const cTotal    = $('cTotal');
const projDot   = $('projDot');
const projTxt   = $('projTxt');
const frame     = $('frame');
const arrows    = $('swipeArrows');
const slidesGrid = $('slidesGrid');
const timerEl    = $('timer');
const partsBar   = $('partsBar');
const partsCtr   = $('partsCtr');
const partsChips = $('partsChips');
const btnPrev = document.querySelector('.btn-prev');
const btnNext = document.querySelector('.btn-next');

/* ── WebSocket ───────────────────────────────────────────────────────── */
function connect() {
  try { ws = new WebSocket('ws://' + location.host); }
  catch (e) { scheduleReconnect(); return; }

  ws.onopen = () => {
    dot.className = 'dot ok';
    pill.className = 'pill ok';
    connTxt.textContent = 'Connected';
    rDelay = 1200;
    reconnectScheduled = false;
    clearTimeout(rTimer);
    startTimer();
  };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'welcome') {
        applyStatus(msg.data.status);
        if (msg.data.preview)     showPreview(msg.data.preview);
        if (msg.data.allPreviews) { mergePreviews(msg.data.allPreviews); renderGrid(); }
        if (msg.data.slideMeta)   { mergeSlideMeta(msg.data.slideMeta); renderGrid(); }
      }
      else if (msg.type === 'status')      { applyStatus(msg.data); }
      else if (msg.type === 'preview')     { showPreview(msg.data); }
      else if (msg.type === 'allPreviews') { mergePreviews(msg.data); renderGrid(); }
      else if (msg.type === 'slideMeta')   { mergeSlideMeta(msg.data); renderGrid(); }
    } catch (e) {
      console.warn('[remote] ws parse error', e);
    }
  };

  ws.onclose = () => {
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onerror is followed by onclose in normal browsers, but do not rely
    // on that behavior. scheduleReconnect() is idempotent via clearTimeout().
    try { ws.close(); } catch {}
  };
}

let reconnectScheduled = false;

function scheduleReconnect() {
  dot.className = 'dot';
  pill.className = 'pill';
  connTxt.textContent = 'Reconnecting…';
  freezeTimer();

  // Prevent duplicate reconnect timers when error/close fire together.
  if (reconnectScheduled) return;
  reconnectScheduled = true;

  clearTimeout(rTimer);
  rTimer = setTimeout(() => {
    reconnectScheduled = false;
    rDelay = Math.min(rDelay * 1.6, 12000);
    connect();
  }, rDelay);
}

/* ── Timer ───────────────────────────────────────────────────────────── */
function pad2(n) { return String(n).padStart(2, '0'); }

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  return pad2(Math.floor(totalSec / 60)) + ':' + pad2(totalSec % 60);
}

function updateTimerDisplay() {
  if (timerStart === null) return;
  timerEl.textContent = formatElapsed(Date.now() - timerStart);
}

function startTimer() {
  stopTimer();
  timerStart = Date.now();
  timerEl.className = 'timer running';
  timerEl.textContent = '00:00';
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function freezeTimer() {
  if (timerStart !== null) updateTimerDisplay();
  stopTimer();
  timerEl.className = 'timer frozen';
}

// Clicking the timer always starts a fresh session timer, even before the
// first WebSocket connection has been established.
timerEl.addEventListener('click', startTimer);

/* ── Status ──────────────────────────────────────────────────────────── */
function applyStatus(d) {
  const prev = st.currentIndex;
  st = { ...st, ...d };

  const c = st.slideCount ? st.currentIndex + 1 : null;
  const t = st.slideCount || null;

  cCur.textContent   = t ? pad(c) : '\u2014';
  cTotal.textContent = t ? pad(t) : '\u2014';
  cCur.className     = 'cnt-cur' + (st.isBlackout ? ' bb' : '');

  if (t && prev !== st.currentIndex) {
    cCur.classList.add('bump');
    setTimeout(() => cCur.classList.remove('bump'), 200);
  }

  // FIX: apply pad() consistently to slideChip to match counter display
  slideChip.textContent = t ? (pad(c) + ' / ' + pad(t)) : '\u2014 / \u2014';

  const pct = t > 1 ? (st.currentIndex / (t - 1)) * 100 : 0;
  progFill.style.width = pct + '%';
  progFill.classList.toggle('live', t > 0);

  bbOverlay.className = 'bb-overlay' + (st.isBlackout ? ' on' : '');
  bbTag.className     = 'bb-tag'     + (st.isBlackout ? ' on' : '');
  bbBtn.className     = 'btn btn-bb btn-w' + (st.isBlackout ? ' on' : '');
  bbTxt.textContent   = st.isBlackout ? 'Blackout \u2014 tap to close' : 'Blackout';

  projDot.className   = 'proj-dot' + (st.isProjectorOpen ? ' on' : '');
  projTxt.textContent = st.isProjectorOpen ? 'On' : 'Off';

  // Status can arrive before allPreviews (or with a changed slide count).
  // Keep the grid structure synchronized with the authoritative slide count.
  const targetCount = Math.max(0, Number(st.slideCount) || 0);
  if (allPreviews.length !== targetCount) {
    if (allPreviews.length > targetCount) {
      allPreviews.length = targetCount;
    } else {
      while (allPreviews.length < targetCount) allPreviews.push(null);
    }
    renderGrid();
  } else {
    updateGridActive();
  }

  if (btnPrev) btnPrev.disabled = !t || st.currentIndex <= 0;
  if (btnNext) btnNext.disabled = !t || st.currentIndex >= t - 1;

  updatePartsBar();
}

function pad(n) {
  const width = st.slideCount > 0 ? String(st.slideCount).length : 2;
  return String(n).padStart(width, '0');
}

/* ── Parts bar ───────────────────────────────────────────────────────── */
function partLabel(text, idx) {
  if (!text) return String(idx + 1);
  // Take up to the first two lines (verse + first couplet) collapsed into
  // one readable label; full-width chips clamp it visually at 2 lines.
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const joined = (lines[0] || '') + (lines[1] ? ' \u00b7 ' + lines[1] : '');
  const clean = joined.replace(/\s+/g, ' ').trim();
  const max = 64;
  if (clean.length <= max) return (idx + 1) + '. ' + clean;
  const cut = clean.slice(0, max).replace(/\s+\S*$/, '').trim();
  return (idx + 1) + '. ' + (cut || clean.slice(0, max)) + '\u2026';
}

function updatePartsBar() {
  const pc = st.partsCount;
  const isPartsMode = (pc !== null && pc !== undefined && pc > 1);
  partsBar.classList.toggle('on', isPartsMode);
  if (!isPartsMode) return;

  const ap = (st.activePart !== null && st.activePart !== undefined) ? st.activePart : 0;

  // counter text e.g. "2 / 5"
  partsCtr.textContent = (ap + 1) + ' / ' + pc;

  // Prefer real part texts for labels; fall back to numbered chips when
  // slideMeta has not arrived yet.
  const meta = slideMeta && slideMeta[st.currentIndex];
  const parts = meta && meta.partsMode && Array.isArray(meta.parts) && meta.parts.length === pc
    ? meta.parts
    : Array.from({ length: pc }, () => '');

  // rebuild chips only when the part set (or its labels) actually changed
  const key = JSON.stringify(parts);
  if (partsChipsKey !== key) {
    partsChipsKey = key;
    partsChips.innerHTML = '';
    parts.forEach((partText, i) => {
      const label = partLabel(partText, i);
      const chip = document.createElement('button');
      chip.className = 'part-chip';
      chip.dataset.part = i;
      const txt = document.createElement('span');
      txt.className = 'part-chip-txt';
      txt.textContent = label;
      chip.appendChild(txt);
      chip.setAttribute('aria-pressed', 'false');
      chip.setAttribute('aria-label', 'Part ' + (i + 1) + ': ' + label);
      chip.addEventListener('click', () => cmd('partGoto', { slide: st.currentIndex, part: i }));
      partsChips.appendChild(chip);
    });
  }
  Array.from(partsChips.children).forEach((chip, i) => {
    const isActive = i === ap;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });
}

/* ── Slides Grid ─────────────────────────────────────────────────────── */
function mergePreviews(newData) {
  if (!Array.isArray(newData)) return;
  while (allPreviews.length < newData.length) allPreviews.push(null);
  newData.forEach((url, i) => { if (url) allPreviews[i] = url; });
}

function mergeSlideMeta(meta) {
  if (!Array.isArray(meta)) return;
  const key = JSON.stringify(meta);
  if (key === lastMetaKey) return;
  lastMetaKey = key;
  slideMeta = meta;
  updatePartsBar();
}

function buildPartCard(i, meta) {
  const card = document.createElement('div');
  card.className = 'part-card' + (i === st.currentIndex ? ' active' : '');
  card.dataset.slide = i;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Slide ' + (i + 1) + ' parts');

  const hdr = document.createElement('div');
  hdr.className = 'part-card-hdr';

  const num = document.createElement('span');
  num.className = 'part-card-num';
  num.textContent = String(i + 1);
  num.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'part-card-title';
  title.textContent = meta.title || 'Parts';

  const count = document.createElement('span');
  count.className = 'part-card-count';

  hdr.append(num, title, count);

  const chips = document.createElement('div');
  chips.className = 'part-chips';

  meta.parts.forEach((partText, p) => {
    const label = partLabel(partText, p);
    const chip = document.createElement('button');
    chip.className = 'part-chip';
    chip.dataset.part = p;
    const txt = document.createElement('span');
    txt.className = 'part-chip-txt';
    txt.textContent = label;
    chip.appendChild(txt);
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', 'Slide ' + (i + 1) + ', part ' + (p + 1) + ': ' + label);
    chip.addEventListener('click', () => cmd('partGoto', { slide: i, part: p }));
    chips.appendChild(chip);
  });

  card.append(hdr, chips);
  return card;
}

function renderGrid() {
  if (!allPreviews.length) {
    slidesGrid.innerHTML = '<div class="slides-empty">No slides</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  allPreviews.forEach((dataUrl, i) => {
    const meta = (slideMeta && slideMeta[i]) || null;
    // partsMode slides render as an inline part selector instead of a thumb
    if (meta && meta.partsMode && Array.isArray(meta.parts) && meta.parts.length > 1) {
      frag.appendChild(buildPartCard(i, meta));
      return;
    }

    const thumb = document.createElement('div');
    thumb.className = 'slide-thumb' + (i === st.currentIndex ? ' active' : '');
    thumb.dataset.index = i;
    thumb.setAttribute('tabindex', '0');
    thumb.setAttribute('role', 'button');
    thumb.setAttribute('aria-label', 'Go to slide ' + (i + 1));

    const live = document.createElement('div');
    live.className = 'thumb-live';
    thumb.appendChild(live);

    if (dataUrl) {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Slide ' + (i + 1) + ' of ' + allPreviews.length;
      // Keep the first viewport-sized batch immediately available; lazy-load
      // the rest so large presentations do not decode every thumbnail at once.
      img.loading = i < 6 ? 'eager' : 'lazy';
      img.decoding = 'async';
      thumb.appendChild(img);
    } else {
      const phDiv = document.createElement('div');
      phDiv.className = 'thumb-ph';
      phDiv.innerHTML = '<svg class="thumb-ph-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="m8 21 4-4 4 4"/></svg>';
      thumb.appendChild(phDiv);
    }

    const num = document.createElement('span');
    num.className = 'thumb-num';
    num.textContent = String(i + 1);
    num.setAttribute('aria-hidden', 'true');
    thumb.appendChild(num);

    thumb.addEventListener('click', () => cmd('goto', i));
    thumb.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cmd('goto', i); }
    });

    frag.appendChild(thumb);
  });

  slidesGrid.innerHTML = '';
  slidesGrid.appendChild(frag);
  // renderGrid rebuilds every card/chip from scratch (e.g. after every
  // allPreviews broadcast), so re-apply the current-slide / current-part
  // highlight or the blue active state would flash and vanish.
  updateGridActive();
}

function updateGridActive() {
  slidesGrid.querySelectorAll('.slide-thumb').forEach(th => {
    th.classList.toggle('active', Number(th.dataset.index) === st.currentIndex);
  });
  slidesGrid.querySelectorAll('.part-card').forEach(card => {
    const i = Number(card.dataset.slide);
    const active = i === st.currentIndex;
    card.classList.toggle('active', active);

    const countEl = card.querySelector('.part-card-count');
    if (countEl) {
      const meta = slideMeta && slideMeta[i];
      const total = meta && Array.isArray(meta.parts) ? meta.parts.length : null;
      countEl.textContent = active && total ? ((st.activePart ?? 0) + 1) + ' / ' + total : '';
    }

    card.querySelectorAll('.part-chip').forEach(chip => {
      const p = Number(chip.dataset.part);
      const isActive = active && p === (st.activePart ?? 0);
      chip.classList.toggle('active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });
  });
}

/* ── Preview crossfade ───────────────────────────────────────────────── */
let activeImg = 'A';
let lastUrl   = '';
// FIX: track in-flight transition so race conditions are avoided
let transitionPending = false;

function norm(t) {
  const m = {
    slideLeft:'slide-left', slideRight:'slide-right',
    slideUp:'slide-up',     slideDown:'slide-down',
    none:'none', fade:'fade', zoom:'zoom', zoomOut:'zoom',
    blur:'blur', flip:'flip',
    'slide-left':'slide-left', 'slide-right':'slide-right',
    'slide-up':'slide-up',     'slide-down':'slide-down',
  };
  return m[t] || 'fade';
}

// FIX: layerStyle now correctly handles slide-up/down (Y axis) and
//      provides actual transforms for blur and flip transitions.
function layerStyle(tr, which, phase) {
  tr = norm(tr);
  if (tr === 'none') return { opacity: 1, transform: 'none', filter: 'none' };

  const isTo   = which === 'to';
  const before = phase === 'before';
  const active = phase === 'active';

  if (tr === 'fade') {
    const op = before ? (isTo ? 0 : 1) : (active ? (isTo ? 1 : 0) : 1);
    return { opacity: op, transform: 'none', filter: 'none' };
  }

  if (tr === 'zoom') {
    const op = before ? (isTo ? 0 : 1) : (active ? (isTo ? 1 : 0) : 1);
    const sc = before ? (isTo ? 0.96 : 1) : (active ? (isTo ? 1 : 1.04) : 1);
    return { opacity: op, transform: 'scale(' + sc + ')', filter: 'none' };
  }

  // FIX: blur uses actual CSS blur filter instead of falling through to fade
  if (tr === 'blur') {
    const op  = before ? (isTo ? 0 : 1) : (active ? (isTo ? 1 : 0) : 1);
    const blr = before ? (isTo ? '12px' : '0px') : (active ? (isTo ? '0px' : '8px') : '0px');
    return { opacity: op, transform: 'none', filter: 'blur(' + blr + ')' };
  }

  // FIX: flip uses rotateY (genuine flip) instead of falling through to fade
  if (tr === 'flip') {
    const op  = before ? (isTo ? 0 : 1) : (active ? (isTo ? 1 : 0) : 1);
    const rot = before ? (isTo ? 'rotateY(90deg)' : 'rotateY(0deg)')
                       : (active ? (isTo ? 'rotateY(0deg)' : 'rotateY(-90deg)') : 'rotateY(0deg)');
    return { opacity: op, transform: rot, filter: 'none' };
  }

  // Slide transitions — FIX: slide-up/down now use Y axis correctly
  const isHoriz = tr === 'slide-left' || tr === 'slide-right';
  const dir     = (tr === 'slide-left' || tr === 'slide-up') ? 1 : -1;
  const fromPct = before ? 0 : (active ? (-18 * dir) : 0);
  const toPct   = before ? (24 * dir) : (active ? 0 : 0);
  const op      = before ? 1 : (active ? (isTo ? 1 : 0.15) : 1);

  const fromTransform = isHoriz
    ? 'translateX(' + fromPct + '%)'
    : 'translateY(' + fromPct + '%)';
  const toTransform = isHoriz
    ? 'translateX(' + toPct + '%)'
    : 'translateY(' + toPct + '%)';

  return { opacity: op, transform: isTo ? toTransform : fromTransform, filter: 'none' };
}

function applyLayer(img, s) {
  img.style.opacity   = String(s.opacity);
  img.style.transform = s.transform;
  img.style.filter    = s.filter || 'none';
}

function showPreview(url) {
  if (!url || url === lastUrl) return;
  lastUrl = url;

  const dur  = Math.max(0, Math.min(+(st.transitionDurationMs) || 0, 2000));
  const tr   = norm(st.slideTransition || 'fade');
  const anim = tr !== 'none' && dur > 0;

  const from = activeImg === 'A' ? imgA : imgB;
  const to   = activeImg === 'A' ? imgB : imgA;

  // FIX: cancel any previous pending transition to prevent race conditions
  // on rapid slide changes — flip activeImg immediately so next call is consistent
  if (transitionPending) {
    from.style.opacity = '0';
    from.style.display = 'none';
    from.style.filter  = 'none';
    activeImg = activeImg === 'A' ? 'B' : 'A';
    transitionPending = false;
  }

  to.onload = () => {
    ph.style.display = 'none';
    from.style.display = to.style.display = '';

    const ease = 'opacity ' + dur + 'ms ease, transform ' + dur + 'ms cubic-bezier(0.22,1,0.36,1), filter ' + dur + 'ms ease';
    from.style.transition = to.style.transition = anim ? ease : 'none';

    applyLayer(from, layerStyle(tr, 'from', 'before'));
    applyLayer(to,   layerStyle(tr, 'to',   'before'));

    // Two frames guarantee that the initial state is committed before the
    // active state is applied, making CSS transitions reliable across browsers.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyLayer(from, layerStyle(tr, 'from', 'active'));
      applyLayer(to,   layerStyle(tr, 'to',   'active'));
      });
    });

    if (!anim) {
      from.style.opacity = '0'; from.style.display = 'none';
      from.style.filter  = 'none';
      activeImg = activeImg === 'A' ? 'B' : 'A';
      transitionPending = false;
      return;
    }

    transitionPending = true;
    setTimeout(() => {
      from.style.opacity = '0'; from.style.display = 'none';
      from.style.filter  = 'none';
      activeImg = activeImg === 'A' ? 'B' : 'A';
      transitionPending = false;
    }, dur + 30);
  };

  to.onerror = () => {
    to.style.opacity = '0'; to.style.display = 'none';
    ph.style.display = '';
    transitionPending = false;
  };
  to.src = url;
}

/* ── Commands ────────────────────────────────────────────────────────── */
function cmd(action, value) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (action === 'next' || action === 'prev' || action === 'goto' ||
      action === 'partNext' || action === 'partPrev' || action === 'partGoto') lastUrl = '';
  ws.send(JSON.stringify({ type: 'command', action, value }));
}

// FIX: gotoSlide now shows visual feedback when the input is invalid or empty
function gotoSlide() {
  const inp = $('gotoInp');
  const v   = parseInt(inp.value, 10);

  if (!st.slideCount) return; // no presentation loaded

  if (isNaN(v) || v < 1 || v > st.slideCount) {
    // Flash invalid state so the user understands the value is out of range
    inp.classList.add('invalid');
    setTimeout(() => inp.classList.remove('invalid'), 600);
    return;
  }

  cmd('goto', v - 1);
  inp.value = '';
}

/* ── Swipe ───────────────────────────────────────────────────────────── */
let tx0 = 0, ty0 = 0, isSwiping = false, arrowTimer;

frame.addEventListener('touchstart', e => {
  tx0 = e.touches[0].clientX;
  ty0 = e.touches[0].clientY;
  isSwiping = true;
  arrows.classList.add('show');
  clearTimeout(arrowTimer);
}, { passive: true });

frame.addEventListener('touchend', e => {
  if (!isSwiping) return;
  isSwiping = false;
  arrowTimer = setTimeout(() => arrows.classList.remove('show'), 700);

  const dx = e.changedTouches[0].clientX - tx0;
  const dy = e.changedTouches[0].clientY - ty0;

  // FIX: raised threshold from 42 to 60px to reduce accidental swipes,
  //      and tightened directionality ratio from 1.4 to 1.8
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
    dx < 0 ? cmd('next') : cmd('prev');
  }
}, { passive: true });

/* ── Button ripple ───────────────────────────────────────────────────── */
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    const r = btn.getBoundingClientRect();
    const t = e.touches[0];
    btn.style.setProperty('--rx', ((t.clientX - r.left)  / r.width  * 100) + '%');
    btn.style.setProperty('--ry', ((t.clientY - r.top)   / r.height * 100) + '%');
  }, { passive: true });
});

/* ── Keyboard ────────────────────────────────────────────────────────── */
// Go-to input lives in a <form>; its submit event (mobile "Go"/Enter key
// and desktop Enter alike) is handled below, so no keydown special-casing
// is needed here.
document.getElementById('gotoForm').addEventListener('submit', e => {
  e.preventDefault();
  gotoSlide();
});

document.addEventListener('keydown', e => {
  const active = document.activeElement;

  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); cmd('next'); }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')                     { e.preventDefault(); cmd('prev'); }
  if (e.key === 'b' || e.key === 'B') cmd('blackout');
  if (e.key === 'Enter') gotoSlide();
  // Part navigation shortcuts: , = prev part, . = next part
  if (e.key === ',') cmd('partPrev');
  if (e.key === '.') cmd('partNext');
});

/* ── Boot ────────────────────────────────────────────────────────────── */
connect();