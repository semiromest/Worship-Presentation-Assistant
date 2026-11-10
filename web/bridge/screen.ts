// Screen slides on the web. The renderer asks for desktop sources by id and
// then calls getUserMedia({ chromeMediaSource: 'desktop', chromeMediaSourceId })
// (Electron-only constraints). Here a single shared capture stands behind the
// id `web-screen`: the control page obtains it with getDisplayMedia (the
// browser's own picker), and output windows reuse it through `window.opener`,
// so the user is asked once and every output shows the same capture.
export const WEB_SCREEN_ID = 'web-screen';

declare global {
  interface Window { __wpaScreenCapture?: { stream: MediaStream | null } }
}

const shared = (): { stream: MediaStream | null } => {
  try {
    const opener = window.opener as Window | null;
    if (opener && opener.location.origin === location.origin && opener.__wpaScreenCapture) return opener.__wpaScreenCapture;
  } catch { /* opener on another origin */ }
  return (window.__wpaScreenCapture ??= { stream: null });
};

const live = (stream: MediaStream | null) => !!stream && stream.getVideoTracks().some(track => track.readyState === 'live');

async function captureStream(): Promise<MediaStream> {
  const state = shared();
  if (live(state.stream)) return state.stream!;
  if (window.opener) throw new DOMException('Start the screen capture from the control window first', 'NotAllowedError');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
  state.stream = stream;
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (state.stream === stream) state.stream = null; }, { once: true });
  return stream;
}

function isDesktopConstraint(constraints?: MediaStreamConstraints): { video: boolean; audio: boolean; id?: string } | null {
  const video = constraints?.video as any;
  const audio = constraints?.audio as any;
  const desktopVideo = video && typeof video === 'object' && video.mandatory?.chromeMediaSource === 'desktop';
  const desktopAudio = audio && typeof audio === 'object' && audio.mandatory?.chromeMediaSource === 'desktop';
  if (!desktopVideo && !desktopAudio) return null;
  return { video: !!desktopVideo, audio: !!desktopAudio, id: desktopVideo ? video.mandatory.chromeMediaSourceId : undefined };
}

export function installScreenCaptureShim(): void {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const desktop = isDesktopConstraint(constraints);
    if (!desktop) return original(constraints);
    const source = await captureStream();
    // Each consumer gets its own clone so stopping one preview never ends the shared capture.
    const tracks = [
      ...(desktop.video ? source.getVideoTracks() : []),
      ...(desktop.audio ? source.getAudioTracks() : []),
    ].map(track => track.clone());
    return new MediaStream(tracks);
  };
}

export async function getScreenSources(language: 'tr' | 'en') {
  const stream = shared().stream;
  const label = live(stream) ? stream!.getVideoTracks()[0]?.label || (language === 'tr' ? 'Paylaşılan ekran' : 'Shared screen') : (language === 'tr' ? 'Ekran, pencere veya sekme seç…' : 'Choose a screen, window or tab…');
  return [{ id: WEB_SCREEN_ID, name: label, thumbnail: '', display_id: '' }];
}

/** One still frame of the shared capture (used for thumbnails). */
export async function captureScreenFrame(): Promise<string | null> {
  const stream = shared().stream;
  if (!live(stream)) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = new MediaStream(stream!.getVideoTracks().map(track => track.clone()));
  try {
    await video.play();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / (video.videoWidth || 640));
    canvas.width = Math.round((video.videoWidth || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 360) * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  } finally {
    (video.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}
