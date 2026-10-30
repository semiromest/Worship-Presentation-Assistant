import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { uiMotion } from '../uiMotion';
import * as m from 'motion/react-m';
import { playSfx } from '../sfx';
import { readHymnAuthorPosition, readHymnAuthorSize } from '../hymnAuthorSettings';
import { usePractice } from '../hooks/usePractice';
import { SettingsAppearancePreview } from './SettingsAppearancePreview';
import { PracticePanel } from './PracticePanel';
import { registerTourAnchor } from './Tour/tourController';
import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Zap, Settings2, Save, Trash2, DatabaseBackup, Volume2, Mic, KeyRound, Languages, Check, Loader2, Music, Palette, Sparkles, Search, X, ChevronRight, BookOpen, Monitor, RefreshCw, Keyboard } from 'lucide-react';
import { useStore } from '../state/useStore';
import { useUpdaterStore } from '../state/useUpdaterStore';
import { WatermarkSettingsPanel } from './WatermarkSettingsPanel';
import { PositionPicker, SettingSlider } from './SettingsControls';
import type { Position } from '../types';
import { useSttStore, refreshSttStatus } from '../state/useSttStore';
import { AUTO_STT_LANGUAGE, STT_LANGUAGES } from '../../shared/stt';
import { cn } from '../utils';
import { DEFAULT_LIVE_SAVE_RETENTION_MS, isLiveSavePreset, LIVE_SAVE_RETENTION_OPTIONS, getLiveSaveRetention } from '../hooks/useLiveSave';
import SettingSwitch from './SettingSwitch';
import { settingsCategories, settingsItems, normalizeSettingsSearch, type SettingsCategoryId, type SettingsItemId } from './settingsNavigation';
import './SettingsTab.css';
import DesktopSettings from './DesktopSettings';

// Navigation is session-only; it never changes a saved presentation or user setting.
let lastSettingsCategory: SettingsCategoryId = 'general';
const CATEGORY_ICONS = { general: Settings2, presentation: Monitor, appearance: Palette, captions: Mic, autosave: DatabaseBackup, updates: RefreshCw, learning: BookOpen };

const HYMN_POSITION_KEYS: Record<Position, string> = {
  'bottom-left': 'common.hymnsAuthorPosBottomLeft',
  'bottom-center': 'common.hymnsAuthorPosBottomCenter',
  'bottom-right': 'common.hymnsAuthorPosBottomRight',
  'top-left': 'common.hymnsAuthorPosTopLeft',
  'top-center': 'common.hymnsAuthorPosTopCenter',
  'top-right': 'common.hymnsAuthorPosTopRight',
};


export default function SettingsTab() {

  const { t, i18n } = useTranslation();
  const practice = usePractice();
  const motionEnabled = useUiMotionEnabled();
  const [category, setCategory] = useState<SettingsCategoryId>(() => lastSettingsCategory);
  const [query, setQuery] = useState('');
  const [focusItem, setFocusItem] = useState<SettingsItemId | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizeSettingsSearch(query);
  const searchResults = settingsItems.filter(item => {
    const copy = [item.id === 'sound' ? `${t('settings.muteSfxDuringLive')} ${t('settings.muteSfxDuringLiveDesc')}` : '', t(item.titleKey), t(item.descriptionKey), t(`settings.navigation.categories.${item.category}.title`), t(`settings.navigation.keywords.${item.id}`)];
    const haystack = normalizeSettingsSearch(copy.join(' '));
    return normalizedQuery.split(/\s+/).every(word => haystack.includes(word));
  });

  const chooseCategory = (next: SettingsCategoryId) => {
    if (next !== category || query) playSfx('swipe');
    lastSettingsCategory = next;
    setCategory(next);
    setQuery('');
    setFocusItem(null);
  };
  const clearSearch = () => { setQuery(''); searchRef.current?.focus(); };
  const openSearchResult = (item: typeof settingsItems[number]) => {
    chooseCategory(item.category);
    setFocusItem(item.id);
  };
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [category, normalizedQuery]);
  useEffect(() => {
    if (!focusItem || normalizedQuery) return;
    const frame = requestAnimationFrame(() => {
      const item = settingsItems.find(entry => entry.id === focusItem);
      const root = contentRef.current?.querySelector<HTMLElement>(`#settings-item-${focusItem}`);
      if (!root || !item) return;
      root.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const explicit = 'focusSelector' in item ? root.querySelector<HTMLElement>(item.focusSelector) : null;
      const control = explicit ?? [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="file"]), summary, [tabindex="0"]')]
        .find(element => element.getClientRects().length > 0);
      (control ?? root).focus({ preventScroll: true });
      setFocusItem(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusItem, normalizedQuery, category]);

  const sectionsEnabled = useStore(s => s.serviceSectionsEnabled);
  const setSectionsEnabled = useStore(s => s.setServiceSectionsEnabled);
  const operatorNotesEnabled = useStore((s) => s.operatorNotesEnabled);
  const setOperatorNotesEnabled = useStore((s) => s.setOperatorNotesEnabled);
  const autoGoLive = useStore((s) => s.autoGoLive);
  const setAutoGoLive = useStore((s) => s.setAutoGoLive);
  const setIsUpdatesOpen = useStore((s) => s.setIsUpdatesOpen);
  const setIsCheatsheetOpen = useStore((s) => s.setIsCheatsheetOpen);
  const liveSaveEnabled = useStore((s) => s.liveSaveEnabled);
  const setLiveSaveEnabled = useStore((s) => s.setLiveSaveEnabled);
  const liveSaveLastSaved = useStore((s) => s.liveSaveLastSaved);
  const liveSaveRetentionMs = useStore((s) => s.liveSaveRetentionMs);
  const setLiveSaveRetentionMs = useStore((s) => s.setLiveSaveRetentionMs);
  const presets = useStore((s) => s.presets);
  const setPresets = useStore((s) => s.setPresets);
  const uiSfxMuteDuringLive = useStore(s => s.uiSfxMuteDuringLive);
  const setUiSfxMuteDuringLive = useStore(s => s.setUiSfxMuteDuringLive);
  const uiSfxEnabled = useStore((s) => s.uiSfxEnabled);
  const setUiSfxEnabled = useStore((s) => s.setUiSfxEnabled);
  const uiMotionEnabled = useStore((s) => s.uiMotionEnabled);
  const setUiMotionEnabled = useStore((s) => s.setUiMotionEnabled);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);

  // Hymn author position & size
  const [hymnAuthorPosition, setHymnAuthorPosition] = useState(readHymnAuthorPosition);
  const [hymnAuthorSize, setHymnAuthorSize] = useState(readHymnAuthorSize);

  // Soniox real-time captions
  const sttHasKey = useSttStore((s) => s.hasKey);
  const sttKeyHint = useSttStore((s) => s.keyHint);
  const sttSpokenLanguage = useSttStore((s) => s.sttLanguage);
  const sttSetSpokenLanguage = useSttStore((s) => s.setSttLanguage);
  const sttTargetLanguage = useSttStore((s) => s.targetLanguage);
  const sttSetTargetLanguage = useSttStore((s) => s.setTargetLanguage);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyState, setApiKeyState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const sttStatus = useSttStore(state => state.status);
  const micActive = useSttStore(state => state.micActive);
  const [keyDeleting, setKeyDeleting] = useState(false);
  const [websiteError, setWebsiteError] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (!practice) void refreshSttStatus();
  }, [practice]);

  const saveApiKey = async () => {
    const key = apiKeyDraft.trim();
    if (!key) {
      setKeyError(t('settings.sonioxKeyEmpty')); playSfx('error');
      return;
    }
    setApiKeyState('saving');
    setKeyError(null);
    try {
      const res = await window.electronAPI?.sttSetApiKey?.(key);
      if (!res?.ok) {
        setKeyError(t('settings.sonioxKeySaveFailed')); playSfx('error');
      } else {
        setApiKeyDraft('');
        setApiKeyState('saved');
        playSfx('success');
        await refreshSttStatus();
        setTimeout(() => setApiKeyState('idle'), 2200);
      }
    } catch {
      setKeyError(t('settings.sonioxKeySaveFailed')); playSfx('error');
      setApiKeyState('idle');
    }
  };

  const clearApiKey = async () => {
    setKeyDeleting(true); setKeyError(null);
    try {
      const result = await window.electronAPI.sttDeleteApiKey();
      if (!result.ok) { setKeyError(t(result.code === 'SESSION_ACTIVE' ? 'settings.sonioxStopFirst' : 'settings.sonioxClearFailed')); playSfx('error'); return; }
      setApiKeyDraft(''); setApiKeyState('idle'); await refreshSttStatus(); playSfx('delete');
    } catch { setKeyError(t('settings.sonioxClearFailed')); playSfx('error'); }
    finally { setKeyDeleting(false); }
  };

  // Language defaults persist inside the store setters (localStorage).
  const changeSpokenLanguage = (code: string) => sttSetSpokenLanguage(code);
  const changeTargetLanguage = (code: string) => sttSetTargetLanguage(code);

  const languages = Object.keys(i18n.options.resources ?? {});
  const liveSavePresets = useMemo(
    () => [...presets].filter((preset) => isLiveSavePreset(preset.name)).sort((a, b) => b.createdAt - a.createdAt),
    [presets]
  );
  const latestLiveSave = liveSavePresets[0] ?? null;

  const clearLiveSaves = async () => {
    const names = liveSavePresets.map((preset) => preset.name);
    if (names.length === 0) return;

    let next = [...presets];
    for (const name of names) {
      const updated = await window.electronAPI?.deletePreset?.(name, getLiveSaveRetention());
      if (Array.isArray(updated)) next = updated;
    }

    setPresets(next);
  };

  const categoryContent: Record<SettingsCategoryId, ReactNode> = {
    general: <>
        <section id="settings-item-language" tabIndex={-1} className="settings-simple-card settings-row rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.language')}>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-white/60 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">{t('settings.language')}</h3>
              <p className="text-sm leading-relaxed text-white/60">{t('settings.languageDesc')}</p>
            </div>
          </div>
          <select
            value={i18n.language}
            onChange={(e) => { if (e.target.value !== i18n.language) { void i18n.changeLanguage(e.target.value); playSfx('press'); } }}
            aria-label={t('settings.language')}
            className="w-full sm:w-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
          >
            {languages.map((lng) => (
              <option key={lng} value={lng} className="bg-surface-overlay">
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </section>

        <section id="settings-item-sound" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.soundEffects')}>
          <div className="settings-row flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Volume2 className={cn('w-4 h-4 shrink-0', uiSfxEnabled ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('settings.soundEffects')}</h3>
                <p className="text-sm leading-relaxed text-white/60">{t('settings.soundEffectsDesc')}</p>
              </div>
            </div>
            <SettingSwitch checked={uiSfxEnabled} onCheckedChange={setUiSfxEnabled} label={t('settings.soundEffects')} />
          </div>
          <div className="settings-row mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
            <div><h4 className="text-sm font-medium">{t('settings.muteSfxDuringLive')}</h4><p className="text-sm text-white/60">{t('settings.muteSfxDuringLiveDesc')}</p></div>
            <SettingSwitch checked={uiSfxMuteDuringLive} onCheckedChange={setUiSfxMuteDuringLive} label={t('settings.muteSfxDuringLive')} />
          </div>
        </section>

        <section id="settings-item-motion" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.uiMotion')}>
          <div className="settings-row flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className={cn('w-4 h-4 shrink-0', uiMotionEnabled ? 'text-violet-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('settings.uiMotion')}</h3>
                <p className="text-sm leading-relaxed text-white/60">{t('settings.uiMotionDesc')}</p>
              </div>
            </div>
            <SettingSwitch
              checked={uiMotionEnabled}
              onCheckedChange={setUiMotionEnabled}
              label={t('settings.uiMotion')}
              activeClassName="bg-violet-500"
            />
          </div>
        </section></>,
    presentation: <>
        <section id="settings-item-auto-live" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('common.autoGoLive')}>
          <div className="settings-row flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Zap className={cn('w-4 h-4 shrink-0', autoGoLive ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('common.autoGoLive')}</h3>
                <p className="text-sm leading-relaxed text-white/60">{t('common.autoGoLiveHint')}</p>
              </div>
            </div>
            <SettingSwitch checked={autoGoLive} onCheckedChange={setAutoGoLive} label={t('common.autoGoLive')} />
          </div>
        </section>

        <section id="settings-item-sections" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4 settings-row flex items-center justify-between gap-4">
          <div><h3 className="text-sm font-semibold">{t('sections.title')}</h3><p className="text-sm leading-relaxed text-white/60">{t('sections.description')}</p></div>
          <SettingSwitch checked={sectionsEnabled} onCheckedChange={setSectionsEnabled} label={t('sections.title')} />
        </section>

        <section id="settings-item-notes" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4 settings-row flex items-center justify-between gap-4" aria-label={t('common.operatorNotes')}>
          <div>
            <h3 className="text-sm font-semibold">{t('common.operatorNotes')}</h3>
            <p className="text-sm leading-relaxed text-white/60">{t('settings.operatorNotesDesc')}</p>
          </div>
          <SettingSwitch checked={operatorNotesEnabled} onCheckedChange={setOperatorNotesEnabled} label={t('common.operatorNotes')} />
        </section></>,
    appearance: <>
        {!normalizedQuery && category === 'appearance' && <SettingsAppearancePreview authorPosition={hymnAuthorPosition} authorSize={hymnAuthorSize} />}
        <div className="grid gap-4 mt-4 lg:grid-cols-2 items-start">
          <section id="settings-item-hymn-position" tabIndex={-1} className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4 h-full" aria-label={t('common.hymnsAuthorPosition')}>
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold">{t('common.hymnsAuthorPosition')}</h3>
                <p className="text-sm leading-relaxed text-white/60">{t('common.hymnsAuthorPositionDesc')}</p>
              </div>
            </div>

            {/* Position picker (same control as the logo watermark) */}
            <PositionPicker
              value={hymnAuthorPosition as Position}
              labelFor={(position) => t(HYMN_POSITION_KEYS[position])}
              ariaLabel={t('common.hymnsAuthorPosition')}
              onChange={(position) => {
                setHymnAuthorPosition(position);
                try { localStorage.setItem('hymnAuthorPosition', position); } catch { /* storage unavailable */ }
              }}
            />

            {/* Size slider */}
            <div id="settings-item-hymn-size" tabIndex={-1}>
              <SettingSlider
                id="hymn-author-size"
                label={t('common.hymnsAuthorSize')}
                value={hymnAuthorSize}
                min={10}
                max={60}
                suffix="%"
                onChange={(size) => {
                  setHymnAuthorSize(size);
                  try { localStorage.setItem('hymnAuthorSize', String(size)); } catch { /* storage unavailable */ }
                }}
              />
            </div>
          </section>

          <div id="settings-item-watermark" tabIndex={-1} className="h-full">
            <WatermarkSettingsPanel />
          </div>
        </div>
      </>,
    captions: <section className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4" aria-label={t('settings.soniox')}>
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">{t('settings.soniox')}</h3>
              <p className="text-sm leading-relaxed text-white/60">{t('settings.sonioxDesc')}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-blue-400/20 bg-blue-500/5 p-3 text-sm leading-relaxed text-white/70">
            <p>{t('settings.sonioxAbout')}</p><p>{t('settings.sonioxSetup')}</p>
            <button id="settings-item-soniox-website" type="button" disabled={practice} onClick={async () => { try { const result = await window.electronAPI.openSonioxWebsite(); setWebsiteError(!result.ok); } catch { setWebsiteError(true); } }} className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 font-medium text-blue-200 hover:bg-blue-500/20 disabled:opacity-40">{t('settings.sonioxWebsite')}</button>
            {websiteError && <p role="alert" className="text-red-300">{t('settings.sonioxWebsiteFailed')}</p>}
          </div>
          {/* API key status */}
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
              sttHasKey
                ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200'
                : 'border-amber-500/25 bg-amber-500/5 text-amber-100/90'
            )}
          >
            {sttHasKey ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t('settings.sonioxKeyConfigured')}</span>
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t('settings.sonioxKeyMissing')}</span>
              </>
            )}
            {sttKeyHint && (
              <span className="ml-auto font-mono text-xs leading-5 text-white/55" title={sttKeyHint}>
                {sttKeyHint}
              </span>
            )}
          </div>

          {/* API key input (password, write-only) */}
          <div id="settings-item-stt-key" tabIndex={-1} className="space-y-1.5">
            <label htmlFor="soniox-api-key" className="block text-xs text-white/65">
              {t('settings.sonioxApiKey')}
            </label>
            <div className="flex gap-2">
              <input
                id="soniox-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveApiKey();
                }}
                placeholder={sttHasKey ? '••••••••••••••••' : t('settings.sonioxApiKeyPlaceholder')}
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
              />
              <button
                type="button"
                onClick={() => void saveApiKey()}
                disabled={practice || keyDeleting || apiKeyState === 'saving'}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold transition-colors"
              >
                {apiKeyState === 'saving' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : apiKeyState === 'saved' ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                )}
                {apiKeyState === 'saved' ? t('common.saved') : t('common.save')}
              </button>
            </div>
            <div id="settings-item-stt-clear-key" tabIndex={-1} className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void clearApiKey()} disabled={practice || micActive || !['idle','error'].includes(sttStatus) || keyDeleting || apiKeyState === 'saving' || (!sttHasKey && !apiKeyDraft)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/25 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-40"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('settings.sonioxClearKey')}</button>
              <p className="w-full text-xs leading-relaxed text-white/55">{t('settings.sonioxClearHint')}</p>
              {(micActive || !['idle','error'].includes(sttStatus)) && <span className="text-xs text-white/55">{t('settings.sonioxStopFirst')}</span>}
            </div>
            <p className="text-xs leading-5 text-white/55">{t('settings.sonioxApiKeyHint')}</p>
            {keyError && <p className="text-[11px] text-red-400">{keyError}</p>}
          </div>

          {/* Default spoken language (STT recognition) */}
          <div id="settings-item-spoken-language" tabIndex={-1} className="space-y-1.5">
            <label htmlFor="soniox-stt-language" className="block text-xs text-white/65">
              {t('settings.sonioxSttLanguage')}
            </label>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                id="soniox-stt-language"
                value={sttSpokenLanguage}
                onChange={(e) => changeSpokenLanguage(e.target.value)}
                aria-label={t('settings.sonioxSttLanguage')}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
              >
                <option value={AUTO_STT_LANGUAGE} className="bg-surface-overlay">
                  {t('settings.sonioxSttAuto')}
                </option>
                {STT_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs leading-5 text-white/55">{t('settings.sonioxSttLanguageHint')}</p>
          </div>

          {/* Translation target language */}
          <div id="settings-item-target-language" tabIndex={-1} className="space-y-1.5">
            <label htmlFor="soniox-target-language" className="block text-xs text-white/65">
              {t('settings.sonioxTargetLanguage')}
            </label>
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                id="soniox-target-language"
                value={sttTargetLanguage}
                onChange={(e) => changeTargetLanguage(e.target.value)}
                aria-label={t('settings.sonioxTargetLanguage')}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors disabled:opacity-50"
              >
                {STT_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs leading-5 text-white/55">{t('settings.sonioxTargetLanguageHint')}</p>
          </div>
        </section>,
    autosave: <section id="settings-item-live-save" tabIndex={-1} className="rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.liveSave')}>
          <div className="settings-row flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Save className={cn('w-4 h-4 shrink-0', liveSaveEnabled ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('settings.liveSave')}</h3>
                {liveSaveEnabled && liveSaveLastSaved && (
                  <p className="text-sm leading-relaxed text-white/60 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" aria-hidden="true" />
                    {t('settings.liveSaveLastSaved', { time: new Date(liveSaveLastSaved).toLocaleTimeString() })}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setLiveSaveEnabled(!liveSaveEnabled); playSfx(liveSaveEnabled ? 'toggle-off' : 'toggle-on'); }}
              aria-pressed={liveSaveEnabled}
              aria-label={t('settings.liveSave')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]',
                liveSaveEnabled ? 'bg-emerald-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  liveSaveEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          <div id="settings-item-retention" tabIndex={-1} className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 text-emerald-100/90 text-[11px] font-medium uppercase tracking-[0.12em]">
              <DatabaseBackup className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('settings.liveSaveRetention')}</span>
            </div>
            <select
              value={String(liveSaveRetentionMs)}
              onChange={(e) => { const next = Number(e.target.value); if (next !== liveSaveRetentionMs) { setLiveSaveRetentionMs(next); playSfx('press'); } }}
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-sm text-white outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              aria-label={t('settings.liveSaveRetention')}
            >
              {LIVE_SAVE_RETENTION_OPTIONS.map((option) => (
                <option key={option} value={String(option)} className="bg-surface-overlay text-white">
                  {option === 0 ? t('settings.retentionForever') : option === DEFAULT_LIVE_SAVE_RETENTION_MS ? t('settings.retention7d') : option === 24 * 60 * 60 * 1000 ? t('settings.retention1d') : t('settings.retention30d')}
                </option>
              ))}
            </select>
          </div>

          <div id="settings-item-clear-live-saves" tabIndex={-1} className="mt-5 border-t border-white/10 pt-4 text-sm text-white/65">
            {latestLiveSave ? (
              <div className="settings-row flex items-center justify-between gap-3">
                <span>
                  {t('settings.liveSaveLastSaved', {
                    time: new Date(latestLiveSave.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}
                </span>
                <button
                  type="button"
                  onClick={clearLiveSaves}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-white/75 hover:bg-white/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {t('settings.navigation.clearLiveSaves')}
                </button>
              </div>
            ) : (
              <span>{t('settings.liveSaveEmpty')}</span>
            )}
          </div>
        </section>,
    updates: <section id="settings-item-updates" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.updates')}>
          <div className="settings-row flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t('settings.updates')}</h3>
              <p className="text-sm leading-relaxed text-white/60">{t('settings.updatesDesc')}</p>
              {currentVersion && (
                <p className="mt-1 text-xs font-mono text-white/65">
                  {t('updates.currentVersion')}: v{currentVersion}
                </p>
              )}
            </div>
            <button
              onClick={() => { setIsUpdatesOpen(true); playSfx('open'); }}
              className="workspace-secondary-action relative font-medium transition-colors active:scale-[0.96]"
            >
              {t('settings.openUpdates')}
              {(updaterStatus === 'available' || updaterStatus === 'downloaded') && (
                <span
                  className="w-2 h-2 rounded-full bg-green-500"
                  aria-hidden="true"
                  title={updaterStatus === 'downloaded' ? t('updates.updateDownloadedBadge') : t('updates.updateAvailableBadge')}
                />
              )}
            </button>
          </div>
        </section>,
    learning: <>
        <section id="settings-item-shortcuts" tabIndex={-1} className="settings-simple-card settings-row flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-surface-raised p-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Keyboard className="h-4 w-4 shrink-0 text-white/60" aria-hidden="true" />{t('common.keyboardShortcuts')}</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/60">{t('tour.helpDescription')}</p>
          </div>
          <button type="button" aria-label={t('common.keyboardShortcuts')} onClick={() => { setIsCheatsheetOpen(true); playSfx('open'); }} className="workspace-secondary-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{t('common.open')}</button>
        </section>
        <section id="settings-item-learn" tabIndex={-1} ref={element => registerTourAnchor('help', element)} className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-3">
          <PracticePanel />
        </section></>,
  };

  return (
    <div className="settings-workspace flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-white/10 bg-surface px-4 py-3">
        <div className="settings-header-layout mx-auto max-w-6xl">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Settings2 className="h-5 w-5 text-blue-400" aria-hidden="true" />{t('nav.settings')}</h2>
          <div className="settings-search relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden="true" />
            <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); clearSearch(); } }}
              aria-label={t('settings.navigation.search')} placeholder={t('settings.navigation.search')}
              className="workspace-search-input pr-11" />
            {query && <button type="button" onClick={clearSearch} aria-label={t('settings.navigation.clearSearch')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" aria-hidden="true" /></button>}
          </div>
        </div>
        <div className="settings-category-select mt-3">
          <label htmlFor="settings-category" className="sr-only">{t('settings.navigation.category')}</label>
          <select id="settings-category" value={category} onChange={event => chooseCategory(event.target.value as SettingsCategoryId)} className="w-full rounded-lg border border-white/15 bg-surface-overlay px-3 py-2.5 text-sm">
            {settingsCategories.map(id => <option key={id} value={id}>{t(`settings.navigation.categories.${id}.title`)}</option>)}
          </select>
        </div>
      </header>
      <div className="settings-layout-grid min-h-0 flex-1">
        <nav className="settings-category-sidebar overflow-y-auto border-r border-white/10 bg-surface p-3" aria-label={t('settings.navigation.category')}>
          <div className="space-y-1">{settingsCategories.map(id => {
            const Icon = CATEGORY_ICONS[id];
            return <button key={id} type="button" aria-current={category === id ? 'page' : undefined} aria-controls={`settings-panel-${id}`} onClick={() => chooseCategory(id)}
              className={cn('relative isolate flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium', category === id ? 'border-blue-400/25 text-blue-200' : 'border-transparent text-white/65 hover:bg-white/5 hover:text-white')}>
              {category === id && <m.span layoutId="settings-active-category" className="pointer-events-none absolute inset-0 -z-10 rounded-xl bg-blue-500/15" transition={{ duration: motionEnabled ? uiMotion.duration.fast : 0, ease: uiMotion.ease }} />}
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words flex-1">{t(`settings.navigation.categories.${id}.title`)}</span>
              {id === 'updates' && (updaterStatus === 'available' || updaterStatus === 'downloaded') && (
                <span className="w-2 h-2 rounded-full bg-blue-400" aria-hidden="true" />
              )}
            </button>;
          })}</div>
        </nav>
        <div ref={contentRef} className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4">
          <div hidden={!normalizedQuery} className="mx-auto max-w-4xl space-y-3">
            <h3 className="text-lg font-semibold">{t('settings.navigation.resultsTitle')}</h3>
            {searchResults.map(item => <button key={item.id} type="button" onClick={() => openSearchResult(item)} className="flex w-full items-center gap-4 rounded-xl border border-white/10 bg-surface-raised p-4 text-left hover:border-blue-400/50 hover:bg-blue-500/5">
              <span className="min-w-0 flex-1"><span className="text-xs font-medium text-blue-300">{t(`settings.navigation.categories.${item.category}.title`)}</span>
                <span className="mt-1 block font-semibold">{t(item.titleKey)}</span><span className="mt-1 block text-sm leading-relaxed text-white/60">{t(item.descriptionKey)}</span>
              </span><ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
            </button>)}
            {!searchResults.length && <div className="rounded-xl border border-dashed border-white/15 p-6 text-center"><p className="text-sm text-white/65">{t('settings.navigation.noResults')}</p><button type="button" onClick={clearSearch} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">{t('settings.navigation.clearSearch')}</button></div>}
          </div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{normalizedQuery ? t('settings.navigation.resultCount', { count: searchResults.length }) : ''}</p>
          {settingsCategories.map(id => <section key={id} id={`settings-panel-${id}`} hidden={!!normalizedQuery || id !== category} aria-labelledby={`settings-title-${id}`} className="ui-fade-enter mx-auto max-w-4xl space-y-4">
            <div><h3 id={`settings-title-${id}`} className="text-lg font-bold">{t(`settings.navigation.categories.${id}.title`)}</h3>
              {id !== 'learning' && <p className="mt-1 text-sm leading-relaxed text-white/60">{t(`settings.navigation.categories.${id}.description`)}</p>}
            </div>
            {categoryContent[id]}
            {id === 'general' && !practice && <DesktopSettings />}
          </section>)}
        </div>
      </div>
    </div>
  );
}
