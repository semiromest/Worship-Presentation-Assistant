// Web build stand-ins for renderer hooks whose work happens in the Electron main
// process (live captions, phone share, phone screen mirror, desktop document host).
// The web vite config aliases only those modules here; everything else is the real renderer.
const noop = () => {};
const noopAsync = async () => {};
export function useStt() { return { start: noopAsync, stop: noopAsync, refreshStatus: noopAsync }; }
export const refreshSttInputDevices = noopAsync;
export const useSttSlideTracker = noop;
export const useLiveScreenShare = noop;
export function useScreenShare() { return { startShare: async () => ({ ok: false }), stopShare: noopAsync }; }
export function useShare() { return { startShare: noopAsync, stopShare: noopAsync }; }
export default function DesktopHost() { return null; }
