<div align="center">

# Worship Presentation Assistant

**Free, open-source worship presentation software for churches and communities.**

A modern desktop app for displaying song lyrics, scriptures, media and announcements on a projector or screen — built with **Electron**, **React**, **TypeScript** and **Vite**.

![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
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
  - [Presenting Live](#presenting-live)
  - [Remote Control from Your Phone](#remote-control-from-your-phone)
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
- 🎚️ **Slide editor** — create text slides, style them with fonts, colors, backgrounds, images and videos, and reorder/duplicate/delete slides with full undo/redo (`Ctrl+Z` / `Ctrl+Y`).
- 🎬 **Transitions** — fade, slide (left/right/up/down), zoom, blur and flip, with durations from 150–800 ms.
- 📖 **Bible** — browse scriptures from an online Bible API or import your own **Zefania XML** Bibles, and send any passage to the presentation as a slide.
- 🎵 **Hymns** — import hymn lyric archives (folders of XML files), auto-split lyrics into parts and slides, and add them to your presentation.
- 🖼️ **Media library** — a persistent library of images and videos; drop them onto slides, use them as backgrounds, or build **loop slides** that cycle automatically.
- ⏱️ **Countdown** — add countdown timer slides for breaks and transitions during the service.
- 🖥️ **Screen capture** — present a live view of any open window or screen (e.g. a live camera feed or another application).
- 🗓️ **Calendar** — plan services on a calendar and open the presentations saved for each date.
- 📱 **Remote control** — control the presentation from any phone on the same network via a QR code: next/previous, black screen and live previews.
- 🖤 **Live controls** — instant black screen (`B`), mute/unmute media (`M`), and a fullscreen projection window on your second display.
- 💧 **Watermark** — overlay your church logo on hymn and scripture slides (position, size and opacity are configurable).
- 💾 **Auto-save** — presentations are continuously backed up with configurable retention (1 day / 7 days / 30 days / forever) so you never lose work.
- 🔄 **Auto-updates** — the app checks GitHub Releases for new versions and updates itself in place.

**File & cloud support**
- 📄 Save/open presentations in the native **`.gpres`** format (a ZIP that embeds all media, so one file contains everything).
- 📊 Import and export **PowerPoint** (`.pptx` / `.pptm`).
- ☁️ Optional **Google Drive** integration for storing and sharing presentations.

---

## Screenshots

<img width="1708" height="920" alt="Worship Presentation Assistant main interface" src="https://github.com/user-attachments/assets/3807e575-38c6-4a47-baf6-89b81239591f" />

---

## Download & Install

Prebuilt installers for all platforms are published on the **[GitHub Releases page](https://github.com/semiromest/Worship-Presentation-Assistant/releases)**. Every release is tagged `vX.Y.Z` and includes installers built automatically for Windows, macOS and Linux.

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

| File | What it is |
|------|------------|
| `Worship-Presentation-Assistant-<version>-Linux.AppImage` | Portable AppImage (x64) |

1. Download the `.AppImage` file from the latest release.
2. Make it executable and run it:

   ```bash
   chmod +x Worship-Presentation-Assistant-*.AppImage
   ./Worship-Presentation-Assistant-*.AppImage
   ```

3. To integrate it with your desktop launcher, install a tool like [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or extract it with `./Worship-Presentation-Assistant-*.AppImage --appimage-extract`.

### Auto-updates

The app ships with `electron-updater` wired to the GitHub Releases feed. **Settings → Updates** shows the current version, checks for new releases and downloads them — the update is applied the next time the app restarts.

---

## Getting Started — Using the App

### The Interface

The app has a dark, modern interface with a sidebar on the left. Press `?` at any time to open the built-in shortcut cheatsheet, and `Alt+1…9` to switch between the nine tabs:

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
| **Settings** | `Alt+9` | Language, auto-save retention, updates and more |

### Building a Presentation

1. **Slides tab** — start typing. Each slide is edited in the slide grid; double-click a slide to open the full editor, or use the right panel for text styles (font size, color, alignment, background image/video, brightness/contrast/blur filters) and transitions.
2. **Add content from the other tabs** — pick a scripture in the **Bible** tab, a hymn in **Hymns**, an image or video in **Media**, a timer in **Countdown**, or a screen source in **Screen**, then send it to the presentation.
3. **Organize** — drag slides to reorder, use `Ctrl+D` to duplicate, `Delete` to remove, and `Alt+↑`/`Alt+↓` to move slides. `Shift+click` multi-selects, and `Alt+Enter` splits a slide into parts (great for verse-by-verse hymn display).
4. **Save** — in the **Presentations** tab, save as a `.gpres` file (media is embedded automatically), or keep it in the built-in library to reopen it later from the **Calendar** tab.

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

### Keyboard Shortcuts

| Keys | Action |
|------|--------|
| `→` / `Space` / `J` / `PageDown` | Next slide |
| `←` / `K` / `PageUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `Enter` | Send the selected slide live |
| `?` | Toggle shortcut cheatsheet |
| `Alt+1…9` | Switch tabs |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Delete` / `Ctrl+D` | Delete / duplicate slide |
| `Alt+Enter` | Split slide into parts |
| `Shift+Click` | Multi-select slides |
| `Alt+↑` / `Alt+↓` | Move slide up / down |
| `M` | Mute / unmute media |
| `B` | Toggle black screen |
| `Esc` | Close the projection |

---

## File Formats & Data

- **`.gpres`** — the native format. A ZIP archive that contains the presentation JSON **plus all embedded images and videos**, so a single file is fully portable and shares cleanly. Legacy plain-JSON presentations are still opened automatically.
- **`.pptx` / `.pptm`** — PowerPoint files can be imported (converted into slides) and exported from any presentation.
- **Data locations** — saved presentations live in the app's user-data folder; the media library is stored under `userData/media/` and downloaded/imported Bibles under `userData/bibles/`.

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

The interface is fully translated and can be switched in **Settings → Language**:

- 🇹🇷 Türkçe (Turkish)
- 🇬🇧 English
- 🇪🇸 Español (Spanish)
- 🇩🇪 Deutsch (German)
- 🇰🇷 한국어 (Korean)

---

## For Developers

### Requirements

- [Node.js](https://nodejs.org/) **18 or newer** (the CI pipeline uses Node 22)
- npm (ships with Node.js)

### Setup & Development

```bash
# 1. Install dependencies
npm install

# 2. Start the development server with hot reload
npm run dev

# 3. Code quality
npm run lint     # ESLint
npm run format   # Prettier
```

> Note: the app's Google Drive integration reads credentials from `src/main/driveCredentials.ts`, which is git-ignored. Without it the Drive features simply show as not signed in — everything else works out of the box.

### Tests

```bash
npm run test:split      # hymn lyric splitter
npm run test:updater    # updater reducer
npm run test:presets    # preset store
npm run test:media      # media library
npm run smoke:worker    # Electron utility-process smoke test
```

### Building & Packaging

```bash
npm run build
```

This runs, in order:

1. **TypeScript check** — `tsc --noEmit`
2. **Bundle** — `vite build` (renderer to `dist/`, main + preload to `dist-electron/`; stale output is cleaned first so no old bundles leak into the package)
3. **Package** — `electron-builder` produces installers in `release/<version>/`

The packaging config in `package.json` also keeps the app lean: only the locales the app actually ships (EN, TR, ES, DE, KO) are included, and the installer uses maximum compression.

### Release Process (CI)

Pushing a tag named `v*` triggers the [GitHub Actions workflow](.github/workflows/release.yml), which:

1. Builds the app on `windows-latest`, `macos-latest` and `ubuntu-latest` in parallel.
2. Generates the Drive credentials from repository secrets (`DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`).
3. Runs `vite build` + `electron-builder --publish always`, which uploads the installers to the **GitHub Release** for that tag.

The attached artifacts are: the Windows NSIS installer (`.exe`), macOS DMG and ZIP (x64 + arm64), the Linux AppImage (`.AppImage`), and the update feed (`.yml` + `.blockmap`) used by the in-app auto-updater.

### Project Structure

```
src/
├── main/               # Electron main process
│   ├── main.ts         # Windows, projector, remote server, IPC, file I/O
│   ├── preload.ts      # Context-isolated bridge (window.electronAPI)
│   ├── presetStore.ts  # Saved presentations (userData/presets)
│   ├── mediaLibrary.ts # Persistent media library (userData/media)
│   ├── driveService.ts # Google Drive OAuth + file sync
│   ├── updater.ts      # Auto-update (electron-updater)
│   ├── pptxService.ts  # PowerPoint import/export
│   └── utility/        # heavyWorker — CPU-heavy work off the main thread
├── renderer/           # React UI
│   ├── App.tsx         # Shell, tabs, live/projector mode
│   ├── <Tab>*.tsx      # Presentations, Slides, Bible, Media, Hymns,
│   │                   # Countdown, Screen, Calendar…
│   ├── components/     # Toolbar, panels, dialogs, modals
│   ├── hooks/          # Keyboard nav, projector sync, live save…
│   ├── state/          # Zustand stores (presentation, undo, updater…)
│   └── locales/        # i18n translations (tr, en, es, de, ko)
└── shared/             # Code shared between main and renderer
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
