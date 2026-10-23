export const settingsCategories = ['general', 'presentation', 'appearance', 'captions', 'autosave', 'updates', 'learning'] as const;
export type SettingsCategoryId = typeof settingsCategories[number];

interface SettingDefinition {
  id: string;
  category: SettingsCategoryId;
  titleKey: string;
  descriptionKey: string;
  focusSelector?: string;
}

/** Search includes translated product copy only, never settings values or user data. */
export const settingsItems = [
  { id: 'language', category: 'general', titleKey: 'settings.language', descriptionKey: 'settings.languageDesc' },
  { id: 'sound', category: 'general', titleKey: 'settings.soundEffects', descriptionKey: 'settings.soundEffectsDesc' },
  { id: 'motion', category: 'general', titleKey: 'settings.uiMotion', descriptionKey: 'settings.uiMotionDesc' },
  { id: 'auto-live', category: 'presentation', titleKey: 'common.autoGoLive', descriptionKey: 'common.autoGoLiveHint' },
  { id: 'sections', category: 'presentation', titleKey: 'sections.title', descriptionKey: 'sections.description' },
  { id: 'notes', category: 'presentation', titleKey: 'common.operatorNotes', descriptionKey: 'settings.operatorNotesDesc' },
  { id: 'appearance-preview', category: 'appearance', titleKey: 'settings.appearancePreview', descriptionKey: 'settings.appearancePreviewHint' },
  { id: 'hymn-position', category: 'appearance', titleKey: 'common.hymnsAuthorPosition', descriptionKey: 'common.hymnsAuthorPositionDesc' },
  { id: 'hymn-size', category: 'appearance', titleKey: 'common.hymnsAuthorSize', descriptionKey: 'settings.navigation.descriptions.hymn-size' },
  { id: 'watermark', category: 'appearance', titleKey: 'watermark.title', descriptionKey: 'settings.navigation.descriptions.watermark' },
  { id: 'soniox-website', category: 'captions', titleKey: 'settings.sonioxWebsite', descriptionKey: 'settings.sonioxAbout' },
  { id: 'stt-clear-key', category: 'captions', titleKey: 'settings.sonioxClearKey', descriptionKey: 'settings.sonioxClearHint' },
  { id: 'stt-key', category: 'captions', titleKey: 'settings.sonioxApiKey', descriptionKey: 'settings.sonioxApiKeyHint', focusSelector: '#soniox-api-key' },
  { id: 'spoken-language', category: 'captions', titleKey: 'settings.sonioxSttLanguage', descriptionKey: 'settings.sonioxSttLanguageHint', focusSelector: '#soniox-stt-language' },
  { id: 'target-language', category: 'captions', titleKey: 'settings.sonioxTargetLanguage', descriptionKey: 'settings.sonioxTargetLanguageHint', focusSelector: '#soniox-target-language' },
  { id: 'live-save', category: 'autosave', titleKey: 'settings.liveSave', descriptionKey: 'settings.navigation.descriptions.live-save', focusSelector: '[aria-pressed]' },
  { id: 'retention', category: 'autosave', titleKey: 'settings.liveSaveRetention', descriptionKey: 'settings.navigation.descriptions.retention' },
  { id: 'clear-live-saves', category: 'autosave', titleKey: 'settings.navigation.clearLiveSaves', descriptionKey: 'settings.navigation.descriptions.clear-live-saves' },
  { id: 'updates', category: 'updates', titleKey: 'settings.updates', descriptionKey: 'settings.updatesDesc' },
  { id: 'learn', category: 'learning', titleKey: 'guide.open', descriptionKey: 'tour.helpTitle' },
  { id: 'shortcuts', category: 'learning', titleKey: 'common.keyboardShortcuts', descriptionKey: 'tour.helpDescription' },
] as const satisfies readonly SettingDefinition[];

export type SettingsItemId = typeof settingsItems[number]['id'];

export function normalizeSettingsSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/ı/g, 'i').trim();
}
