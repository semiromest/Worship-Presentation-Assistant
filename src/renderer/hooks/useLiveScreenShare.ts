import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { generateSlideThumbnail } from '../utils';
import { IS_PROJECTOR_MODE } from '../constants';

const FRAME_SCALE = 4; // 320×180 base → 1280×720 phone output (crisp text)
const FRAME_QUALITY = 0.75;
const REFRESH_MS = 2000; // periodic push for countdown ticks / loop rotation
const VIDEO_REFRESH_MS = 500; // ~2 fps for live video slides

interface VideoCaptureTarget {
  mediaUrl: string;
  objectFit?: string;
}

/**
 * While the live-screen phone broadcast is active, pushes JPEG frames of the
 * current live slide (the one sent to the projector by "Canlı Yayın") to the
 * main process so connected phones receive them via WebSocket.
 *
 * Text/image/countdown slides are rendered through the same canvas pipeline as
 * the projector (generateSlideThumbnail). Video slides are played through a
 * hidden <video> element whose frames are drawn to canvas, so phones see the
 * video actually playing.
 *
 * Mount once in the control renderer (App.tsx). The projector window is a no-op.
 */
export function useLiveScreenShare(): void {
  const liveIndex = useStore((s) => s.liveIndex);
  const slides = useStore((s) => s.presentation.slides);
  const isBlackout = useStore((s) => s.isBlackout);
  const screenShareActive = useStore((s) => s.screenShareActive);

  const busyRef = useRef(false);
  const blackFrameRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrcRef = useRef<string | null>(null);

  const ensureVideo = useCallback(async (src: string): Promise<HTMLVideoElement | null> => {
    let video = videoRef.current;
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = 'auto';
      videoRef.current = video;
    }
    if (videoSrcRef.current !== src) {
      videoSrcRef.current = src;
      video.src = src;
      video.load();
      // Wait until metadata is available (or the source fails) before drawing.
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) { resolve(); return; }
        const done = () => {
          video?.removeEventListener('loadeddata', done);
          video?.removeEventListener('error', done);
          resolve();
        };
        video.addEventListener('loadeddata', done);
        video.addEventListener('error', done);
        window.setTimeout(done, 5000); // safety timeout
      });
    }
    if (video.readyState < 1 || video.videoWidth === 0) return null;
    if (video.paused) {
      video.currentTime = 0;
      video.play().catch(() => { /* autoplay blocked or src dead */ });
    }
    return video;
  }, []);

  const captureVideoFrame = useCallback(async (target: VideoCaptureTarget): Promise<string | null> => {
    const video = await ensureVideo(target.mediaUrl);
    if (!video) return null;

    const W = 1280;
    const H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0) {
      const cover = target.objectFit === 'cover';
      const scale = cover ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    return canvas.toDataURL('image/jpeg', FRAME_QUALITY);
  }, [ensureVideo]);

  const pushFrame = useCallback(async () => {
    // Don't pile up; one in-flight generation is enough.
    if (busyRef.current) return;
    const state = useStore.getState();
    if (!state.screenShareActive) return;
    if (state.screenShareClientCount <= 0) return;

    const slides = state.presentation.slides;
    const idx = state.liveIndex;
    const slide = slides[idx] ?? slides[0];
    if (!slide) return;

    busyRef.current = true;
    try {
      let frame: string | null = null;
      if (state.isBlackout) {
        // Generate a solid black JPEG once and reuse it across blackout periods.
        if (!blackFrameRef.current) {
          const c = document.createElement('canvas');
          const S = 320 * FRAME_SCALE;
          c.width = S;
          c.height = (S * 9) / 16;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, c.width, c.height);
          }
          blackFrameRef.current = c.toDataURL('image/jpeg', 0.7);
        }
        frame = blackFrameRef.current;
      } else if (slide.type === 'video') {
        frame = await captureVideoFrame({ mediaUrl: slide.mediaUrl ?? '', objectFit: slide.styles?.objectFit });
      } else if (slide.type === 'loop' && slide.loopItems?.[0]?.type === 'video') {
        // Loop starting with a video item — play it live.
        frame = await captureVideoFrame({ mediaUrl: slide.loopItems[0].mediaUrl ?? '', objectFit: 'contain' });
      } else {
        // Non-video slide — pause the hidden video so it stops burning CPU.
        videoRef.current?.pause();
        frame = await generateSlideThumbnail(slide, { scale: FRAME_SCALE, quality: FRAME_QUALITY });
      }
      if (frame) window.electronAPI?.screenShareFrame?.(frame);
    } finally {
      busyRef.current = false;
    }
  }, [captureVideoFrame]);

  // Push immediately when the live slide changes, its content changes (e.g.
  // hymn part switch), or blackout toggles.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || !screenShareActive) return;
    void pushFrame();
  }, [liveIndex, screenShareActive, isBlackout, slides, pushFrame]);

  // Periodic refresh for countdown ticks, loop rotation, etc.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || !screenShareActive) return;
    const id = setInterval(() => {
      void pushFrame();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [screenShareActive, pushFrame]);

  // Faster refresh while a video (or loop starting with a video) is live.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || !screenShareActive) return;
    const slides = useStore.getState().presentation.slides;
    const slide = slides[useStore.getState().liveIndex];
    const isVideo =
      slide?.type === 'video' ||
      (slide?.type === 'loop' && slide.loopItems?.[0]?.type === 'video');
    if (!isVideo) return;
    const id = setInterval(() => {
      void pushFrame();
    }, VIDEO_REFRESH_MS);
    return () => clearInterval(id);
  }, [screenShareActive, liveIndex, pushFrame]);

  // When the broadcast stops, release the hidden video element.
  useEffect(() => {
    if (screenShareActive) return;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }, [screenShareActive]);
}