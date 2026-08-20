// ─── Phone captions share: mobile client HTML shell ─────────────────────────
/* eslint-disable */
import shareClient from './share-client.js?raw';

export const SHARE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<title>Live Captions</title>
<style>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html,body { height: 100%; background: #000; color: #d6e8ff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; overflow: hidden; }
#wrap { height: 100%; display: flex; flex-direction: column; }
#bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; font-size: 13px; font-weight: 600; color: #9db8d4; border-bottom: 1px solid rgba(255,255,255,.08); background: #0a0f18; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #3a526e; flex: 0 0 auto; }
.dot.on { background: #00e5a0; box-shadow: 0 0 8px rgba(0,229,160,.7); animation: pulse 1.6s ease-in-out infinite; }
.dot.wait { background: #ffb030; }
.dot.off { background: #ff3d6b; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
#feed { flex: 1 1 auto; overflow-y: auto; padding: 16px; -webkit-overflow-scrolling: touch; }
.line { margin-bottom: 12px; display: flex; flex-direction: column; gap: 3px; }
.line .tag { font-size: 10px; font-weight: 700; letter-spacing: .14em; color: #4b9eff; }
.line .txt { white-space: pre-wrap; word-break: break-word; }
.line.tr .txt { font-size: 21px; font-weight: 650; line-height: 1.35; color: #eaf3ff; }
.line.orig .txt { font-size: 15px; font-weight: 400; line-height: 1.4; color: #8aa7c4; }
.line.tr { border-left: 3px solid #4b9eff; padding-left: 10px; }
.line.orig { padding-left: 13px; }
.live { margin-top: 6px; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,.14); }
.live-active { border-top-color: #00e5a0; }
.placeholder { color: #4a637f; font-size: 15px; font-style: italic; padding: 8px 0; text-align: center; }
#ended { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: #000; color: #ff3d6b; font-size: 18px; font-weight: 600; z-index: 10; }
.hidden { display: none !important; }
</style>
</head>
<body>
<div id="wrap">
  <header id="bar"><span id="dot" class="dot"></span><span id="status">Connecting…</span></header>
  <main id="feed"></main>
</div>
<div id="ended" class="hidden"><span>⚠</span><span id="endedText">Broadcast ended</span></div>
<script>${shareClient.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
