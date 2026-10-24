import { DatabaseSync, StatementSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import {
  Room,
  SquadMember,
  RecordingSession,
  SquadMarker,
  SessionMemberAnchor,
  SessionSummary,
  MarkerCategory,
  DaVinciMarkerColor,
  ObsRecordingStatus,
} from '@streamcollab/shared';

/**
 * Ordered schema migrations. The index + 1 is the resulting `PRAGMA user_version`.
 * Never edit a released migration; append a new one instead.
 */
const MIGRATIONS: string[] = [
  // v1 — initial v1.0.0 schema
  `
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active_session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'player',
      obs_status TEXT NOT NULL DEFAULT 'disconnected',
      stream_url TEXT,
      fps REAL NOT NULL DEFAULT 60.0,
      output_duration_ms INTEGER NOT NULL DEFAULT 0,
      clock_offset_ms REAL NOT NULL DEFAULT 0.0,
      rtt_ms REAL NOT NULL DEFAULT 0.0,
      last_heartbeat INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recording_sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      stopped_at INTEGER,
      base_timecode TEXT NOT NULL DEFAULT '01:00:00:00',
      framerate_num INTEGER NOT NULL DEFAULT 60,
      framerate_den INTEGER NOT NULL DEFAULT 1,
      drop_frame INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      relative_time_ms INTEGER NOT NULL,
      timecode TEXT NOT NULL,
      frame_number INTEGER NOT NULL,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      comment TEXT,
      color TEXT NOT NULL,
      tags TEXT,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES recording_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_markers_session ON markers(session_id, relative_time_ms);
    CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_id);
  `,
  // v2 — per-member recording anchors and exact OBS framerates (v1.1.0)
  `
    ALTER TABLE members ADD COLUMN fps_num INTEGER;
    ALTER TABLE members ADD COLUMN fps_den INTEGER;
    ALTER TABLE members ADD COLUMN record_started_at INTEGER;
    ALTER TABLE markers ADD COLUMN obs_record_ms INTEGER;

    CREATE TABLE IF NOT EXISTS session_members (
      session_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      record_started_at INTEGER NOT NULL,
      framerate_num INTEGER NOT NULL,
      framerate_den INTEGER NOT NULL,
      PRIMARY KEY (session_id, member_id),
      FOREIGN KEY (session_id) REFERENCES recording_sessions(id) ON DELETE CASCADE
    );
  `,
  // v3 — host and member token hashes (v1.2.0). Rooms created before this have no host.
  `
    ALTER TABLE rooms ADD COLUMN host_token_hash TEXT;
    ALTER TABLE members ADD COLUMN token_hash TEXT;
  `,
  // v4 — membership per room (v1.6.1). A member id is a device identity (with its token) that can
  // belong to several rooms; before this, joining a second room moved the member out of the first.
  // Also closes sessions orphaned by starting a new one while another was running.
  `
    CREATE TABLE member_identities (
      id TEXT PRIMARY KEY,
      token_hash TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO member_identities (id, token_hash, created_at)
      SELECT id, token_hash, last_heartbeat FROM members;

    CREATE TABLE members_v4 (
      id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'player',
      obs_status TEXT NOT NULL DEFAULT 'disconnected',
      stream_url TEXT,
      fps REAL NOT NULL DEFAULT 60.0,
      output_duration_ms INTEGER NOT NULL DEFAULT 0,
      clock_offset_ms REAL NOT NULL DEFAULT 0.0,
      rtt_ms REAL NOT NULL DEFAULT 0.0,
      last_heartbeat INTEGER NOT NULL,
      fps_num INTEGER,
      fps_den INTEGER,
      record_started_at INTEGER,
      PRIMARY KEY (room_id, id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    INSERT INTO members_v4 (
      id, room_id, name, avatar_url, role, obs_status, stream_url, fps, output_duration_ms,
      clock_offset_ms, rtt_ms, last_heartbeat, fps_num, fps_den, record_started_at
    )
      SELECT id, room_id, name, avatar_url, role, obs_status, stream_url, fps, output_duration_ms,
        clock_offset_ms, rtt_ms, last_heartbeat, fps_num, fps_den, record_started_at
      FROM members;
    DROP TABLE members;
    ALTER TABLE members_v4 RENAME TO members;
    CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_id);

    UPDATE recording_sessions
      SET stopped_at = COALESCE(
        (SELECT MAX(m.timestamp) FROM markers m WHERE m.session_id = recording_sessions.id),
        started_at
      )
      WHERE stopped_at IS NULL
        AND id NOT IN (SELECT active_session_id FROM rooms WHERE active_session_id IS NOT NULL);
  `,
  // v5 — (v1.6.2) v4 could close an orphan at a marker taken just before the session started, which
  // left stopped_at < started_at. Also records when the server was last alive and whether it shut
  // down cleanly, so a restart can tell a deploy from a crash.
  `
    UPDATE recording_sessions SET stopped_at = started_at
      WHERE stopped_at IS NOT NULL AND stopped_at < started_at;

    CREATE TABLE server_state (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `,
];

// A clean shutdown older than this is treated like a crash: nobody was recording through it
export const RESUME_AFTER_CLEAN_SHUTDOWN_MS = 10 * 60_000;

// Shapes of SQLite rows as returned by node:sqlite (snake_case columns)
interface RoomRow {
  id: string;
  name: string;
  created_at: number;
  active_session_id: string | null;
  host_token_hash: string | null;
}

interface MemberRow {
  id: string;
  room_id: string;
  name: string;
  avatar_url: string | null;
  role: SquadMember['role'];
  obs_status: string;
  stream_url: string | null;
  fps: number;
  output_duration_ms: number;
  clock_offset_ms: number;
  rtt_ms: number;
  last_heartbeat: number;
  fps_num: number | null;
  fps_den: number | null;
  record_started_at: number | null;
}

interface SessionRow {
  id: string;
  room_id: string;
  name: string;
  started_at: number;
  stopped_at: number | null;
  base_timecode: string;
  framerate_num: number;
  framerate_den: number;
  drop_frame: number;
}

interface MarkerRow {
  id: string;
  room_id: string;
  session_id: string;
  member_id: string;
  member_name: string;
  timestamp: number;
  relative_time_ms: number;
  timecode: string;
  frame_number: number;
  category: string;
  label: string;
  comment: string | null;
  color: string;
  tags: string | null;
  obs_record_ms: number | null;
}

interface AnchorRow {
  session_id: string;
  member_id: string;
  record_started_at: number;
  framerate_num: number;
  framerate_den: number;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

export class DatabaseService {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private open = true;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.resolve(process.cwd(), 'streamcollab.sqlite');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(finalPath);
    try {
      this.init();
    } catch (err) {
      // Don't keep the file open (and locked on Windows) when it can't be used
      this.open = false;
      this.db.close();
      throw err;
    }
  }

  private init() {
    // Enable WAL mode for high concurrency between Fastify workers and OBS WebSocket writes
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.reconcileOrphanSessions();
  }

  private inTx = false;
  private afterCommitQueue: (() => void)[] = [];

  /**
   * Run a callback inside a BEGIN IMMEDIATE ... COMMIT transaction with rollback on error.
   * Nested calls join the outer transaction.
   */
  transaction<T>(fn: () => T): T {
    if (this.inTx) {
      return fn();
    }
    // A BEGIN that fails (SQLITE_BUSY past busy_timeout) leaves nothing to undo: throw before inTx is set
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    let committed = false;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      committed = true;
      return result;
    } catch (err) {
      // SQLite may have rolled back on its own already (SQLITE_FULL, IOERR); keep the original error
      if (this.db.isTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // the original error is the useful one
        }
      }
      throw err;
    } finally {
      this.inTx = false;
      const queued = this.afterCommitQueue;
      this.afterCommitQueue = [];
      if (committed) {
        // The commit already happened: a failing callback (a broadcast) must neither turn it into an
        // error for the caller nor keep the other callbacks from running
        for (const callback of queued) {
          try {
            callback();
          } catch (err) {
            console.error('[StreamCollab] after-commit callback failed:', err);
          }
        }
      }
    }
  }

  /** Run `callback` once the current transaction commits (now, if there is none); dropped on rollback */
  afterCommit(callback: () => void) {
    if (this.inTx) {
      this.afterCommitQueue.push(callback);
    } else {
      callback();
    }
  }

  /**
   * Auto-close unstopped sessions using the last recorded marker timestamp (or started_at).
   * By default, reconciles orphan sessions (those not pointed to by any room's active_session_id).
   * When options.closeActive is true (crash recovery), also auto-closes active sessions left unstopped
   * when the server was killed/crashed, and clears active_session_id across all rooms.
   */
  reconcileOrphanSessions(options?: { closeActive?: boolean }): { closedCount: number } {
    return this.transaction(() => {
      if (options?.closeActive) {
        const unstopped = this.stmt('SELECT id FROM recording_sessions WHERE stopped_at IS NULL').all() as unknown as {
          id: string;
        }[];

        if (unstopped.length === 0) {
          this.db.exec('UPDATE rooms SET active_session_id = NULL WHERE active_session_id IS NOT NULL');
          return { closedCount: 0 };
        }

        this.db.exec(`
          UPDATE recording_sessions
          SET stopped_at = MAX(
            COALESCE(
              (SELECT MAX(timestamp) FROM markers WHERE markers.session_id = recording_sessions.id),
              started_at
            ),
            started_at
          )
          WHERE stopped_at IS NULL;
          UPDATE rooms SET active_session_id = NULL WHERE active_session_id IS NOT NULL;
        `);

        return { closedCount: unstopped.length };
      }

      const unstopped = this.stmt(
        `SELECT id FROM recording_sessions
         WHERE stopped_at IS NULL
           AND id NOT IN (SELECT active_session_id FROM rooms WHERE active_session_id IS NOT NULL)`
      ).all() as unknown as { id: string }[];

      if (unstopped.length === 0) return { closedCount: 0 };

      this.db.exec(`
        UPDATE recording_sessions
        SET stopped_at = MAX(
          COALESCE(
            (SELECT MAX(timestamp) FROM markers WHERE markers.session_id = recording_sessions.id),
            started_at
          ),
          started_at
        )
        WHERE stopped_at IS NULL
          AND id NOT IN (SELECT active_session_id FROM rooms WHERE active_session_id IS NOT NULL);
      `);

      return { closedCount: unstopped.length };
    });
  }

  reconcileCrashRecovery(): { closedCount: number } {
    return this.reconcileOrphanSessions({ closeActive: true });
  }

  private getState(key: string): number | null {
    const row = this.stmt('SELECT value FROM server_state WHERE key = ?').get(key) as { value: number } | undefined;
    return row ? Number(row.value) : null;
  }

  private setState(key: string, value: number) {
    this.stmt(
      'INSERT INTO server_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  }

  /** Written periodically while the server runs: after a crash, sessions ran at least until then */
  markAlive(now: number = Date.now()) {
    this.setState('last_alive_at', now);
  }

  /** Written by the graceful shutdown, just before the database closes */
  markCleanShutdown(now: number = Date.now()) {
    this.setState('last_alive_at', now);
    this.setState('clean_shutdown_at', now);
  }

  /**
   * Startup reconciliation.
   * - After a recent clean shutdown (a deploy or restart), running sessions keep running: OBS kept
   *   recording and the docks reconnect on their own.
   * - After a crash, or a clean shutdown older than RESUME_AFTER_CLEAN_SHUTDOWN_MS, running sessions
   *   are closed at the last moment they are known to have run (latest marker or server heartbeat).
   * In both cases no dock is connected yet, so nobody is "recording": that status is reported again
   * on rejoin, and a session started before then must not anchor a stale recording file.
   */
  recoverAfterRestart(now: number = Date.now()): { resumed: boolean; closedCount: number } {
    return this.transaction(() => {
      const cleanShutdownAt = this.getState('clean_shutdown_at');
      const lastAliveAt = this.getState('last_alive_at');
      this.stmt('DELETE FROM server_state WHERE key = ?').run('clean_shutdown_at');
      this.db.exec("UPDATE members SET obs_status = 'disconnected' WHERE obs_status <> 'disconnected'");

      const resumed = cleanShutdownAt !== null && now - cleanShutdownAt <= RESUME_AFTER_CLEAN_SHUTDOWN_MS;
      if (resumed) {
        return { resumed, ...this.reconcileOrphanSessions() };
      }

      const unstopped = this.stmt('SELECT id FROM recording_sessions WHERE stopped_at IS NULL').all();
      this.stmt(
        `UPDATE recording_sessions
         SET stopped_at = MAX(
           started_at,
           COALESCE((SELECT MAX(timestamp) FROM markers WHERE markers.session_id = recording_sessions.id), started_at),
           COALESCE(?, started_at)
         )
         WHERE stopped_at IS NULL`
      ).run(lastAliveAt);
      this.db.exec('UPDATE rooms SET active_session_id = NULL WHERE active_session_id IS NOT NULL');
      return { resumed, closedCount: unstopped.length };
    });
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = Number(row.user_version);

    // A database written by a newer StreamCollab has tables this build doesn't know how to keep consistent
    if (current > MIGRATIONS.length) {
      throw new Error(
        `Database schema v${current} is newer than this StreamCollab build supports (v${MIGRATIONS.length}). ` +
          'Upgrade StreamCollab or restore a backup made by this version.'
      );
    }

    for (let version = current; version < MIGRATIONS.length; version++) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(MIGRATIONS[version]);
        this.db.exec(`PRAGMA user_version = ${version + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  getSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return Number(row.user_version);
  }

  // Prepared statements are compiled once and reused
  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  // Room methods
  createRoom(id: string, name: string, hostTokenHash: string | null = null): Room {
    const createdAt = Date.now();
    this.stmt(
      'INSERT INTO rooms (id, name, created_at, active_session_id, host_token_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, createdAt, null, hostTokenHash);
    return {
      id,
      name,
      createdAt,
      activeSessionId: null,
      members: [],
    };
  }

  getRoom(id: string): Room | null {
    const row = this.stmt('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.created_at),
      activeSessionId: row.active_session_id,
      members: this.getRoomMembers(id),
    };
  }

  listRooms(): Room[] {
    const rows = this.stmt('SELECT * FROM rooms ORDER BY created_at DESC').all() as unknown as RoomRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: Number(row.created_at),
      activeSessionId: row.active_session_id,
      members: this.getRoomMembers(row.id),
    }));
  }

  roomExists(roomId: string): boolean {
    return Boolean(this.stmt('SELECT 1 FROM rooms WHERE id = ?').get(roomId));
  }

  /** Canonical id of a room typed in any letter case (room codes are shared by voice / chat) */
  resolveRoomId(input: string): string | null {
    const row = this.stmt('SELECT id FROM rooms WHERE id = ? COLLATE NOCASE LIMIT 1').get(input) as
      { id: string } | undefined;
    return row?.id ?? null;
  }

  getRoomHostTokenHash(roomId: string): string | null {
    const row = this.stmt('SELECT host_token_hash FROM rooms WHERE id = ?').get(roomId) as
      Pick<RoomRow, 'host_token_hash'> | undefined;
    return row?.host_token_hash ?? null;
  }

  setRoomActiveSession(roomId: string, sessionId: string | null) {
    this.stmt('UPDATE rooms SET active_session_id = ? WHERE id = ?').run(sessionId, roomId);
  }

  // Member methods
  upsertMember(roomId: string, member: SquadMember) {
    this.stmt(
      `
      INSERT INTO members (
        id, room_id, name, avatar_url, role, obs_status, stream_url,
        fps, output_duration_ms, clock_offset_ms, rtt_ms, last_heartbeat,
        fps_num, fps_den, record_started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, id) DO UPDATE SET
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        role = excluded.role,
        obs_status = excluded.obs_status,
        stream_url = excluded.stream_url,
        fps = excluded.fps,
        output_duration_ms = excluded.output_duration_ms,
        clock_offset_ms = excluded.clock_offset_ms,
        rtt_ms = excluded.rtt_ms,
        last_heartbeat = excluded.last_heartbeat,
        fps_num = excluded.fps_num,
        fps_den = excluded.fps_den,
        record_started_at = excluded.record_started_at
    `
    ).run(
      member.id,
      roomId,
      member.name,
      member.avatarUrl ?? null,
      member.role,
      member.obsStatus,
      member.streamUrl ?? null,
      member.fps,
      member.outputDurationMs,
      member.clockOffsetMs,
      member.rttMs,
      member.lastHeartbeat,
      member.fpsNumerator ?? null,
      member.fpsDenominator ?? null,
      member.recordStartedAt ?? null
    );
  }

  // A member id is a device identity shared by every room that device joins; its token proves it
  getMemberTokenHash(memberId: string): string | null {
    const row = this.stmt('SELECT token_hash FROM member_identities WHERE id = ?').get(memberId) as
      { token_hash: string | null } | undefined;
    return row?.token_hash ?? null;
  }

  setMemberTokenHash(memberId: string, tokenHash: string) {
    this.stmt(
      `INSERT INTO member_identities (id, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash`
    ).run(memberId, tokenHash, Date.now());
  }

  /** Deletes the session with its markers and recording anchors (FK cascade) */
  deleteSession(sessionId: string): boolean {
    return Number(this.stmt('DELETE FROM recording_sessions WHERE id = ?').run(sessionId).changes) > 0;
  }

  /** Deletes the room with its members, sessions, markers and anchors (FK cascade) */
  deleteRoom(roomId: string): boolean {
    return Number(this.stmt('DELETE FROM rooms WHERE id = ?').run(roomId).changes) > 0;
  }

  /** Removes the member from this room only; its identity (and token) stays with the device */
  removeMember(roomId: string, memberId: string) {
    this.stmt('DELETE FROM members WHERE room_id = ? AND id = ?').run(roomId, memberId);
  }

  getRoomMembers(roomId: string): SquadMember[] {
    const rows = this.stmt('SELECT * FROM members WHERE room_id = ?').all(roomId) as unknown as MemberRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatarUrl: r.avatar_url || undefined,
      role: r.role,
      obsStatus: r.obs_status as ObsRecordingStatus,
      streamUrl: r.stream_url || undefined,
      fps: Number(r.fps),
      outputDurationMs: Number(r.output_duration_ms),
      clockOffsetMs: Number(r.clock_offset_ms),
      rttMs: Number(r.rtt_ms),
      lastHeartbeat: Number(r.last_heartbeat),
      fpsNumerator: r.fps_num != null ? Number(r.fps_num) : undefined,
      fpsDenominator: r.fps_den != null ? Number(r.fps_den) : undefined,
      recordStartedAt: r.record_started_at != null ? Number(r.record_started_at) : null,
    }));
  }

  // Session methods
  createSession(session: RecordingSession): RecordingSession {
    return this.transaction(() => {
      this.stmt(
        `
        INSERT INTO recording_sessions (
          id, room_id, name, started_at, stopped_at, base_timecode,
          framerate_num, framerate_den, drop_frame
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        session.id,
        session.roomId,
        session.name,
        session.startedAt,
        session.stoppedAt,
        session.baseTimecode,
        session.framerateNumerator,
        session.framerateDenominator,
        session.dropFrame ? 1 : 0
      );

      this.setRoomActiveSession(session.roomId, session.id);
      return session;
    });
  }

  /**
   * Stop a running session. Returns null when it doesn't exist or already stopped (its stop time is
   * never moved). The room's active session is only cleared if it is this one.
   */
  stopSession(sessionId: string, stoppedAt: number = Date.now()): RecordingSession | null {
    return this.transaction(() => {
      const changed = this.stmt(
        'UPDATE recording_sessions SET stopped_at = MAX(?, started_at) WHERE id = ? AND stopped_at IS NULL'
      ).run(stoppedAt, sessionId).changes;
      if (Number(changed) === 0) return null;

      const session = this.getSession(sessionId);
      if (session) {
        this.stmt('UPDATE rooms SET active_session_id = NULL WHERE id = ? AND active_session_id = ?').run(
          session.roomId,
          sessionId
        );
      }
      return session;
    });
  }

  private mapSession(row: SessionRow): RecordingSession {
    return {
      id: row.id,
      roomId: row.room_id,
      name: row.name,
      startedAt: Number(row.started_at),
      stoppedAt: row.stopped_at ? Number(row.stopped_at) : null,
      baseTimecode: row.base_timecode,
      framerateNumerator: Number(row.framerate_num),
      framerateDenominator: Number(row.framerate_den),
      dropFrame: Boolean(row.drop_frame),
    };
  }

  getSession(sessionId: string): RecordingSession | null {
    const row = this.stmt('SELECT * FROM recording_sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  getActiveSession(roomId: string): RecordingSession | null {
    const row = this.stmt('SELECT active_session_id FROM rooms WHERE id = ?').get(roomId) as
      Pick<RoomRow, 'active_session_id'> | undefined;
    if (!row || !row.active_session_id) return null;
    return this.getSession(row.active_session_id);
  }

  getLatestSession(roomId: string): RecordingSession | null {
    const row = this.stmt('SELECT * FROM recording_sessions WHERE room_id = ? ORDER BY started_at DESC LIMIT 1').get(
      roomId
    ) as SessionRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  /** Every session of a room, newest first, with how many markers it holds */
  listSessions(roomId: string): SessionSummary[] {
    const rows = this.stmt(
      `SELECT s.*, (SELECT COUNT(*) FROM markers m WHERE m.session_id = s.id) AS marker_count
       FROM recording_sessions s WHERE s.room_id = ? ORDER BY s.started_at DESC`
    ).all(roomId) as unknown as (SessionRow & { marker_count: number })[];
    return rows.map((row) => ({ ...this.mapSession(row), markerCount: Number(row.marker_count) }));
  }

  // Recording anchors (where each member's file starts within a session)
  upsertSessionAnchor(anchor: SessionMemberAnchor) {
    this.stmt(
      `
      INSERT INTO session_members (session_id, member_id, record_started_at, framerate_num, framerate_den)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, member_id) DO UPDATE SET
        record_started_at = excluded.record_started_at,
        framerate_num = excluded.framerate_num,
        framerate_den = excluded.framerate_den
    `
    ).run(
      anchor.sessionId,
      anchor.memberId,
      anchor.recordStartedAt,
      anchor.framerateNumerator,
      anchor.framerateDenominator
    );
  }

  getSessionAnchors(sessionId: string): SessionMemberAnchor[] {
    const rows = this.stmt('SELECT * FROM session_members WHERE session_id = ?').all(
      sessionId
    ) as unknown as AnchorRow[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      memberId: r.member_id,
      recordStartedAt: Number(r.record_started_at),
      framerateNumerator: Number(r.framerate_num),
      framerateDenominator: Number(r.framerate_den),
    }));
  }

  // PASSIVE never blocks writers; TRUNCATE (used at shutdown) also empties the -wal file
  checkpoint(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE') {
    this.db.exec(`PRAGMA wal_checkpoint(${mode});`);
  }

  // Marker methods
  createMarker(marker: SquadMarker): SquadMarker {
    this.stmt(
      `
      INSERT INTO markers (
        id, room_id, session_id, member_id, member_name,
        timestamp, relative_time_ms, timecode, frame_number,
        category, label, comment, color, tags, obs_record_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      marker.id,
      marker.roomId,
      marker.sessionId,
      marker.memberId,
      marker.memberName,
      marker.timestamp,
      marker.relativeTimeMs,
      marker.timecode,
      marker.frameNumber,
      marker.category,
      marker.label,
      marker.comment ?? null,
      marker.color,
      marker.tags ? JSON.stringify(marker.tags) : null,
      marker.obsRecordMs ?? null
    );

    return marker;
  }

  private mapMarker(r: MarkerRow): SquadMarker {
    return {
      id: r.id,
      roomId: r.room_id,
      sessionId: r.session_id,
      memberId: r.member_id,
      memberName: r.member_name,
      timestamp: Number(r.timestamp),
      relativeTimeMs: Number(r.relative_time_ms),
      timecode: r.timecode,
      frameNumber: Number(r.frame_number),
      category: r.category as MarkerCategory,
      label: r.label,
      comment: r.comment || undefined,
      color: r.color as DaVinciMarkerColor,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      obsRecordMs: r.obs_record_ms != null ? Number(r.obs_record_ms) : undefined,
    };
  }

  getSessionMarkers(sessionId: string): SquadMarker[] {
    const rows = this.stmt('SELECT * FROM markers WHERE session_id = ? ORDER BY relative_time_ms ASC').all(
      sessionId
    ) as unknown as MarkerRow[];
    return rows.map((r) => this.mapMarker(r));
  }

  getMarker(markerId: string): SquadMarker | null {
    const row = this.stmt('SELECT * FROM markers WHERE id = ?').get(markerId) as MarkerRow | undefined;
    return row ? this.mapMarker(row) : null;
  }

  /** Persist the editable fields of a marker (timing is immutable) */
  updateMarker(marker: SquadMarker): SquadMarker {
    this.stmt('UPDATE markers SET category = ?, label = ?, comment = ?, color = ? WHERE id = ?').run(
      marker.category,
      marker.label,
      marker.comment ?? null,
      marker.color,
      marker.id
    );
    return marker;
  }

  deleteMarker(markerId: string): boolean {
    const result = this.stmt('DELETE FROM markers WHERE id = ?').run(markerId);
    return Number(result.changes) > 0;
  }

  getLatestMemberMarker(sessionId: string, memberId: string): SquadMarker | null {
    const row = this.stmt(
      'SELECT * FROM markers WHERE session_id = ? AND member_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(sessionId, memberId) as MarkerRow | undefined;
    return row ? this.mapMarker(row) : null;
  }

  getRoomMarkers(roomId: string): SquadMarker[] {
    const rows = this.stmt('SELECT * FROM markers WHERE room_id = ? ORDER BY timestamp ASC').all(
      roomId
    ) as unknown as MarkerRow[];
    return rows.map((r) => this.mapMarker(r));
  }

  get isOpen(): boolean {
    return this.open;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.statements.clear();
    this.db.close();
  }
}
