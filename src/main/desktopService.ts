import { showAppDialog } from './appDialogs';
import { app, ipcMain, globalShortcut, Menu, nativeTheme, nativeImage, Notification, shell, type BrowserWindow, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DESKTOP, GLOBAL_SHORTCUTS, normalizeDesktopPreferences, safePathLabel, type DesktopPreferences, type DesktopStatus, type DesktopCommand } from '../shared/desktop';
import { nativeDialogBusy } from './nativeDialogGate';
import { replacementDialogCopy, systemMessageCopy } from './desktopDialogCopy';

const COMMANDS: readonly DesktopCommand[] = ['previous', 'next', 'blackout'];
const AUTO_SPELLCHECK: Readonly<Record<string, string>> = { tr: 'tr', en: 'en-US', de: 'de', es: 'es', ko: 'ko' };
const MAX_OUTPUTS = 20;
const MAX_PENDING = 20;
const MAX_PREPARED = 20;
const pathKey = (file: string) => (process.platform === 'linux' ? file : file.toLowerCase());

export function createDesktopService(getWindow: () => BrowserWindow | null, restricted: boolean, hasOutputs: () => boolean) {
  let preferences: DesktopPreferences = structuredClone(DEFAULT_DESKTOP);
  let registered: DesktopStatus['registered'] = { previous: false, next: false, blackout: false };
  let registeredAccelerators: string[] = [];
  let blocked = true, rendererReady = false, disposed = false, documentPath: string | null = null;
  let language = 'en';
  const pending = new Map<string, string>();
  const outputs = new Set<string>();
  const knownDocuments = new Set<string>();
  const prepared = new Map<string, { file: string; requestId?: string }>();
  const services: DesktopStatus['services'] = { drive: { state: 'unknown' }, music: { state: 'unknown' }, captions: { state: 'unknown' } };
  const tasks = new Map<string, number>();
  const recordRecents = !restricted && !process.argv.includes('--wpa-smoke');
  let settingsWrites: Promise<void> = Promise.resolve();
  const settingsFile = path.join(app.getPath('userData'), 'desktop-settings.json');
  const channels: string[] = [];

  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    channels.push(channel);
    ipcMain.handle(channel, listener);
  };

  const liveWindow = (): BrowserWindow | null => {
    const window = getWindow();
    return window && !window.isDestroyed() && !window.webContents.isDestroyed() ? window : null;
  };
  let cachedIcon: NativeImage | undefined;
  const appIcon = () => (cachedIcon ??= nativeImage.createFromPath(path.join(__dirname, '../build/ico.png')));

  const check = (event: IpcMainInvokeEvent) => {
    const window = liveWindow();
    if (restricted || !window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unauthorized desktop request');
    }
    return window;
  };

  const status = (): DesktopStatus => ({
    preferences,
    registered,
    services,
    outputs: [...outputs].reverse().map(file => ({ path: file, label: safePathLabel(path.basename(file)) })),
  });

  const send = (channel: string, value: unknown) => {
    liveWindow()?.webContents.send(channel, value);
  };

  let publishQueued = false;
  const publish = () => {
    if (publishQueued || disposed) return;
    publishQueued = true;
    queueMicrotask(() => {
      publishQueued = false;
      send('desktop:status', status());
    });
  };

  const completedOutput = (file: string) => {
    outputs.delete(file);
    outputs.add(file);
    if (outputs.size > MAX_OUTPUTS) outputs.delete(outputs.values().next().value!);
    publish();
  };

  const command = (value: DesktopCommand) => {
    const window = liveWindow();
    if (!window || blocked || nativeDialogBusy() || pending.size || !hasOutputs() || window.webContents.isLoading()) return;
    window.webContents.send('desktop:command', value);
  };

  const applySpellcheckLanguage = () => {
    const window = liveWindow();
    if (!window || process.platform === 'darwin') return;
    const selected = preferences.spellcheckLanguage === 'auto'
      ? AUTO_SPELLCHECK[language.split('-')[0]]
      : preferences.spellcheckLanguage;
    if (selected && window.webContents.session.availableSpellCheckerLanguages.includes(selected)) {
      window.webContents.session.setSpellCheckerLanguages([selected]);
    }
  };

  const applySpellcheck = () => {
    liveWindow()?.webContents.session.setSpellCheckerEnabled(preferences.spellcheck);
    applySpellcheckLanguage();
  };

  const unregisterShortcuts = () => {
    for (const accelerator of registeredAccelerators) globalShortcut.unregister(accelerator);
    registeredAccelerators = [];
  };

  const applyShortcuts = () => {
    unregisterShortcuts();
    const result: DesktopStatus['registered'] = { previous: false, next: false, blackout: false };
    if (!restricted && preferences.shortcutsEnabled) {
      for (const name of COMMANDS) {
        const accelerator = preferences.shortcuts[name];
        try {
          if (globalShortcut.register(accelerator, () => command(name))) {
            result[name] = true;
            registeredAccelerators.push(accelerator);
          }
        } catch {
          // shown as unregistered
        }
      }
    }
    registered = result;
  };

  const shortcutsDiffer = (a: DesktopPreferences, b: DesktopPreferences) =>
    a.shortcutsEnabled !== b.shortcutsEnabled || COMMANDS.some(name => a.shortcuts[name] !== b.shortcuts[name]);

  const needsShortcutRegistration = (previous: DesktopPreferences) =>
    shortcutsDiffer(previous, preferences) || (preferences.shortcutsEnabled && COMMANDS.some(name => !registered[name]));

  const apply = () => {
    applyShortcuts();
    applySpellcheck();
    publish();
  };

  function normalize(input: unknown): DesktopPreferences {
    if (!input || typeof input !== 'object') throw new Error('Invalid desktop preferences');
    const p = input as DesktopPreferences;
    const shortcuts = p.shortcuts;
    if (
      typeof p.shortcutsEnabled !== 'boolean' ||
      typeof p.spellcheck !== 'boolean' ||
      typeof p.notifications !== 'boolean' ||
      !shortcuts ||
      typeof shortcuts !== 'object' ||
      !COMMANDS.every(name => typeof shortcuts[name] === 'string') ||
      new Set(COMMANDS.map(name => shortcuts[name].toLowerCase())).size !== COMMANDS.length
    ) {
      throw new Error('Invalid shortcut settings');
    }
    const next = normalizeDesktopPreferences({ ...DEFAULT_DESKTOP, ...p, shortcuts: { ...DEFAULT_DESKTOP.shortcuts, ...shortcuts } });
    return next;
  }

  async function writeSettings(value: DesktopPreferences) {
    const temp = `${settingsFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx' });
      await fs.rename(temp, settingsFile);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  const emitPending = () => {
    if (rendererReady) {
      send('desktop:open-requests', [...pending].map(([id, file]) => ({ id, label: safePathLabel(file) })));
    }
  };

  const enqueue = (file: unknown) => {
    if (restricted || typeof file !== 'string' || !/\.gpres$/i.test(file) || !path.isAbsolute(file) || file.includes('\0') || pending.size >= MAX_PENDING) {
      return;
    }
    const resolved = path.resolve(file);
    const key = pathKey(resolved);
    if ([...pending.values()].every(existing => pathKey(existing) !== key)) {
      pending.set(randomUUID(), resolved);
    }
    if (!hasOutputs()) {
      const window = liveWindow();
      if (window?.isMinimized()) window.restore();
      window?.show();
      window?.focus();
    }
    emitPending();
  };

  handle('desktop:ready', event => {
    check(event);
    rendererReady = true;
    emitPending();
    return status();
  });

  handle('desktop:settings', async (event, input: unknown) => {
    check(event);
    const next = normalize(input);
    const write = settingsWrites.catch(() => {}).then(async () => {
      await writeSettings(next);
      const previous = preferences;
      preferences = next;
      if (needsShortcutRegistration(previous)) applyShortcuts();
      applySpellcheck();
      publish();
    });
    settingsWrites = write;
    await write;
    return status();
  });

  handle('desktop:block', (event, value: unknown) => {
    check(event);
    if (typeof value !== 'boolean') throw new Error('Invalid command gate');
    blocked = value;
  });

  handle('desktop:reject-open', (event, id: unknown) => {
    check(event);
    if (typeof id === 'string') pending.delete(id);
    emitPending();
  });

  handle('desktop:document', (event, input: { dirty: boolean; path: string | null }) => {
    const window = check(event);
    if (typeof input?.dirty !== 'boolean') throw new Error('Invalid document state');
    if (input.path !== null && (typeof input.path !== 'string' || !knownDocuments.has(input.path))) {
      throw new Error('Unknown document');
    }
    documentPath = input.path;
    if (process.platform === 'darwin') {
      window.setRepresentedFilename(documentPath ?? '');
      window.setDocumentEdited(input.dirty);
    }
  });

  handle('desktop:commit-open', (event, token: unknown) => {
    check(event);
    if (typeof token !== 'string' || !prepared.has(token)) throw new Error('Unknown prepared document');
    const value = prepared.get(token)!;
    prepared.delete(token);
    knownDocuments.add(value.file);
    if (value.requestId) pending.delete(value.requestId);
    if (recordRecents) app.addRecentDocument(value.file);
    emitPending();
  });

  handle('desktop:replace-choice', async event => {
    const window = check(event);
    const copy = replacementDialogCopy(language);
    const result = await showAppDialog(window, {
      title: copy.title,
      message: copy.message,
      choices: [
        { value: 'cancel', label: copy.cancel },
        { value: 'discard', label: copy.discard, tone: 'danger' },
        { value: 'save', label: copy.save, tone: 'primary' },
      ],
    });
    return result === 'save' || result === 'discard' ? result : 'cancel';
  });

  handle('desktop:drag-output', (event, file: unknown) => {
    const window = check(event);
    if (typeof file !== 'string' || (!outputs.has(file) && file !== documentPath)) throw new Error('Unknown output');
    window.webContents.startDrag({ file, icon: appIcon() });
  });

  handle('desktop:language', (event, input: unknown) => {
    check(event);
    if (typeof input !== 'string' || input.length > 12) throw new Error('Invalid language');
    language = input;
    applySpellcheckLanguage();
  });

  handle('desktop:default-apps', async event => {
    check(event);
    if (process.platform !== 'win32') return false;
    try {
      await shell.openExternal('ms-settings:defaultapps');
      return true;
    } catch {
      return false;
    }
  });

  return {
    getLanguage: () => language,
    enqueue,
    take(id: string) {
      const file = pending.get(id);
      if (!file) throw new Error('Unknown open request');
      return file;
    },
    complete(id: string) {
      pending.delete(id);
      emitPending();
    },
    saved(file: string) {
      knownDocuments.add(file);
      completedOutput(file);
      if (recordRecents) app.addRecentDocument(file);
    },
    output: completedOutput,
    prepare(file: string, requestId?: string) {
      const token = randomUUID();
      if (prepared.size >= MAX_PREPARED) prepared.delete(prepared.keys().next().value!);
      prepared.set(token, { file, requestId });
      return token;
    },
    windowCreated(window: BrowserWindow) {
      blocked = true;
      rendererReady = false;
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          rendererReady = false;
          blocked = true;
        }
      });
      window.webContents.on('context-menu', (_event, params) => {
        if (!params.isEditable || restricted) return;
        const word = params.misspelledWord;
        const suggestions = [
          ...params.dictionarySuggestions.slice(0, 6).map(suggestion => ({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          })),
          ...(word ? [{ label: systemMessageCopy(language).addToDictionary, click: () => window.webContents.session.addWordToSpellCheckerDictionary(word) }] : []),
        ];
        Menu.buildFromTemplate([
          ...suggestions,
          ...(suggestions.length ? [{ type: 'separator' as const }] : []),
          { role: 'cut' as const },
          { role: 'copy' as const },
          { role: 'paste' as const },
          { role: 'selectAll' as const },
        ]).popup({ window });
      });
      window.webContents.once('did-finish-load', () => {
        applySpellcheck();
        publish();
      });
      if (process.platform === 'win32' && !restricted) {
        window.setThumbarButtons(COMMANDS.map(name => ({ tooltip: name, icon: appIcon(), click: () => command(name) })));
      }
    },
    async init() {
      nativeTheme.themeSource = 'dark';
      try {
        const stored = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Invalid preferences');
        const merged = { ...DEFAULT_DESKTOP, ...stored, shortcuts: { ...DEFAULT_DESKTOP.shortcuts, ...((stored as Record<string, unknown>).shortcuts ?? {}) } };
        preferences = normalizeDesktopPreferences(merged);
        if (JSON.stringify(stored) !== JSON.stringify(preferences)) await writeSettings(preferences);
      } catch {
        // defaults
      }
      apply();
    },
    progress(id: string, fraction: number | null, successful = false) {
      if (fraction === null) tasks.delete(id);
      else tasks.set(id, fraction);

      const window = liveWindow();
      let last = -1;
      for (const value of tasks.values()) last = value;
      window?.setProgressBar(last);

      if (fraction === null && successful && preferences.notifications && !hasOutputs() && !window?.isFocused() && Notification.isSupported()) {
        new Notification({ title: app.getName(), body: systemMessageCopy(language).operationCompleted }).show();
      }
    },
    service(name: string, ok: boolean, offline = false) {
      const previous = services[name];
      const state = ok ? ('working' as const) : offline ? ('offline' as const) : ('error' as const);
      services[name] = { ...previous, state, ...(ok ? { lastSuccess: Date.now() } : {}) };
      if (ok || previous?.state !== state) publish();
    },
    dispose() {
      disposed = true;
      unregisterShortcuts();
      for (const channel of channels) ipcMain.removeHandler(channel);
    },
  };
}
