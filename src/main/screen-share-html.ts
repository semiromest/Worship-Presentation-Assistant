// ─── Phone live-screen share: mobile client HTML shell ─────────────────────
/* eslint-disable */
import screenShareClient from './screen-share-client.js?raw';

export const SCREEN_SHARE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<title>Live Screen</title>
<style>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html,body { height: 100%; background: #000; color: #e8f0ff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; overflow: hidden; }
#stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; }
#frame { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; }
#bar { position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px; font-size: 13px; font-weight: 600; color: #cfe0f5; background: linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,0)); z-index: 10; transition: opacity .3s; }
#bar.hidden { opacity: 0; pointer-events: none; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #3a526e; flex: 0 0 auto; }
.dot.on { background: #00e5a0; box-shadow: 0 0 10px rgba(0,229,160,.8); animation: pulse 1.6s ease-in-out infinite; }
.dot.wait { background: #ffb030; }
.dot.off { background: #ff3d6b; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
#ended { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #000; color: #ff3d6b; font-size: 18px; font-weight: 600; z-index: 20; }
.hidden { display: none !important; }
</style>
</head>
<body>
<div id="stage"><img id="frame" alt="" /></div>
<header id="bar"><span id="dot" class="dot"></span><span id="status">Connecting…</span></header>
<div id="ended" class="hidden"><span>⚠</span><span id="endedText">Broadcast ended</span></div>
<script>${screenShareClient.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
