# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-20

### Added
- **Room codes and host tokens**: `POST /api/rooms` generates an unguessable code (e.g. `KQ7P-M3XD`) and returns a host token once; only its SHA-256 hash is stored. Starting / stopping sessions (WebSocket and REST) requires the host token.
- **Member tokens**: the first dock to claim a member id receives a member token (`JOINED` message); later joins with that id must present it. The HTTP `quick-mark` endpoint requires `Authorization: Bearer <memberToken>`.
- **Shared Zod schemas** (`@streamcollab/shared` `schemas/`) for every WebSocket message and REST body: category / DaVinci color enums, timecode format, length limits.
- Rate limits: `@fastify/rate-limit` on room creation (10/min) and quick-mark (60/min); per-socket token bucket on WebSocket messages (burst 40, 20/s).
- `maxPayload` 16 KB for WebSocket frames and 64 KB REST body limit.
- Director Panel *room setup*: create room, copy Dock / HUD invite links, copy or paste the host token. Dock settings: copy the HTTP marker token.
- New server messages `JOINED` and coded `ERROR`s (`ROOM_NOT_FOUND`, `FORBIDDEN`, `HOST_TOKEN_INVALID`, `MEMBER_TOKEN_INVALID`, `INVALID_MESSAGE`, `NOT_JOINED`, `RATE_LIMITED`), surfaced in a client banner.
- Env vars `ALLOWED_ORIGIN`, `ADMIN_TOKEN`, `TRUST_PROXY`. Schema migration v3 (`host_token_hash`, `token_hash`).
- `security.test.ts` (18 tests, 80 total).

### Changed
- **Breaking:** joining an unknown room returns `ROOM_NOT_FOUND` instead of creating it; the client no longer defaults to `squad-1` and remembers the last room instead.
- **Breaking:** CORS is same-origin only unless `ALLOWED_ORIGIN` is set (was `*`). `GET /api/rooms` is hidden unless `ADMIN_TOKEN` is configured.
- WebSocket actions use the identity proven at join time: `roomId` / `memberId` / `memberName` in payloads are ignored, and HUD / dashboard observers can't create markers or update status.
- Internal error details are no longer echoed to WebSocket clients.

### Fixed
- A session id from another room could be stopped, exported or listed through a different room's endpoints.
- Closing sockets during server shutdown wrote to an already-closed database.
- A dock that lost its member token now continues under a fresh member id instead of being locked out.

## [1.1.0] - 2026-10-20

### Added
- **Global OBS hotkeys** (`obs-scripts/streamcollab-hotkeys.lua`): five frontend hotkeys (Kill, Squad Wipe, Clutch, Funny, Note) bindable in OBS *Settings → Hotkeys* that work while the game has focus. The script signals the Dock through the `StreamCollab Signal` input and obs-websocket `InputSettingsChanged`.
- **Per-POV exports**: `GET /api/rooms/:id/export/:format?memberId=…` re-times every marker against that streamer's own OBS recording file (new shared `rebaseSessionForMember`). The Export modal has a *Timeline* selector for it.
- **Recording anchors**: the Dock reports `recordStartedAt` (calibrated server time when its OBS file began; re-anchored after pause) and exact `fpsNumerator/fpsDenominator`, stored per session in the new `session_members` table.
- **WebSocket heartbeat**: server pings every 15 s and terminates sockets that don't answer, so crashed or dropped clients are marked disconnected.
- `clientKind` (`dock` | `hud` | `dashboard`) in `JOIN_ROOM`; HUD overlays and dashboards join as read-only observers.
- `socketClient.on(event, handler)` multi-listener subscriptions in the client.
- SQLite schema migrations via `PRAGMA user_version` (v1.0.0 databases upgrade in place) and cached prepared statements.
- 15 new tests (61 total): real-socket WebSocket integration, heartbeat, timestamp clamping, per-POV EDL, sync matrix anchors, legacy DB migration, Content-Disposition.

### Changed
- Markers are stamped with the client's SNTP-calibrated keypress time (`clientTimestamp`, clamped to −10 s/+1 s of arrival) instead of server receipt time, and carry `obsRecordMs` (exact position in the marker author's own file).
- **Multicam Sync Matrix**: `sessionOffsetMs` is now the real offset `recordStartedAt − session.startedAt` (previously it echoed the SNTP clock offset). New fields `aligned`, `recordStartedAt`, `clockOffsetMs`. The Export modal loads the matrix from the server so anchors are included.
- Nav bar name / room inputs apply on blur or Enter instead of reconnecting on every keystroke.
- Export filenames use an ASCII `filename` plus RFC 5987 `filename*`, stripping quotes, slashes and Windows-invalid characters.

### Fixed
- Joining a room that doesn't exist (e.g. the default `squad-1` on a fresh database) failed on the members foreign key and the client never received `ROOM_STATE`. Rooms are now created on first join.
- The Dock and the HUD Browser Source of the same streamer (same member id) replaced each other on the server, so one of them stopped receiving events; the HUD also appeared as a squad player.
- HUD toasts never appeared because `App` overwrote the HUD's `onMarkerAdded` callback.
- The Dock reconnected to OBS every time the video settings arrived.
- Intentionally closing the client socket scheduled a ghost reconnect.

## [1.0.0] - 2026-10-20

### Added

#### `@streamcollab/shared`
- **SMPTE Timecode Engine**:
  - High-precision rational arithmetic (`RationalTimecode`) to prevent floating-point timecode drift over multi-hour broadcasts.
  - True SMPTE Drop-Frame (DF) and Non-Drop-Frame (NDF) calculation with correct minute-mark frame skipping for 29.97 fps and 59.94 fps.
  - Full support for industry framerates: 60, 59.94 (60000/1001), 50, 30, 29.97 (30000/1001), 25, 24, and 23.976 (24000/1001) fps.
  - Configurable base timecode offsets (e.g., `00:00:00:00` or `01:00:00:00`) with bidirectional frame-to-timecode and timecode-to-frame conversion.
- **NLE Exporters Suite**:
  - **DaVinci Resolve CMX 3600 EDL**: Generates sample-accurate 1-frame edit events (`001`, `002`...) with CRLF line terminators and native `* LOC:` color-mapped markers (Red, Fuchsia, Yellow, Cyan, Blue).
  - **Adobe Premiere Pro FCP 7 XML (`xmeml` v4)**: Strict Apple XML interchange format with `<format><samplecharacteristics>` video format blocks and track-level `<marker>` tags prefixed with category headers and author comments.
  - **Universal RFC 4180 CSV**: Clean CSV export with proper escaping for quotes, commas, and line breaks for Markerbox, Google Sheets, and Microsoft Excel.
  - **YouTube Video Chapters**: Clean description chapter format (`00:00 Intro\n...`) enforcing YouTube's 10-second minimum interval guidelines.
  - **Multicam Sync Matrix JSON**: Calculates clock calibration offsets, frame alignments, and session start deltas across all squad creator feeds.
- **Shared Data Contracts & Schemas**:
  - Strongly-typed TypeScript interfaces and WebSocket event payloads (`RoomState`, `SquadMember`, `Marker`, `RecordingStatus`, `TimecodeSettings`, `SntpPayload`, `ClientToServerEvents`, `ServerToClientEvents`).

#### `@streamcollab/server`
- **Fastify v5 Architecture**:
  - High-throughput REST and WebSocket backend using Fastify v5, `@fastify/websocket` v11, and `@fastify/cors`.
  - Room management (`RoomManager`) with broadcast dispatching, creator heartbeat monitoring, and automatic room teardown.
- **Native Node 24 SQLite Storage**:
  - Native Node 24 `node:sqlite` (`DatabaseSync`) configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and `synchronous = NORMAL` for zero-dependency, ultra-fast persistence.
  - Relational schema for rooms, recording sessions, and squad markers with indexed queries.
- **SNTP 4-Timestamp Clock Engine**:
  - Sub-millisecond Round Trip Time (RTT) and clock skew estimation ($\theta = \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$) between streamers' PCs and the central server to align multicam timelines across distributed physical setups.
- **REST API Endpoints**:
  - `/api/health`: Liveness probe.
  - `/api/rooms`: Create, query, and manage collaborative rooms.
  - `/api/rooms/:roomId/session/start` & `/api/rooms/:roomId/session/stop`: Session lifecycle management.
  - `/api/rooms/:roomId/quick-mark`: Instant marker ingestion via HTTP.
  - `/api/rooms/:roomId/markers`: Query marker history.
  - `/api/rooms/:roomId/export/:format`: Dynamic export generation (`edl`, `xml`, `csv`, `youtube`, `matrix`) working during and after active recording sessions.

#### `@streamcollab/client`
- **OBS Studio Native Custom Browser Dock (`?view=dock`)**:
  - Direct connection to OBS Studio via `obs-websocket-js` v5 (`ws://127.0.0.1:4455`).
  - Auto-queries canvas video settings (`GetVideoSettings`) and live recording duration (`GetRecordStatus`).
  - Hotkeys (`1`..`5`) mapped to standard squad events:
    - `1` 🎯 Kill (Red)
    - `2` 💥 Squad Wipe (Fuchsia)
    - `3` 🏆 Clutch Play (Yellow)
    - `4` 😂 Funny Moment (Cyan)
    - `5` 📝 Timeline Note (Blue)
  - Custom comment input and live reverse-chronological marker history with SMPTE timecode readout.
- **OBS Studio Browser Source HUD Overlay (`?view=hud`)**:
  - Transparent overlay (`bg-transparent`) optimized for 1920x1080 OBS Browser Sources.
  - 60 FPS GPU-accelerated animated alert toasts with sound cues sliding in on highlight events.
  - Real-time squad status HUD badge displaying live recording states (🔴 REC, ⏸️ PAUSED, ⚪ IDLE) for each squad member.
  - OBS event hook for `obsSourceVisibleChanged` to automatically throttle timers and halt rendering when hidden, saving GPU overhead for competitive gaming.
- **Tournament Director Dashboard (`?view=dashboard`)**:
  - Centralized command center to monitor all squad members' recording status, timecodes, and clock synchronization health.
  - Start/stop global recording sessions and trigger one-click NLE exports.
- **NLE Export Modal**:
  - Intuitive dialog to preview and download DaVinci Resolve EDL, Premiere Pro XML, Universal CSV, Multicam Sync Matrix, or copy YouTube Chapters directly to clipboard.

#### Configuration & Developer Experience
- **Environment & Build Configuration**:
  - Added `.env.example` template for server port, host, database path, and OBS credentials.
  - Added dedicated `vitest.config.ts` with V8 coverage reporters and workspace glob patterns.
  - Added root `npm start` script for running the compiled Fastify production server.

### Fixed
- Fixed SMPTE integer truncation on sub-frame rational calculations.
- Fixed FCP 7 XML sequence duration calculation and DTD compliance with sequence-level markers.
- Fixed exporter access after session stop to allow post-broadcast timeline generation.
- Fixed route navigation handling for both query string (`?view=dock`) and hash routing (`#/dock`).

[Unreleased]: https://github.com/Consterna/streamcollab/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Consterna/streamcollab/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Consterna/streamcollab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Consterna/streamcollab/releases/tag/v1.0.0

