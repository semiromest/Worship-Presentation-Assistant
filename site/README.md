# Website and browser demo

This directory is a standalone static website for GitHub Pages. It has no build step, desktop imports, analytics or third-party runtime dependencies.

- `/`: English/Turkish product introduction and GitHub release download links.
- `/demo/`: A browser-only slide workspace with original sample lyrics, clearly labelled scripture paraphrases and optional local image/video files.
- `assets/demo-model.mjs`: Slide selection, live cues, song parts and edit history, separate from DOM rendering.

The demo does not implement Electron APIs, real projector outputs, phone control, cloud transcription or XML/PowerPoint import. It does not upload files or persist presentations. Only the language preference is stored in localStorage; edits and object URLs belong to the current tab.

## Preview

Serve `site/` with any static HTTP server. For example, from the repository root:

```sh
npx vite --config site/vite.config.mjs
```

Then open `http://127.0.0.1:4174/`. This serves the website without starting Electron. Do not use the project's desktop `npm run dev` to preview this directory.

## GitHub Pages

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The `Publish website and browser demo` workflow deploys only `site/`, automatically when that directory changes on `master`, or manually through `workflow_dispatch`.

Expected URLs:

- `https://semiromest.github.io/Worship-Presentation-Assistant/`
- `https://semiromest.github.io/Worship-Presentation-Assistant/demo/`

All local asset links are relative so both pages work under the repository subdirectory. Update canonical URLs, sitemap and robots.txt if the deployment address changes.

The logo comes from the desktop project. Work Sans is self-hosted with its OFL notice in `assets/fonts/OFL.txt`. Source code is covered by the repository's MIT license. Keep the demo's original lyrics and paraphrase notices when changing sample content.
