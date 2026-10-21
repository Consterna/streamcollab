import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import {
  Room,
  SquadMember,
  RecordingSession,
  SquadMarker,
  MarkerCategory,
  DaVinciMarkerColor,
  ObsRecordingStatus,
} from '@streamcollab/shared';

export class DatabaseService {
  private db: DatabaseSync;

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

    this.db.exec(`
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
    `);
  }

  // Room methods
  createRoom(id: string, name: string): Room {
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      'INSERT INTO rooms (id, name, created_at, active_session_id) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, name, createdAt, null);
    return {
      id,
      name,
      createdAt,
      activeSessionId: null,
      members: [],
    };
  }

  getRoom(id: string): Room | null {
    const stmt = this.db.prepare('SELECT * FROM rooms WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    const members = this.getRoomMembers(id);
    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.created_at),
      activeSessionId: row.active_session_id,
      members,
    };
  }

  listRooms(): Room[] {
    const stmt = this.db.prepare('SELECT * FROM rooms ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: Number(row.created_at),
      activeSessionId: row.active_session_id,
      members: this.getRoomMembers(row.id),
    }));
  }

  setRoomActiveSession(roomId: string, sessionId: string | null) {
    const stmt = this.db.prepare('UPDATE rooms SET active_session_id = ? WHERE id = ?');
    stmt.run(sessionId, roomId);
  }

  // Member methods
  upsertMember(roomId: string, member: SquadMember) {
    const stmt = this.db.prepare(`
      INSERT INTO members (
        id, room_id, name, avatar_url, role, obs_status, stream_url,
        fps, output_duration_ms, clock_offset_ms, rtt_ms, last_heartbeat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        role = excluded.role,
        obs_status = excluded.obs_status,
        stream_url = excluded.stream_url,
        fps = excluded.fps,
        output_duration_ms = excluded.output_duration_ms,
        clock_offset_ms = excluded.clock_offset_ms,
        rtt_ms = excluded.rtt_ms,
        last_heartbeat = excluded.last_heartbeat
    `);

    stmt.run(
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
      member.lastHeartbeat
    );
  }

  removeMember(memberId: string) {
    const stmt = this.db.prepare('DELETE FROM members WHERE id = ?');
    stmt.run(memberId);
  }

  getRoomMembers(roomId: string): SquadMember[] {
    const stmt = this.db.prepare('SELECT * FROM members WHERE room_id = ?');
    const rows = stmt.all(roomId) as any[];
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
    }));
  }

  // Session methods
  createSession(session: RecordingSession): RecordingSession {
    const stmt = this.db.prepare(`
      INSERT INTO recording_sessions (
        id, room_id, name, started_at, stopped_at, base_timecode,
        framerate_num, framerate_den, drop_frame
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
    const stmt = this.db.prepare('UPDATE recording_sessions SET stopped_at = ? WHERE id = ?');
    stmt.run(stoppedAt, sessionId);

    const session = this.getSession(sessionId);
    if (session) {
      this.setRoomActiveSession(session.roomId, null);
    }
    return session;
  }

  getSession(sessionId: string): RecordingSession | null {
    const stmt = this.db.prepare('SELECT * FROM recording_sessions WHERE id = ?');
    const row = stmt.get(sessionId) as any;
    if (!row) return null;

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

  getActiveSession(roomId: string): RecordingSession | null {
    const room = this.getRoom(roomId);
    if (!room || !room.activeSessionId) return null;
    return this.getSession(room.activeSessionId);
  }

  // Marker methods
  createMarker(marker: SquadMarker): SquadMarker {
    const stmt = this.db.prepare(`
      INSERT INTO markers (
        id, room_id, session_id, member_id, member_name,
        timestamp, relative_time_ms, timecode, frame_number,
        category, label, comment, color, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
      marker.tags ? JSON.stringify(marker.tags) : null
    );

    return marker;
  }

  getSessionMarkers(sessionId: string): SquadMarker[] {
    const stmt = this.db.prepare('SELECT * FROM markers WHERE session_id = ? ORDER BY relative_time_ms ASC');
    const rows = stmt.all(sessionId) as any[];
    return rows.map((r) => ({
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
    }));
  }

  getRoomMarkers(roomId: string): SquadMarker[] {
    const stmt = this.db.prepare('SELECT * FROM markers WHERE room_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(roomId) as any[];
    return rows.map((r) => ({
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
    }));
  }

  close() {
    this.db.close();
  }
}
