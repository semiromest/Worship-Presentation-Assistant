# Worship Presentation Assistant

A modern desktop application built with **TypeScript**, **React**, and **Electron** for churches and communities that need presentation software. This MVP release includes core presentation creation, slide management, and local file operations.

## Features

- **Slide Management:** Add, delete, reorder, and edit slides with ease.
- **Live Presentation:** Present slides in fullscreen mode (F11 / Live Presentation button).
- **Local Storage:** Save and open presentations as `.gpres` files.
- **Modern UI:** Clean, user-friendly interface built with Tailwind CSS, featuring dark mode support.

## Requirements

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (ships with Node.js)

## Getting Started

### 1. Install Dependencies

Open a terminal in the project directory and run:

```powershell
npm install
```

### 2. Start in Development Mode

Launch the application with hot module replacement (HMR) support:

```powershell
npm run dev
```

### 3. Code Quality Checks

Lint your code with ESLint and format it with Prettier:

```powershell
# Check for errors
npm run lint

# Auto-fix formatting
npm run format
```

## Building & Packaging (Windows)

To compile and package the application for Windows:

```powershell
npm run build
```

This command performs the following steps:
1. Compiles TypeScript code.
2. Bundles frontend assets with Vite.
3. Uses `electron-builder` to produce distributable artifacts in the `release/` folder.

### Release Artifacts

The build process generates two types of Windows executables under the `release/` directory:

- **`Worship Presentation Assistant Setup X.X.X.exe`** — An NSIS installer that installs the application on your system. Recommended for standard installation.
- **`Worship Presentation Assistant X.X.X-win-unpacked/`** — A portable, unpacked version of the application. No installation required — simply run the `.exe` file inside this folder directly. Ideal for USB drives or temporary use.

**Note:** This application is currently configured for the Windows platform only.

## Project Structure

- `src/main` — Electron main process code.
- `src/preload` — Secure bridge (preload scripts) between Electron and the renderer.
- `src/renderer` — React-based user interface code.
- `dist` — Compiled frontend assets.
- `dist-electron` — Compiled Electron main/preload files.
- `release` — Packaged application artifacts ready for distribution.

