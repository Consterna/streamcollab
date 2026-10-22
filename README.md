**English** | [Español](README.es.md)

# 🎮 StreamCollab — OBS Squad-Marker & Live Multicam HUD

[![CI](https://github.com/Consterna/streamcollab/actions/workflows/ci.yml/badge.svg)](https://github.com/Consterna/streamcollab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Consterna/streamcollab)](https://github.com/Consterna/streamcollab/releases/latest)

> **High-Precision Collaborative Squad Marker & Multicam Sync System for OBS Studio & Professional NLEs (DaVinci Resolve, Adobe Premiere Pro, YouTube).**

StreamCollab allows competitive gaming squads, content creator groups, and esports tournament directors to coordinate multicam recordings in real-time. Creators can instantly mark epic kills, squad wipes, clutches, and funny moments with 1-click hotkeys right inside OBS Studio. When the session ends, StreamCollab generates **SMPTE-timecoded NLE timeline markers and multicam sync matrices** ready for video editors.

---

## 🚀 Key Features

- **OBS Studio Native Custom Browser Dock**:
  - Connects directly to local OBS Studio via `obs-websocket-js` v5 (`ws://127.0.0.1:4455`).
  - Queries native video settings (`GetVideoSettings`: framerate, base/output resolution) and recording status (`GetRecordStatus`: live output duration, active/paused states).
  - Quick action hotkeys:
    - `1` 🎯 **Kill** (Red marker)
    - `2` 💥 **Squad Wipe** (Fuchsia marker)
    - `3` 🏆 **Clutch Play** (Yellow marker)
    - `4` 😂 **Funny Moment** (Cyan marker)
    - `5` 📝 **Timeline Note** (Blue marker)
  - **Global hotkeys while gaming** via the bundled OBS Lua script (`streamcollab-hotkeys.lua`), bindable in OBS *Settings → Hotkeys*.
  - Inline custom label / comment text input.
  - **Undo** your last marker with the Undo button, `0` / `Ctrl+Z`, or a global OBS hotkey.
  - **Native OBS chapters**: each marker is also written as a chapter into your own recording (OBS 30.2+, Hybrid MP4), optionally including your squadmates' markers.
  - Live reverse-chronological marker history with SMPTE timecode.
  - Shows **Server disconnected** while it can't reach the StreamCollab server, and tells you when a marker could not be sent.

- **OBS Browser Source HUD (Transparent Overlay)**:
  - Transparent gaming overlay (`bg-transparent`) optimized for OBS Studio Browser Sources.
  - CSS-animated alert toasts that slide into the stream when any squadmate records a highlight.
  - Optional alert sounds per category (`&sound=1&volume=0.6` on the HUD link), synthesized in the page; no audio files.
  - Only squadmates whose dock is connected appear in the on-stream squad list.
  - Real-time squad status HUD badge showing each creator's live OBS recording health (🔴 REC, ⏸️ PAUSED, ⚪ IDLE).
  - **Resource Optimization**: Listens to OBS's `obsSourceVisibleChanged` event and stops rendering and toast timers while the source / scene is hidden. Toast cleaner interval preserves reference identity when no toasts expire, preventing unnecessary re-renders in OBS CEF.

- **High-Precision SMPTE Timecode Engine**:
  - Pure rational arithmetic avoiding floating-point drift over multi-hour broadcasts.
  - Full support for standard framerates: `60 fps`, `59.94 fps` (60000/1001), `50 fps`, `30 fps`, `29.97 fps` (30000/1001), `25 fps`, `24 fps`, and `23.976 fps` (24000/1001).
  - True SMPTE Drop Frame (DF) & Non-Drop Frame (NDF) calculation with correct minute-mark frame skipping (drop-frame only exists for 29.97 and 59.94 fps).
  - Configurable base timecode offsets (e.g. `01:00:00:00` or `00:00:00:00`).

- **NLE Exporter Suite**:
  - 🎬 **DaVinci Resolve CMX 3600 EDL**: Strict CRLF line endings, sequential 1-frame edit events (`001`, `002`...), and `* LOC:` locator syntax mapped to native DaVinci marker colors (Red, Fuchsia, Yellow, Cyan, Blue, Green), clamped against negative frame durations.
  - 🎞️ **Adobe Premiere Pro FCP 7 XML (`xmeml` v4)**: Valid Final Cut Pro 7 XML with stripped control characters, complete `<format><samplecharacteristics>` video format blocks and track-level `<marker>` tags prefixed with category identifiers.
  - 📊 **Universal CSV**: RFC 4180 compliant CSV compatible with Google Sheets, Microsoft Excel, and Markerbox. Formula injection triggers (`/^\s*[=+\-@|]|[\t\r]/`) are safely neutralized.
  - 📺 **YouTube Video Chapters**: Clean description chapter format (`00:00 Intro\n01:23 First Blood`) that always starts at `00:00` and keeps YouTube's 10-second minimum chapter length.
  - 🛰️ **Multicam Sync Matrix JSON**: Where each creator's OBS file starts relative to the session (ms and frames), from SNTP-calibrated recording anchors.
  - 🎥 **Per-POV timelines**: Any format can be exported re-timed to one creator's own recording file (`?memberId=`), so markers land on the right frame of that clip.

- **Private Rooms & Host Control**:
  - Rooms are created explicitly and identified by an unguessable join code (e.g. `KQ7P-M3XD`).
  - Only the host (holder of the room's host token) can start or stop sessions; each streamer's dock is bound to its own member token, so nobody can mark or update status in someone else's name.
  - One Dock can be a member of several rooms at once.
  - Every WebSocket message and REST body is validated with shared Zod schemas; per-socket and per-route rate limits.

- **High-Concurrency Fastify Backend & SQLite WAL**:
  - Fastify v5 with `@fastify/websocket` v11 and `@fastify/cors`.
  - Native Node 24 `node:sqlite` (`DatabaseSync`) configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL`), `busy_timeout = 5000ms`, atomic transactions, and automatic orphan session crash recovery on startup.
  - **SNTP 4-Timestamp Engine**: Continuous RTT & clock offset calibration with initial 4-ping burst, outlier jitter rejection (> 2.5x baseline), and 5s exponential smoothing ($\theta = \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$) between streamers' PCs and the server.

---

### Languages
The interface is available in **Spanish and English**. It follows the browser language, can be switched from the selector in the navigation bar, and can be forced per link with `&lang=es` / `&lang=en`. Invite links copied from the Director Panel keep the panel's language, so docks and overlays pasted into OBS match it. Default marker labels (e.g. "Kill confirmada" / "Kill Confirmed") use the language of the streamer who marks.

---

## ⚡ Quick Start

StreamCollab is one server: it serves the Director Panel, the Dock, the HUD, the REST API and the WebSocket hub from a single address. Run it once for the whole squad, then add the Dock and the HUD to each streamer's OBS ([OBS Studio Setup Guide](#-obs-studio-setup-guide)).

Prebuilt images for `linux/amd64` and `linux/arm64` are published at `ghcr.io/consterna/streamcollab`.

### Option A: one PC or your local network (Docker)
With [Docker](https://docs.docker.com/get-started/get-docker/) installed:
```bash
docker run -d -p 3000:3000 -v streamcollab-data:/data --name streamcollab ghcr.io/consterna/streamcollab:1.6.1
```
1. Open `http://localhost:3000/dashboard` and create a room (**New room** → **Create**). You are now its host.
2. Copy the Dock and HUD links from the Director Panel into OBS.
3. Squadmates on other PCs of the same network: open the Director Panel at `http://<this PC's LAN IP>:3000/dashboard` instead, so the copied links point to an address they can reach, and allow port 3000 through this PC's firewall.

The database lives in the `streamcollab-data` volume and survives container updates. To update, remove the container and run the same command with the new version tag: `docker rm -f streamcollab`, then `docker run ...:<new version>`.

This option is plain HTTP, meant for a home network. To play with squadmates over the internet, use Option B.

### Option B: VPS with HTTPS (Docker Compose + Caddy)
`docker-compose.yml` runs the published image behind [Caddy](https://caddyserver.com), which obtains and renews the TLS certificate automatically (HTTPS and WSS).

1. Point a DNS record (e.g. `collab.example.com`) at the VPS and open ports 80 and 443.
2. On the VPS:
   ```bash
   git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
   cp .env.example .env    # set DOMAIN=collab.example.com (and ADMIN_TOKEN if you want the room list)
   docker compose pull && docker compose up -d
   ```
   This uses `ghcr.io/consterna/streamcollab:1.6.1`; set `STREAMCOLLAB_TAG` in `.env` to choose another published version. To compile the image from the source you cloned instead, run `docker compose up -d --build`.
3. Open `https://collab.example.com/dashboard`, create a room and share the Dock / HUD links.

Backups, updates and logs: [Running on a VPS](#-running-on-a-vps).

### Without Docker
Install Node.js 24 and run the server from source: see [Production server from source](#production-server-from-source).

---

## 🎥 OBS Studio Setup Guide

The example links below use `http://localhost:3000` (Option A). On a VPS, use your domain instead, e.g. `https://collab.example.com/?view=dock&room=KQ7P-M3XD`. The Director Panel's copy buttons always give you the right link.

### 1. Enable OBS WebSocket Server
1. In OBS Studio, open **Tools** -> **WebSocket Server Settings**.
2. Check **Enable WebSocket server**.
3. Server Port: `4455` (default).
4. If you enable authentication, take note of your password (you can input it in the StreamCollab Dock settings).
5. Click **Apply** -> **OK**.

### 2. Add the OBS Custom Browser Dock
1. In OBS Studio top menu, click **Docks** -> **Custom Browser Docks...**
2. **Dock Name**: `StreamCollab Squad Marker`
3. **URL**: the Dock link from the Director Panel, e.g. `http://localhost:3000/?view=dock&room=KQ7P-M3XD`
4. Click **Apply**.
5. The dock will open as a window inside OBS Studio. Drag and drop it into your OBS workspace (e.g. next to the Audio Mixer or Scene list).
6. Click **OBS Disconnected** -> verify `ws://127.0.0.1:4455` (and the password, if authentication is enabled) -> click **Connect**. The address and password are saved in this OBS profile, and the dock reconnects by itself whenever OBS (or its WebSocket server) restarts.
7. The status turns to a green **OBS Linked** dot, displaying your live canvas resolution, framerate, and recording status.

The OBS WebSocket address and password are stored in plain text in the Dock's browser storage (`localStorage`) inside this OBS profile. They are never sent to the StreamCollab server.

If the Dock stays on **OBS Disconnected** while OBS is running, see [If the Dock can't reach OBS](#if-the-dock-cant-reach-obs).

### 3. Global Hotkeys While Gaming (Recommended)
The Dock's `1`..`5` keys only work while the Dock has focus. To mark from inside your game:
1. Download `streamcollab-hotkeys.lua` from the assets of the [latest release](https://github.com/Consterna/streamcollab/releases/latest) (its SHA-256 is listed in `SHA256SUMS`), or take [`obs-scripts/streamcollab-hotkeys.lua`](obs-scripts/streamcollab-hotkeys.lua) from this repository.
2. In OBS Studio, open **Tools** -> **Scripts** -> **+** and select the file.
3. Open **Settings** -> **Hotkeys**, search for `StreamCollab` and bind *Kill*, *Squad Wipe*, *Clutch Play*, *Funny Moment*, *Timeline Note* and *Undo my last marker*.
4. Keep the StreamCollab Dock open and linked to OBS. Each hotkey press updates the hidden `StreamCollab Signal` input; the Dock receives it through obs-websocket and creates the marker.

The script creates the `StreamCollab Signal` input automatically. It is never added to a scene, so nothing is rendered.

**Native chapters in your recording (optional):** with OBS 30.2+ set **Settings** -> **Output** -> **Recording** -> **Recording Format** to **Hybrid MP4**. The Dock then writes every marker as a chapter into the file you are recording, so editors see them even without importing an EDL. The Dock's settings panel shows whether chapters are available and lets you also add your squadmates' markers. Chapters are permanent in the file: undoing a marker in StreamCollab does not remove its chapter.

### 4. Add the OBS Browser Source (HUD Overlay)
1. In your active OBS Scene, click **Add Source (+)** -> **Browser**.
2. Name it `StreamCollab HUD`.
3. Configure settings:
   - **URL**: the HUD link from the Director Panel, e.g. `http://localhost:3000/?view=hud&room=KQ7P-M3XD`
   - **Width**: `1920`
   - **Height**: `1080`
   - **Custom CSS**: (leave default or clear, background is already transparent)
   - **Shutdown source when not visible**: Checked (optional, built-in visibility listener handles it automatically)
4. Click **OK**.
5. When any squadmate presses a hotkey (`1`..`5`) or marks an event, an alert slides in on-stream with the category, label, creator and SMPTE timecode.
6. **Sound (optional):** use the *HUD with sound* link from the Director Panel (it adds `&sound=1&volume=0.6`). Tick **Control audio via OBS** in the Browser Source properties to give the cues their own fader in the OBS mixer.

### 5. Tournament Director Panel
- Access via any browser: `http://localhost:3000/dashboard` (or `/?view=dashboard`)
- Create the room (you become its host) and copy the Dock / HUD invite links.
- Browse the **Session History**: pick any past session to review, fix and export its markers.
- Start master recording sessions, customize base timecodes and framerates (60, 59.94, 50, 30, 29.97, 25, 24 and 23.976 fps; drop-frame for 29.97 and 59.94), monitor all squad members' recording duration and clock calibration, and export NLE timelines in 1 click.

---

## 🔐 Rooms, Hosts & Security

1. **The host creates a room** in the Director Panel (`/dashboard`) -> **New room** -> **Create**. The server returns a room code and a **host token**; the token is stored in that browser and only its SHA-256 hash is kept on the server.
2. **Invite the squad** with the copy buttons: the Dock URL (`/?view=dock&room=<CODE>`) and HUD URL (`/?view=hud&room=<CODE>`). The room code is the invite, so share it only with your squad.
3. **Moving host control** to another device: copy the host token from *You are the host* and paste it in *Viewing only -> Unlock* on the other device.
4. **Streamer identity**: the first time a dock joins, the server issues a member token bound to that dock's member id (stored in the OBS browser profile). The same identity works in every room that dock joins. If a dock loses it, it rejoins automatically under a new member id.

| Action | Who can do it |
| --- | --- |
| View room, markers, exports | Anyone with the room code |
| Create markers, update OBS status | The streamer's own dock (member token) |
| Start / stop sessions | The host (host token); see *Auto Session* below |
| Delete finished sessions, delete the room, remove offline members | The host (host token) |
| List all rooms (`GET /api/rooms`) | Admin only (`ADMIN_TOKEN`), hidden otherwise |

**Auto Session:** if a streamer marks (from the Dock, a hotkey or the HTTP quick-mark) while no session is running, the server starts one automatically, named `Auto Session` plus the server's local time (60 fps, non-drop frame, base timecode `01:00:00:00`). So a session can begin without the host; only the host can stop it. Starting a new session always stops the one that was running.

**HTTP quick-mark and undo (Stream Deck / Streamer.bot):** in the Dock, open the OBS settings panel and copy the *HTTP token*, then:
```http
POST /api/rooms/<CODE>/quick-mark
Authorization: Bearer <member token>
Content-Type: application/json

{ "memberId": "<your member id>", "category": "kill", "label": "Ace" }
```
`POST /api/rooms/<CODE>/markers/undo` with `{ "memberId": "..." }` removes your last marker. Step-by-step setup for Stream Deck, Streamer.bot, PowerShell and curl: [docs/stream-deck.md](docs/stream-deck.md).

**Editing markers:** the author (from their own Dock) and the host can fix or delete markers; the Director Panel shows edit / delete buttons on each timeline row for the host. Edits keep the original timing and are reflected in every export.

**Server environment variables** (see `.env.example`):
- `ALLOWED_ORIGIN`: comma-separated origins allowed to call the REST API cross-origin. Leave empty when the client is served from the same host (default).
- `ADMIN_TOKEN`: enables `GET /api/rooms` for `Authorization: Bearer <ADMIN_TOKEN>` (16+ characters).
- `TRUST_PROXY`: `true` behind a reverse proxy so rate limits use the real client IP. Only enable it behind a proxy that **overwrites** `X-Forwarded-For` with the address it sees. Caddy does by default (`docker-compose.yml` already sets `TRUST_PROXY=true` for it). With another proxy, configure it that way (in Nginx, `proxy_set_header X-Forwarded-For $remote_addr;`); otherwise a client can send a fake IP and slip past the rate limits.
- `ROOM_CREATE_LIMIT_PER_MINUTE`: rooms one IP may create per minute (default 10).

Room codes are accepted in any letter case (`kq7p-m3xd` joins `KQ7P-M3XD`). An IP that tries more than 20 unknown room codes in a minute is refused for the rest of that minute.

Rooms created with v1.0/v1.1 have no host token: they stay readable and markable but sessions can't be started or stopped there. Create a new room.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

## 🚢 Running on a VPS

The repository ships a multi-stage `Dockerfile` (Node 24, production dependencies only, non-root user, healthcheck on `/api/health`) and the `docker-compose.yml` from [Option B](#option-b-vps-with-https-docker-compose--caddy).

- **Data**: SQLite lives in the `streamcollab-data` volume (`/data/streamcollab.sqlite`). Back it up **while it runs** (a consistent, compacted snapshot via SQLite `VACUUM INTO`, verified with `integrity_check`) and copy it out:
  ```bash
  docker compose exec streamcollab node packages/server/dist/backup.js /data/backups/streamcollab.sqlite
  docker compose cp streamcollab:/data/backups/streamcollab.sqlite ./streamcollab-backup.sqlite
  ```
  With the single container from Option A, use `docker exec streamcollab ...` and `docker cp streamcollab:/data/backups/streamcollab.sqlite .` instead. From source: `npm run backup` writes `backups/streamcollab-<date>.sqlite` next to the database (or `npm run backup -- <file>`). Existing files are never overwritten. To restore, stop the server and put the copy in place of the database file.
- **Updates**: `git pull && docker compose pull && docker compose up -d` (or `git pull && docker compose up -d --build` if you build from source). Schema migrations run automatically on startup.
- **Shutdown**: `docker compose stop` sends SIGTERM; the server closes sockets, checkpoints the SQLite WAL and exits (15 s grace period).
- **Logs**: `docker compose logs -f streamcollab` (`LOG_LEVEL` controls verbosity).

### If the Dock can't reach OBS
The Dock talks to OBS on `ws://127.0.0.1:4455` from your PC. Recent Chromium versions restrict public HTTPS pages that open connections to `localhost` ("Local Network Access"), and an OBS Custom Browser Dock may not be able to show the permission prompt.

**OBS 33** (a release candidate at the time of writing) updates the Chromium (CEF) built into OBS from version 127 to 150 ([33.0.0-rc3 release notes](https://github.com/obsproject/obs-studio/releases/tag/33.0.0-rc3)). Its betas blocked requests from public pages to `localhost` ([obsproject/obs-browser#545](https://github.com/obsproject/obs-browser/issues/545)); OBS restored them with a change it describes as temporary ([obsproject/obs-studio#14009](https://github.com/obsproject/obs-studio/pull/14009)).

If the Dock loaded from your domain stays on **OBS Disconnected**:
1. Serve the Dock locally next to OBS: for example `npm run build` then `npm run preview --workspace=packages/client`, which serves `http://localhost:4173` (or run the Docker image from Option A on that PC and use `http://localhost:3000`).
2. Use the Dock URL with a `server` parameter so it still joins the room on your VPS:
   `http://localhost:4173/?view=dock&room=<CODE>&server=https://collab.example.com`
3. Add that local origin to `ALLOWED_ORIGIN` on the server (e.g. `ALLOWED_ORIGIN=http://localhost:4173`).

The HUD and Director Panel never talk to OBS's WebSocket, so they can always be loaded from the public domain.

---

## 🎬 Importing Markers into NLEs

### DaVinci Resolve
1. In StreamCollab Dock or Director Panel, click **Export NLE** -> select **DaVinci Resolve**.
2. Click **Download File** (`.edl`).
3. In DaVinci Resolve:
   - Go to **File** -> **Import** -> **Timeline...** (or right-click timeline -> **Timelines** -> **Import** -> **EDL/XML...**).
   - Select the downloaded `.edl` file.
   - DaVinci Resolve will create timeline markers with native colors corresponding to each event type (Red for Kills, Fuchsia for Wipes, Yellow for Clutches, Cyan for Funny, Blue for Notes).

EDL titles are plain ASCII: accented letters are folded (a session named "Sesión" becomes "Sesion").

### Adobe Premiere Pro
1. Click **Export NLE** -> select **Premiere Pro**.
2. Click **Download File** (`.xml`).
3. In Adobe Premiere Pro:
   - Go to **File** -> **Import...** (`Ctrl + I` / `Cmd + I`).
   - Select the `.xml` sequence.
   - Premiere Pro opens a sequence with all squad markers placed on the video track with category headers and author comments.

### Per-Creator (POV) Timelines
Every creator's Dock reports when their OBS recording file started (on the server-calibrated clock). In the **Export NLE** dialog, pick a creator in the **Timeline** selector to get markers re-timed to that creator's own recording:
- Markers made by that creator use the exact in-file position reported by OBS.
- Squadmates' markers are placed using the SNTP-calibrated wall clock.
- REST: `GET /api/rooms/:roomId/export/:format?sessionId=…&memberId=…`

A POV export needs that creator's OBS to have been recording during the session.

Known limitation: if a creator pauses their recording, squadmates' markers made *before* the pause may shift in that creator's POV export (their own markers stay exact).

### YouTube Chapters
1. Click **Export NLE** -> select **YouTube Chapters**.
2. Click **Copy Code**.
3. Paste directly into your YouTube video description.

YouTube only shows chapters when the first one starts at `00:00`, there are at least 3 timestamps and each chapter lasts 10 seconds or more. The exporter always starts at `00:00` and keeps the 10-second minimum; the dialog warns you when an export has fewer than 3 chapters.

The **Master session** timeline counts from the start of the StreamCollab session, not from the start of your video. For chapters on your own video, pick your name in the **Timeline** selector (POV export): the times are then relative to your OBS recording file.

---

## 🛠️ Development

### Prerequisites
- **Node.js**: v24 LTS (or higher) with native `node:sqlite` support
- **npm**: v11+
- **OBS Studio**: v28+ (WebSocket v5 is built into OBS Studio by default)

> On Windows PowerShell, use `npm.cmd` (and `npx.cmd`) if script execution is blocked.

### 1. Install Dependencies & Setup Environment
```bash
git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
npm install

# Optional: customize server port, host, or SQLite database path
cp .env.example .env
```

### 2. Build All Workspaces
```bash
npm run build
```

### 3. Run Tests
```bash
npm test
```
More than 100 unit and integration tests verify SMPTE drop frame boundaries, NLE XML/EDL formatting, CSV escaping, and Fastify SQLite WAL routes.

### Developer Workflow
| Command | What it does |
| --- | --- |
| `npm run check` | Lint, format check, typecheck and unit / integration tests |
| `npm run e2e` | Playwright end-to-end tests against the compiled server (run `build` first) |
| `npm run lint` | ESLint 10 (TypeScript + React hooks / React Compiler rules) |
| `npm run format` | Prettier (`format:check` to verify only) |
| `npm run typecheck` | `tsc -b` (shared, server) + client `tsc --noEmit` |
| `npm run build` | Incremental `tsc -b` + Vite production build of the client |
| `npm run clean` | Remove `tsc -b` outputs |
| `npm run backup` | Hot backup of the SQLite database (`-- <file>` to choose the destination) |

In development, `@streamcollab/shared` is resolved from its TypeScript sources through the `development` export condition (Vite, Vitest and `tsx --conditions=development`), so you never need to rebuild it while working. Production and Docker use the compiled `dist`.

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks plus `npm audit` on production dependencies, then builds the Docker image and smoke-tests it (health, client, room creation, graceful shutdown exit code).

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

### 4. Start Development Servers
In two terminal windows:

**Terminal 1 (Backend Server):**
```bash
npm run dev:server
# API and WebSocket server on port 3000
```

**Terminal 2 (Frontend Client):**
```bash
npm run dev:client
# Vite client on http://localhost:5173 (proxies /api and /ws to port 3000)
```

During development, open `http://localhost:5173/?view=dashboard`, and the Dock and HUD links copied from there point to port 5173.

### Production server from source
```bash
# Build once, then run the compiled server: it serves the API, the WebSocket hub
# and the compiled client from a single origin (http://localhost:3000)
npm run build
npm start
```
The server reads a `.env` file from the repository root if present, validates every variable at startup and exits with a clear message if something is wrong.

### 📂 Monorepo Architecture

```text
streamcollab/
├── packages/
│   ├── shared/            # Pure TypeScript shared logic
│   │   ├── src/
│   │   │   ├── timecode/  # SMPTE calculator with rational arithmetic & drop frame
│   │   │   ├── exporters/ # EDL, XML, CSV, YouTube Chapters, Multicam Matrix
│   │   │   ├── schemas/   # Zod schemas for every WebSocket message and REST body
│   │   │   └── types/     # Shared TS types & WebSocket message payloads
│   │   └── test/          # Timecode, exporter, and edge case test suites
│   │
│   ├── server/            # Fastify v5 WebSocket & REST Backend
│   │   ├── src/
│   │   │   ├── db/        # Node 24 native node:sqlite (DatabaseSync WAL mode)
│   │   │   ├── sntp/      # SNTP 4-timestamp clock engine (RTT & clock offset)
│   │   │   ├── rooms/     # RoomManager & multi-client broadcast dispatcher
│   │   │   ├── routes/    # REST API endpoints (/api/rooms, /api/export, etc.)
│   │   │   └── websocket/ # Real-time state synchronization
│   │   └── test/          # Integration tests for server, DB, and exporters
│   │
│   └── client/            # Vite 8 + React 19 + Tailwind CSS 4 Frontend
│       └── src/
│           ├── services/  # obs-websocket-js v5 wrapper & socket client
│           ├── components/# NLE Export Modal & UI widgets
│           ├── i18n/      # Spanish / English dictionaries
│           ├── index.css  # Tailwind CSS 4 entry and theme (@theme)
│           └── views/
│               ├── DockView.tsx      # OBS Custom Browser Dock
│               ├── HudView.tsx       # OBS Browser Source transparent overlay
│               └── DashboardView.tsx # Tournament Director command center
│
├── obs-scripts/
│   └── streamcollab-hotkeys.lua  # OBS global hotkeys → Dock (via obs-websocket)
│
├── docs/                  # Stream Deck guide and real-OBS test checklist (English / Spanish)
├── e2e/                   # Playwright end-to-end tests
├── deploy/Caddyfile       # HTTPS reverse proxy for docker-compose
├── Dockerfile             # Multi-stage production image
├── docker-compose.yml     # App + Caddy (automatic HTTPS / WSS)
├── .github/workflows/ci.yml  # Lint, format, typecheck, test, build, Docker smoke test
├── .env.example           # Environment template
├── package.json           # npm workspaces monorepo configuration
├── tsconfig.json          # Solution file: `tsc -b` builds shared -> server
├── tsconfig.base.json
├── eslint.config.mjs      # ESLint 10 flat config (typescript-eslint, react-hooks)
├── .prettierrc.json
├── playwright.config.ts
└── vitest.config.ts
```

### 🧪 Testing & Verification

StreamCollab maintains an automated suite of **216 tests** (201 Vitest unit/integration tests across 23 test suites + 15 Playwright end-to-end tests across real multi-streamer flows):
```bash
npm test       # 201 Vitest tests across 23 suites
npm run e2e    # 15 Playwright E2E tests (real multi-window Chromium flow)
```
- `packages/shared/test/timecode.test.ts`: SMPTE arithmetic, 60 fps NDF, 29.97 DF, 59.94 DF, 24 fps, minute-mark frame skipping.
- `packages/shared/test/timecode-proptest.test.ts`: Property-based testing (`fast-check`) verifying bijectivity across all 8 standard framerates, drop-frame minute boundaries, sub-ms rational math, and 24h rollover.
- `packages/shared/test/exporters.test.ts`: DaVinci CMX 3600 EDL formatting, FCP 7 XML, RFC 4180 CSV, YouTube chapters, and Multicam Sync Matrix.
- `packages/shared/test/exporters-conformance.test.ts`: Strict CRLF conformance in EDL, DOMParser FCP XML 1.0 schema parsing, control character stripping, and CSV formula fuzzing.
- `packages/shared/test/edge-cases.test.ts`: Zero markers, XML/CSV escaping, YouTube 10s chapter clustering, >24h timecode rollover.
- `packages/shared/test/perMember.test.ts`: Per-POV timeline rebasing and EDL locators on the creator's own file.
- `packages/shared/test/regressions.test.ts`: YouTube chapters opening at 00:00, CSV formula neutralization, accent folding in EDL titles, drop-frame only at 29.97 / 59.94, framerate validation.
- `packages/server/test/server.test.ts`: Fastify routes, Node 24 native `node:sqlite` WAL mode, SNTP 4-timestamp clock offset and RTT engine.
- `packages/server/test/db-concurrency.test.ts`: 20 concurrent workers executing 2,000 writes/sec with simultaneous live database hot backup under WAL contention.
- `packages/server/test/crash-recovery.test.ts`: Startup reconciliation of unstopped sessions left active after an abrupt crash or server kill.
- `packages/server/test/markers.test.ts`: Marker editing / deletion permissions and broadcasts, undo (WebSocket and HTTP), session history.
- `packages/server/test/audit.test.ts`: Case-insensitive room codes, member presence and removal, session / room deletion, per-IP limit on unknown room codes.
- `packages/server/test/backup.test.ts`: Hot backups of a live database (including WAL writes), never overwriting existing files.
- `packages/server/test/deploy.test.ts`: Environment validation, serving the compiled client (SPA fallback, cache headers, no path traversal), security headers, API-only mode.
- `packages/server/test/security.test.ts`: Host / member tokens, spoofing attempts, cross-room access, Zod validation errors, CORS, REST and WebSocket rate limits, oversized frames.
- `packages/server/test/ws.test.ts`: Real-socket WebSocket rooms (Dock + HUD with the same member id), heartbeat, calibrated marker timestamps, recording anchors, per-POV exports, and in-place migration of v1.0.0 databases.
- `packages/server/test/ws-chaos.test.ts`: Rate limit burst flooding, reconnect storms with 30 sockets, 16KB/40KB oversized payloads, malformed JSON fuzzing, 15s unjoined socket timeout.
- `packages/server/test/regressions.test.ts`: Membership in several rooms, one running session per room, room state between sessions, unsupported framerates, schema migration v3 → v4.
- `packages/client/test/obs.test.ts`: Native OBS chapter detection, recording-only writes and error reporting, automatic reconnection backoff (with a stubbed obs-websocket).
- `packages/client/test/obs-integration.test.ts`: OBS WebSocket v5 protocol integration (start/pause/resume/stop lifecycle, dynamic canvas FPS changes, Lua hotkey signal deduplication, chapter fallback).
- `packages/client/test/socket.test.ts`: The Dock sends nothing to a room until the server confirms the join, and stops when the room is gone or the connection drops.
- `packages/client/test/sntp-resilience.test.ts`: 4-ping initial calibration burst, jitter spike outlier rejection, duplicate disconnect event prevention, and exponential backoff.
- `packages/client/test/i18n-sound.test.ts`: Spanish / English dictionaries in sync (keys and placeholders), interpolation, HUD sound options and cues.

**End-to-end (Playwright):** `npm run build` then `npm run e2e`. Starts the compiled server on port 3210 with a throwaway database and drives real Chromium windows as separate identities (host, streamer dock, HUD, viewer): session start, hotkeys and undo, HUD toasts, the HUD preview's way back, editing / deleting markers, session history and exports, wrong room codes, language and HUD sound, narrow docks (300px/360px), multi-streamer squad synchronization, all 5 export format downloads, and the Dock losing and regaining the server connection. OBS's WebSocket is mocked, so the run never touches an OBS open on the same machine. Run `npx playwright install chromium` once before the first run.

**With real OBS:** follow the checklist in [docs/local-testing.md](docs/local-testing.md) (no VPS needed).

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for more information.
