import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createServer } from '../src/index.js';
import { DatabaseService, SCHEMA_VERSION, RESUME_AFTER_CLEAN_SHUTDOWN_MS } from '../src/db/database.js';
import { RoomManager, RoomError } from '../src/rooms/roomManager.js';
import { attachmentDisposition } from '../src/routes/api.js';
import { loadConfig } from '../src/config.js';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.unlinkSync(`${dbPath}${suffix}`);
  }
}

interface TestClient {
  ws: WebSocket;
  messages: any[];
  closed: Promise<number>;
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  send: (msg: unknown) => void;
}

function connectTo(wsUrl: string, open: WebSocket[]) {
  return new Promise<TestClient>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    open.push(ws);
    const messages: any[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<number>((res) => ws.once('close', (code) => res(code)));
    const client: TestClient = {
      ws,
      messages,
      closed,
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
}

const dockMember = (id: string) => ({
  id,
  name: id,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

describe('v1.6.2 database integrity', () => {
  const dbPath = path.resolve(process.cwd(), 'test-audit-v162-db.sqlite');
  let db: DatabaseService;
  let rooms: RoomManager;

  beforeEach(() => {
    removeDb(dbPath);
    db = new DatabaseService(dbPath);
    rooms = new RoomManager(db);
  });

  afterEach(() => {
    db.close();
    removeDb(dbPath);
  });

  it('keeps transactions working after a BEGIN that failed (e.g. SQLITE_BUSY)', () => {
    const raw = (db as any).db as DatabaseSync;
    const realExec = raw.exec.bind(raw);
    let failNextBegin = true;
    raw.exec = (sql: string) => {
      if (failNextBegin && sql === 'BEGIN IMMEDIATE') {
        failNextBegin = false;
        throw new Error('database is locked');
      }
      return realExec(sql);
    };

    expect(() => db.transaction(() => db.createRoom('LOCKED-1', 'x'))).toThrow('database is locked');
    expect(db.roomExists('LOCKED-1')).toBe(false);

    // The next transaction is a real one again: a failure inside it rolls everything back
    expect(() =>
      db.transaction(() => {
        db.createRoom('ROLLED-BACK', 'x');
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(db.roomExists('ROLLED-BACK')).toBe(false);
    raw.exec = realExec;
  });

  it('keeps the original error when SQLite already ended the transaction', () => {
    const raw = (db as any).db as DatabaseSync;
    expect(() =>
      db.transaction(() => {
        raw.exec('ROLLBACK'); // what SQLite does by itself on SQLITE_FULL / IOERR
        throw new Error('disk full');
      })
    ).toThrow('disk full');
    // and the service is usable afterwards
    db.transaction(() => db.createRoom('AFTER-FULL', 'x'));
    expect(db.roomExists('AFTER-FULL')).toBe(true);
  });

  it('runs afterCommit callbacks only once the transaction commits', () => {
    const ran: string[] = [];
    db.transaction(() => {
      db.afterCommit(() => ran.push('committed'));
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['committed']);

    expect(() =>
      db.transaction(() => {
        db.afterCommit(() => ran.push('rolled back'));
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(ran).toEqual(['committed']);

    db.afterCommit(() => ran.push('no transaction'));
    expect(ran).toEqual(['committed', 'no transaction']);
  });

  it('stopping an old session neither moves its end nor orphans the running one', () => {
    rooms.createRoom('STOP-ROOM', 'x');
    const first = rooms.startSession('STOP-ROOM', { name: 'first' });
    const stoppedFirst = rooms.stopSession('STOP-ROOM', first.id)!;
    const second = rooms.startSession('STOP-ROOM', { name: 'second' });

    const again = rooms.stopSession('STOP-ROOM', first.id);
    expect(again?.stoppedAt).toBe(stoppedFirst.stoppedAt);
    expect(db.getActiveSession('STOP-ROOM')?.id).toBe(second.id);
    expect(db.getSession(second.id)?.stoppedAt).toBeNull();
  });

  it('never stores a marker in a session that already stopped', () => {
    rooms.createRoom('LATE-ROOM', 'x');
    const stopped = rooms.startSession('LATE-ROOM', { name: 'ended' });
    rooms.stopSession('LATE-ROOM', stopped.id);
    const running = rooms.startSession('LATE-ROOM', { name: 'running' });

    const marker = rooms.createMarker({
      roomId: 'LATE-ROOM',
      sessionId: stopped.id, // a dock that hasn't seen SESSION_STOPPED yet
      memberId: 'm1',
      memberName: 'm1',
      category: 'kill',
      label: 'late',
    });
    expect(marker.sessionId).toBe(running.id);
    expect(db.getSessionMarkers(stopped.id)).toEqual([]);
  });

  it('undo only reaches markers of the running session', () => {
    rooms.createRoom('UNDO-ROOM', 'x');
    rooms.startSession('UNDO-ROOM', { name: 'ended' });
    rooms.createMarker({ roomId: 'UNDO-ROOM', memberId: 'm1', memberName: 'm1', category: 'kill', label: 'keep' });
    rooms.stopSession('UNDO-ROOM', db.getActiveSession('UNDO-ROOM')!.id);

    expect(() => rooms.undoLastMarker('UNDO-ROOM', 'm1')).toThrow(RoomError);
    expect(db.getRoomMarkers('UNDO-ROOM')).toHaveLength(1);
  });

  it('validates the merged framerate of a partial status update', () => {
    rooms.createRoom('FPS-ROOM', 'x');
    db.upsertMember('FPS-ROOM', {
      ...dockMember('m-fps'),
      clockOffsetMs: 0,
      rttMs: 0,
      lastHeartbeat: Date.now(),
      fpsNumerator: 30000,
      fpsDenominator: 1001,
    });
    expect(() => rooms.updateMember('FPS-ROOM', 'm-fps', { fpsNumerator: 1 })).toThrow(/1-1000 fps/);
    expect(db.getRoomMembers('FPS-ROOM')[0].fpsNumerator).toBe(30000);
    rooms.updateMember('FPS-ROOM', 'm-fps', { fpsNumerator: 60000 });
    expect(db.getRoomMembers('FPS-ROOM')[0].fpsNumerator).toBe(60000);
  });

  it('broadcasts SESSION_STOPPED only after the session switch committed', () => {
    rooms.createRoom('ORDER-ROOM', 'x');
    const first = rooms.startSession('ORDER-ROOM', { name: 'first' });
    const sent: string[] = [];
    rooms.broadcastToRoom = (_roomId, message) => {
      sent.push(`${message.type}:${db.getActiveSession('ORDER-ROOM')?.name ?? 'none'}`);
    };

    // The new session fails to be written: the old one must keep running and nobody hears it stopped
    const createSession = db.createSession.bind(db);
    db.createSession = () => {
      throw new Error('insert failed');
    };
    expect(() => rooms.startSession('ORDER-ROOM', { name: 'second' })).toThrow('insert failed');
    expect(sent).toEqual([]);
    expect(db.getActiveSession('ORDER-ROOM')?.id).toBe(first.id);
    expect(db.getSession(first.id)?.stoppedAt).toBeNull();

    db.createSession = createSession;
    rooms.startSession('ORDER-ROOM', { name: 'second' });
    expect(sent).toEqual(['SESSION_STOPPED:second', 'SESSION_STARTED:second']);
  });
});

describe('v1.6.2 restart recovery and migration v5', () => {
  const dbPath = path.resolve(process.cwd(), 'test-audit-v162-restart.sqlite');

  beforeEach(() => removeDb(dbPath));
  afterEach(() => removeDb(dbPath));

  const seed = () => {
    const db = new DatabaseService(dbPath);
    const rooms = new RoomManager(db);
    rooms.createRoom('RESTART-ROOM', 'x');
    const session = rooms.startSession('RESTART-ROOM', { name: 'live' });
    db.upsertMember('RESTART-ROOM', {
      ...dockMember('m-rec'),
      obsStatus: 'recording',
      clockOffsetMs: 0,
      rttMs: 0,
      lastHeartbeat: Date.now(),
      recordStartedAt: session.startedAt,
    });
    return { db, rooms, session };
  };

  it('resumes running sessions after a recent clean shutdown', () => {
    const { db, session } = seed();
    const shutdownAt = Date.now();
    db.markCleanShutdown(shutdownAt);
    db.close();

    const reopened = new DatabaseService(dbPath);
    const result = reopened.recoverAfterRestart(shutdownAt + 60_000);
    expect(result).toEqual({ resumed: true, closedCount: 0 });
    expect(reopened.getActiveSession('RESTART-ROOM')?.id).toBe(session.id);
    // Nobody's dock is connected yet: no stale "recording" member can anchor a new session
    expect(reopened.getRoomMembers('RESTART-ROOM')[0].obsStatus).toBe('disconnected');

    // The flag is consumed: a crash right after this start is a crash
    reopened.close();
    const third = new DatabaseService(dbPath);
    expect(third.recoverAfterRestart(shutdownAt + 120_000).resumed).toBe(false);
    third.close();
  });

  it('closes sessions at the last heartbeat after a crash, not at the last marker', () => {
    const { db, session } = seed();
    const lastAlive = session.startedAt + 2 * 60 * 60_000; // ran for two hours with no marker
    db.markAlive(lastAlive);
    db.close();

    const reopened = new DatabaseService(dbPath);
    expect(reopened.recoverAfterRestart(lastAlive + 5_000)).toEqual({ resumed: false, closedCount: 1 });
    expect(reopened.getSession(session.id)?.stoppedAt).toBe(lastAlive);
    expect(reopened.getActiveSession('RESTART-ROOM')).toBeNull();
    reopened.close();
  });

  it('treats a clean shutdown long ago like a crash', () => {
    const { db, session } = seed();
    const shutdownAt = session.startedAt + 30_000;
    db.markCleanShutdown(shutdownAt);
    db.close();

    const reopened = new DatabaseService(dbPath);
    const result = reopened.recoverAfterRestart(shutdownAt + RESUME_AFTER_CLEAN_SHUTDOWN_MS + 1);
    expect(result.resumed).toBe(false);
    expect(reopened.getSession(session.id)?.stoppedAt).toBe(shutdownAt);
    reopened.close();
  });

  it('migration v5 repairs sessions that v4 closed before they started', () => {
    const { db, session } = seed();
    db.stopSession(session.id);
    db.close();

    // Rewind the file to schema v4 with the corruption v4's orphan clean-up could produce
    const raw = new DatabaseSync(dbPath);
    raw.exec(`UPDATE recording_sessions SET stopped_at = started_at - 1500 WHERE id = '${session.id}'`);
    raw.exec('DROP TABLE server_state');
    raw.exec('PRAGMA user_version = 4');
    raw.close();

    const migrated = new DatabaseService(dbPath);
    expect(migrated.getSchemaVersion()).toBe(SCHEMA_VERSION);
    expect(migrated.getSession(session.id)?.stoppedAt).toBe(session.startedAt);
    migrated.close();
  });

  it('refuses a database written by a newer StreamCollab', () => {
    const { db } = seed();
    db.close();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    expect(() => new DatabaseService(dbPath)).toThrow(/newer than this StreamCollab build supports/);
  });
});

describe('v1.6.2 HTTP and WebSocket hardening', () => {
  const dbPath = path.resolve(process.cwd(), 'test-audit-v162-net.sqlite');
  let app: any;
  let db: DatabaseService;
  let wsUrl = '';
  const open: WebSocket[] = [];
  const connect = () => connectTo(wsUrl, open);

  beforeAll(async () => {
    removeDb(dbPath);
    const server = await createServer({
      dbPath,
      logger: false,
      unjoinedTimeoutMs: 300,
      joinFailureLimit: { max: 3, windowMs: 60_000 },
      maxSocketsPerIp: 6,
    });
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

  afterEach(async () => {
    // Every test starts with no open sockets (they count towards the per-IP cap)
    open.splice(0).forEach((ws) => ws.terminate());
    await new Promise((r) => setTimeout(r, 50));
  });

  const createRoom = async (payload: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: 'POST', url: '/api/rooms', payload });
    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };

  it('rejects an export for a session that does not exist instead of exporting another one', async () => {
    const { body: room } = await createRoom();
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/session/start`,
      payload: {},
      headers: { authorization: `Bearer ${room.hostToken}` },
    });
    const missing = await app.inject({ method: 'GET', url: `/api/rooms/${room.id}/export/edl?sessionId=nope` });
    expect(missing.statusCode).toBe(404);
    const latest = await app.inject({ method: 'GET', url: `/api/rooms/${room.id}/export/edl` });
    expect(latest.statusCode).toBe(200);
  });

  it('answers 400 (not 500) to a repeated query parameter', async () => {
    const { body: room } = await createRoom();
    for (const url of [
      `/api/rooms/${room.id}/markers?sessionId=a&sessionId=b`,
      `/api/rooms/${room.id}/export/csv?sessionId=a&sessionId=b`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
  });

  it('requires custom room codes at least as long as generated ones', async () => {
    expect((await createRoom({ id: 'ABC' })).status).toBe(400);
    expect((await createRoom({ id: 'ABCD-1234' })).status).toBe(201);
  });

  it('closes a socket that left its room once the unjoined timeout passes', async () => {
    const { body: room } = await createRoom();
    const hud = await connect();
    hud.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'hud' } });
    await hud.waitFor((m) => m.type === 'JOINED');
    hud.send({ type: 'LEAVE_ROOM' });
    expect((await hud.waitFor((m) => m.type === 'ERROR', 2000)).payload.code).toBe('TIMEOUT');
    expect(await hud.closed).toBe(1008);
  });

  it('closes sockets of a deleted room once the unjoined timeout passes', async () => {
    const { body: room } = await createRoom();
    const hud = await connect();
    hud.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'hud' } });
    await hud.waitFor((m) => m.type === 'JOINED');
    await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}`,
      headers: { authorization: `Bearer ${room.hostToken}` },
    });
    await hud.waitFor((m) => m.type === 'ROOM_DELETED');
    expect((await hud.waitFor((m) => m.type === 'ERROR', 2000)).payload.code).toBe('TIMEOUT');
    expect(await hud.closed).toBe(1008);
  });

  it('caps simultaneous sockets per IP', async () => {
    const sockets = await Promise.all(Array.from({ length: 6 }, () => connect()));
    const extra = await connect();
    expect((await extra.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('RATE_LIMITED');
    expect(await extra.closed).toBe(1008);

    // A slot frees up when a socket closes
    sockets[0].ws.close();
    await sockets[0].closed;
    await new Promise((r) => setTimeout(r, 50));
    const replacement = await connect();
    replacement.send({ type: 'SNTP_PING', payload: { t1: Date.now() } });
    expect((await replacement.waitFor((m) => m.type === 'SNTP_PONG')).type).toBe('SNTP_PONG');
  });

  // Last: it blocks this IP for the rest of the window
  it('counts unknown room codes over HTTP and WebSocket together', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: `/api/rooms/GUESS-000${i}` })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/api/rooms/GUESS-0003' })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/api/rooms/GUESS-0003/export/edl' })).statusCode).toBe(429);

    const ws = await connect();
    ws.send({ type: 'JOIN_ROOM', payload: { roomId: 'GUESS-0004', clientKind: 'hud' } });
    expect((await ws.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('RATE_LIMITED');
  });
});

describe('v1.6.2 small fixes', () => {
  it('treats empty PORT / HOST / LOG_LEVEL / ROOM_CREATE_LIMIT_PER_MINUTE as unset', () => {
    expect(loadConfig({ PORT: '', HOST: '', LOG_LEVEL: '', ROOM_CREATE_LIMIT_PER_MINUTE: ' ' })).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      roomCreateLimitPerMinute: 10,
    });
  });

  it("percent-encodes ' ( ) * in the RFC 5987 file name", () => {
    expect(attachmentDisposition("Rock'n (roll)*.edl")).toBe(
      `attachment; filename="Rock'n_(roll).edl"; filename*=UTF-8''Rock%27n_%28roll%29.edl`
    );
  });
});
