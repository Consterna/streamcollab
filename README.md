# 🎮 StreamCollab — OBS Squad-Marker & Live Multicam HUD

> **High-Precision Collaborative Squad Marker & Multicam Sync System for OBS Studio & Professional NLEs (DaVinci Resolve, Adobe Premiere Pro, YouTube).**

StreamCollab allows competitive gaming squads, content creator groups, and esports tournament directors to coordinate multicam recordings in real-time. Creators can instantly mark epic kills, squad wipes, clutches, and funny moments with 1-click hotkeys right inside OBS Studio. When the session ends, StreamCollab generates **sample-accurate NLE timeline markers and multicam sync matrices** ready for video editors.

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
  - **Global hotkeys while gaming** via the bundled OBS Lua script (`obs-scripts/streamcollab-hotkeys.lua`), bindable in OBS *Settings → Hotkeys*.
  - Inline custom label / comment text input.
  - Live reverse-chronological marker history with SMPTE timecode.

- **OBS Browser Source HUD (Transparent 60 FPS Overlay)**:
  - Transparent gaming overlay (`bg-transparent`) optimized for OBS Studio Browser Sources.
  - 60 FPS GPU-accelerated animated alert toasts that slide into the stream when any squadmate records a highlight.
  - Real-time squad status HUD badge showing each creator's live OBS recording health (🔴 REC, ⏸️ PAUSED, ⚪ IDLE).
  - **Resource Optimization**: Hooks into OBS's native `obsSourceVisibleChanged` event to throttle timers and suspend heavy CSS animations when the source/scene is hidden, preserving 100% GPU performance for gaming.

- **High-Precision SMPTE Timecode Engine**:
  - Pure rational arithmetic avoiding floating-point drift over multi-hour broadcasts.
  - Full support for standard framerates: `60 fps`, `59.94 fps` (60000/1001), `50 fps`, `30 fps`, `29.97 fps` (30000/1001), `25 fps`, `24 fps`, and `23.976 fps` (24000/1001).
  - True SMPTE Drop Frame (DF) & Non-Drop Frame (NDF) calculation with correct minute-mark frame skipping.
  - Configurable base timecode offsets (e.g. `01:00:00:00` or `00:00:00:00`).

- **NLE Exporter Suite**:
  - 🎬 **DaVinci Resolve CMX 3600 EDL**: Strict CRLF line endings, sequential 1-frame edit events (`001`, `002`...), and `* LOC:` locator syntax mapped to native DaVinci marker colors (Red, Fuchsia, Yellow, Cyan, Blue, Green).
  - 🎞️ **Adobe Premiere Pro FCP 7 XML (`xmeml` v4)**: Valid Final Cut Pro 7 XML with complete `<format><samplecharacteristics>` video format blocks and track-level `<marker>` tags prefixed with category identifiers.
  - 📊 **Universal CSV**: RFC 4180 compliant CSV compatible with Google Sheets, Microsoft Excel, and Markerbox.
  - 📺 **YouTube Video Chapters**: Clean description chapter format (`00:00 Intro\n01:23 First Blood`) adhering to YouTube's 10-second minimum interval guidelines.
  - 🛰️ **Multicam Sync Matrix JSON**: Where each creator's OBS file starts relative to the session (ms and frames), from SNTP-calibrated recording anchors.
  - 🎥 **Per-POV timelines**: Any format can be exported re-timed to one creator's own recording file (`?memberId=`), so markers land on the right frame of that clip.

- **Private Rooms & Host Control**:
  - Rooms are created explicitly and identified by an unguessable join code (e.g. `KQ7P-M3XD`).
  - Only the host (holder of the room's host token) can start or stop sessions; each streamer's dock is bound to its own member token, so nobody can mark or update status in someone else's name.
  - Every WebSocket message and REST body is validated with shared Zod schemas; per-socket and per-route rate limits.

- **High-Concurrency Fastify Backend & SQLite WAL**:
  - Fastify v5 with `@fastify/websocket` v11 and `@fastify/cors`.
  - Native Node 24 `node:sqlite` (`DatabaseSync`) configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and normal synchronous mode for maximum throughput.
  - **SNTP 4-Timestamp Engine**: Sub-millisecond RTT & clock offset calibration ($\theta = \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$) between streamers' PCs and the server.

---

## 📂 Monorepo Architecture

```text
streamcollab/
├── packages/
│   ├── shared/            # Pure TypeScript shared logic
│   │   ├── src/
│   │   │   ├── timecode/  # SMPTE calculator with rational arithmetic & drop frame
│   │   │   ├── exporters/ # EDL, XML, CSV, YouTube Chapters, Multicam Matrix
│   │   │   └── types/     # Shared TS schemas & WebSocket message payloads
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
│       ├── src/
│       │   ├── services/  # obs-websocket-js v5 wrapper & socket client
│       │   ├── components/# NLE Export Modal & UI widgets
│       │   └── views/
│       │       ├── DockView.tsx      # OBS Custom Browser Dock
│       │       ├── HudView.tsx       # OBS Browser Source transparent overlay
│       │       └── DashboardView.tsx # Tournament Director command center
│       └── tailwind.config.js
│
├── obs-scripts/
│   └── streamcollab-hotkeys.lua  # OBS global hotkeys → Dock (via obs-websocket)
│
├── deploy/Caddyfile       # HTTPS reverse proxy for docker-compose
├── Dockerfile             # Multi-stage production image
├── docker-compose.yml     # App + Caddy (automatic HTTPS / WSS)
├── .github/workflows/ci.yml  # Lint, format, typecheck, test, build, Docker smoke test
├── .env.example           # Environment template (PORT, HOST, DATABASE_PATH)
├── package.json           # npm workspaces monorepo configuration
├── tsconfig.json          # Solution file: `tsc -b` builds shared -> server
├── tsconfig.base.json
├── eslint.config.mjs      # ESLint 10 flat config (typescript-eslint, react-hooks)
├── .prettierrc.json
└── vitest.config.ts
```

---

## 🛠️ Quick Start & Installation

### Prerequisites
- **Node.js**: v24 LTS (or higher) with native `node:sqlite` support
- **npm**: v11+
- **OBS Studio**: v28+ (WebSocket v5 is built into OBS Studio by default)

### 1. Install Dependencies & Setup Environment
```powershell
# From the repository root (c:\dev\proyectos\streamcollab)
npm.cmd install

# Optional: customize server port, host, or SQLite database path
Copy-Item .env.example .env
```

### 2. Build All Workspaces
```powershell
npm.cmd run build
```

### 3. Run Tests
```powershell
npm.cmd test
```
All 90 unit and integration tests verify SMPTE drop frame boundaries, NLE XML/EDL formatting, CSV escaping, and Fastify SQLite WAL routes.

### Developer Workflow
| Command | What it does |
| --- | --- |
| `npm.cmd run check` | Everything CI runs: lint, format check, typecheck and tests |
| `npm.cmd run lint` | ESLint 10 (TypeScript + React hooks / React Compiler rules) |
| `npm.cmd run format` | Prettier (`format:check` to verify only) |
| `npm.cmd run typecheck` | `tsc -b` (shared, server) + client `tsc --noEmit` |
| `npm.cmd run build` | Incremental `tsc -b` + Vite production build of the client |
| `npm.cmd run clean` | Remove `tsc -b` outputs |

In development, `@streamcollab/shared` is resolved from its TypeScript sources through the `development` export condition (Vite, Vitest and `tsx --conditions=development`), so you never need to rebuild it while working. Production and Docker use the compiled `dist`.

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks plus `npm audit` on production dependencies, then builds the Docker image and smoke-tests it (health, client, room creation, graceful shutdown exit code).

### 4. Start Development Servers
In two terminal windows:

**Terminal 1 (Backend Server):**
```powershell
npm.cmd run dev:server
# Server starts on http://127.0.0.1:3000
```

**Terminal 2 (Frontend Client):**
```powershell
npm.cmd run dev:client
# Vite client starts on http://localhost:5173
```

### 5. Production Server (Optional)
```powershell
# Build once, then run the compiled server: it serves the API, the WebSocket hub
# and the compiled client from a single origin (http://localhost:3000)
npm.cmd run build
npm.cmd start
```
The server reads a `.env` file from the repository root if present, validates every variable at startup and exits with a clear message if something is wrong.

---

## 🚢 Deploy on a VPS (Docker + HTTPS)

The repository ships a multi-stage `Dockerfile` (Node 24, production dependencies only, non-root user, healthcheck on `/api/health`) and a `docker-compose.yml` that puts [Caddy](https://caddyserver.com) in front for automatic HTTPS and WSS.

1. Point a DNS record (e.g. `collab.example.com`) at the VPS and open ports 80 and 443.
2. On the VPS:
   ```bash
   git clone <your repo> streamcollab && cd streamcollab
   cp .env.example .env    # set DOMAIN=collab.example.com (and ADMIN_TOKEN if you want the room list)
   docker compose up -d --build
   ```
3. Open `https://collab.example.com/dashboard`, create a room and share the Dock / HUD links.

Operations:
- **Data**: SQLite lives in the `streamcollab-data` volume (`/data/streamcollab.sqlite`). To back it up, stop the app (the graceful shutdown folds the WAL into the main file) and copy it out:
  ```bash
  docker compose stop streamcollab
  docker compose cp streamcollab:/data/streamcollab.sqlite ./streamcollab-backup.sqlite
  docker compose start streamcollab
  ```
- **Updates**: `git pull && docker compose up -d --build`. Schema migrations run automatically on startup.
- **Shutdown**: `docker compose stop` sends SIGTERM; the server closes sockets, checkpoints the SQLite WAL and exits (15 s grace period).
- **Logs**: `docker compose logs -f streamcollab` (`LOG_LEVEL` controls verbosity).

### If the Dock can't reach OBS (Chrome "Local Network Access")
The Dock talks to OBS on `ws://127.0.0.1:4455` from your PC. Recent Chrome versions ask for permission when a public HTTPS site opens connections to `localhost`, and an OBS Custom Browser Dock may not be able to show that prompt once OBS ships a Chromium with this rule. If the Dock loaded from your domain stays on **OBS Disconnected**:
1. Serve the Dock locally next to OBS (for example `npm.cmd run build` then `npm.cmd run preview --workspace=packages/client`, which serves `http://localhost:4173`).
2. Use the Dock URL with a `server` parameter so it still joins the room on your VPS:
   `http://localhost:4173/?view=dock&room=<CODE>&server=https://collab.example.com`
3. Add that local origin to `ALLOWED_ORIGIN` on the server (e.g. `ALLOWED_ORIGIN=http://localhost:4173`).

The HUD and Director Panel never talk to OBS's WebSocket, so they can always be loaded from the public domain.

---

## 🔐 Rooms, Hosts & Security

1. **The host creates a room** in the Director Panel (`/?view=dashboard`) -> **New room** -> **Create**. The server returns a room code and a **host token**; the token is stored in that browser and only its SHA-256 hash is kept on the server.
2. **Invite the squad** with the copy buttons: the Dock URL (`/?view=dock&room=<CODE>`) and HUD URL (`/?view=hud&room=<CODE>`). The room code is the invite, so share it only with your squad.
3. **Moving host control** to another device: copy the host token from *You are the host* and paste it in *Viewing only -> Unlock* on the other device.
4. **Streamer identity**: the first time a dock joins, the server issues a member token bound to that dock's member id (stored in the OBS browser profile). If a dock loses it, it rejoins automatically under a new member id.

| Action | Who can do it |
| --- | --- |
| View room, markers, exports | Anyone with the room code |
| Create markers, update OBS status | The streamer's own dock (member token) |
| Start / stop sessions | The host (host token) |
| List all rooms (`GET /api/rooms`) | Admin only (`ADMIN_TOKEN`), hidden otherwise |

**HTTP quick-mark (Stream Deck / Streamer.bot):** in the Dock, open the OBS settings panel and copy the *HTTP token*, then:
```http
POST /api/rooms/<CODE>/quick-mark
Authorization: Bearer <member token>
Content-Type: application/json

{ "memberId": "<your member id>", "category": "kill", "label": "Ace" }
```

**Server environment variables** (see `.env.example`):
- `ALLOWED_ORIGIN`: comma-separated origins allowed to call the REST API cross-origin. Leave empty when the client is served from the same host (default).
- `ADMIN_TOKEN`: enables `GET /api/rooms` for `Authorization: Bearer <ADMIN_TOKEN>` (16+ characters).
- `TRUST_PROXY`: `true` behind a reverse proxy (Caddy / Nginx) so rate limits use the real client IP.

Rooms created with v1.0/v1.1 have no host token: they stay readable and markable but sessions can't be started or stopped there. Create a new room.

---

## 🎥 OBS Studio Setup Guide

### 1. Enable OBS WebSocket Server
1. In OBS Studio, open **Tools** -> **WebSocket Server Settings**.
2. Check **Enable WebSocket server**.
3. Server Port: `4455` (default).
4. If you enable authentication, take note of your password (you can input it in the StreamCollab Dock settings).
5. Click **Apply** -> **OK**.

### 2. Add the OBS Custom Browser Dock
1. In OBS Studio top menu, click **Docks** -> **Custom Browser Docks...**
2. **Dock Name**: `StreamCollab Squad Marker`
3. **URL**: the Dock link from the Director Panel, e.g. `http://localhost:5173/?view=dock&room=KQ7P-M3XD`
4. Click **Apply**.
5. The dock will open as a window inside OBS Studio. Drag and drop it into your OBS workspace (e.g. next to the Audio Mixer or Scene list).
6. Click **OBS Disconnected** -> verify `ws://127.0.0.1:4455` -> click **Connect**.
7. The status turns to a green **OBS Linked** dot, displaying your live canvas resolution, framerate, and recording status.

### 3. Global Hotkeys While Gaming (Recommended)
The Dock's `1`..`5` keys only work while the Dock has focus. To mark from inside your game:
1. In OBS Studio, open **Tools** -> **Scripts** -> **+** and select `obs-scripts/streamcollab-hotkeys.lua` from this repository.
2. Open **Settings** -> **Hotkeys**, search for `StreamCollab` and bind *Kill*, *Squad Wipe*, *Clutch Play*, *Funny Moment* and *Timeline Note*.
3. Keep the StreamCollab Dock open and linked to OBS. Each hotkey press updates the hidden `StreamCollab Signal` input; the Dock receives it through obs-websocket and creates the marker.

The script creates the `StreamCollab Signal` input automatically. It is never added to a scene, so nothing is rendered.

### 4. Add the OBS Browser Source (HUD Overlay)
1. In your active OBS Scene, click **Add Source (+)** -> **Browser**.
2. Name it `StreamCollab HUD`.
3. Configure settings:
   - **URL**: the HUD link from the Director Panel, e.g. `http://localhost:5173/?view=hud&room=KQ7P-M3XD`
   - **Width**: `1920`
   - **Height**: `1080`
   - **Custom CSS**: (leave default or clear, background is already transparent)
   - **Shutdown source when not visible**: Checked (optional, built-in visibility listener handles it automatically)
4. Click **OK**.
5. When any squadmate presses a hotkey (`1`..`5`) or marks an event, a glowing alert badge will animate on-stream with sound cues, creator credit, and SMPTE timecode.

### 5. Tournament Director Panel
- Access via any browser: `http://localhost:5173/?view=dashboard`
- Create the room (you become its host) and copy the Dock / HUD invite links.
- Start master recording sessions, customize base timecodes and framerates (60, 59.94 DF, 50, 30, 24 fps), monitor all squad members' recording duration and clock calibration, and export NLE timelines in 1 click.

---

## 🎬 Importing Markers into NLEs

### DaVinci Resolve
1. In StreamCollab Dock or Director Panel, click **Export NLE** -> select **DaVinci Resolve**.
2. Click **Download File** (`.edl`).
3. In DaVinci Resolve:
   - Go to **File** -> **Import** -> **Timeline...** (or right-click timeline -> **Timelines** -> **Import** -> **EDL/XML...**).
   - Select the downloaded `.edl` file.
   - DaVinci Resolve will create timeline markers with native colors corresponding to each event type (Red for Kills, Fuchsia for Wipes, Yellow for Clutches, Cyan for Funny, Blue for Notes).

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

Known limitation: if a creator pauses their recording, squadmates' markers made *before* the pause may shift in that creator's POV export (their own markers stay exact).

### YouTube Chapters
1. Click **Export NLE** -> select **YouTube Chapters**.
2. Click **Copy Code**.
3. Paste directly into your YouTube video description. The exporter automatically ensures a `00:00` start and enforces YouTube's 10-second minimum chapter interval.

---

## 🧪 Testing & Verification

The project includes unit and integration tests across the monorepo:
```powershell
npm.cmd test
```
- `packages/shared/test/timecode.test.ts`: SMPTE arithmetic, 60 fps NDF, 29.97 DF, 59.94 DF, 24 fps, minute-mark frame skipping.
- `packages/shared/test/exporters.test.ts`: DaVinci CMX 3600 EDL formatting, FCP 7 XML, RFC 4180 CSV, YouTube chapters, and Multicam Sync Matrix.
- `packages/shared/test/edge-cases.test.ts`: Zero markers, XML/CSV escaping, YouTube 10s chapter clustering, >24h timecode rollover.
- `packages/shared/test/perMember.test.ts`: Per-POV timeline rebasing and EDL locators on the creator's own file.
- `packages/server/test/server.test.ts`: Fastify routes, Node 24 native `node:sqlite` WAL mode, SNTP 4-timestamp clock offset and RTT engine.
- `packages/server/test/deploy.test.ts`: Environment validation, serving the compiled client (SPA fallback, cache headers, no path traversal), security headers, API-only mode.
- `packages/server/test/security.test.ts`: Host / member tokens, spoofing attempts, cross-room access, Zod validation errors, CORS, REST and WebSocket rate limits, oversized frames.
- `packages/server/test/ws.test.ts`: Real-socket WebSocket rooms (Dock + HUD with the same member id), heartbeat, calibrated marker timestamps, recording anchors, per-POV exports, and in-place migration of v1.0.0 databases.

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for more information.

