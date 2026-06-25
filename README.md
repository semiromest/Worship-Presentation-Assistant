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
### Downloads

Prebuilt Windows binaries are available on the GitHub Releases page.

1. Go to the **Releases** section of this repository.
2. Download the latest release assets.
3. Choose one of the following packages:

* **`Worship Presentation Assistant Setup X.X.X.exe`** — NSIS installer version. Recommended for most users. Run the installer and follow the setup wizard.
* **`Worship Presentation Assistant X.X.X-win-unpacked.zip`** — Portable version. Extract the archive and run the executable directly without installation.

### Installation

#### Installer Version

1. Download `Worship Presentation Assistant Setup X.X.X.exe`.
2. Run the installer.
3. Follow the installation wizard.
4. Launch the application from the Start Menu or Desktop shortcut.

#### Portable Version

1. Download `Worship Presentation Assistant X.X.X-win-unpacked.zip`.
2. Extract the archive to any location.
3. Open the extracted folder.
4. Run `Worship Presentation Assistant.exe`.

> **Note:** The application is currently available for Windows only.


