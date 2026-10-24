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
}

const dockMember = (id: string) => ({
  id,
  name: id,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

describe('Marker editing, undo and session history', () => {
  const dbPath = path.resolve(process.cwd(), 'test-markers-streamcollab.sqlite');
  let app: any;
  let db: DatabaseService;
  let wsUrl = '';
  let roomId = '';
  let hostToken = '';
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

  const joinDock = async (memberId: string) => {
    const client = await connect();
    client.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'dock', member: dockMember(memberId) } });
    const joined = await client.waitFor((m) => m.type === 'JOINED');
    await client.waitFor((m) => m.type === 'ROOM_STATE');
    return { client, memberToken: joined.payload.memberToken as string };
  };

  const mark = async (client: TestClient, label: string, category = 'kill') => {
    client.send({ type: 'CREATE_MARKER', payload: { marker: { category, label } } });
    const added = await client.waitFor((m) => m.type === 'MARKER_ADDED' && m.payload.label === label);
    return added.payload;
  };

  beforeAll(async () => {
    removeDb(dbPath);
    const server = await createServer({ dbPath, logger: false });
    app = server.fastify;
    db = server.db;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;

    const created = JSON.parse((await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).payload);
    roomId = created.id;
    hostToken = created.hostToken;
  });

  afterAll(async () => {
    open.forEach((ws) => ws.terminate());
    await app.close();
    db.close();
    removeDb(dbPath);
  });

  it('lets the author edit their marker and broadcasts the change', async () => {
    const { client: alpha } = await joinDock('mem-alpha');
    const hud = await connect();
    hud.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'hud' } });
    await hud.waitFor((m) => m.type === 'ROOM_STATE');

    const marker = await mark(alpha, 'Typo Kil');
    alpha.send({
      type: 'UPDATE_MARKER',
      payload: { markerId: marker.id, changes: { label: 'Triple Kill', category: 'clutch', comment: 'off the wall' } },
    });

    const updated = await hud.waitFor((m) => m.type === 'MARKER_UPDATED');
    expect(updated.payload).toMatchObject({
      id: marker.id,
      label: 'Triple Kill',
      category: 'clutch',
      color: 'Yellow', // new category brings its default DaVinci color
      comment: 'off the wall',
      timecode: marker.timecode, // timing never changes
    });
    expect(db.getMarker(marker.id)?.label).toBe('Triple Kill');

    // comment: null clears it; an explicit color wins over the category default
    alpha.send({ type: 'UPDATE_MARKER', payload: { markerId: marker.id, changes: { comment: null, color: 'Mint' } } });
    const cleared = await alpha.waitFor((m) => m.type === 'MARKER_UPDATED' && m.payload.color === 'Mint');
    expect(cleared.payload.comment).toBeUndefined();

    const edl = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/export/edl` });
    expect(edl.payload).toContain('|C:ResolveColorMint |M:Triple Kill');
  });

  it("does not let a squadmate change someone else's marker, but the host can", async () => {
    const { client: owner } = await joinDock('mem-owner');
    const { client: mate } = await joinDock('mem-mate');
    const marker = await mark(owner, 'Owner Kill');

    mate.send({ type: 'UPDATE_MARKER', payload: { markerId: marker.id, changes: { label: 'Stolen' } } });
    expect((await mate.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');
    mate.send({ type: 'DELETE_MARKER', payload: { markerId: marker.id } });
    expect((await mate.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');
    expect(db.getMarker(marker.id)?.label).toBe('Owner Kill');

    const host = await connect();
    host.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'dashboard', hostToken } });
    await host.waitFor((m) => m.type === 'ROOM_STATE');
    host.send({ type: 'UPDATE_MARKER', payload: { markerId: marker.id, changes: { label: 'Director Fix' } } });
    await host.waitFor((m) => m.type === 'MARKER_UPDATED' && m.payload.label === 'Director Fix');

    host.send({ type: 'DELETE_MARKER', payload: { markerId: marker.id } });
    const deleted = await owner.waitFor((m) => m.type === 'MARKER_DELETED');
    expect(deleted.payload).toEqual({ markerId: marker.id, sessionId: marker.sessionId });
    expect(db.getMarker(marker.id)).toBeNull();
  });

  it('rejects unknown markers, markers of other rooms and empty edits', async () => {
    const { client } = await joinDock('mem-edge');
    client.send({ type: 'DELETE_MARKER', payload: { markerId: 'does-not-exist' } });
    expect((await client.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('NOT_FOUND');

    const other = JSON.parse((await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).payload);
    const { client: outsider } = await (async () => {
      const c = await connect();
      c.send({
        type: 'JOIN_ROOM',
        payload: { roomId: other.id, clientKind: 'dock', member: dockMember('mem-outsider') },
      });
      await c.waitFor((m) => m.type === 'ROOM_STATE');
      return { client: c };
    })();
    const foreign = await mark(outsider, 'Other Room Kill');
    client.send({ type: 'DELETE_MARKER', payload: { markerId: foreign.id } });
    expect((await client.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('NOT_FOUND');
    expect(db.getMarker(foreign.id)).not.toBeNull();

    const own = await mark(client, 'Edge Kill');
    client.send({ type: 'UPDATE_MARKER', payload: { markerId: own.id, changes: {} } });
    const invalid = await client.waitFor((m) => m.type === 'ERROR');
    expect(invalid.payload.code).toBe('INVALID_MESSAGE');
    expect(invalid.payload.message).toMatch(/at least one field/);
  });

  it('undoes only your own most recent markers, newest first', async () => {
    const { client: undoer } = await joinDock('mem-undo');
    const { client: other } = await joinDock('mem-bystander');

    const first = await mark(undoer, 'First');
    await new Promise((r) => setTimeout(r, 5));
    const second = await mark(undoer, 'Second');
    const bystander = await mark(other, 'Bystander');

    undoer.send({ type: 'UNDO_LAST_MARKER' });
    expect((await undoer.waitFor((m) => m.type === 'MARKER_DELETED')).payload.markerId).toBe(second.id);
    undoer.send({ type: 'UNDO_LAST_MARKER', payload: {} });
    expect((await undoer.waitFor((m) => m.type === 'MARKER_DELETED')).payload.markerId).toBe(first.id);
    undoer.send({ type: 'UNDO_LAST_MARKER' });
    expect((await undoer.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('NOT_FOUND');

    expect(db.getMarker(bystander.id)).not.toBeNull();

    const hud = await connect();
    hud.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'hud' } });
    await hud.waitFor((m) => m.type === 'ROOM_STATE');
    hud.send({ type: 'UNDO_LAST_MARKER' });
    expect((await hud.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');
  });

  it('undoes over HTTP with the member token (Stream Deck)', async () => {
    const { client, memberToken } = await joinDock('mem-deck-undo');
    const marker = await mark(client, 'Deck Oops');
    const url = `/api/rooms/${roomId}/markers/undo`;
    const payload = { memberId: 'mem-deck-undo' };

    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${memberToken}` } });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).removed.id).toBe(marker.id);
    const none = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(none.statusCode).toBe(404);
  });

  it('lists the session history newest first with marker counts', async () => {
    const auth = { authorization: `Bearer ${hostToken}` };
    const active = db.getActiveSession(roomId)!;
    const countBefore = db.getSessionMarkers(active.id).length;

    await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/session/stop`, payload: {}, headers: auth });
    const started = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/session/start`,
      payload: { name: 'Round 2' },
      headers: auth,
    });
    const round2 = JSON.parse(started.payload);

    const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/sessions` });
    expect(res.statusCode).toBe(200);
    const sessions = JSON.parse(res.payload);
    expect(sessions.map((s: any) => s.id)).toEqual([round2.id, active.id]);
    expect(sessions[0]).toMatchObject({ name: 'Round 2', markerCount: 0, stoppedAt: null });
    expect(sessions[1].markerCount).toBe(countBefore);
    expect(sessions[1].stoppedAt).toBeGreaterThan(0);

    expect((await app.inject({ method: 'GET', url: '/api/rooms/NOPE-0000/sessions' })).statusCode).toBe(404);
  });
});
