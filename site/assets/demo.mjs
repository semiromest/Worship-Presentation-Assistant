import { getLanguage, onLanguageChange, t } from './common.mjs';
import { samples } from './strings.mjs';
import { createDeck, themes } from './demo-model.mjs';

const $ = selector => document.querySelector(selector);
const make = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
let deck = createDeck(samples(getLanguage())), view = 'selected', panel = 'slides', toastTimer;
const objectURLs = new Set();
const textInput = $('#slide-text'), stage = $('#slide-stage'), stageMedia = $('#stage-media');

function announce(key) {
  clearTimeout(toastTimer); const status = $('#demo-status');
  status.textContent = t(key); status.classList.add('visible');
  toastTimer = setTimeout(() => { status.classList.remove('visible'); status.textContent = ''; }, 3300);
}
function selectPanel(next) {
  panel = next;
  document.querySelectorAll('[data-panel]').forEach(button => {
    const active = button.dataset.panel === panel; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.library-panel').forEach(node => { node.hidden = node.id !== `panel-${panel}`; });
}
function add(source) { deck.add(source); selectPanel('slides'); view = 'selected'; render(); announce('added'); }

function renderSlideList() {
  const focused = document.activeElement?.dataset.slide;
  const nodes = deck.state.slides.map((slide, index) => {
    const row = make('div', 'slide-row');
    const button = make('button', `slide-thumb${slide.id === deck.state.selected ? ' selected' : ''}`);
    button.type = 'button'; button.dataset.slide = slide.id;
    button.setAttribute('aria-label', `${t('slideLabel')} ${index + 1}: ${slide.title}`);
    button.setAttribute('aria-pressed', String(slide.id === deck.state.selected));
    const preview = make('div', `slide-thumb-preview theme-${slide.theme}`);
    if (slide.type === 'image') { const img = make('img'); img.src = slide.src; img.alt = ''; preview.append(img); }
    preview.append(make('span', '', slide.type === 'video' ? '▶' : slide.text));
    const meta = make('div', 'slide-thumb-meta'); meta.append(make('span', '', String(index + 1).padStart(2, '0')), make('strong', '', slide.title));
    if (slide.id === deck.state.live) meta.append(make('span', 'thumb-live', t('liveLabel')));
    button.append(preview, meta);
    button.addEventListener('click', () => { deck.select(slide.id); view = 'selected'; render(); });
    row.append(button); return row;
  });
  $('#slide-list').replaceChildren(...nodes);
  if (focused) {
    const active = [...$('#slide-list').querySelectorAll('button')].find(button => button.dataset.slide === deck.state.selected);
    active?.focus({ preventScroll: true });
  }
}

function renderStage() {
  const slide = view === 'live' ? deck.state.slides.find(item => item.id === deck.state.live) : deck.selected();
  if (!slide) return;
  stage.className = `demo-stage theme-${slide.theme}`;
  stage.setAttribute('aria-label', `${t(view === 'live' ? 'liveView' : 'selectedView')}: ${slide.title}`);
  $('#stage-content').textContent = slide.type === 'text' ? slide.text : '';
  $('#stage-content').style.fontSize = `${slide.fontSize / 10}cqw`;
  $('#stage-content').style.textAlign = slide.align;
  $('#stage-credit').textContent = slide.credit ?? '';
  const source = slide.type === 'text' ? '' : slide.src;
  if ((stageMedia.dataset.source ?? '') !== source) {
    stageMedia.querySelector('video')?.pause(); stageMedia.replaceChildren(); stageMedia.dataset.source = source;
    if (source) {
      const media = make(slide.type === 'video' ? 'video' : 'img'); media.src = source;
      if (slide.type === 'video') { media.controls = true; media.muted = true; media.loop = true; media.playsInline = true; media.preload = 'metadata'; media.setAttribute('aria-label', slide.title); }
      else media.alt = slide.title;
      media.addEventListener('error', () => announce('fileError'), { once: true }); stageMedia.append(media);
    }
  }
  $('#stage-blackout').hidden = view !== 'live' || !deck.state.black;
  $('#preview-status').textContent = t(view === 'live' ? 'liveLabel' : 'previewLabel');
  $('#preview-status').classList.toggle('preview-live-label', view === 'live');
  $('#slide-count').textContent = `${t('slideLabel')} ${deck.state.slides.indexOf(slide) + 1} / ${deck.state.slides.length}`;
  $('#part-status').textContent = slide.parts?.length ? `${t('part')} ${slide.activePart + 1} / ${slide.parts.length}` : '';
  $('#selected-view').classList.toggle('active', view === 'selected'); $('#selected-view').setAttribute('aria-pressed', String(view === 'selected'));
  $('#live-view').classList.toggle('active', view === 'live'); $('#live-view').setAttribute('aria-pressed', String(view === 'live'));
  $('#blackout').textContent = t(deck.state.black ? 'restore' : 'blackout'); $('#blackout').setAttribute('aria-pressed', String(deck.state.black));
  const partFocus = document.activeElement?.dataset.part;
  $('#part-controls').replaceChildren(...(slide.parts?.length > 1 ? slide.parts.map((_, index) => {
    const button = make('button', index === slide.activePart ? 'active' : '', `${t('part')} ${index + 1}`);
    button.type = 'button'; button.dataset.part = String(index); button.setAttribute('aria-pressed', String(index === slide.activePart));
    button.addEventListener('click', () => { deck.part(index, slide.id); render(); }); return button;
  }) : []));
  if (partFocus !== undefined) $('#part-controls').querySelector(`[data-part="${slide.activePart}"]`)?.focus({ preventScroll: true });
}

function updateSplitAvailability() {
  const slide = deck.selected(); const offset = textInput.selectionStart;
  $('#split-part').disabled = !slide || slide.type !== 'text' || textInput.selectionStart !== textInput.selectionEnd
    || !slide.text.slice(0, offset).trim() || !slide.text.slice(offset).trim();
}
function renderInspector() {
  const slide = deck.selected(); if (!slide) return;
  $('#text-tools').hidden = slide.type !== 'text'; $('#media-settings-note').hidden = slide.type === 'text';
  if (document.activeElement !== textInput) textInput.value = slide.text;
  $('#font-size').value = String(slide.fontSize); $('#font-size-value').value = String(slide.fontSize);
  document.querySelectorAll('[data-align]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.align === slide.align)); });
  const swatchFocus = document.activeElement?.dataset.theme;
  $('#background-swatches').replaceChildren(...themes.map(theme => {
    const button = make('button', `theme-${theme}`); button.type = 'button'; button.dataset.theme = theme;
    button.disabled = slide.type !== 'text';
    button.setAttribute('aria-label', t(theme)); button.setAttribute('aria-pressed', String(slide.theme === theme));
    button.addEventListener('click', () => { deck.update({ theme }); render(); }); return button;
  }));
  if (swatchFocus) $('#background-swatches').querySelector(`[data-theme="${swatchFocus}"]`)?.focus({ preventScroll: true });
  const index = deck.state.slides.indexOf(slide);
  $('#move-up').disabled = index === 0; $('#move-down').disabled = index === deck.state.slides.length - 1;
  $('#delete').disabled = deck.state.slides.length < 2;
  updateSplitAvailability();
}
function render() {
  renderSlideList(); renderStage(); renderInspector();
  $('#undo').disabled = !deck.canUndo; $('#redo').disabled = !deck.canRedo;
  document.querySelectorAll('[data-apply-background]').forEach(button => { button.disabled = deck.selected()?.type !== 'text'; });
}

function renderResources() {
  document.title = t('demoTitleTag');
  $('#song-title').textContent = t('songTitle'); $('#song-text').textContent = t('songText');
  $('#scripture-list').replaceChildren(...['One', 'Two'].map(suffix => {
    const card = make('article', 'sample-card'); card.append(make('h3', '', t(`passage${suffix}`)), make('p', '', t(`passage${suffix}Text`)));
    const button = make('button', 'library-action', t('addPassage')); button.type = 'button';
    button.addEventListener('click', () => add({ title: t(`passage${suffix}`), text: t(`passage${suffix}Text`), theme: 'night', credit: `${t(`passage${suffix}`)} · ${getLanguage() === 'tr' ? 'Örnek anlam aktarımı' : 'Illustrative paraphrase'}` }));
    card.append(button); return card;
  }));
  $('#background-library').replaceChildren(...themes.slice(0, 3).map(theme => {
    const card = make('article', 'background-library-card'); card.append(make('div', `background-library-preview theme-${theme}`, t(theme)));
    const actions = make('div', 'background-library-actions'); const insert = make('button', '', t('addBackground')), apply = make('button', '', t('applyBackground'));
    insert.type = apply.type = 'button';
    apply.dataset.applyBackground = theme;
    apply.setAttribute('aria-label', `${t('applyBackground')}: ${t(theme)}`);
    insert.setAttribute('aria-label', `${t('addBackground')}: ${t(theme)}`);
    insert.addEventListener('click', () => add({ title: t(theme), text: '', theme }));
    apply.addEventListener('click', () => { deck.update({ theme }); render(); announce('updated'); });
    actions.append(insert, apply); card.append(actions); return card;
  }));
}

document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => selectPanel(button.dataset.panel)));
$('#add-slide').addEventListener('click', () => add({ title: t('newTitle'), text: t('newText') }));
$('#add-song').addEventListener('click', () => { const parts = t('songText').split('\n\n'); add({ title: t('songTitle'), text: parts[0], parts, theme: 'ocean' }); });
$('#selected-view').addEventListener('click', () => { view = 'selected'; render(); });
$('#live-view').addEventListener('click', () => { view = 'live'; render(); });
$('#go-live').addEventListener('click', () => { deck.cue(); view = 'live'; render(); });
$('#blackout').addEventListener('click', () => { deck.toggleBlack(); view = 'live'; render(); });
$('#undo').addEventListener('click', () => { deck.undo(); textInput.value = deck.selected().text; render(); });
$('#redo').addEventListener('click', () => { deck.redo(); textInput.value = deck.selected().text; render(); });
$('#duplicate').addEventListener('click', () => { deck.duplicate(); view = 'selected'; render(); });
$('#delete').addEventListener('click', () => { if (!deck.remove()) { announce('minSlides'); return; } render(); });
$('#move-up').addEventListener('click', () => { deck.move(-1); render(); });
$('#move-down').addEventListener('click', () => { deck.move(1); render(); });
textInput.addEventListener('input', () => { deck.update({ text: textInput.value }); render(); });
textInput.addEventListener('select', updateSplitAvailability);
textInput.addEventListener('click', updateSplitAvailability);
textInput.addEventListener('keyup', updateSplitAvailability);
$('#split-part').addEventListener('click', () => {
  if (deck.split(textInput.selectionStart)) { textInput.value = deck.selected().text; render(); }
});
$('#font-size').addEventListener('input', event => { deck.update({ fontSize: Number(event.target.value) }); render(); });
document.querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => { deck.update({ align: button.dataset.align }); render(); }));

$('#media-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { announce('unsupportedFile'); event.target.value = ''; return; }
  const src = URL.createObjectURL(file); objectURLs.add(src);
  add({ title: file.name, text: '', type: file.type.startsWith('video/') ? 'video' : 'image', src, theme: 'plain' }); event.target.value = '';
});

$('#fullscreen').addEventListener('click', async () => {
  deck.cue(); view = 'live'; render();
  try { if (!$('#fullscreen-host').requestFullscreen) throw new Error('Fullscreen unavailable'); await $('#fullscreen-host').requestFullscreen(); }
  catch { announce('fullscreenError'); }
});
$('#fullscreen-exit').addEventListener('click', () => { document.exitFullscreen?.().catch(() => {}); });
document.addEventListener('fullscreenchange', () => { $('#fullscreen-exit').hidden = !document.fullscreenElement; });

function clearMedia() { stageMedia.querySelector('video')?.pause(); objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs.clear(); }
$('#reset').addEventListener('click', () => {
  clearMedia(); deck = createDeck(samples(getLanguage())); view = 'selected'; selectPanel('slides'); render(); announce('resetDone');
});
window.addEventListener('pagehide', event => { if (!event.persisted) clearMedia(); });
document.addEventListener('keydown', event => {
  if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],video')) return;
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); deck.navigate(event.key === 'ArrowRight' ? 1 : -1, view === 'live'); render();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const slide = view === 'live' ? deck.state.slides.find(item => item.id === deck.state.live) : deck.selected();
    if (!slide?.parts?.length) return; event.preventDefault(); deck.part(slide.activePart + (event.key === 'ArrowDown' ? 1 : -1), slide.id); render();
  } else if (event.key.toLowerCase() === 'b') { event.preventDefault(); deck.toggleBlack(); view = 'live'; render(); }
});

onLanguageChange(() => { renderResources(); render(); selectPanel(panel); });
renderResources(); render();
