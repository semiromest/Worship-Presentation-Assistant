export interface MediaFolderSettings {
  path: string;
  recursive: boolean;
  includeImages: boolean;
  includeVideos: boolean;
}

const STORAGE_KEY = 'wpa.mediaFolderSettings';

export const DEFAULT_MEDIA_FOLDER_SETTINGS: MediaFolderSettings = {
  path: '',
  recursive: false,
  includeImages: true,
  includeVideos: true,
};

export function loadMediaFolderSettings(): MediaFolderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MEDIA_FOLDER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MediaFolderSettings>;
    return {
      path: typeof parsed.path === 'string' ? parsed.path : '',
      recursive:
        typeof parsed.recursive === 'boolean'
          ? parsed.recursive
          : DEFAULT_MEDIA_FOLDER_SETTINGS.recursive,
      includeImages:
        typeof parsed.includeImages === 'boolean'
          ? parsed.includeImages
          : DEFAULT_MEDIA_FOLDER_SETTINGS.includeImages,
      includeVideos:
        typeof parsed.includeVideos === 'boolean'
          ? parsed.includeVideos
          : DEFAULT_MEDIA_FOLDER_SETTINGS.includeVideos,
    };
  } catch {
    return { ...DEFAULT_MEDIA_FOLDER_SETTINGS };
  }
}

export function saveMediaFolderSettings(settings: MediaFolderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Media folder settings save failed', err);
  }
}