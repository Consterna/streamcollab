# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed
- Fixed SMPTE integer truncation on sub-frame rational calculations.
- Fixed FCP 7 XML sequence duration calculation and DTD compliance with sequence-level markers.
- Fixed exporter access after session stop to allow post-broadcast timeline generation.
- Fixed route navigation handling for both query string (`?view=dock`) and hash routing (`#/dock`).
