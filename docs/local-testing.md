**English** | [Español](local-testing.es.md)

# Testing StreamCollab locally (no VPS)

Everything works on a single PC with OBS. Locally, Chrome's "Local Network Access" restriction doesn't apply
either, because the Dock is loaded from `localhost`.

> The automated tests (`npm test` and `npm run e2e`) cover the server and the interface in a browser.
> This checklist covers what **can only be checked with a real OBS**.

> On Windows PowerShell, use `npm.cmd` if script execution is blocked.

## 0. Start

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000/dashboard`. The data is stored in `packages/server/streamcollab.sqlite`.

Without Node.js, you can use the Docker image from the README (quick start, option A); the data then lives in the
`streamcollab-data` volume.

## 1. Room

- [ ] In the Director Panel: **New room** → **Create**. "You are the host" appears, with the Dock and HUD links.

## 2. Connect OBS

- [ ] OBS → Tools → WebSocket Server Settings → enable it (port 4455).
- [ ] Docks → Custom Browser Docks → paste the Dock link.
- [ ] In the Dock: **OBS Disconnected** → **Connect** → it turns into **OBS Linked** with your resolution and FPS.
- [ ] The **Chapters** line says that chapters are available (OBS 30.2+).

## 3. Markers in the Dock

- [ ] Buttons and keys `1`–`5` → the marker shows up in the Dock and in the Director Panel.
- [ ] `0` or **Undo** → your last marker disappears.

## 4. On-screen HUD

- [ ] Browser Source with the HUD link, 1920×1080 → marking shows the alert over a transparent background.
- [ ] Hiding the source and showing it again leaves no "stuck" alerts.

## 5. Global hotkeys (with the game in the foreground)

- [ ] Tools → Scripts → `+` → `streamcollab-hotkeys.lua` (from the releases page or from `obs-scripts/`).
- [ ] Settings → Hotkeys → "StreamCollab" → bind Kill, Squad Wipe, Clutch, Funny, Note and Undo.
- [ ] With a game or another window focused, the keys create markers and the Undo key removes them.

## 6. Recording and native chapters

- [ ] Settings → Output → Recording → **Hybrid MP4** format.
- [ ] Director Panel → **Start New Session**; then record in OBS → the Dock shows **REC LIVE**.
- [ ] Mark 3–4 moments you will remember; stop the recording.
- [ ] Open the file in a player with chapter support (e.g. VLC → Playback → Chapter): the chapters are at those moments.

## 7. Export to DaVinci Resolve

- [ ] Director Panel → **Export Timeline** → **Timeline**: your name (POV) → DaVinci Resolve → download the `.edl`.
- [ ] Import the `.edl` together with your recording: the markers land where you marked.

## 8. Several people without a VPS

- [ ] Same PC: open the Dock link in another browser or in a private window (it is another player).
- [ ] Another PC at home: `http://YOUR-LAN-IP:3000/...` (allow Node through the Windows firewall).
- [ ] Both appear in the Director Panel; only the host can start or stop sessions.

## 9. Persistence and reconnection

- [ ] `Ctrl+C` on the server: the Dock shows **Server disconnected · reconnecting**, and marking warns that the marker was not sent.
- [ ] `npm start` again: the Dock reconnects, and the room, the sessions and the markers are still there.

## If something fails, write down

- The step and what you expected to see.
- The text of the Dock's **Chapters** line and any yellow notice.
- A screenshot of the Dock or the Director Panel.
