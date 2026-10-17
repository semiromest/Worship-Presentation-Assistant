<div align="center">

# Worship Presentation Assistant

**Free, open-source worship presentation software for churches and communities.**

A modern desktop app for displaying song lyrics, scriptures, media and announcements on a projector or screen — built with **Electron**, **React**, **TypeScript** and **Vite**.

![Platforms](https://img.shields.io/badge/installers-Windows%20%7C%20macOS-blue)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Download & Install](#download--install)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Auto-updates](#auto-updates)
- [Getting Started — Using the App](#getting-started--using-the-app)
  - [The Interface](#the-interface)
  - [Building a Presentation](#building-a-presentation)
  - [Slide Editor & Generated Backgrounds](#slide-editor--generated-backgrounds)
  - [Preparation Check](#preparation-check)
  - [Guided Practice](#guided-practice)
  - [Presenting Live](#presenting-live)
  - [Remote Control from Your Phone](#remote-control-from-your-phone)
  - [Live Captions & Translation](#live-captions--translation)
  - [Live Screen Sharing](#live-screen-sharing)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [File Formats & Data](#file-formats--data)
- [PowerPoint & Google Drive](#powerpoint--google-drive)
- [Supported Media](#supported-media)
- [Languages](#languages)
- [For Developers](#for-developers)
  - [Requirements](#requirements)
  - [Setup & Development](#setup--development)
  - [Tests](#tests)
  - [Building & Packaging](#building--packaging)
  - [Release Process (CI)](#release-process-ci)
  - [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Features

**Presentation tools**
- 🎚️ **Slide editor** — edit text and image elements on a canvas, manage layers, rotate and resize elements, and save changes back to the presentation. Slide selection and editing support undo/redo.
- 🌈 **Generated backgrounds** — create gradient backgrounds with palettes, soft/flow styles and darkness controls. Optional Flow, Aurora, Waves and Fog animations have speed and amount controls; apply a background to a slide, selection or hymn group.
- ✅ **Preparation check** — review missing or inaccessible media, unavailable fonts, measured text overflow, empty content, online resources and adjacent duplicate slides. Open the report from the toolbar or a slide badge; warnings do not block live output.
- 🧭 **Guided practice** — learn through ten sections in a separate practice profile, using sample content and real editing actions. Pause, resume or restart the guide without changing your normal presentation library; live output and sharing are disabled in practice.
- 🎬 **Transitions** — fade, slide (left/right/up/down), zoom, blur and flip, with durations from 150–800 ms.
- 📖 **Bible** — browse scriptures from an online Bible API or import your own **Zefania XML** Bibles, and send any passage to the presentation as a slide.
- 🎵 **Hymns** — import hymn lyric archives (folders of XML files), auto-split lyrics into parts and slides, and add them to your presentation.
- 🎶 **Music slides** — add YouTube music results to a presentation, control playback and volume, and dim the background. Seeking is available for sources that support it.
- 🖼️ **Media library** — a persistent library of images and videos; drop them onto slides, use them as backgrounds, or build **loop slides** that cycle automatically.
- ⏱️ **Countdown** — add countdown timer slides for breaks and transitions during the service.
- 🖥️ **Screen capture** — present a live view of any open window or screen (e.g. a live camera feed or another application).
- 🗓️ **Calendar** — plan services on a calendar and open the presentations saved for each date.
- 📱 **Remote control** — control the presentation from any phone on the same network via a QR code: next/previous, black screen and live previews.
- 🗣️ **Live captions & translation** — transcribe microphone audio in real time, optionally translate it into multiple target languages, and follow slides from spoken text.
- 📡 **Live sharing** — share the current live slide or live captions with phones through a QR code; optional Cloudflare Tunnel support enables access outside the local network.
- 🖤 **Live controls** — instant black screen (`B`), mute/unmute media (`M`), and a fullscreen projection window on your second display.
- 🖥️ **Multiple outputs** — configure each display independently as follow-live, manual, or stage/confidence-monitor output, with per-output blackout controls.
- 💧 **Watermark** — overlay your church logo on hymn and scripture slides (position, size and opacity are configurable).
- ⚙️ **Searchable settings** — find controls across General, Presentation, Hymns & Logo, Captions & Translation, Auto-save, Updates and Learning categories. Optional interface sound effects have their own preference.
- 💾 **Auto-save** — presentations are backed up with configurable retention (1 day / 7 days / 30 days / forever).
- 🔄 **Auto-updates** — the app checks GitHub Releases for new versions and updates itself in place.

**File & cloud support**
- 📄 Save/open presentations in the native **`.gpres`** format, a ZIP archive containing the presentation and embedded local media.
- 📊 Import **PowerPoint** (`.pptx` / `.pptm`) and export `.pptx`.
- ☁️ Optional **Google Drive** integration for storing and sharing presentations.

---

## Screenshots

<img width="1708" height="920" alt="Worship Presentation Assistant main interface" src="https://github.com/user-attachments/assets/3807e575-38c6-4a47-baf6-89b81239591f" />

---

## Download & Install

Prebuilt installers for Windows and macOS are published on the **[GitHub Releases page](https://github.com/semiromest/Worship-Presentation-Assistant/releases)**. Releases are tagged `vX.Y.Z`. Linux installers are not currently produced by the release workflow.

> 💡 **Tip:** the app can also update itself. Once installed, check **Settings → Updates** to download the latest version from within the app — no need to re-download from GitHub.

### Windows

| File | What it is |
|------|------------|
| `Worship-Presentation-Assistant-<version>-Windows-Setup.exe` | **Installer (recommended)** |

1. Go to the [Releases page](https://github.com/semiromest/Worship-Presentation-Assistant/releases) and download the `...-Windows-Setup.exe` file from the **latest** release.
2. Run the downloaded `.exe` and follow the setup wizard — you can choose the installation folder.
3. Launch **Worship Presentation Assistant** from the Start Menu or the desktop shortcut.

*Note: the installer is unsigned, so SmartScreen may show a warning — click **More info → Run anyway**.*

### macOS

| File | What it is |
|------|------------|
| `Worship-Presentation-Assistant-<version>-<arch>-mac.dmg` | Drag-and-drop installer |
| `Worship-Presentation-Assistant-<version>-<arch>-mac.zip` | Portable version |

Choose the file matching your chip: **x64** for Intel Macs, **arm64** for Apple Silicon (M1/M2/M3+).

1. Download the `.dmg` file from the latest release.
2. Open it and drag the app into your **Applications** folder.
3. The first time you launch it, macOS may warn that the app is from an unidentified developer: right-click the app → **Open** → **Open** again, or go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Linux

Linux packaging is not currently produced by the release workflow. The application source includes Linux-related support, but published installers are currently limited to Windows and macOS.

### Auto-updates

The app ships with `electron-updater` wired to the GitHub Releases feed. **Settings → Updates** shows the current version, checks for new releases and downloads them — the update is applied the next time the app restarts.

---

## Getting Started — Using the App

### The Interface

The sidebar contains ten pages. Press `?` outside a text field to open the shortcut cheatsheet. Use `Alt+1…9` for the original pages and `Alt+0` for the slide editor:

| Tab | Shortcut | What it does |
|-----|----------|--------------|
| **Presentations** | `Alt+1` | Save/open `.gpres` files, import PowerPoint, manage saved presentations and auto-saves |
| **Slides** | `Alt+2` | The main slide list — add, edit, reorder and style slides; right panel for styles & transitions |
| **Bible** | `Alt+3` | Browse scriptures and add them as slides |
| **Media** | `Alt+4` | Image/video library, media backgrounds and loop slides |
| **Hymns** | `Alt+5` | Import hymn lyrics, split into parts and add as slides |
| **Countdown** | `Alt+6` | Create countdown timer slides |
| **Screen** | `Alt+7` | Select a window or screen to broadcast live |
| **Calendar** | `Alt+8` | Open saved presentations from a service calendar |
| **Editor** | `Alt+0` | Edit slide elements, layers, geometry and styles on the canvas |
| **Settings** | `Alt+9` | Search settings, change language and preferences, or open guided practice |

### Building a Presentation

1. **Slides tab** — add and select slides, then use the right panel for text styles, backgrounds, media filters and transitions. Open the **Editor** page (`Alt+0`) for canvas editing. Double-clicking a slide sends it live.
2. **Add content from the other tabs** — pick a scripture in the **Bible** tab, a hymn in **Hymns**, an image or video in **Media**, a timer in **Countdown**, or a screen source in **Screen**, then send it to the presentation.
3. **Organize** — drag slides to reorder, use `Ctrl+D` to duplicate, `Delete` to remove, and `Alt+↑`/`Alt+↓` to move slides. `Shift+click` multi-selects, and `Alt+Enter` splits a slide into parts (great for verse-by-verse hymn display).
4. **Save** — in the **Presentations** tab, save as a `.gpres` file (local media is embedded automatically), or keep it in the built-in library to reopen it later from the **Calendar** tab.

### Slide Editor & Generated Backgrounds

Select a slide and open **Editor**. Supported slide types expose canvas elements and layers; editing controls let you move, resize, rotate and style those elements. Use **Save** to commit editor changes to the presentation. The editor has its own selection and keyboard behavior while it is active.

Open the gradient generator from the background controls. Choose a palette, style and darkness, or regenerate a different arrangement. Enable motion and choose Flow, Aurora, Waves or Fog, then adjust speed and amount. The preview uses the current slide so you can judge text contrast before applying the result to a slide, selection or hymn group. The background recipe retains its motion settings; a static image is also saved for export.

### Preparation Check

The toolbar summarizes preparation issues, and affected slides show badges. Open either to inspect the report, jump to a slide or retry a failed resource check. Text overflow is measured against the space available to the text; a text box touching the slide edge does not produce a safe-margin warning.

Resource and font checks can take time. The report refreshes after relevant content changes, but it does not prevent you from presenting. Review any warnings that matter to your service, especially media availability and online resources.

### Guided Practice

Open **Settings → Learning** or use the practice entry in the `?` shortcut cheatsheet. Practice starts in a separate window and profile with its own sample presentation.

The guide covers Presentations, Slides, Bible, Media, Hymns, Countdown, Screen, Calendar, Editor and Settings. It combines short explanations with real actions such as adding, reordering and deleting slides, importing sample content and saving an editor change. Result screens show the completed work before you continue.

You can change the guide language, pause and resume, or jump to a section while paused. Restarting archives the previous run and starts fresh. Practice cannot open live projection, start captions or sharing, or modify the normal profile's presentation library.

### Presenting Live

1. **Go live** — select a slide and press `Enter` (or double-click it). A fullscreen **projection window** opens — on a multi-monitor setup it appears on the second display (perfect for a projector or stage screen).
2. **Navigate** — `→` / `Space` / `J` / `PageDown` for next, `←` / `K` / `PageUp` for previous, `Home`/`End` to jump to the first/last slide. These work even when the projection window has focus.
3. **During the service** — press `B` for an instant black screen, `M` to mute/unmute media, and `Esc` to close the projection.
4. **Transitions** — set per-slide transitions (fade, slide, zoom, blur, flip) and durations from the right panel; they render live in the projection window.

### Remote Control from Your Phone

Turn your phone into a wireless presentation remote:

1. Make sure the phone is on the **same Wi-Fi network** as the computer running the app.
2. Open the remote control panel (the smartphone icon in the toolbar).
3. Scan the **QR code** — or type the displayed URL (e.g. `http://192.168.1.20:45123/remote`) into the phone's browser.
4. The phone shows a live preview of the current slide and lets you go **next/previous**, jump to any slide, and toggle the black screen.

> The connection is local (HTTP/WebSocket on your LAN only) — no account or internet connection is required.

### Live Captions & Translation

The live captions console uses Soniox to transcribe microphone audio and can translate it into one or more target languages. It can also track the current slide from the spoken words.

1. Add a Soniox API key in **Settings → Live captions**. The key is stored locally in the app's user-data directory and is not displayed after saving.
2. Open the live captions console, choose the microphone and spoken language, then enable translation and select target languages if needed.
3. Start the session and send the captions to a presentation slide. Captions can also be shared with phones using the QR code in the sharing panel.

An internet connection, microphone permission and a valid Soniox API key are required. Soniox usage may be subject to its own account limits and pricing.

### Live Screen Sharing

The live sharing panel publishes the slide currently shown on the projection output as a read-only phone view. Scan its QR code or open the displayed URL in a browser on the same network. The panel shows connected clients and can add a QR-code slide to the presentation.

By default, sharing is available only on the local network. Public sharing can optionally use Cloudflare Tunnel. Packaged builds need the platform-appropriate `cloudflared` binary in `resources/cloudflared`; download it only from the [official Cloudflare releases](https://github.com/cloudflare/cloudflared/releases) and verify its checksum. Public tunnels expose the local sharing endpoint to the internet, so enable them only when needed.

### Keyboard Shortcuts

| Keys | Action |
|------|--------|
| `→` / `Space` / `J` / `PageDown` | Next slide |
| `←` / `K` / `PageUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `Enter` | Send the selected slide live |
| `?` | Toggle shortcut cheatsheet |
| `Alt+1…9` | Switch pages (`Alt+9` opens Settings) |
| `Alt+0` | Open the slide editor |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Delete` / `Ctrl+D` | Delete / duplicate slide |
| `Alt+Enter` | Split slide into parts |
| `Shift+Click` | Multi-select slides |
| `Alt+↑` / `Alt+↓` | Move slide up / down |
| `M` | Mute / unmute media |
| `B` | Toggle black screen |
| `Esc` | Close the projection |

Text fields, dialogs and the editor handle their own keys. During guided practice, actions are limited to the current exercise and guide controls.

---

## File Formats & Data

- **`.gpres`** — the native format. A ZIP archive containing the presentation JSON and embedded local images and videos. Online resources such as YouTube still require connectivity. Legacy plain-JSON presentations are opened automatically.
- **`.pptx` / `.pptm`** — import PowerPoint presentations; export the current presentation as `.pptx`. App-specific live features, such as animated gradients, do not become equivalent PowerPoint animations.
- **Data locations** — saved presentations live in the app's user-data folder; the media library is stored under `userData/media/` and downloaded/imported Bibles under `userData/bibles/`.
- **Media storage** — imported media is stored using content-addressed files and referenced from presentations, which avoids duplicating the same bytes in undo history and autosaves.

---

## PowerPoint & Google Drive

- **Import**: in the **Presentations** tab choose *Import PowerPoint* and pick a `.pptx`/`.pptm` file. Slides are converted and added to the presentation with a progress indicator.
- **Export**: in the **Presentations** tab choose *Export PowerPoint* to save the current presentation as a `.pptx` you can open in PowerPoint, Keynote or Google Slides.
- **Google Drive** (optional): sign in from the **Presentations** tab to list, open, save and delete `.gpres` files in your Drive. Sign-in uses OAuth with your Google account; nothing is uploaded without your action.

---

## Supported Media

| Type | Formats |
|------|---------|
| Images | JPG, PNG, GIF, WebP, BMP, TIFF, AVIF, SVG |
| Videos | MP4, WebM, MOV, MKV, AVI, M4V, WMV, FLV, MPEG |
| Audio | MP3, WAV, OGG, FLAC, AAC, M4A, WMA |

---

## Languages

The interface supports five languages, selectable in **Settings → General → Language**. Guided practice also has its own language selector:

- 🇹🇷 Türkçe (Turkish)
- 🇬🇧 English
- 🇪🇸 Español (Spanish)
- 🇩🇪 Deutsch (German)
- 🇰🇷 한국어 (Korean)

---

## For Developers

### Requirements

- [Node.js](https://nodejs.org/) **22** to match the CI environment
- npm (ships with Node.js)
- Git and Git LFS for the repository's tracked large assets
- Windows or macOS for the configured installer targets

### Setup & Development

```bash
# 1. From the repository root, fetch large assets and install locked dependencies
git lfs install
git lfs pull
npm ci

# 2. Create the local Drive credentials module described below

# 3. Start the development server and Electron with hot reload
npm run dev

# 4. Code quality
npm run lint     # ESLint
npm run format   # Prettier

# 5. Optional preview of an existing production renderer build
npm run preview
```

Create the git-ignored `src/main/driveCredentials.ts` before starting or building the app. This module is imported by the main process, so it must exist even when you do not use Drive. Empty credentials allow development without configuring Google OAuth:

```ts
export const DRIVE_CREDENTIALS = {
  clientId: '',
  clientSecret: '',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  redirectPort: 0,
};
```

Use your Google OAuth credentials to enable Drive sign-in. Keep this local file out of commits. `npm run preview` serves the renderer only; Electron IPC features require the desktop app.

### Tests

```bash
npm run test:sections   # service sections and slide grouping
npm run test:updater    # updater reducer
npm run test:presets    # preset store
npm run test:media      # media library
npm run test:matcher    # speech-to-slide matcher
npm run test:stt        # live captions state
npm run test:readiness  # preparation checks and resource reporting
npm run test:editor     # editor drafts, geometry, selection and commits
npm run test:gradients  # generated backgrounds and gradient media
npm run test:sfx        # interface sound behavior
npm run test:zoom       # slide grid zoom behavior
npm run test:tour       # guide, practice, persistence and isolation unit checks
npm run test:architecture # IPC, preview updates, canvas layout and store contracts

npx tsc --noEmit --incremental false
npx vite build         # build Electron entry points before source E2E/worker checks
npm run smoke:worker
npm run test:tour:e2e   # all configured source Electron E2E groups
```

There is no combined `npm test` script. Source E2E uses isolated profiles and starts its own renderer server. Packaged E2E requires a built Windows unpacked app:

```bash
npx electron-builder --win --dir --publish never
npm run test:tour:packaged
```

By default, packaged tests find the executable under `release/<version>/win-unpacked`. Set `WPA_PACKAGED_EXE` to use a different executable path.

Fallow analysis is available without applying fixes:

```bash
npm run analyze:fallow
npm run analyze:source
```

These scripts pin Fallow 3.33.1. Findings can produce exit code 1; inspect the JSON report rather than treating every finding as permission to delete code. The source configuration checks main/preload/renderer/shared boundaries and avoids relying only on Electron's automatic entry-point discovery.

### Building & Packaging

```bash
npm run build
```

This runs, in order:

1. **TypeScript check** — `tsc --noEmit`
2. **Bundle** — `vite build` (renderer to `dist/`, main + preload to `dist-electron/`; stale output is cleaned first so no old bundles leak into the package)
3. **Package** — `electron-builder` produces installers in `release/<version>/`

To bundle without making installers, use `npx vite build`. To package a local unpacked app after bundling, use `npx electron-builder --dir --publish never`.

The packaging config includes the five shipped locales (EN, TR, ES, DE, KO) and uses normal compression. Local packaging also expects the platform-appropriate `cloudflared` binary under `resources/cloudflared` for public sharing. See [the binary placement instructions](resources/cloudflared/README.md).

### Release Process (CI)

Pushing a tag named `v*` triggers the [GitHub Actions workflow](.github/workflows/release.yml), which:

1. Runs the reusable [tour checks workflow](.github/workflows/tour.yml), subject to the release workflow's configured skip conditions.
2. Generates the Drive credentials from repository secrets (`DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`).
3. Builds Windows and macOS using Node 22. The platform matrix currently runs one build at a time.
4. Runs `vite build` and `electron-builder --publish never`, then uploads build artifacts. Packaged Windows practice smoke tests run in advisory mode.
5. A separate release job attaches installers and updater files to the **GitHub Release**.

The attached artifacts are: the Windows NSIS installer (`.exe`), macOS DMG and ZIP (x64 + arm64), and the update feeds (`.yml` + `.blockmap`) used by the in-app auto-updater.

### Project Structure

```
src/
├── main/               # Electron main process
│   ├── main.ts         # Windows, projector, remote server, IPC, file I/O
│   ├── preload.ts      # Context-isolated bridge (window.electronAPI)
│   ├── presetStore.ts  # Saved presentations (userData/presets)
│   ├── mediaLibrary.ts # Persistent media library (userData/media)
│   ├── driveService.ts # Google Drive OAuth + file sync
│   ├── sonioxService.ts # Live captions and translation
│   ├── shareService.ts # Local phone sharing and QR sessions
│   ├── screenShareService.ts # Live slide streaming
│   ├── cloudflareTunnelService.ts # Optional public sharing tunnel
│   ├── updater.ts      # Auto-update (electron-updater)
│   ├── pptxExportService.ts # PowerPoint export (import work runs in heavyWorker)
│   ├── practiceWorkspace.ts # Isolated guide state, exercise results and recovery
│   └── utility/        # heavyWorker and gradientWorker processes
├── renderer/           # React UI
│   ├── App.tsx         # Shell, tabs, live/projector mode
│   ├── <Tab>*.tsx      # Presentations, Slides, Bible, Media, Hymns,
│   │                   # Countdown, Screen, Calendar…
│   ├── components/     # Toolbar, panels, dialogs, modals
│   ├── editor/         # Canvas, slide drafts, selection and editing history
│   ├── hooks/          # Keyboard nav, projector sync, live save…
│   ├── state/          # Zustand stores and presentation/preferences/media/UI slices
│   └── locales/        # i18n translations (tr, en, es, de, ko)
└── shared/             # Presentation models, Electron API types, practice and layout

tests/tour/             # Source and packaged Electron E2E tests
docs/                   # Feature notes and validation records
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 43 |
| UI | React 18, Tailwind CSS 3, lucide-react |
| Language | TypeScript |
| Build | Vite 5, vite-plugin-electron |
| State | Zustand |
| i18n | i18next + react-i18next |
| Packaging | electron-builder, electron-updater |
| Networking | ws (WebSocket remote control) |
| Office | pptxgenjs (PowerPoint export) |
| Backend | Node.js HTTP + WebSocket server (phone remote) |

---

## License

[MIT](LICENSE) © IPCA

Made with ❤️ for worship teams everywhere.
