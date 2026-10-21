import { DatabaseSync, StatementSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import {
  Room,
  SquadMember,
  RecordingSession,
  SquadMarker,
  SessionMemberAnchor,
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
];

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
    this.init();
  }

  private init() {
    // Enable WAL mode for high concurrency between Fastify workers and OBS WebSocket writes
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = Number(row.user_version);

    for (let version = current; version < MIGRATIONS.length; version++) {
      this.db.exec('BEGIN');
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
    const row = this.stmt('SELECT * FROM rooms WHERE id = ?').get(id) as any;
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
    const rows = this.stmt('SELECT * FROM rooms ORDER BY created_at DESC').all() as any[];
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

  getRoomHostTokenHash(roomId: string): string | null {
    const row = this.stmt('SELECT host_token_hash FROM rooms WHERE id = ?').get(roomId) as any;
    return row?.host_token_hash ?? null;
  }

  setRoomActiveSession(roomId: string, sessionId: string | null) {
    this.stmt('UPDATE rooms SET active_session_id = ? WHERE id = ?').run(sessionId, roomId);
  }

  // Member methods
  upsertMember(roomId: string, member: SquadMember) {
    this.stmt(`
      INSERT INTO members (
        id, room_id, name, avatar_url, role, obs_status, stream_url,
        fps, output_duration_ms, clock_offset_ms, rtt_ms, last_heartbeat,
        fps_num, fps_den, record_started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        room_id = excluded.room_id,
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
    `).run(
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

  getMemberTokenHash(memberId: string): string | null {
    const row = this.stmt('SELECT token_hash FROM members WHERE id = ?').get(memberId) as any;
    return row?.token_hash ?? null;
  }

  setMemberTokenHash(memberId: string, tokenHash: string) {
    this.stmt('UPDATE members SET token_hash = ? WHERE id = ?').run(tokenHash, memberId);
  }

  removeMember(memberId: string) {
    this.stmt('DELETE FROM members WHERE id = ?').run(memberId);
  }

  getRoomMembers(roomId: string): SquadMember[] {
    const rows = this.stmt('SELECT * FROM members WHERE room_id = ?').all(roomId) as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatarUrl: r.avatar_url || undefined,
      role: r.role as any,
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
    this.stmt(`
      INSERT INTO recording_sessions (
        id, room_id, name, started_at, stopped_at, base_timecode,
        framerate_num, framerate_den, drop_frame
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
  }

  stopSession(sessionId: string, stoppedAt: number = Date.now()): RecordingSession | null {
    this.stmt('UPDATE recording_sessions SET stopped_at = ? WHERE id = ?').run(stoppedAt, sessionId);

    const session = this.getSession(sessionId);
    if (session) {
      this.setRoomActiveSession(session.roomId, null);
    }
    return session;
  }

  private mapSession(row: any): RecordingSession {
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
    const row = this.stmt('SELECT * FROM recording_sessions WHERE id = ?').get(sessionId) as any;
    return row ? this.mapSession(row) : null;
  }

  getActiveSession(roomId: string): RecordingSession | null {
    const row = this.stmt('SELECT active_session_id FROM rooms WHERE id = ?').get(roomId) as any;
    if (!row || !row.active_session_id) return null;
    return this.getSession(row.active_session_id);
  }

  getLatestSession(roomId: string): RecordingSession | null {
    const row = this.stmt(
      'SELECT * FROM recording_sessions WHERE room_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(roomId) as any;
    return row ? this.mapSession(row) : null;
  }

  // Recording anchors (where each member's file starts within a session)
  upsertSessionAnchor(anchor: SessionMemberAnchor) {
    this.stmt(`
      INSERT INTO session_members (session_id, member_id, record_started_at, framerate_num, framerate_den)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, member_id) DO UPDATE SET
        record_started_at = excluded.record_started_at,
        framerate_num = excluded.framerate_num,
        framerate_den = excluded.framerate_den
    `).run(
      anchor.sessionId,
      anchor.memberId,
      anchor.recordStartedAt,
      anchor.framerateNumerator,
      anchor.framerateDenominator
    );
  }

  getSessionAnchors(sessionId: string): SessionMemberAnchor[] {
    const rows = this.stmt('SELECT * FROM session_members WHERE session_id = ?').all(sessionId) as any[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      memberId: r.member_id,
      recordStartedAt: Number(r.record_started_at),
      framerateNumerator: Number(r.framerate_num),
      framerateDenominator: Number(r.framerate_den),
    }));
  }

  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  }

  // Marker methods
  createMarker(marker: SquadMarker): SquadMarker {
    this.stmt(`
      INSERT INTO markers (
        id, room_id, session_id, member_id, member_name,
        timestamp, relative_time_ms, timecode, frame_number,
        category, label, comment, color, tags, obs_record_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  private mapMarker(r: any): SquadMarker {
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
    const rows = this.stmt(
      'SELECT * FROM markers WHERE session_id = ? ORDER BY relative_time_ms ASC'
    ).all(sessionId) as any[];
    return rows.map((r) => this.mapMarker(r));
  }

  getRoomMarkers(roomId: string): SquadMarker[] {
    const rows = this.stmt('SELECT * FROM markers WHERE room_id = ? ORDER BY timestamp ASC').all(roomId) as any[];
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
