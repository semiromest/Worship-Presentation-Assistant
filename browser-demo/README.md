# Browser demo sandbox

`main.tsx` mounts the desktop application's real `App`, components and CSS. This is not a separate approximation of the interface. `samples.ts` supplies three original sample hymns, six illustrative scripture paraphrases and an example deck.

`bridge.ts` replaces Electron IPC with inert browser methods. The only file picker accepts local images/videos and returns object URLs. `runtime.ts` replaces desktop runtime hooks; `liveSave.ts` retains shared naming helpers without enabling automatic file saves. The build config adapts desktop media protocols only in the browser bundle. The content security policy blocks third-party connections, embedded frames and external scripts.

The Screen tab remains visible and inert. Users can create and edit text/image/video slides and change appearance. Projector outputs, screen capture, live transcription, remote control, desktop imports/exports, generated gradients and background music are unavailable. No Electron main process or preload code is bundled.

Build from the repository root after installing its dependencies:

```sh
npx vite build --config browser-demo/vite.config.mts
```

Output replaces `site/demo/`. Preview the whole website with `npx vite --config site/vite.config.mjs` and open `http://127.0.0.1:4174/demo/`. The checked-in bundle is a snapshot of the renderer working tree at build time. Rebuild when desktop UI changes should appear in the demo; Pages serves the snapshot without building the Electron app.
