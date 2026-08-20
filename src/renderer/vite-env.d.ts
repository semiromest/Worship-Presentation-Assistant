/// <reference types="vite/client" />

import type { SttConfig, SttStatus } from '../shared/stt';
import type { DisplayInfo, ProjectorOutputStatus } from '../shared/displays';

declare global {
  interface Window {
    electronAPI: {
      [x: string]: any;
      saveFile: (content: string) => Promise<string>;
      openFile: () => Promise<{ content: string; path: string }>;
      loadPresets: (retentionMs?: number) => Promise<any[]>;
      savePreset: (preset: { name: string; presentation: any; retentionMs?: number }) => Promise<any[]>;
      deletePreset: (name: string, retentionMs?: number) => Promise<any[]>;
      renamePreset: (oldName: string, newName: string, retentionMs?: number) => Promise<any[]>;
      getDisplays: () => Promise<DisplayInfo[]>;
      getProjectorOutputs: () => Promise<ProjectorOutputStatus[]>;
      toggleProjector: (initialData?: any, displayId?: string) => Promise<boolean>;
      openProjector: (displayId: string, initialData?: any) => Promise<boolean>;
      closeProjector: (displayId: string) => Promise<boolean>;
      updateProjector: (data: any) => Promise<boolean>;
      getProjectorStatus: () => Promise<boolean>;
      importBibleXml: (filePath?: string) => Promise<any>;
      saveBibleData: (id: string, data: unknown) => Promise<string | null>;
      readBibleData: (filePath: string) => Promise<{ content: string } | null>;
      deleteBibleData: (filePath: string) => Promise<boolean | null>;
      selectMediaFile: (type: 'image' | 'video') => Promise<string>;
      selectMediaFilesAll?: () => Promise<string[] | null>;
      importHymnArchive: (dirPath?: string) => Promise<any>;
      selectPptxFile: () => Promise<string | null>;
      importPptx: (filePath: string) => Promise<any>;
      exportPptx: (content: string) => Promise<{
        success: boolean;
        filePath?: string;
        slideCount?: number;
        warnings?: string[];
        error?: string;
        canceled?: boolean;
      }>;
      getRemoteUrl: () => Promise<string>;
      getRemoteDebug: () => Promise<any>;
      updateRemoteStatus: (status: any) => Promise<void>;
      quitApp: () => Promise<boolean>;
      updateAllSlidePreviews: (previews: (string | null)[]) => Promise<void>;
      updateSlidePreviewsDelta: (updates: { i: number; url: string }[]) => Promise<void>;
      sendSlidePreview: (dataUrl: string) => Promise<void>;
      showConfirmDialog: (options: {
        message: string;
        title?: string;
        detail?: string;
        confirmLabel?: string;
        cancelLabel?: string;
      }) => Promise<boolean>;
      showAlertDialog: (options: {
        message: string;
        title?: string;
        detail?: string;
        okLabel?: string;
      }) => Promise<void>;
      notifyProjectorReady: (displayId?: string) => void;
      onRemoteAction: (callback: (data: any) => void) => () => void;
      onProjectorUpdate: (callback: (data: any) => void) => () => void;
      onProjectorClosed: (callback: (data?: { displayId?: string }) => void) => () => void;
      onProjectorReady: (callback: (data?: { displayId?: string }) => void) => () => void;
      onDisplaysChanged: (callback: (displays: DisplayInfo[]) => void) => () => void;
      onProjectorOutputStatus: (callback: (outputs: ProjectorOutputStatus[]) => void) => () => void;
      onPptxImportProgress: (callback: (data: { current: number; total: number }) => void) => () => void;
      onPptxExportProgress: (callback: (data: { current: number; total: number }) => void) => () => void;
      selectMediaFiles?: (type: MediaKind) => Promise<string[] | string | null>;
      selectMediaFolder?: () => Promise<string | null>;
      readMediaFolder?: (
        folderPath: string,
        options?: { recursive?: boolean; includeImages?: boolean; includeVideos?: boolean },
      ) => Promise<{ paths: string[]; missing: boolean } | null>;
      selectMediaFile?: (type: MediaKind) => Promise<string | null>;

      // Google Drive API
      driveSignIn: () => Promise<DriveStatus>;
      driveSignOut: () => Promise<void>;
      driveStatus: () => Promise<DriveStatus>;
      driveListFiles: () => Promise<DriveFile[]>;
      driveUpload: (name: string, content: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
      driveSavePresentation: (content: string, name?: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
      driveDownload: (fileId: string) => Promise<{ ok: boolean; data?: string; error?: string }>;
      driveDeleteFile: (fileId: string) => Promise<{ ok: boolean; error?: string }>;

      // Updater API
      getUpdaterInfo: () => Promise<{ version: string; updaterActive: boolean }>;
      checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
      downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
      installUpdate: () => Promise<boolean>;
      onUpdaterEvent: (callback: (event: { type: string; payload?: any }) => void) => () => void;

      // Soniox real-time STT + translation
      sttGetStatus: () => Promise<SttStatus>;
      sttSetApiKey: (key: string) => Promise<{ ok: boolean; code?: string; message?: string }>;
      sttStart: (config: SttConfig) => Promise<{ ok: boolean; code?: string; message?: string }>;
      sttSendAudio: (chunk: ArrayBuffer | Uint8Array) => void;
      sttStop: () => Promise<{ ok: boolean }>;
      onSttEvent: (callback: (event: any) => void) => () => void;

      // Phone captions/translation share (LAN broadcast to phone browsers)
      shareStart: () => Promise<{ ok: boolean; url?: string; error?: string }>;
      shareStop: () => Promise<{ ok: boolean }>;
      sharePublish: (snapshot: any) => void;
      shareGetStatus: () => Promise<{ active: boolean; url: string; clientCount: number }>;
      onShareClientCount: (callback: (count: number) => void) => () => void;
      onShareNetworkChanged: (callback: (data: { url: string }) => void) => () => void;
    };
  }
}

export {};
