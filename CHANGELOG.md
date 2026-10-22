**English** | [Español](CHANGELOG.es.md)

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.1] - 2026-10-22

### Added
- Property-based testing with `fast-check` covering SMPTE timecode bijectivity across all 8 standard framerates (60, 59.94, 50, 30, 29.97, 25, 24, 23.976 fps), sub-ms rational math, 24-hour rollover, and drop-frame minute boundaries.
- Strict exporter conformance tests for CMX 3600 EDL (CRLF line endings, DaVinci Resolve color locators), Final Cut Pro 7 XML (XML 1.0 schema validity via DOMParser), and CSV formula injection fuzzing.
- High-concurrency database stress tests (20 concurrent workers, 2,000 writes/sec during hot backup, unstopped orphan session reconciliation on restart).
- WebSocket resilience and chaos testing (rate limit burst flooding, reconnect storms with 30 sockets, 16KB payloads, malformed JSON fuzzing, 15s unjoined connection timeout).
- Mock OBS WebSocket v5 integration suite testing full recording lifecycle (start/pause/resume/stop), dynamic canvas framerate changes, Lua hotkey signal deduplication, and chapter format error fallback.
- Extended Playwright E2E suite (`e2e/squad-extended.spec.ts`) validating multi-streamer squad synchronization, all 5 export format downloads (.edl, .xml, .csv, .txt, .json), and ultra-narrow OBS dock viewports (300px and 360px) in Spanish locale without overflow.
- Security policy (`SECURITY.md`), contributing guide (`CONTRIBUTING.md`) and GitHub issue / pull request templates.

### Changed
- **OBS CEF HUD performance:** Optimized toast cleaner state interval in `HudView.tsx` to preserve reference identity when no toasts expire, completely eliminating 5 idle re-renders per second in OBS CEF browser sources.
- **WebSocket resilience:** Added 4-ping initial SNTP calibration burst on connect, jitter spike outlier rejection (> 2.5x baseline and > 100ms), client exponential backoff up to 15s, and deduplicated `onConnectionChange` notifications while guaranteeing initial failure alerts.
- **SQLite concurrency & recovery:** Added `PRAGMA busy_timeout = 5000;` on all database connections and hot backup handles to eliminate `SQLITE_BUSY` contention, atomic multi-statement transactions with re-entrancy protection, and automatic orphan session reconciliation on server startup.
- **Docker image on GHCR:** `ghcr.io/consterna/streamcollab` (`linux/amd64`, `linux/arm64`). `docker-compose.yml` uses it by default (`STREAMCOLLAB_TAG`, with `build: .` as a fallback).
- GitHub Releases ship the OBS Lua script (`streamcollab-hotkeys.lua`), `SHA256SUMS` and a build provenance attestation.
- Documentation in English and Spanish (`README`, `CHANGELOG`, `docs/`); the README gains a user quick start (Docker, VPS) before the development guide.
- `engines.node >= 24`.
- Removing an offline member (`REMOVE_MEMBER`) now only takes them out of that room: their member id stays bound to their Dock, so no other device can claim it afterwards.

### Fixed
- **Timecode dropFrame in EDL and XML:** Fixed `tc.dropFrame` in `packages/shared/src/exporters/edl.ts` and `xml.ts` to use timecode drop-frame settings.
- **XML control character stripping:** Stripped XML 1.0 disallowed control characters (`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`) in `escapeXml` to prevent corrupt Final Cut Pro XML exports.
- **Member identity was global across rooms:** when a Dock joined another room, its streamer disappeared from the previous room, from that room's multicam sync matrix and from its HTTP quick-mark. Membership is now per room (schema migration v4); the Dock's identity and member token are shared by every room it joins.
- **YouTube chapters:** the first chapter could start after `00:00` (YouTube requires the first chapter at 00:00, at least 3 timestamps and chapters of 10 s or more). The export now always opens at `00:00`, and the Export dialog warns when there are fewer than 3 chapters.
- **EDL titles** lost accented letters ("Sesión" → "Sesin"); they are now folded to ASCII ("Sesion").
- **Non-standard framerates** produced `NaN` timecodes. Sessions now only accept the 8 supported rates (60, 59.94, 50, 30, 29.97, 25, 24 and 23.976 fps), with drop-frame only at 29.97 and 59.94, and a Dock that reports an impossible OBS framerate is rejected. The timecode engine no longer drops frames at integer 30 / 60 fps when drop-frame is requested (only NTSC rates drop frames); the Director Panel disables the drop-frame option for the other rates.
- **Orphaned sessions:** starting a session while another one was running left the previous one open, and it could not be deleted. The running session is now stopped first, and the migration closes existing orphans.
- Joining a room with no active session sent every marker of every session; it now sends the most recent session and its markers, which can still be exported after a reload.
- The Dock sent status updates before it had joined the room, and the translated "room does not exist / was deleted" notice was replaced every second by "Join a room first".
- The Dock didn't show that it had lost its connection to the server, and markers were lost silently. It now shows **Server disconnected** and warns about the marker that was not sent (its native OBS chapter, if enabled, is still written into your recording).
- The Director Panel's category filter had no `custom` option.
- The category in the Dock's marker history was not translated.
- The `1`–`5` and `0` shortcuts fired while a dropdown had focus.
- The favicon pointed at a missing `/vite.svg` (404).
- Un-hashed files of the client build (such as the favicon) were cached as immutable for 30 days; only hashed `/assets/` are now, the rest are revalidated.
- The error codes `FORBIDDEN`, `NOT_FOUND` and `INVALID_MESSAGE` were not translated.
- Unguarded `localStorage` access in OBS profiles where browser storage is blocked.

### Security
- CSV formula trigger regex hardened to `/^\s*[=+\-@|]|[\t\r]/`, preventing spreadsheet formula injection in Excel and Google Sheets.

## [1.6.0] - 2026-10-21

### Added
- **Spanish / English interface** with a selector in the navigation bar, `?lang=` links, browser-language detection, translated server errors and per-language default marker labels.
- **Optional HUD alert sounds** (`&sound=1&volume=0..1`), synthesized per category with Web Audio; "HUD with sound" invite link.
- **Automatic OBS reconnection** in the Dock (backoff 2 s → 30 s) and remembered OBS address / password per OBS profile.
- **Room cleanup for hosts:** remove offline members, delete finished sessions, delete the room (`DELETE /api/rooms/:id/sessions/:sid`, `DELETE /api/rooms/:id`, `REMOVE_MEMBER`).
- Member presence (`online`), shown as OFFLINE · "last seen" in the Director Panel; the on-stream HUD only lists online squadmates.
- **Hot backups:** `npm run backup` (SQLite `VACUUM INTO`, integrity-checked, never overwrites).
- **End-to-end tests** with Playwright (10 scenarios, OBS mocked) and a CI `e2e` job; `docs/local-testing.md` checklist for real OBS.
- `ROOM_CREATE_LIMIT_PER_MINUTE` setting.

### Changed
- Room codes are accepted in any letter case.
- `no-explicit-any` is an error in application code (SQLite rows are typed).
- README no longer claims unverifiable "60 FPS GPU" / "sub-millisecond" performance; documents the real sound feature.

### Fixed
- The generated default streamer name changed on every page load.
- Narrow OBS docks (≈420 px) pushed the room code, language selector and Undo button off-screen.
- Session modal labels were not associated with their inputs (accessibility).
- Offline members were shown as IDLE, like online ones.

### Security
- An IP that tries more than 20 unknown room codes per minute over WebSocket is refused for the rest of that minute.

## [1.5.1] - 2026-10-21

### Fixed
- Opening **OBS Overlay HUD** from the app's navigation left no way back (the HUD hides the navigation so it stays clean in OBS). It now opens as a preview with a floating **Back** button (also `Esc`) and a **Copy OBS link** button; the link used in OBS (`?view=hud&room=...`) still renders the bare overlay.
- Switching views now updates `?view=` in the URL instead of the `#` hash, so reloading keeps the current view and URLs like `?view=dock...#/hud` no longer contradict each other.

## [1.5.0] - 2026-10-21

### Added
- **Native OBS recording chapters**: the Dock writes each marker as a chapter into the streamer's own recording via `CreateRecordChapter` (obs-websocket 5.5 / OBS 30.2+, Hybrid MP4). Support is detected from `GetVersion.availableRequests`; rejected chapters (e.g. non-Hybrid MP4 format) are reported in the Dock settings. Optional: also write squadmates' markers. Preferences persist per device.
- **Undo**: `UNDO_LAST_MARKER` removes the dock's own most recent marker (resolved server-side). Dock Undo button, `0` / `Ctrl+Z`, a new "Undo my last marker" global hotkey in the OBS Lua script, and `POST /api/rooms/:id/markers/undo` for Stream Deck (member token).
- **Edit / delete markers**: `UPDATE_MARKER` (label, comment, category, color; timing is immutable; a new category brings its default DaVinci color) and `DELETE_MARKER`, allowed for the author's dock or the room host. Broadcast as `MARKER_UPDATED` / `MARKER_DELETED`. Inline edit / delete on Director Panel timeline rows for the host.
- **Session history**: `GET /api/rooms/:id/sessions` (newest first, with marker counts) and a Session History card in the Director Panel to review, edit and export past sessions.
- `docs/stream-deck.md`: Stream Deck, Streamer.bot (C#), PowerShell and curl guide for quick-mark and undo.
- Tests: `markers.test.ts` and the first client test suite `obs.test.ts` (101 total).

## [1.4.0] - 2026-10-20

### Changed
- **Toolchain:** Vite 8 (Rolldown / Oxc) and `@vitejs/plugin-react` 6 across the monorepo (the client was on Vite 6 while Vitest used Vite 7), Vitest 5, TypeScript 6.0, `@types/node` 24 (matches the Node 24 runtime), React 19.3, lucide-react 1.60 (brand icons were removed: the YouTube export uses `ListVideo`). TypeScript 7 is not adopted yet because typescript-eslint supports `<6.1`.
- **Tailwind CSS 4** via `@tailwindcss/vite`: configuration moved to `@theme` in `index.css`, v3 utility renames applied by the official upgrade tool, PostCSS / autoprefixer removed. Visual parity checked against pre-upgrade screenshots.
- **TypeScript project references:** root `tsconfig.json` solution, `tsc -b` builds shared then server incrementally; new scripts `typecheck`, `clean`, `check`.
- `@streamcollab/shared` exposes a `development` export condition (sources) used by Vite, Vitest and `tsx`, and is marked `sideEffects: false`: Zod no longer ships to the browser (client JS 408 kB -> 319 kB, gzip 121 -> 96 kB).
- Client services expose `on()` subscriptions instead of mutable callback properties; React components follow the React Compiler rules (no prop mutation, no setState cascades in effects, `useEffectEvent` for the OBS hotkey handler, no impure calls during render).

### Added
- ESLint 10 flat config (typescript-eslint 8, eslint-plugin-react-hooks 7, eslint-config-prettier) and Prettier 3 (`npm run lint`, `format`, `format:check`).
- GitHub Actions CI: lint, format check, typecheck, tests, build, production `npm audit`, Docker build and container smoke test (health, client, room creation, graceful shutdown).

### Fixed
- Docker build stage did not copy the root `tsconfig.json` required by `tsc -b`.

### Security
- Tailwind 3 pulled in vulnerable dev dependencies (`braces`, `postcss-selector-parser`); `npm audit` now reports 0 vulnerabilities.

## [1.3.0] - 2026-10-20

### Added
- **Single-origin production server**: Fastify serves the compiled client (`@fastify/static`) at `/`, `/dock`, `/hud` and `/dashboard` with an SPA fallback for browser navigations; hashed assets are cached 30 days (`immutable`) and `index.html` is always revalidated.
- **Docker deployment**: multi-stage `Dockerfile` (Node 24 slim, production dependencies of the server workspace only, non-root, `/data` volume, healthcheck) and `docker-compose.yml` with Caddy for automatic HTTPS / WSS (`deploy/Caddyfile`). `.dockerignore` and `.gitattributes` (LF for container files).
- **Validated configuration** (`src/config.ts`): every env var is checked at startup with Zod and invalid values stop the server with a readable list. New `CLIENT_DIST`, `LOG_LEVEL`, `DOMAIN`. A root `.env` is loaded automatically (never overriding real env vars).
- **Graceful shutdown** on SIGTERM / SIGINT: close sockets, `wal_checkpoint(TRUNCATE)`, close SQLite, 10 s safety timeout.
- **`?server=` client parameter** to run the Dock from a local page while the room server lives on a VPS (fallback for Chrome Local Network Access restrictions on `ws://127.0.0.1`).
- Security headers on every response (`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`).
- `deploy.test.ts` (10 tests, 90 total).

### Changed
- Invite links always point at `/?view=…` regardless of the page they were copied from.
- Removed the unused `OBS_WS_URL` / `OBS_WS_PASSWORD` entries from `.env.example` (OBS credentials stay in each Dock).

### Security
- Uses `@fastify/static` 10.1.6, which fixes two high-severity advisories present in ≤10.1.1 (GHSA-8pvw-jcv7-9cmj, GHSA-83w8-p2f5-377r).

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

*Note: the "60 FPS GPU-accelerated" and "sub-millisecond" claims below were never verified and were removed from the README in 1.6.0.*

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

[Unreleased]: https://github.com/Consterna/streamcollab/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/Consterna/streamcollab/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Consterna/streamcollab/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/Consterna/streamcollab/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Consterna/streamcollab/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Consterna/streamcollab/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Consterna/streamcollab/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Consterna/streamcollab/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Consterna/streamcollab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Consterna/streamcollab/releases/tag/v1.0.0

