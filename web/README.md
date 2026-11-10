# Web app

`web/` runs the desktop application's renderer (`src/renderer`) unchanged in a normal browser. `bridge/` implements `window.electronAPI` with browser APIs instead of Electron IPC. The build is written to `site/app/`, and the Pages workflow builds it on every deploy (it is not committed).

It is a working app: you can present from it, and your work is saved in the browser.

## What works

| Desktop | Web |
|---|---|
| Projector windows, multiple outputs, stage display | `window.open` per output plus a `BroadcastChannel` per control session (`bridge/projector.ts`). Outputs get a full snapshot when they open or reload, then delta patches, the same as the desktop app. The ← → Space B Home End keys in the output control the presentation. The output window has focus when it opens, so the first key press there (usually → for the next slide), or one click, makes it fullscreen; browsers do not allow it without a gesture in that window. On a second screen the output enters fullscreen by itself where the Automatic Fullscreen policy allows the site (`policies/README.md`). When that fails on Windows Chrome/Edge, the control page offers once to download a `.reg` file with the policy for the current site. |
| Choosing the target display | The first Start Broadcast asks for the browser's "window management" permission (Chrome/Edge). Once it is granted, every extended display (projector, TV, or a virtual screen such as SpaceDesk) is listed, and the output opens on the second screen, filling it. If the prompt took longer than the click's activation window, the app asks you to click Start Broadcast again. If the permission is denied or unsupported, a single "Screen 1" opens a separate window that you drag to the projector and make fullscreen. |
| `.gpres` open/save | `bridge/gpres.ts` reads and writes the same ZIP layout as `src/main/gpresWriter.ts`, so files move both ways between the web and desktop apps. Uses the File System Access API where available; otherwise a download and a file input. |
| Media library (`local-resource://`) | Picked files are stored in IndexedDB under their SHA-256. The service worker (`sw.js`) serves them at `wpa-media/<sha256>.<ext>`, with Range support for video seeking. They survive reloads and also load in output windows. |
| Media storage housekeeping (desktop `userData/media` folder) | Shared with the desktop app: the warning, the dialogs and the Settings → Autosave → Storage card are in `src/renderer/mediaStorage.ts` and `src/renderer/components/StorageSettings.tsx`, and the unused-media rules are in `src/shared/mediaStorage.ts`. `bridge/storage.ts` supplies the browser side: IndexedDB records, references kept in IndexedDB, the browser quota, and a request for persistent storage on the first media save, so the browser does not evict it. The default limit is 2 GB, or 70% of the browser quota if that is smaller (desktop: 5 GB). Only media nothing refers to, and that was added more than 10 minutes ago, is ever removed, and only after the user agrees. |
| Media folder | `showDirectoryPicker` (Chrome/Edge, `bridge/folders.ts`). The folder handle is kept in IndexedDB, and scans import new or changed files; unchanged files are recognised by path, size and modification time. After a reload the browser may ask for access again: the last scan is shown until you rescan. Other browsers hide the folder option. |
| Saved presentations, autosave/recovery | Presets are kept in IndexedDB (`bridge/index.ts`), including the live-save retention rules. |
| Zefania XML Bibles, downloaded Bibles, hymn archives | File or folder input; the content is cached in IndexedDB. |
| Screen slides (`desktopCapturer`) | `getDisplayMedia` behind the renderer's `chromeMediaSource: 'desktop'` request (`bridge/screen.ts`). The capture is chosen once in the control page; output windows reuse it through `window.opener`. |
| Generated backgrounds and gradient library | The shared renderer (`src/shared/generatedBackground.ts`) runs in a Web Worker (`bridge/gradientWorker.ts`), with JPEG encoding through `OffscreenCanvas`. Contrast is measured on the encoded image, as on the desktop. Saved gradients go to the media store and the library to IndexedDB. |
| PowerPoint export | `src/shared/pptxExport.ts` is the deck builder shared with the desktop app (`src/main/pptxExportService.ts` only adds file-system reads and the file write). On the web, media comes from the media store and the deck is saved as a Blob. |
| Google Drive | Google Identity Services provides a browser access token, and `bridge/drive.ts` calls the Drive REST API: the same `drive.file` scope, app folder and `.gpres` files as the desktop app. Needs configuration, see below. |
| Offline use | The production build writes the full file list into `sw.js`, and the whole app is cached on first visit. Pages are network-first, so a new deploy shows up on the next online load; hashed assets are cache-first, and the previous version is kept for pages that are still open. The app is installable (`manifest.webmanifest`). The dev server serves `sw.js` with an empty list, so nothing is cached during development. |

These are still desktop-only and show a notice, or do nothing, on the web: PowerPoint import, live captions (Soniox), phone remote/share/screen mirror, music (YouTube) and updates. They need a server or the Electron main process.

## Google Drive setup

In Google Cloud, use the same project as the desktop app, so that `drive.file` gives both apps access to each other's files. Create an **OAuth client ID** of type **Web application**. Add the site's origin (for example `https://semiromest.github.io`, and `http://localhost:4176` for development) under **Authorized JavaScript origins**. Then build with the client ID:

```sh
VITE_GOOGLE_DRIVE_CLIENT_ID=1234-abc.apps.googleusercontent.com npx vite build --config web/vite.config.mts
```

A Web client ID is public by design; it needs no secret. Without it, the Drive button explains that Drive is not configured.

Only the hooks that talk to the main process are replaced (`runtime.ts`). `vite.config.mts` patches three spots that build `file://` URLs so that same-origin media URLs pass through, and the build fails if a patch no longer matches.

## Run and build

```sh
npx vite --config web/vite.config.mts                # dev: http://127.0.0.1:4176/
npx vite build --config web/vite.config.mts          # writes site/app/
npx tsc -p web/tsconfig.json                         # typecheck
npx vite preview --config web/vite.config.mts        # serve the build statically: http://127.0.0.1:4177/
```

Test offline behaviour with `vite preview`, not with the dev server for `site/`. A dev server rewrites module URLs, so they no longer match the precache list.

The service worker needs `https://` or `localhost`. Popups must be allowed for the site so that outputs can open.
