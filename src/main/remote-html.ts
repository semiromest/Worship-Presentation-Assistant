// ─── Remote HTML (mobile interface) ───────────────────────────────────────────
/* eslint-disable */
import remoteScript from './remote-script.js?raw';

export const REMOTE_HTML_NEW = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<title>Worship Presentation Assistant Remote</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
/* ── Tokens ─────────────────────────────────────────────────────────── */
:root {
  --ink:    #000000;
  --z0:     #080c14;
  --z1:     #0d1320;
  --z2:     #121a2a;
  --z3:     #1a2538;
  --rim:    #243348;
  --rim2:   #2e4060;
  --tx:     #d6e8ff;
  --tx2:    #7a99bb;
  --muted:  #3a526e;
  --blue:   #4b9eff;
  --blue2:  #7dbeff;
  --bglow:  rgba(75,158,255,.2);
  --bglow2: rgba(75,158,255,.08);
  --green:  #00e5a0;
  --gglow:  rgba(0,229,160,.2);
  --red:    #ff3d6b;
  --rglow:  rgba(255,61,107,.2);
  --amber:  #ffb030;
  --aglow:  rgba(255,176,48,.2);
  --r:   14px;
  --r2:  10px;
  --bh:  58px;
  color-scheme: dark;
}

/* ── Reset ───────────────────────────────────────────────────────────── */
*,*::before,*::after {
  box-sizing: border-box; margin: 0; padding: 0;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
}
html,body {
  height: 100%;
  background: var(--ink);
  overscroll-behavior: none;
  overflow: hidden;
}
body {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  min-height: -webkit-fill-available;
  min-height: 100dvh; /* modern mobile browsers: ignores the two lines above */
  color: var(--tx);
  font-family: 'Barlow', system-ui, sans-serif;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* ── Noise texture overlay ───────────────────────────────────────────── */
/* FIX: was mix-blend-mode:overlay on a full-screen fixed layer — a
   per-pixel blend of the entire viewport on every frame is expensive on
   mobile GPUs (heat, scroll jank). Now blended directly with a low opacity;
   translateZ(0) promotes the layer to the compositor once instead. */
body::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 9999;
  transform: translateZ(0);
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");
  background-size: 256px 256px;
  opacity: .55;
}

/* ── Header ──────────────────────────────────────────────────────────── */
.hdr {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: .7rem 1rem;
  padding-top: calc(.7rem + env(safe-area-inset-top, 0px));
  background: var(--z0);
  border-bottom: 1px solid var(--z2);
  position: relative; z-index: 20;
}
.logo { display: flex; align-items: center; gap: .6rem; }
.logo-icon {
  width: 32px; height: 32px;
  border-radius: 9px;
  background: var(--blue);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; position: relative; overflow: hidden;
}
.logo-icon::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.25) 0%, transparent 60%);
}
.logo-icon svg { position: relative; z-index: 1; }
.logo-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.05rem; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--tx); line-height: 1.1;
}
.logo-name span {
  display: block;
  font-family: 'Barlow', sans-serif;
  font-size: .6rem; font-weight: 500;
  letter-spacing: .1em; color: var(--muted);
}

/* Connection pill */
.pill {
  display: flex; align-items: center; gap: .4rem;
  background: var(--z2); border: 1px solid var(--rim);
  border-radius: 99px;
  padding: .3rem .75rem .3rem .5rem;
  font-size: .7rem; font-weight: 600;
  letter-spacing: .02em; color: var(--tx2);
  transition: border-color .3s;
}
.pill.ok   { border-color: var(--green); }
.pill.wait { border-color: var(--amber); }

/* Timer */
.hdr-right { display: flex; align-items: center; gap: .5rem; }
.timer {
  font-family: 'Space Mono', monospace;
  font-size: .72rem; font-weight: 700;
  letter-spacing: .06em; color: var(--muted);
  background: var(--z2); border: 1px solid var(--rim);
  border-radius: 99px; padding: .3rem .7rem;
  cursor: pointer;
  -webkit-appearance: none; appearance: none;
  transition: color .3s, border-color .3s, background .3s;
  user-select: none; -webkit-user-select: none;
}
.timer.running { color: var(--green); border-color: var(--green); }
.timer.frozen  { color: var(--muted); border-color: var(--rim); opacity: .6; }
.timer:hover   { background: var(--z3); }
.timer:active  { transform: scale(.94); }

.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--red); flex-shrink: 0;
  transition: background .3s, box-shadow .3s;
}
.dot.ok   { background: var(--green); box-shadow: 0 0 7px var(--green); }
.dot.wait { background: var(--amber); animation: blink 1.1s ease-in-out infinite; }

@keyframes blink {
  0%,100% { opacity: 1; }
  50%      { opacity: .25; }
}

/* ── Preview Stage ───────────────────────────────────────────────────── */
.stage {
  flex-shrink: 0;
  background: var(--z0);
  padding: .8rem 1rem .5rem;
  border-bottom: 1px solid var(--z2);
}

/* Frame */
.frame {
  position: relative;
  width: 100%; aspect-ratio: 16/9;
  background: var(--z2); border-radius: var(--r);
  overflow: hidden;
  border: 1.5px solid var(--rim);
  box-shadow: 0 12px 48px rgba(0,0,0,.8), 0 0 0 1px var(--bglow2);
  touch-action: pan-y;
  user-select: none; -webkit-user-select: none;
}
@media (hover: hover) {
  .frame { cursor: grab; }
  .frame:active { cursor: grabbing; }
}
.frame img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: contain; display: block;
  /* FIX: imgA/imgB are crossfaded via opacity (see markup) but had no
     transition, so slide changes used to snap instead of fading. */
  transition: opacity .25s ease;
}

/* Placeholder */
.ph {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: .65rem;
}
.ph-icon { animation: ph-float 3.5s ease-in-out infinite; opacity: .2; }
@keyframes ph-float {
  0%,100% { transform: translateY(0); }
  50%      { transform: translateY(-8px); }
}
.ph p { font-size: .72rem; font-weight: 500; letter-spacing: .05em; color: var(--muted); }

/* Blackout overlay */
.bb-overlay {
  position: absolute; inset: 0; z-index: 4;
  background: rgba(255,61,107,.07);
  border: 2px solid var(--red);
  border-radius: calc(var(--r) - 1.5px);
  display: none; pointer-events: none;
}
.bb-overlay.on { display: block; }

/* Frame footer */
.frame-foot {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 5;
  background: linear-gradient(transparent, rgba(0,0,0,.75));
  padding: .9rem .7rem .5rem;
  display: flex; align-items: center; justify-content: space-between;
}
.bb-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: .65rem; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase;
  background: var(--red); color: #fff;
  border-radius: 5px; padding: .2rem .5rem;
  display: none;
}
.bb-tag.on { display: block; animation: bb-flash 1.4s ease-in-out infinite; }
@keyframes bb-flash { 0%,100%{opacity:1}50%{opacity:.5} }

.slide-chip {
  font-family: 'Space Mono', monospace;
  font-size: .72rem; font-weight: 700;
  background: rgba(0,0,0,.6); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 6px; padding: .2rem .5rem;
  color: rgba(255,255,255,.9); letter-spacing: .04em;
}

/* Swipe arrows */
.swipe-arrows {
  position: absolute; inset: 0; z-index: 3;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 .65rem; pointer-events: none;
  opacity: 0; transition: opacity .25s;
}
.swipe-arrows.show { opacity: 1; }
.arr {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(0,0,0,.55); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,.15);
  display: flex; align-items: center; justify-content: center;
}

/* ── Counter ─────────────────────────────────────────────────────────── */
.counter {
  display: flex; align-items: baseline; justify-content: center;
  gap: .15rem; padding: .55rem 0 .3rem;
}
.cnt-cur {
  font-family: 'Space Mono', monospace;
  font-size: 2.4rem; font-weight: 700; line-height: 1;
  color: var(--tx); letter-spacing: -.04em;
  transition: color .25s, transform .18s;
}
.cnt-cur.bump { transform: scale(1.08); }
.cnt-cur.bb   { color: var(--red); }
.cnt-sep {
  font-family: 'Space Mono', monospace;
  font-size: 1.1rem; font-weight: 400;
  color: var(--muted); margin: 0 .05rem;
}
.cnt-total {
  font-family: 'Space Mono', monospace;
  font-size: 1.2rem; font-weight: 400; color: var(--muted);
}

/* ── Progress ────────────────────────────────────────────────────────── */
.prog {
  flex-shrink: 0; padding: 0 1rem .6rem;
  background: var(--z0);
}
.prog-track {
  height: 4px; background: var(--z3);
  border-radius: 99px; overflow: visible; position: relative;
}
.prog-fill {
  height: 100%; background: var(--blue);
  border-radius: 99px; width: 0%;
  transition: width .4s cubic-bezier(.4,0,.2,1);
  position: relative;
}
.prog-fill::after {
  content: '';
  position: absolute; right: -4px; top: 50%;
  transform: translateY(-50%);
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--blue); box-shadow: 0 0 10px var(--blue);
  opacity: 0; transition: opacity .3s;
}
.prog-fill.live::after { opacity: 1; }

/* ── Deck (Controls) ─────────────────────────────────────────────────── */
.deck {
  flex: 1; overflow-y: auto;
  background: var(--z1); border-top: 1px solid var(--z3);
  padding: .8rem 1rem;
  display: flex; flex-direction: column; gap: .6rem;
}

/* Section labels */
.lbl {
  font-size: .62rem; font-weight: 700;
  letter-spacing: .15em; text-transform: uppercase;
  color: var(--muted); padding: .15rem 0 .05rem;
}
/* Divider */
.sep { height: 1px; background: var(--z3); border-radius: 99px; }

/* ── Buttons ─────────────────────────────────────────────────────────── */
.btn {
  display: flex; align-items: center; justify-content: center; gap: .5rem;
  height: var(--bh);
  border: none; border-radius: var(--r);
  font-family: 'Barlow', system-ui, sans-serif;
  font-size: .95rem; font-weight: 700; letter-spacing: .02em;
  color: #fff; cursor: pointer;
  position: relative; overflow: hidden; outline: none;
  -webkit-appearance: none;
  user-select: none; -webkit-user-select: none;
  transition: transform .1s ease, filter .15s ease;
  /* hint the compositor before :active mutates transform/filter → no jank */
  will-change: transform, filter;
}
.btn::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,.1) 0%, transparent 55%);
  pointer-events: none;
}
.btn::after {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(
    circle at var(--rx, 50%) var(--ry, 50%),
    rgba(255,255,255,.22) 0%, transparent 55%
  );
  opacity: 0; transition: opacity .3s; pointer-events: none;
}
.btn:active { transform: scale(.955); filter: brightness(.82); }
.btn:active::after { opacity: 1; }

/* Variants */
.btn-prev { background: var(--z3); border: 1.5px solid var(--rim2); color: var(--tx); }
.btn-prev:disabled,
.btn-next:disabled {
  opacity: .35;
  cursor: not-allowed;
  box-shadow: none;
  filter: none;
  transform: none;
}
.btn-next { background: var(--blue); box-shadow: 0 4px 24px var(--bglow); }
.btn-bb {
  background: var(--z3); border: 1.5px solid var(--rim); color: var(--tx2);
  transition: background .3s, border-color .3s, color .3s, box-shadow .3s,
              transform .1s ease, filter .15s ease;
}
.btn-bb.on {
  background: rgba(255,61,107,.14); border-color: var(--red); color: var(--red);
  box-shadow: 0 0 24px var(--rglow), inset 0 0 24px var(--rglow);
}
.btn-open {
  background: rgba(0,229,160,.1); border: 1.5px solid rgba(0,229,160,.5); color: var(--green);
}
.btn-close {
  background: rgba(255,61,107,.08); border: 1.5px solid rgba(255,61,107,.35); color: var(--red);
}
.btn-go {
  background: var(--z3); border: 1.5px solid var(--rim2); color: var(--tx);
  flex-shrink: 0; min-width: 70px; height: var(--bh);
}
.btn-w { width: 100%; }

/* Grid rows */
.g2  { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
.nav-g { display: grid; grid-template-columns: 1fr 1.55fr; gap: .6rem; }

/* ── Goto ────────────────────────────────────────────────────────────── */
.goto-row { display: flex; gap: .6rem; }
.goto-inp {
  flex: 1; height: var(--bh);
  background: var(--z2); border: 1.5px solid var(--rim);
  border-radius: var(--r); padding: 0 1rem; color: var(--tx);
  font-family: 'Space Mono', monospace; font-size: 1rem; font-weight: 700;
  outline: none; -webkit-appearance: none;
  transition: border-color .2s, box-shadow .2s;
}
.goto-inp:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--bglow); }
.goto-inp::placeholder {
  font-family: 'Barlow', sans-serif; font-size: .85rem; font-weight: 500; color: var(--muted);
}
.goto-inp::-webkit-inner-spin-button,
.goto-inp::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.goto-inp[type=number] { -moz-appearance: textfield; }
.goto-inp.invalid { border-color: var(--red); box-shadow: 0 0 0 3px var(--rglow); }

/* ── Projector status badge ──────────────────────────────────────────── */
.proj-status {
  display: flex; align-items: center; gap: .5rem;
  font-size: .72rem; font-weight: 600; color: var(--tx2); letter-spacing: .02em;
}
.proj-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--muted); flex-shrink: 0;
  transition: background .3s, box-shadow .3s;
}
.proj-dot.on { background: var(--green); box-shadow: 0 0 7px var(--green); }

/* ── Slides Grid ─────────────────────────────────────────────────────── */
.slides-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .55rem; }

.slide-thumb {
  position: relative; aspect-ratio: 16/9;
  background: var(--z2); border-radius: 8px; overflow: hidden;
  border: 1.5px solid var(--rim); cursor: pointer;
  user-select: none; -webkit-user-select: none;
  transition: border-color .18s, box-shadow .18s, transform .12s;
  -webkit-tap-highlight-color: transparent;
}
.slide-thumb:active { transform: scale(.96); filter: brightness(.8); }
.slide-thumb.active {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px var(--bglow), 0 4px 18px rgba(0,0,0,.6);
}
.slide-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }

/* Thumb placeholder */
.thumb-ph {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--z3);
}
.thumb-ph::after {
  content: 'Loading';
  position: absolute; bottom: 6px;
  font-size: .55rem; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
}
.thumb-ph-icon { opacity: .7; }

/* Thumb number badge */
.thumb-num {
  position: absolute; bottom: 4px; right: 5px;
  font-family: 'Space Mono', monospace;
  font-size: .58rem; font-weight: 700;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 4px; padding: .1rem .3rem;
  color: rgba(255,255,255,.75); pointer-events: none;
}
/* Active indicator — blue dot top-right */
.thumb-live {
  position: absolute; top: 5px; right: 5px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--blue); box-shadow: 0 0 6px var(--blue);
  display: none; pointer-events: none;
}
.slide-thumb.active .thumb-live { display: block; }
/* No slides placeholder */
.slides-empty {
  grid-column: 1 / -1; padding: 1.2rem 0; text-align: center;
  font-size: .72rem; font-weight: 500; letter-spacing: .04em; color: var(--muted);
}

/* Projector btn label */
.btn-lbl { font-size: .7rem; font-weight: 600; letter-spacing: .02em; }

/* ── Part cards (partsMode slides in the grid) ───────────────────────── */
.part-card {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; gap: .5rem;
  background: var(--z2);
  border: 1.5px solid var(--rim);
  border-radius: 12px;
  padding: .55rem .6rem .6rem;
  transition: border-color .18s, box-shadow .18s;
}
.part-card.active {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px var(--bglow), 0 4px 18px rgba(0,0,0,.6);
}
.part-card.active .part-card-num {
  background: var(--blue);
  border-color: rgba(255,255,255,.35);
  color: #fff;
}
.part-card-hdr {
  display: flex; align-items: center; gap: .5rem;
  min-width: 0;
}
.part-card-num {
  font-family: 'Space Mono', monospace;
  font-size: .62rem; font-weight: 700;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 5px; padding: .15rem .4rem;
  color: rgba(255,255,255,.75); flex-shrink: 0;
}
.part-card-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: .85rem; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase;
  color: var(--tx);
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
  min-width: 0; flex: 1;
}
.part-card-count {
  font-family: 'Space Mono', monospace;
  font-size: .62rem; font-weight: 700;
  color: var(--blue2);
  background: var(--bglow2);
  border: 1px solid rgba(75,158,255,.35);
  border-radius: 99px;
  padding: .15rem .5rem;
  flex-shrink: 0;
  display: none;
}
.part-card.active .part-card-count { display: block; }

/* ── Part chips (direct part selection) ──────────────────────────────── */
.part-chips {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
}
.part-chip {
  display: flex; align-items: center; justify-content: center;
  min-height: 44px;
  padding: .35rem .7rem;
  border-radius: 8px;
  border: 1.5px solid var(--rim2);
  background: var(--z3);
  color: var(--tx2);
  font-family: 'Barlow', system-ui, sans-serif;
  font-size: .78rem; font-weight: 600;
  letter-spacing: .01em;
  cursor: pointer;
  outline: none;
  -webkit-appearance: none;
  user-select: none; -webkit-user-select: none;
  transition: border-color .18s, background .18s, color .18s, box-shadow .18s,
              transform .1s ease, filter .15s ease;
  will-change: transform, filter;
}
.part-chip:active { transform: scale(.96); filter: brightness(.85); }
/* Active part: filled blue button + check mark — clearly reads "this part
   is on stage" at a glance, both in the parts bar and in part cards. */
.part-chip.active {
  border-color: #2f74d8;
  background: linear-gradient(160deg, #4b9eff, #2f74d8);
  color: #fff;
  box-shadow: 0 3px 14px rgba(47,116,216,.55), inset 0 1px 0 rgba(255,255,255,.25);
}
.part-chip.active::after {
  content: '\u2713';
  display: inline-block;
  margin-left: .32rem;
  font-size: .72rem;
  font-weight: 800;
}
.part-chip:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 2px; }

/* ── Parts bar (partsMode / hymn navigation) ─────────────────────────── */
.parts-bar {
  display: none; /* shown via JS when partsMode is active */
  flex-direction: column; gap: .5rem;
}
.parts-bar.on { display: flex; }

.parts-hdr {
  display: flex; align-items: center; justify-content: space-between;
}
.parts-counter {
  font-family: 'Space Mono', monospace;
  font-size: .65rem; font-weight: 700;
  color: var(--muted); letter-spacing: .04em;
}
/* Active part counter — turned into a small highlighted pill so "which part
   is on stage" (e.g. "2 / 5") reads instantly on the parts bar. */
.parts-bar.on .parts-counter {
  color: var(--blue2);
  background: var(--bglow2);
  border: 1px solid rgba(75,158,255,.35);
  border-radius: 99px;
  padding: .1rem .5rem;
}

/* ── Landscape ───────────────────────────────────────────────────────── */
/* FIX: Separated into two distinct non-overlapping queries to avoid
   cascade conflicts. Boundaries are fluid (no hard 520/767 px edges) so
   foldables and odd aspect ratios fall into the closest sensible layout
   instead of breaking: short phones (<560px tall, <800px wide) get the
   compact row layout, anything wider gets the tablet row layout. */
@media (orientation: landscape) and (max-height: 560px) and (max-width: 800px) {
  body { flex-direction: row; flex-wrap: wrap; }
  .hdr  { width: 100%; padding: .45rem 1rem; }
  .stage {
    width: 52%; border-bottom: none; border-right: 1px solid var(--z2);
    padding: .55rem .7rem .4rem; flex-shrink: 0;
  }
  .prog  { width: 52%; border-right: 1px solid var(--z2); padding: 0 .7rem .45rem; }
  .deck  { flex: 1; width: 48%; border-top: none; padding: .6rem .8rem; }
  .slides-grid { grid-template-columns: 1fr 1fr; }
  .cnt-cur { font-size: 1.8rem; }
  .counter { padding: .35rem 0 .2rem; }
  /* FIX: was targeting non-existent .bh class; use CSS variable override instead */
  :root { --bh: 50px; }
}

@media (orientation: landscape) and (min-width: 800px) {
  body { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
  .hdr  { width: 100%; padding: .5rem 1.2rem; }
  .stage {
    width: 55%; border-bottom: none; border-right: 1px solid var(--z2);
    padding: .65rem .8rem .5rem; flex-shrink: 0;
  }
  .prog  { width: 55%; border-right: 1px solid var(--z2); padding: 0 .8rem .5rem; }
  .deck  { flex: 1; width: 45%; max-width: none; border-top: none; padding: .7rem 1rem; }
  .slides-grid { grid-template-columns: 1fr 1fr 1fr; }
  .cnt-cur { font-size: 2rem; }
  .counter { padding: .4rem 0 .25rem; }
  :root { --bh: 58px; }
}

/* Large tablets / desktop-width landscape: same row layout, one more
   grid column since there's room for it. Kept as a single additive
   breakpoint (not a separate width/orientation block) so it can never
   fight with the rule above it. */
@media (orientation: landscape) and (min-width: 1024px) {
  .slides-grid { grid-template-columns: repeat(4, 1fr); }
}

/* ── Entrance animation ──────────────────────────────────────────────── */
@keyframes slide-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.deck > * { animation: slide-up .35s ease both; }
.deck > *:nth-child(1)  { animation-delay: .04s; }
.deck > *:nth-child(2)  { animation-delay: .08s; }
.deck > *:nth-child(3)  { animation-delay: .12s; }
.deck > *:nth-child(4)  { animation-delay: .16s; }
.deck > *:nth-child(5)  { animation-delay: .20s; }
.deck > *:nth-child(6)  { animation-delay: .24s; }
.deck > *:nth-child(7)  { animation-delay: .28s; }
.deck > *:nth-child(8)  { animation-delay: .32s; }
.deck > *:nth-child(9)  { animation-delay: .36s; }
.deck > *:nth-child(10) { animation-delay: .40s; }

/* ── Focus visible ───────────────────────────────────────────────────── */
:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 2px; }
.frame:focus-visible,
.slide-thumb:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 1px; }
.goto-inp:focus-visible    { outline: 2.5px solid var(--blue); outline-offset: 0px; }

/* ── Reduced motion ──────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *,*::before,*::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .deck > * { animation: none !important; }
  .ph-icon  { animation: none !important; }
  .dot.wait { animation: none !important; opacity: .5; }
  .bb-tag.on { animation: none !important; }
  .cnt-cur.bump { transform: none !important; }
}

/* ── Container max-width (tablet+) ──────────────────────────────────── */
@media (min-width: 520px) {
  body { align-items: center; }
  .hdr, .stage, .prog, .deck { width: 100%; max-width: 480px; }
}

@media (min-width: 768px) and (orientation: portrait) {
  .hdr, .stage, .prog, .deck { max-width: 640px; }
}
/* NOTE: the landscape tablet/desktop rules used to be duplicated here
   (min-width:768px / 1024px + orientation:landscape), overriding the
   dedicated landscape system above it in source order. That silently
   broke the short-phone compact layout for a real range of devices.
   The large-tablet 4-column enhancement has been merged into the single
   landscape system above instead — see the "Landscape" section. */

.proj-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ── Grid responsive columns ─────────────────────────────────────────── */
/* NOTE: was declared twice at 480px and 768px with the identical value —
   the 768px rule was dead weight since 480px already covers it. */
@media (min-width: 480px) and (orientation: portrait) {
  .slides-grid { grid-template-columns: repeat(3, 1fr); }
}
</style>
</head>
<body>

<!-- ── Header ─────────────────────────────────────────────────────────── -->
<header class="hdr">
  <div class="logo">
    <div class="logo-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="logo-name">WPA<span>Remote</span></div>
  </div>
  <div class="hdr-right">
    <button type="button" class="timer" id="timer" title="Reset timer" aria-label="Session timer, tap to reset">--:--</button>
    <div class="pill" id="pill">
      <div class="dot" id="dot"></div>
      <span id="connTxt">Connect</span>
    </div>
  </div>
</header>

<!-- ── Preview Stage ──────────────────────────────────────────────────── -->
<section class="stage">
  <div class="frame" id="frame">
    <div class="ph" id="ph">
      <svg class="ph-icon" width="34" height="34" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2.5"/>
        <path d="m8 21 4-4 4 4M12 17v4"/>
      </svg>
      <p>Preview…</p>
    </div>

    <img id="imgA" alt="Slide preview" style="opacity:0">
    <img id="imgB" alt="Slide preview" style="opacity:0">

    <div class="bb-overlay" id="bbOverlay"></div>

    <div class="swipe-arrows" id="swipeArrows">
      <div class="arr">
        <svg width="13" height="13" fill="none" stroke="rgba(255,255,255,.8)"
             stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
      <div class="arr">
        <svg width="13" height="13" fill="none" stroke="rgba(255,255,255,.8)"
             stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <div class="frame-foot">
      <span class="bb-tag" id="bbTag">● Blackout</span>
      <span class="slide-chip" id="slideChip">— / —</span>
    </div>
  </div>

  <div class="counter">
    <span class="cnt-cur" id="cCur">—</span>
    <span class="cnt-sep">/</span>
    <span class="cnt-total" id="cTotal">—</span>
  </div>
</section>

<!-- ── Progress ───────────────────────────────────────────────────────── -->
<div class="prog">
  <div class="prog-track">
    <div class="prog-fill" id="progFill"></div>
  </div>
</div>

<!-- ── Deck ───────────────────────────────────────────────────────────── -->
<main class="deck">

  <!-- Parts bar — shown only when active slide is a partsMode (hymn) slide -->
  <div class="parts-bar" id="partsBar">
    <div class="parts-hdr">
      <span class="lbl">Parts</span>
      <span class="parts-counter" id="partsCtr" aria-live="polite">1 / 1</span>
    </div>
    <div class="part-chips" id="partsChips" role="group" aria-label="Hymn parts"></div>
  </div>

  <!-- Navigation -->
  <nav class="nav-g">
    <button class="btn btn-prev" onclick="cmd('prev')" aria-label="Previous slide">
      <svg width="20" height="20" fill="none" stroke="currentColor"
           stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="btn btn-next" onclick="cmd('next')" aria-label="Next slide">
      <svg width="20" height="20" fill="none" stroke="currentColor"
           stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </nav>

  <div class="sep"></div>

  <!-- Blackout -->
  <span class="lbl">Screen</span>
  <button class="btn btn-bb btn-w" id="bbBtn" onclick="cmd('blackout')" aria-label="Toggle blackout">
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
         stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
    <span id="bbTxt">Blackout</span>
  </button>

  <div class="sep"></div>

  <!-- Projector — FIX: added text labels so icons aren't the only affordance -->
  <div class="proj-hdr">
    <span class="lbl">Projector</span>
    <div class="proj-status">
      <div class="proj-dot" id="projDot"></div>
      <span id="projTxt">Off</span>
    </div>
  </div>
  <div class="g2">
    <button class="btn btn-open" onclick="cmd('openProjector')" aria-label="Open projector">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
           stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <span class="btn-lbl">Open</span>
    </button>
    <button class="btn btn-close" onclick="cmd('closeProjector')" aria-label="Close projector">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
           stroke="currentColor" stroke-width="2" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M2 12s3-7 10-7M22 12s-3 7-10 7"/>
      </svg>
      <span class="btn-lbl">Close</span>
    </button>
  </div>

  <div class="sep"></div>

  <!-- Goto — wrapped in a form so the mobile keyboard's "Go/Enter" key
       submits instead of being swallowed; desktop Enter works too. -->
  <span class="lbl">Go to</span>
  <form class="goto-row" id="gotoForm" novalidate>
    <input class="goto-inp" id="gotoInp" type="number" min="1"
           placeholder="#" inputmode="numeric" aria-label="Slide number">
    <button class="btn btn-go" type="submit" aria-label="Go to slide">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
           stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
        <polyline points="3 18 9 12 3 6"/>
      </svg>
    </button>
  </form>

  <div class="sep"></div>

  <!-- Slides Grid -->
  <span class="lbl">Slides</span>
  <div class="slides-grid" id="slidesGrid">
    <div class="slides-empty">No slides</div>
  </div>

</main><!-- /deck -->

<script>${remoteScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
/* eslint-enable */