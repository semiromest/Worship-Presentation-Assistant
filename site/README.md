# Website and web app

This directory contains the static files published by GitHub Pages. The landing page has no build step.

- `/`: English product introduction with real application screenshots and GitHub release download links.
- `assets/screens/`: Application screenshots at 1600×960 (1.5× scale), saved as WebP. Recapture them when the interface changes.
- `/app/`: The web app, built from `web/` (see `web/README.md`). `site/app/` is generated and not committed. The Pages workflow builds it on every deploy.

## Preview

Serve `site/` with a static server, so it behaves the same as on GitHub Pages. From the repository root:

```sh
npx vite build --config web/vite.config.mts
npx vite preview --config site/vite.config.mjs --outDir . --port 4189
```

Then open `http://127.0.0.1:4189/`. Do not use the project's desktop `npm run dev` to preview this directory. Avoid the Vite dev server (`npx vite --config site/vite.config.mjs`) for the web app: it rewrites module URLs, so offline caching cannot be tested there.

## GitHub Pages

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The `Publish website and web app` workflow builds the web app and deploys `site/`. It runs automatically when the site, the web app or the shared renderer changes on `master`, or manually through `workflow_dispatch`. To enable Google Drive in the web app, set the repository variable `GOOGLE_DRIVE_CLIENT_ID` (see `web/README.md`).

Expected URLs:

- `https://semiromest.github.io/Worship-Presentation-Assistant/`
- `https://semiromest.github.io/Worship-Presentation-Assistant/app/`

All local asset links are relative, so both pages work under the repository subdirectory. Update canonical URLs, sitemap and robots.txt if the deployment address changes.

The logo comes from the desktop project. Work Sans is self-hosted with its OFL notice in `assets/fonts/OFL.txt`. Source code is covered by the repository's MIT license.
