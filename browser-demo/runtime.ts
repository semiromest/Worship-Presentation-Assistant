// Browser build aliases replace only desktop-side runtime hooks, not UI components.
const noop = () => {};
const noopAsync = async () => {};
export function useStt() { return { start: noopAsync, stop: noopAsync, refreshStatus: noopAsync }; }
export const refreshSttInputDevices = noopAsync;
export function useRemoteControl() { return { openLive: noopAsync, closeLive: noopAsync, openOutput: noopAsync, closeOutput: noopAsync }; }
export const useProjectorSync = noop;
export const useLiveScreenShare = noop;
export const usePreparationCheck = noop;
export const useSttSlideTracker = noop;
export function useScreenShare() { return { startShare: async () => ({ ok: false }), stopShare: noopAsync }; }
export function useShare() { return { startShare: noopAsync, stopShare: noopAsync }; }
export default function DesktopHost() { return null; }
