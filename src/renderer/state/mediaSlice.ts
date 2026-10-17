// UndoAction is used in setPresentationName to keep rename in undo history

import type { AppSet, AppState } from './storeTypes';

export function createMediaSlice(
  set: AppSet
): Pick<
  AppState,
  | 'shareActive'
  | 'setShareActive'
  | 'shareUrl'
  | 'setShareUrl'
  | 'shareQr'
  | 'setShareQr'
  | 'shareClientCount'
  | 'setShareClientCount'
  | 'shareNetworkChanged'
  | 'setShareNetworkChanged'
  | 'screenShareActive'
  | 'setScreenShareActive'
  | 'screenShareUrl'
  | 'setScreenShareUrl'
  | 'screenShareQr'
  | 'setScreenShareQr'
  | 'screenShareClientCount'
  | 'setScreenShareClientCount'
  | 'screenShareNetworkChanged'
  | 'setScreenShareNetworkChanged'
  | 'backgroundMusicFolder'
  | 'backgroundMusicFiles'
  | 'backgroundMusicCurrent'
  | 'backgroundMusicPlaying'
  | 'setBackgroundMusicFolder'
  | 'setBackgroundMusicFiles'
  | 'setBackgroundMusicCurrent'
  | 'setBackgroundMusicPlaying'
  | 'mediaVolume'
  | 'setMediaVolume'
  | 'isMediaMuted'
  | 'setIsMediaMuted'
  | 'mediaItems'
  | 'setMediaItems'
  | 'loopItems'
  | 'setLoopItems'
  | 'driveSignedIn'
  | 'driveEmail'
  | 'driveFiles'
  | 'drivePanelOpen'
  | 'driveSigningIn'
  | 'driveFilesLoaded'
  | 'setDriveSignedIn'
  | 'setDriveFiles'
  | 'setDrivePanelOpen'
  | 'setDriveSigningIn'
  | 'setDriveFilesLoaded'
> {
  return {
    shareActive: false,
    setShareActive: (shareActive) => set({ shareActive }),
    shareUrl: '',
    setShareUrl: (shareUrl) => set({ shareUrl }),
    shareQr: null,
    setShareQr: (shareQr) => set({ shareQr }),
    shareClientCount: 0,
    setShareClientCount: (shareClientCount) => set({ shareClientCount }),
    shareNetworkChanged: false,
    setShareNetworkChanged: (shareNetworkChanged) => set({ shareNetworkChanged }),
    screenShareActive: false,
    setScreenShareActive: (screenShareActive) => set({ screenShareActive }),
    screenShareUrl: '',
    setScreenShareUrl: (screenShareUrl) => set({ screenShareUrl }),
    screenShareQr: null,
    setScreenShareQr: (screenShareQr) => set({ screenShareQr }),
    screenShareClientCount: 0,
    setScreenShareClientCount: (screenShareClientCount) => set({ screenShareClientCount }),
    screenShareNetworkChanged: false,
    setScreenShareNetworkChanged: (screenShareNetworkChanged) => set({ screenShareNetworkChanged }),
    backgroundMusicFolder: (() => {
      try {
        return localStorage.getItem('backgroundMusicFolder') ?? '';
      } catch {
        return '';
      }
    })(),
    backgroundMusicFiles: [],
    backgroundMusicCurrent: null,
    backgroundMusicPlaying: false,
    setBackgroundMusicFolder: (folder) => {
      try {
        localStorage.setItem('backgroundMusicFolder', folder);
      } catch {
        /* storage unavailable */
      }
      set({ backgroundMusicFolder: folder });
    },
    setBackgroundMusicFiles: (backgroundMusicFiles) => set({ backgroundMusicFiles }),
    setBackgroundMusicCurrent: (backgroundMusicCurrent) => set({ backgroundMusicCurrent }),
    setBackgroundMusicPlaying: (backgroundMusicPlaying) => set({ backgroundMusicPlaying }),
    mediaVolume: 1,
    setMediaVolume: (vol) => set({ mediaVolume: vol }),
    isMediaMuted: false,
    setIsMediaMuted: (muted) =>
      set((state) => ({
        isMediaMuted: typeof muted === 'function' ? muted(state.isMediaMuted) : muted,
      })),
    mediaItems: [],
    setMediaItems: (items) =>
      set((state) => ({
        mediaItems: typeof items === 'function' ? items(state.mediaItems) : items,
      })),
    loopItems: [],
    setLoopItems: (items) =>
      set((state) => ({
        loopItems: typeof items === 'function' ? items(state.loopItems) : items,
      })),
    driveSignedIn: false,
    driveEmail: null,
    driveFiles: [],
    drivePanelOpen: false,
    driveSigningIn: false,
    driveFilesLoaded: false,
    setDriveSignedIn: (signedIn, email = null) => set({ driveSignedIn: signedIn, driveEmail: email }),
    setDriveFiles: (files) => set({ driveFiles: files }),
    setDrivePanelOpen: (open) => set({ drivePanelOpen: open }),
    setDriveSigningIn: (signingIn) => set({ driveSigningIn: signingIn }),
    setDriveFilesLoaded: (loaded) => set({ driveFilesLoaded: loaded }),
  };
}
