// Normalise a file:// or local-resource:// URL back to a plain OS path so we
// can pass it to the Electron IPC thumbnail generator.
function mediaUrlToFilePath(url: string): string | null {
  try {
    if (url.startsWith('file://')) {
      let p = decodeURIComponent(new URL(url).pathname);
      // Windows: /C:/... → C:/...
      if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
      return p.replace(/\//g, '\\');
    }
    if (url.startsWith('local-resource://mediafile/')) {
      const encoded = url.slice('local-resource://mediafile/'.length);
      let p = decodeURIComponent(encoded);
      if (/^[a-zA-Z]:\//.test(p)) p = p.replace(/\//g, '\\');
      return p;
    }
  } catch {
    // ignore
  }
  return null;
}

// Render a single video frame to a data URL entirely in the renderer.
// Uses play/pause + requestVideoFrameCallback (if available) to guarantee the
// decoded frame is in the pixel buffer before drawing.
export function extractVideoFrameDataUrl(mediaUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    // Convert file:// to local-resource:// so CORS canvas tainting is avoided.
    let src = mediaUrl;
    if (mediaUrl.startsWith('file://') && window.electronAPI) {
      const fp = mediaUrlToFilePath(mediaUrl);
      if (fp) src = `local-resource://mediafile/${encodeURIComponent(fp.replace(/\\/g, '/'))}`;
    }
    video.src = src;

    let settled = false;
    const timer = setTimeout(() => done(null), 10_000);

    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch { /**/ }
      resolve(result);
    };

    const capture = () => {
      if (settled) return;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) { done(null); return; }
        const maxEdge = 400;
        const scale = Math.min(maxEdge / vw, maxEdge / vh, 1);
        const c = document.createElement('canvas');
        c.width = Math.round(vw * scale);
        c.height = Math.round(vh * scale);
        const ctx = c.getContext('2d');
        if (!ctx) { done(null); return; }
        ctx.drawImage(video, 0, 0, c.width, c.height);
        // Detect all-black frame and retry up to 3 times at different positions
        try {
          const d = ctx.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
          let sum = 0, n = 0;
          for (let i = 0; i < d.length; i += 4 * 16) { sum += d[i] + d[i+1] + d[i+2]; n++; }
          if (n > 0 && sum / (n * 3) < 10) { done(null); return; }
        } catch { /**/ }
        c.toBlob((blob) => {
          if (!blob) { done(null); return; }
          const reader = new FileReader();
          reader.onload = () => done(reader.result as string);
          reader.onerror = () => done(null);
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.75);
      } catch {
        done(null);
      }
    };

    const afterSeek = () => {
      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        (video as any).requestVideoFrameCallback(() => { if (!settled) capture(); });
        setTimeout(() => { if (!settled) capture(); }, 800);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { if (!settled) capture(); }, 80)));
      }
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const seekTo = duration > 0
        ? Math.min(Math.max(duration * 0.08, 0.05), Math.max(0, duration - 0.1))
        : 0;
      if (seekTo > 0) {
        video.currentTime = seekTo;
      } else {
        afterSeek();
      }
    };
    video.onseeked = afterSeek;
    video.onerror = () => done(null);
    video.load();
  });
}

