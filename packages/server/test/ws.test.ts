import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { createServer } from '../src/index.js';
import { DatabaseService, SCHEMA_VERSION } from '../src/db/database.js';
import {
  resolveMarkerTimestamp,
  MARKER_MAX_PAST_SKEW_MS,
  MARKER_MAX_FUTURE_SKEW_MS,
} from '../src/rooms/roomManager.js';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.unlinkSync(`${dbPath}${suffix}`);
  }
}

// A WebSocket test client that records every server message from the moment it connects
interface TestClient {
  ws: WebSocket;
  messages: any[];
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  send: (msg: unknown) => void;
}

function wrap(ws: WebSocket): TestClient {
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return {
    ws,
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor: (predicate, timeoutMs = 2000) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const found = messages.find(predicate);
          if (found) return resolve(found);
          if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for message'));
          setTimeout(check, 5);
        };
        check();
      }),
  };
}

async function until(condition: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const dockMember = (id: string, name: string) => ({
  id,
  name,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

describe('WebSocket rooms, connections and timing', () => {
  const testDbPath = path.resolve(process.cwd(), 'test-ws-streamcollab.sqlite');
  let app: any;
  let db: DatabaseService;
  let roomManager: any;
  let wsUrl = '';

  // Real sockets on an ephemeral port, so close/terminate propagate exactly like in production
  const connect = () =>
    new Promise<TestClient>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const client = wrap(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });

  beforeAll(async () => {
    removeDb(testDbPath);
    const server = await createServer({ dbPath: testDbPath, logger: false });
    app = server.fastify;
    db = server.db;
    roomManager = server.roomManager;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;

    for (const id of ['fresh-room', 'squad-dup', 'squad-life', 'squad-x', 'squad-time']) {
      roomManager.createRoom(id);
    }
  });

  afterAll(async () => {
    await app.close();
    db.close();
    removeDb(testDbPath);
  });

  it('rejects joining a room that was never created', async () => {
    const dock = await connect();
    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'ghost-room', clientKind: 'dock', member: dockMember('mem-ghost', 'Ghost') },
    });

    const error = await dock.waitFor((m) => m.type === 'ERROR');
    expect(error.payload.code).toBe('ROOM_NOT_FOUND');
    expect(roomManager.getConnections('ghost-room')).toEqual([]);
    expect(db.roomExists('ghost-room')).toBe(false);
    dock.ws.terminate();
  });

  it('joins an existing room and returns its state', async () => {
    const dock = await connect();
    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'fresh-room', clientKind: 'dock', member: dockMember('mem-fresh', 'Fresh') },
    });

    const joined = await dock.waitFor((m) => m.type === 'JOINED');
    expect(joined.payload).toMatchObject({ roomId: 'fresh-room', clientKind: 'dock', isHost: false });
    const state = await dock.waitFor((m) => m.type === 'ROOM_STATE');
    expect(state.payload.room.id).toBe('fresh-room');
    expect(state.payload.room.members.map((m: any) => m.id)).toEqual(['mem-fresh']);
    dock.ws.terminate();
  });

  it('delivers markers to both the dock and the HUD of the same streamer', async () => {
    const dock = await connect();
    const hud = await connect();

    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'squad-dup', clientKind: 'dock', member: dockMember('mem-dup', 'Dup') },
    });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');
    // The HUD runs in the same OBS (same localStorage member id) but joins as an observer
    hud.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'squad-dup', clientKind: 'hud', member: dockMember('mem-dup', 'Dup') },
    });
    await hud.waitFor((m) => m.type === 'ROOM_STATE');

    dock.send({
      type: 'CREATE_MARKER',
      payload: {
        roomId: 'squad-dup',
        marker: { sessionId: '', category: 'kill', label: 'Kill', color: 'Red' },
      },
    });

    const onDock = await dock.waitFor((m) => m.type === 'MARKER_ADDED');
    const onHud = await hud.waitFor((m) => m.type === 'MARKER_ADDED');
    expect(onHud.payload.id).toBe(onDock.payload.id);

    const kinds = roomManager
      .getConnections('squad-dup')
      .map((c: any) => c.kind)
      .sort();
    expect(kinds).toEqual(['dock', 'hud']);
    expect(db.getRoomMembers('squad-dup')).toHaveLength(1);

    dock.ws.terminate();
    hud.ws.terminate();
  });

  it('keeps the member online when only the HUD closes, and marks them disconnected when the dock closes', async () => {
    const dock = await connect();
    const hud = await connect();

    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'squad-life', clientKind: 'dock', member: dockMember('mem-life', 'Life') },
    });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');
    hud.send({ type: 'JOIN_ROOM', payload: { roomId: 'squad-life', clientKind: 'hud' } });
    await hud.waitFor((m) => m.type === 'ROOM_STATE');

    dock.send({
      type: 'UPDATE_STATUS',
      payload: { roomId: 'squad-life', memberId: 'mem-life', status: { obsStatus: 'recording' } },
    });
    await hud.waitFor((m) => m.type === 'MEMBER_UPDATED');

    hud.ws.close();
    await until(() => roomManager.getConnections('squad-life').length === 1);
    expect(db.getRoomMembers('squad-life')[0].obsStatus).toBe('recording');
    expect(dock.messages.some((m) => m.type === 'MEMBER_LEFT')).toBe(false);

    const observer = await connect();
    observer.send({ type: 'JOIN_ROOM', payload: { roomId: 'squad-life', clientKind: 'dashboard' } });
    await observer.waitFor((m) => m.type === 'ROOM_STATE');

    dock.ws.close();
    const left = await observer.waitFor((m) => m.type === 'MEMBER_LEFT');
    expect(left.payload.memberId).toBe('mem-life');
    expect(db.getRoomMembers('squad-life')[0].obsStatus).toBe('disconnected');
    observer.ws.terminate();
  });

  it('rejects a dock join without member details', async () => {
    const dock = await connect();
    dock.send({ type: 'JOIN_ROOM', payload: { roomId: 'squad-x', clientKind: 'dock' } });
    const error = await dock.waitFor((m) => m.type === 'ERROR');
    expect(error.payload.code).toBe('INVALID_MESSAGE');
    expect(error.payload.message).toMatch(/member details/);
    dock.ws.terminate();
  });

  it('stamps markers with the calibrated client keypress time and stores the in-file position', async () => {
    const dock = await connect();
    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'squad-time', clientKind: 'dock', member: dockMember('mem-time', 'Time') },
    });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');

    const pressedAt = Date.now() - 1500; // the message took 1.5s to arrive
    dock.send({
      type: 'CREATE_MARKER',
      payload: {
        roomId: 'squad-time',
        clientTimestamp: pressedAt,
        marker: { sessionId: '', category: 'clutch', label: 'Clutch', color: 'Yellow', obsRecordMs: 42_000 },
      },
    });

    const added = await dock.waitFor((m) => m.type === 'MARKER_ADDED');
    expect(added.payload.timestamp).toBe(pressedAt);
    expect(added.payload.obsRecordMs).toBe(42_000);
    expect(db.getSessionMarkers(added.payload.sessionId)[0].obsRecordMs).toBe(42_000);
    dock.ws.terminate();
  });

  it('clamps forged or skewed client timestamps to a window around arrival', () => {
    const now = 1_700_000_000_000;
    expect(resolveMarkerTimestamp(undefined, now)).toBe(now);
    expect(resolveMarkerTimestamp(Number.NaN, now)).toBe(now);
    expect(resolveMarkerTimestamp(now - 3000, now)).toBe(now - 3000);
    expect(resolveMarkerTimestamp(now - 3_600_000, now)).toBe(now - MARKER_MAX_PAST_SKEW_MS);
    expect(resolveMarkerTimestamp(now + 60_000, now)).toBe(now + MARKER_MAX_FUTURE_SKEW_MS);
  });

  it('records a recording anchor and exports a per-POV timeline and an aligned sync matrix', async () => {
    const { hostToken } = roomManager.createRoom('squad-pov');
    const dock = await connect();
    dock.send({
      type: 'JOIN_ROOM',
      payload: { roomId: 'squad-pov', clientKind: 'dock', member: dockMember('mem-pov', 'Pov') },
    });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/rooms/squad-pov/session/start',
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { name: 'POV Test', baseTimecode: '00:00:00:00', framerateNumerator: 60, framerateDenominator: 1 },
    });
    const session = JSON.parse(startRes.payload);

    // Streamer's OBS was already recording 2s before the director started the session
    const recordStartedAt = session.startedAt - 2000;
    dock.send({
      type: 'UPDATE_STATUS',
      payload: {
        roomId: 'squad-pov',
        memberId: 'mem-pov',
        status: { obsStatus: 'recording', fpsNumerator: 30, fpsDenominator: 1, fps: 30, recordStartedAt },
      },
    });
    await dock.waitFor((m) => m.type === 'MEMBER_UPDATED');
    expect(db.getSessionAnchors(session.id)).toEqual([
      { sessionId: session.id, memberId: 'mem-pov', recordStartedAt, framerateNumerator: 30, framerateDenominator: 1 },
    ]);

    // A squadmate's marker (no obsRecordMs) is placed in this file via the calibrated wall clock
    dock.send({
      type: 'CREATE_MARKER',
      payload: {
        roomId: 'squad-pov',
        clientTimestamp: Date.now(),
        marker: { sessionId: session.id, category: 'kill', label: 'Pov Kill', color: 'Red' },
      },
    });
    const added = await dock.waitFor((m) => m.type === 'MARKER_ADDED');

    const edlRes = await app.inject({
      method: 'GET',
      url: `/api/rooms/squad-pov/export/edl?sessionId=${session.id}&memberId=mem-pov`,
    });
    expect(edlRes.statusCode).toBe(200);
    expect(edlRes.payload).toContain('TITLE: POV Test - Pov');
    const expectedMs = added.payload.timestamp - recordStartedAt;
    const expectedFrames = Math.floor((expectedMs * 30) / 1000 + 1e-6);
    const ss = String(Math.floor(expectedFrames / 30)).padStart(2, '0');
    const ff = String(expectedFrames % 30).padStart(2, '0');
    expect(edlRes.payload).toMatch(
      new RegExp(`C {8}00:00:${ss}:${ff} \\S+ 00:00:${ss}:${ff} \\S+ {2}\\r\\n \\|C:ResolveColorRed \\|M:Pov Kill`)
    );

    const matrixRes = await app.inject({
      method: 'GET',
      url: `/api/rooms/squad-pov/export/matrix?sessionId=${session.id}`,
    });
    const matrix = JSON.parse(matrixRes.payload);
    expect(matrix.members[0].aligned).toBe(true);
    expect(matrix.members[0].sessionOffsetMs).toBe(-2000);
    expect(matrix.members[0].sessionOffsetFrames).toBe(-60);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/rooms/squad-pov/export/edl?sessionId=${session.id}&memberId=nobody`,
    });
    expect(missing.statusCode).toBe(404);
    dock.ws.terminate();
  });

  it('sends safe Content-Disposition headers for session names with quotes and accents', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { id: 'squad-name', name: 'Names' },
    });
    const { hostToken } = JSON.parse(created.payload);
    await app.inject({
      method: 'POST',
      url: '/api/rooms/squad-name/session/start',
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { name: 'Final "Épica" / día 2' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/rooms/squad-name/export/csv' });
    const header = String(res.headers['content-disposition']);
    expect(header).toMatch(/^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
    expect(header).not.toContain('\\"');
    expect(header).toContain(encodeURIComponent('Final_Épica_día_2.csv'));
  });
});

describe('WebSocket heartbeat', () => {
  const hbDbPath = path.resolve(process.cwd(), 'test-heartbeat-streamcollab.sqlite');
  let app: any;
  let db: DatabaseService;
  let roomManager: any;
  let wsUrl = '';

  beforeAll(async () => {
    removeDb(hbDbPath);
    const server = await createServer({ dbPath: hbDbPath, logger: false, heartbeatIntervalMs: 40 });
    app = server.fastify;
    db = server.db;
    roomManager = server.roomManager;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;
    roomManager.createRoom('hb-room');
  });

  afterAll(async () => {
    await app.close();
    db.close();
    removeDb(hbDbPath);
  });

  it('terminates dead connections that stop answering pings and frees the member', async () => {
    const open = (autoPong: boolean) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(wsUrl, { autoPong });
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });

    const healthy = await open(true);
    const frozen = await open(false); // simulates a crashed OBS / dropped Wi-Fi

    healthy.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: 'hb-room', clientKind: 'hud' } }));
    frozen.send(
      JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { roomId: 'hb-room', clientKind: 'dock', member: dockMember('mem-frozen', 'Frozen') },
      })
    );
    await until(() => roomManager.getConnections('hb-room').length === 2);

    await until(() => roomManager.getConnections('hb-room').length === 1, 1000);
    expect(roomManager.getConnections('hb-room')[0].kind).toBe('hud');
    expect(db.getRoomMembers('hb-room')[0].obsStatus).toBe('disconnected');

    healthy.terminate();
    frozen.terminate();
  });
});

describe('DatabaseService schema migrations', () => {
  const legacyDbPath = path.resolve(process.cwd(), 'test-legacy-streamcollab.sqlite');

  afterAll(() => removeDb(legacyDbPath));

  it('upgrades a v1.0.0 database in place without losing data', () => {
    removeDb(legacyDbPath);
    const legacy = new DatabaseSync(legacyDbPath);
    legacy.exec(`
      CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, active_session_id TEXT);
      CREATE TABLE members (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'player', obs_status TEXT NOT NULL DEFAULT 'disconnected', stream_url TEXT,
        fps REAL NOT NULL DEFAULT 60.0, output_duration_ms INTEGER NOT NULL DEFAULT 0,
        clock_offset_ms REAL NOT NULL DEFAULT 0.0, rtt_ms REAL NOT NULL DEFAULT 0.0, last_heartbeat INTEGER NOT NULL
      );
      CREATE TABLE recording_sessions (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, started_at INTEGER NOT NULL, stopped_at INTEGER,
        base_timecode TEXT NOT NULL DEFAULT '01:00:00:00', framerate_num INTEGER NOT NULL DEFAULT 60,
        framerate_den INTEGER NOT NULL DEFAULT 1, drop_frame INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE markers (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
        member_name TEXT NOT NULL, timestamp INTEGER NOT NULL, relative_time_ms INTEGER NOT NULL, timecode TEXT NOT NULL,
        frame_number INTEGER NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL, comment TEXT, color TEXT NOT NULL, tags TEXT
      );
      INSERT INTO rooms VALUES ('old-room', 'Old Room', 1700000000000, NULL);
      INSERT INTO members (id, room_id, name, last_heartbeat) VALUES ('old-mem', 'old-room', 'Veteran', 1700000000000);
    `);
    legacy.close();

    const db = new DatabaseService(legacyDbPath);
    expect(db.getSchemaVersion()).toBe(SCHEMA_VERSION);
    expect(db.getRoom('old-room')?.name).toBe('Old Room');
    const [member] = db.getRoomMembers('old-room');
    expect(member.name).toBe('Veteran');
    expect(member.recordStartedAt).toBeNull();
    db.close();

    // Re-opening an up-to-date database is a no-op
    const reopened = new DatabaseService(legacyDbPath);
    expect(reopened.getSchemaVersion()).toBe(SCHEMA_VERSION);
    reopened.close();
  });
});
