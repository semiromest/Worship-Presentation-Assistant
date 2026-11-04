# Website and browser demo

This directory contains the static files published by GitHub Pages. The landing page has no build step. The demo is a prebuilt browser bundle of the application's actual React renderer and styles, with desktop capabilities replaced by a browser sandbox.

- `/`: English/Turkish product introduction and GitHub release download links.
- `/demo/`: A browser-only slide workspace with original sample lyrics, clearly labelled scripture paraphrases and optional local image/video files.
- `demo/assets/`: Generated renderer bundle; rebuild from `browser-demo/` rather than editing these files.

The demo allows slide creation, text and appearance editing, local image/video selection, and exploring sample hymns and scripture. The Screen tab is intentionally inert. Projector outputs, screen capture, phone control, cloud services, import/export and other desktop integrations are disabled. Files are read locally through browser object URLs and never uploaded. The renderer can retain appearance preferences and library entries in browser storage; the open presentation resets on reload.

To rebuild the demo from the current renderer working tree, run from the repository root:

```sh
npx vite build --config browser-demo/vite.config.mts
```

Commit the resulting `site/demo/` files together with changes to the sandbox source. Pages publishes this checked-in snapshot, so deployment does not depend on Electron packaging or unrelated desktop changes.

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
