/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      [x: string]: any;
      saveFile: (content: string) => Promise<string>;
      openFile: () => Promise<{ content: string; path: string }>;
      loadPresets: () => Promise<any[]>;
      savePreset: (preset: { name: string; presentation: any }) => Promise<any[]>;
      deletePreset: (name: string) => Promise<any[]>;
      renamePreset: (oldName: string, newName: string) => Promise<any[]>;
      toggleProjector: (initialData?: any) => Promise<boolean>;
      updateProjector: (data: any) => Promise<boolean>;
      getProjectorStatus: () => Promise<boolean>;
      importBibleXml: (filePath?: string) => Promise<any>;
      selectMediaFile: (type: 'image' | 'video') => Promise<string>;
      selectMediaFilesAll?: () => Promise<string[] | null>;
      importHymnArchive: (dirPath?: string) => Promise<any>;
      selectPptxFile: () => Promise<string | null>;
      importPptx: (filePath: string) => Promise<any>;
      getRemoteUrl: () => Promise<string>;
      getRemoteDebug: () => Promise<any>;
      updateRemoteStatus: (status: any) => Promise<void>;
      quitApp: () => Promise<boolean>;
      updateAllSlidePreviews: (previews: (string | null)[]) => Promise<void>;
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
      notifyProjectorReady: () => void;
      onRemoteAction: (callback: (data: any) => void) => () => void;
      onProjectorUpdate: (callback: (data: any) => void) => () => void;
      onProjectorClosed: (callback: () => void) => () => void;
      onPptxImportProgress: (callback: (data: { current: number; total: number }) => void) => () => void;
      selectMediaFiles?: (type: MediaKind) => Promise<string[] | string | null>;
      selectMediaFolder?: () => Promise<string | null>;
      readMediaFolder?: (folderPath: string) => Promise<string[] | null>;
      selectMediaFile?: (type: MediaKind) => Promise<string | null>;
    };
  }
}

export {};
