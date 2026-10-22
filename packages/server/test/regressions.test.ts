import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createServer } from '../src/index.js';
import { DatabaseService, SCHEMA_VERSION } from '../src/db/database.js';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.unlinkSync(`${dbPath}${suffix}`);
  }
}

interface TestClient {
  ws: WebSocket;
  messages: any[];
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  send: (msg: unknown) => void;
}

const dockMember = (id: string) => ({
  id,
  name: id,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

describe('v1.6.1 regressions: membership per room, sessions, room state, framerates', () => {
  const dbPath = path.resolve(process.cwd(), 'test-regressions-streamcollab.sqlite');
  let app: any;
  let db: DatabaseService;
  let wsUrl = '';
  const open: WebSocket[] = [];

  const connect = () =>
    new Promise<TestClient>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      open.push(ws);
      const messages: any[] = [];
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const client: TestClient = {
        ws,
        messages,
        send: (msg) => ws.send(JSON.stringify(msg)),
        waitFor: (predicate, timeoutMs = 2000) =>
          new Promise((res, rej) => {
            const started = Date.now();
            const check = () => {
              const index = messages.findIndex(predicate);
              if (index >= 0) return res(messages.splice(index, 1)[0]);
              if (Date.now() - started > timeoutMs) return rej(new Error('Timed out waiting for message'));
              setTimeout(check, 5);
            };
            check();
          }),
      };
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });

  const createRoom = async () =>
    JSON.parse((await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).payload) as {
      id: string;
      hostToken: string;
    };

  const startSession = (roomId: string, hostToken: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/session/start`,
      payload,
      headers: { authorization: `Bearer ${hostToken}` },
    });

  const stopSession = (roomId: string, hostToken: string) =>
    app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/session/stop`,
      payload: {},
      headers: { authorization: `Bearer ${hostToken}` },
    });

  const joinDock = async (roomId: string, memberId: string, memberToken?: string) => {
    const client = await connect();
    client.send({
      type: 'JOIN_ROOM',
      payload: { roomId, clientKind: 'dock', member: dockMember(memberId), memberToken },
    });
    const joined = await client.waitFor((m) => m.type === 'JOINED');
    const state = await client.waitFor((m) => m.type === 'ROOM_STATE');
    return { client, joined: joined.payload, state: state.payload };
  };

  beforeAll(async () => {
    removeDb(dbPath);
    const server = await createServer({ dbPath, logger: false });
    app = server.fastify;
    db = server.db;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;
  });

  afterAll(async () => {
    open.forEach((ws) => ws.terminate());
    await app.close();
    db.close();
    removeDb(dbPath);
  });

  it('keeps a streamer in every room their dock joins (exports and HTTP markers of the first room still work)', async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    const sessionA = JSON.parse((await startSession(roomA.id, roomA.hostToken)).payload);

    const inA = await joinDock(roomA.id, 'mem-two-rooms');
    const memberToken = inA.joined.memberToken as string;
    expect(typeof memberToken).toBe('string');
    inA.client.send({
      type: 'UPDATE_STATUS',
      payload: { status: { obsStatus: 'recording', recordStartedAt: sessionA.startedAt + 500 } },
    });
    await inA.client.waitFor((m) => m.type === 'MEMBER_UPDATED');
    inA.client.ws.close();

    // The same device (same id and token) joins a second room
    const inB = await joinDock(roomB.id, 'mem-two-rooms', memberToken);
    expect(inB.joined.memberToken).toBeUndefined(); // the identity already exists: no new token

    expect(db.getRoomMembers(roomA.id).map((m) => m.id)).toEqual(['mem-two-rooms']);
    expect(db.getRoomMembers(roomB.id).map((m) => m.id)).toEqual(['mem-two-rooms']);

    const matrix = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/rooms/${roomA.id}/export/matrix?sessionId=${sessionA.id}` }))
        .payload
    );
    const entry = matrix.members.find((m: any) => m.memberId === 'mem-two-rooms');
    expect(entry?.aligned).toBe(true);
    expect(entry?.sessionOffsetMs).toBe(500);

    const quickMark = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomA.id}/quick-mark`,
      payload: { memberId: 'mem-two-rooms', category: 'kill', label: 'Still in A' },
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(quickMark.statusCode).toBe(201);
  });

  it('closes the running session when a new one starts instead of orphaning it', async () => {
    const room = await createRoom();
    const first = JSON.parse((await startSession(room.id, room.hostToken)).payload);
    const second = JSON.parse((await startSession(room.id, room.hostToken)).payload);

    expect(db.getSession(first.id)?.stoppedAt).not.toBeNull();
    expect(db.getActiveSession(room.id)?.id).toBe(second.id);
    const running = db.listSessions(room.id).filter((s) => s.stoppedAt === null);
    expect(running.map((s) => s.id)).toEqual([second.id]);
  });

  it('sends only the most recent session and its markers to clients joining between sessions', async () => {
    const room = await createRoom();
    const { client: dock, joined } = await joinDock(room.id, 'mem-history');
    const mark = (label: string) =>
      app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/quick-mark`,
        payload: { memberId: 'mem-history', category: 'note', label },
        headers: { authorization: `Bearer ${joined.memberToken}` },
      });

    await startSession(room.id, room.hostToken);
    await mark('Old session');
    await stopSession(room.id, room.hostToken);
    const latest = JSON.parse((await startSession(room.id, room.hostToken)).payload);
    await mark('Latest 1');
    await mark('Latest 2');
    await stopSession(room.id, room.hostToken);
    dock.ws.close();

    const viewer = await connect();
    viewer.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dashboard' } });
    const state = (await viewer.waitFor((m) => m.type === 'ROOM_STATE')).payload;
    expect(state.activeSession).toBeNull();
    expect(state.latestSession.id).toBe(latest.id);
    expect(state.markers.map((m: any) => m.label)).toEqual(['Latest 1', 'Latest 2']);
  });

  it('rejects framerates the timecode engine does not support, and drop-frame outside 29.97 / 59.94', async () => {
    const room = await createRoom();
    const bogus = await startSession(room.id, room.hostToken, {
      framerateNumerator: 1,
      framerateDenominator: 1_000_000,
    });
    expect(bogus.statusCode).toBe(400);
    expect(JSON.parse(bogus.payload).error).toMatch(/framerate/i);

    const halfSpecified = await startSession(room.id, room.hostToken, { framerateNumerator: 30000 });
    expect(halfSpecified.statusCode).toBe(400);

    const dropFrame60 = await startSession(room.id, room.hostToken, { framerateNumerator: 60, dropFrame: true });
    expect(dropFrame60.statusCode).toBe(400);
    expect(JSON.parse(dropFrame60.payload).error).toMatch(/drop-frame/i);

    const ntsc = await startSession(room.id, room.hostToken, {
      framerateNumerator: 60000,
      framerateDenominator: 1001,
      dropFrame: true,
    });
    expect(ntsc.statusCode).toBe(201);
  });

  it('rejects a dock that reports an impossible OBS framerate', async () => {
    const room = await createRoom();
    const { client: dock } = await joinDock(room.id, 'mem-bad-fps');
    dock.send({ type: 'UPDATE_STATUS', payload: { status: { fpsNumerator: 1, fpsDenominator: 1_000_000 } } });
    const error = await dock.waitFor((m) => m.type === 'ERROR');
    expect(error.payload.code).toBe('INVALID_MESSAGE');
  });
});

describe('Schema migration v3 -> v4', () => {
  const dbPath = path.resolve(process.cwd(), 'test-migration-v4-streamcollab.sqlite');

  afterAll(() => removeDb(dbPath));

  it('moves member tokens to device identities and closes orphaned sessions', () => {
    removeDb(dbPath);
    // A v1.6.0 database (schema v3) with one member and a session left running by a second start
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, active_session_id TEXT, host_token_hash TEXT
      );
      CREATE TABLE members (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'player', obs_status TEXT NOT NULL DEFAULT 'disconnected', stream_url TEXT,
        fps REAL NOT NULL DEFAULT 60.0, output_duration_ms INTEGER NOT NULL DEFAULT 0,
        clock_offset_ms REAL NOT NULL DEFAULT 0.0, rtt_ms REAL NOT NULL DEFAULT 0.0, last_heartbeat INTEGER NOT NULL,
        fps_num INTEGER, fps_den INTEGER, record_started_at INTEGER, token_hash TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );
      CREATE TABLE recording_sessions (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, started_at INTEGER NOT NULL, stopped_at INTEGER,
        base_timecode TEXT NOT NULL DEFAULT '01:00:00:00', framerate_num INTEGER NOT NULL DEFAULT 60,
        framerate_den INTEGER NOT NULL DEFAULT 1, drop_frame INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );
      CREATE TABLE markers (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
        member_name TEXT NOT NULL, timestamp INTEGER NOT NULL, relative_time_ms INTEGER NOT NULL, timecode TEXT NOT NULL,
        frame_number INTEGER NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL, comment TEXT, color TEXT NOT NULL,
        tags TEXT, obs_record_ms INTEGER,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES recording_sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE session_members (
        session_id TEXT NOT NULL, member_id TEXT NOT NULL, record_started_at INTEGER NOT NULL,
        framerate_num INTEGER NOT NULL, framerate_den INTEGER NOT NULL, PRIMARY KEY (session_id, member_id)
      );
      INSERT INTO rooms VALUES ('ROOM-V3', 'Room', 1000, 'live', 'hosthash');
      INSERT INTO members (id, room_id, name, last_heartbeat, token_hash) VALUES ('mem-v3', 'ROOM-V3', 'Vet', 1000, 'tokenhash');
      INSERT INTO recording_sessions (id, room_id, name, started_at, stopped_at) VALUES ('orphan', 'ROOM-V3', 'Orphan', 2000, NULL);
      INSERT INTO recording_sessions (id, room_id, name, started_at, stopped_at) VALUES ('live', 'ROOM-V3', 'Live', 5000, NULL);
      INSERT INTO markers VALUES ('m1', 'ROOM-V3', 'orphan', 'mem-v3', 'Vet', 3000, 1000, '01:00:01:00', 60, 'kill', 'K', NULL, 'Red', NULL, NULL);
      PRAGMA user_version = 3;
    `);
    legacy.close();

    const db = new DatabaseService(dbPath);
    expect(db.getSchemaVersion()).toBe(SCHEMA_VERSION);
    expect(db.getRoomMembers('ROOM-V3').map((m) => m.name)).toEqual(['Vet']);
    expect(db.getMemberTokenHash('mem-v3')).toBe('tokenhash');
    // The orphan ends at its last marker; the session the room points at keeps running
    expect(db.getSession('orphan')?.stoppedAt).toBe(3000);
    expect(db.getSession('live')?.stoppedAt).toBeNull();
    expect(db.getActiveSession('ROOM-V3')?.id).toBe('live');
    db.close();
  });
});
