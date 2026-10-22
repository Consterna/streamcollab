import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { createServer } from '../src/index.js';
import { DatabaseService } from '../src/db/database.js';

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
  closed: Promise<number>;
}

const dockMember = (id: string) => ({
  id,
  name: id,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

async function until(condition: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('Audit fixes: room codes, presence, deletion, join limits', () => {
  const dbPath = path.resolve(process.cwd(), 'test-audit-streamcollab.sqlite');
  let app: any;
  let db: DatabaseService;
  let roomManager: any;
  let wsUrl = '';
  const open: WebSocket[] = [];

  const connect = () =>
    new Promise<TestClient>((resolve, reject) => {
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

  const createRoom = async () =>
    JSON.parse((await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).payload) as {
      id: string;
      hostToken: string;
    };

  beforeAll(async () => {
    removeDb(dbPath);
    const server = await createServer({
      dbPath,
      logger: false,
      joinFailureLimit: { max: 5, windowMs: 60_000 },
    });
    app = server.fastify;
    db = server.db;
    roomManager = server.roomManager;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;
  });

  afterAll(async () => {
    open.forEach((ws) => ws.terminate());
    await app.close();
    db.close();
    removeDb(dbPath);
  });

  it('accepts room codes typed in any letter case', async () => {
    const room = await createRoom();
    const lower = room.id.toLowerCase();

    const dock = await connect();
    dock.send({ type: 'JOIN_ROOM', payload: { roomId: lower, clientKind: 'dock', member: dockMember('mem-case') } });
    const joined = await dock.waitFor((m) => m.type === 'JOINED');
    expect(joined.payload.roomId).toBe(room.id); // canonical spelling
    expect(db.getRoomMembers(room.id).map((m) => m.id)).toContain('mem-case');

    const rest = await app.inject({ method: 'GET', url: `/api/rooms/${lower}/sessions` });
    expect(rest.statusCode).toBe(200);
    const duplicate = await app.inject({ method: 'POST', url: '/api/rooms', payload: { id: lower } });
    expect(duplicate.statusCode).toBe(409);
  });

  it('reports member presence and lets the host remove only offline members', async () => {
    const room = await createRoom();
    const dock = await connect();
    dock.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dock', member: dockMember('mem-ghost') } });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');

    const host = await connect();
    host.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dashboard', hostToken: room.hostToken } });
    const state = await host.waitFor((m) => m.type === 'ROOM_STATE');
    expect(state.payload.room.members.find((m: any) => m.id === 'mem-ghost').online).toBe(true);

    host.send({ type: 'REMOVE_MEMBER', payload: { memberId: 'mem-ghost' } });
    expect((await host.waitFor((m) => m.type === 'ERROR')).payload.message).toMatch(/online/);

    dock.ws.close();
    await host.waitFor((m) => m.type === 'MEMBER_LEFT');
    const viewer = await connect();
    viewer.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dashboard' } });
    const viewerState = await viewer.waitFor((m) => m.type === 'ROOM_STATE');
    expect(viewerState.payload.room.members.find((m: any) => m.id === 'mem-ghost').online).toBe(false);
    viewer.send({ type: 'REMOVE_MEMBER', payload: { memberId: 'mem-ghost' } });
    expect((await viewer.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');

    host.send({ type: 'REMOVE_MEMBER', payload: { memberId: 'mem-ghost' } });
    await viewer.waitFor((m) => m.type === 'MEMBER_REMOVED' && m.payload.memberId === 'mem-ghost');
    expect(db.getRoomMembers(room.id)).toHaveLength(0);
    // Only the membership goes: the id stays bound to its device, so nobody else can claim it now
    expect(db.getMemberTokenHash('mem-ghost')).not.toBeNull();
    const claimer = await connect();
    claimer.send({
      type: 'JOIN_ROOM',
      payload: { roomId: room.id, clientKind: 'dock', member: dockMember('mem-ghost') },
    });
    expect((await claimer.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('MEMBER_TOKEN_INVALID');
  });

  it('lets the host delete finished sessions (with their markers) but not the live one', async () => {
    const room = await createRoom();
    const auth = { authorization: `Bearer ${room.hostToken}` };
    const start = async (name: string) =>
      JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/rooms/${room.id}/session/start`,
            payload: { name },
            headers: auth,
          })
        ).payload
      );

    const first = await start('Warmup');
    const dock = await connect();
    dock.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dock', member: dockMember('mem-del') } });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');
    dock.send({ type: 'CREATE_MARKER', payload: { marker: { category: 'note', label: 'Warmup note' } } });
    await dock.waitFor((m) => m.type === 'MARKER_ADDED');

    const live = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}/sessions/${first.id}`,
      headers: auth,
    });
    expect(live.statusCode).toBe(409);

    await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/session/stop`, payload: {}, headers: auth });
    await start('Match');

    const anonymous = await app.inject({ method: 'DELETE', url: `/api/rooms/${room.id}/sessions/${first.id}` });
    expect(anonymous.statusCode).toBe(403);

    const ok = await app.inject({ method: 'DELETE', url: `/api/rooms/${room.id}/sessions/${first.id}`, headers: auth });
    expect(ok.statusCode).toBe(204);
    await dock.waitFor((m) => m.type === 'SESSION_DELETED' && m.payload.sessionId === first.id);
    expect(db.getSession(first.id)).toBeNull();
    expect(db.getSessionMarkers(first.id)).toHaveLength(0);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}/sessions/${first.id}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
  });

  it('lets the host delete the whole room and tells connected clients', async () => {
    const room = await createRoom();
    const dock = await connect();
    dock.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'dock', member: dockMember('mem-gone') } });
    await dock.waitFor((m) => m.type === 'ROOM_STATE');

    expect((await app.inject({ method: 'DELETE', url: `/api/rooms/${room.id}` })).statusCode).toBe(403);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}`,
      headers: { authorization: `Bearer ${room.hostToken}` },
    });
    expect(res.statusCode).toBe(204);

    await dock.waitFor((m) => m.type === 'ROOM_DELETED');
    expect(db.roomExists(room.id)).toBe(false);
    expect(db.getRoomMembers(room.id)).toHaveLength(0);
    expect(roomManager.getConnections(room.id)).toEqual([]);

    // The detached socket can't act on the deleted room any more
    dock.send({ type: 'CREATE_MARKER', payload: { marker: { category: 'kill', label: 'Too late' } } });
    expect((await dock.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('NOT_JOINED');
  });

  it('blocks an IP that keeps guessing room codes', async () => {
    const guesser = await connect();
    for (let i = 0; i < 5; i++) {
      guesser.send({ type: 'JOIN_ROOM', payload: { roomId: `GUES-${1000 + i}`, clientKind: 'hud' } });
    }
    await until(() => guesser.messages.filter((m) => m.payload?.code === 'ROOM_NOT_FOUND').length === 5);

    // A brand-new socket from the same IP is refused too, even for a real room
    const room = await createRoom();
    const fresh = await connect();
    fresh.send({ type: 'JOIN_ROOM', payload: { roomId: room.id, clientKind: 'hud' } });
    expect((await fresh.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('RATE_LIMITED');
    expect(await fresh.closed).toBe(1008);
  });
});
