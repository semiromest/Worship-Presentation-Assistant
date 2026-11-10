# Fullscreen output without a click (Windows)

Browsers enter fullscreen only after a click inside that window. Chrome tested a way for a page to open a popup straight into fullscreen ("fullscreen popups"), then dropped it after the origin trial. A site therefore cannot make its output window fullscreen by itself.

The supported alternative is the **Automatic Fullscreen** policy. Chrome and Edge let an administrator allow chosen sites to enter fullscreen without a gesture. Websites cannot ask the user for this permission, so it is set once on the presentation computer.

With the policy set, the web app's output window opens fullscreen on the second screen as soon as you click Start Broadcast. Without it, one click on the output window, or the first key press there, makes it fullscreen. The web app also offers this file itself: when the output could not go fullscreen on a second screen, it asks once whether to download it, already filled in with the address the app runs on. On the main screen the output never goes fullscreen by itself, as in the desktop app, so that the control panel stays visible.

## Setup

1. Double-click `allow-presentation-output.reg` and confirm. This needs administrator rights.
2. Restart Chrome or Edge completely.
3. Optionally, check `chrome://policy` (or `edge://policy`): the three policies below should be listed.

The file sets these policies for `https://semiromest.github.io` (the published web app) and `http://localhost:4176` (the development server):

| Policy | Effect |
|---|---|
| `AutomaticFullscreenAllowedForUrls` | The output window may enter fullscreen without a click. |
| `WindowManagementAllowedForUrls` | Connected screens are listed without the "window management" prompt, so the output opens on the second screen. |
| `PopupsAllowedForUrls` | The output window is never blocked as a popup. |

If you host the web app elsewhere, replace the addresses in the file with your own origin before running it, for example `https://presenter.example.org`.

## Undo

Run `remove-presentation-output.reg`, then restart the browser. It deletes these three policy lists completely, including entries for other sites that someone may have added to the same lists.

The desktop app does not need any of this: its output windows are always fullscreen on a second screen.
