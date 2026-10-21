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
  - 🛰️ **Multicam Sync Matrix JSON**: Calculates clock calibration offsets, frame alignments, and session start deltas across all squad creator feeds.

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
│   └── client/            # Vite 6 + React 19 + Tailwind CSS Frontend
│       ├── src/
│       │   ├── services/  # obs-websocket-js v5 wrapper & socket client
│       │   ├── components/# NLE Export Modal & UI widgets
│       │   └── views/
│       │       ├── DockView.tsx      # OBS Custom Browser Dock
│       │       ├── HudView.tsx       # OBS Browser Source transparent overlay
│       │       └── DashboardView.tsx # Tournament Director command center
│       └── tailwind.config.js
│
├── package.json           # npm workspaces monorepo configuration
├── tsconfig.base.json
└── vitest.config.ts
```

---

## 🛠️ Quick Start & Installation

### Prerequisites
- **Node.js**: v24 LTS (or higher) with native `node:sqlite` support
- **npm**: v11+
- **OBS Studio**: v28+ (WebSocket v5 is built into OBS Studio by default)

### 1. Install Dependencies
```powershell
# From the repository root (c:\dev\proyectos\streamcollab)
npm.cmd install
```

### 2. Build All Workspaces
```powershell
npm.cmd run build
```

### 3. Run Tests
```powershell
npm.cmd test
```
All 38 unit and integration tests verify SMPTE drop frame boundaries, NLE XML/EDL formatting, CSV escaping, and Fastify SQLite WAL routes.

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
3. **URL**: `http://localhost:5173/?view=dock` (or `http://localhost:5173/#/dock`)
4. Click **Apply**.
5. The dock will open as a window inside OBS Studio. Drag and drop it into your OBS workspace (e.g. next to the Audio Mixer or Scene list).
6. Click **OBS Disconnected** -> verify `ws://127.0.0.1:4455` -> click **Connect**.
7. The status turns to a green **OBS Linked** dot, displaying your live canvas resolution, framerate, and recording status.

### 3. Add the OBS Browser Source (HUD Overlay)
1. In your active OBS Scene, click **Add Source (+)** -> **Browser**.
2. Name it `StreamCollab HUD`.
3. Configure settings:
   - **URL**: `http://localhost:5173/?view=hud` (or `http://localhost:5173/#/hud`)
   - **Width**: `1920`
   - **Height**: `1080`
   - **Custom CSS**: (leave default or clear, background is already transparent)
   - **Shutdown source when not visible**: Checked (optional, built-in visibility listener handles it automatically)
4. Click **OK**.
5. When any squadmate presses a hotkey (`1`..`5`) or marks an event, a glowing alert badge will animate on-stream with sound cues, creator credit, and SMPTE timecode.

### 4. Tournament Director Panel
- Access via any browser: `http://localhost:5173/?view=dashboard`
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
- `packages/server/test/server.test.ts`: Fastify routes, Node 24 native `node:sqlite` WAL mode, SNTP 4-timestamp clock offset and RTT engine.

---

## 📜 License
MIT License. Created for the stream and video editing community.
