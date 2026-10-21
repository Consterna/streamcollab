import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { createServer, parseOriginList } from '../src/index.js';
import { DatabaseService } from '../src/db/database.js';
import { hashToken, tokenMatches, generateRoomCode, bearerToken } from '../src/auth/tokens.js';
import { LIMITS } from '@streamcollab/shared';

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

const dockMember = (id: string, name: string) => ({
  id,
  name,
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
});

describe('Token helpers', () => {
  it('stores only hashes and compares in constant time', () => {
    const hash = hashToken('secret-token-value-123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches('secret-token-value-123456', hash)).toBe(true);
    expect(tokenMatches('secret-token-value-123457', hash)).toBe(false);
    expect(tokenMatches(undefined, hash)).toBe(false);
    expect(tokenMatches('secret-token-value-123456', null)).toBe(false);
  });

  it('generates human-friendly room codes without ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRoomCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    }
  });

  it('parses bearer tokens and origin lists', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer   xyz')).toBe('xyz');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
    expect(parseOriginList(' https://a.com, https://b.com ,')).toEqual(['https://a.com', 'https://b.com']);
    expect(parseOriginList(undefined)).toEqual([]);
  });
});

describe('Room access control', () => {
  const dbPath = path.resolve(process.cwd(), 'test-security-streamcollab.sqlite');
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
              const found = messages.find(predicate);
              if (found) return res(found);
              if (Date.now() - started > timeoutMs) return rej(new Error('Timed out waiting for message'));
              setTimeout(check, 5);
            };
            check();
          }),
      };
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });

  const joinDock = async (memberId: string, extra: Record<string, unknown> = {}, room = roomId) => {
    const client = await connect();
    client.send({
      type: 'JOIN_ROOM',
      payload: { roomId: room, clientKind: 'dock', member: dockMember(memberId, memberId), ...extra },
    });
    return client;
  };

  beforeAll(async () => {
    removeDb(dbPath);
    const server = await createServer({
      dbPath,
      logger: false,
      adminToken: 'admin-secret-token-abcdef',
      allowedOrigins: ['https://director.example'],
    });
    app = server.fastify;
    db = server.db;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = `${address.replace('http', 'ws')}/ws`;

    const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Secure Squad' } });
    const created = JSON.parse(res.payload);
    roomId = created.id;
    hostToken = created.hostToken;
  });

  afterAll(async () => {
    open.forEach((ws) => ws.terminate());
    await app.close();
    db.close();
    removeDb(dbPath);
  });

  describe('REST', () => {
    it('creates rooms with a generated code and a host token that is never stored in clear', () => {
      expect(roomId).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(hostToken.length).toBeGreaterThanOrEqual(40);
      expect(db.getRoomHostTokenHash(roomId)).toBe(hashToken(hostToken));
    });

    it('rejects invalid and duplicate room ids', async () => {
      const invalid = await app.inject({ method: 'POST', url: '/api/rooms', payload: { id: 'bad id!' } });
      expect(invalid.statusCode).toBe(400);
      const duplicate = await app.inject({ method: 'POST', url: '/api/rooms', payload: { id: roomId } });
      expect(duplicate.statusCode).toBe(409);
    });

    it('hides the room list unless the admin token is presented', async () => {
      const anonymous = await app.inject({ method: 'GET', url: '/api/rooms' });
      expect(anonymous.statusCode).toBe(404);
      const wrong = await app.inject({ method: 'GET', url: '/api/rooms', headers: { authorization: 'Bearer nope' } });
      expect(wrong.statusCode).toBe(404);
      const admin = await app.inject({
        method: 'GET',
        url: '/api/rooms',
        headers: { authorization: 'Bearer admin-secret-token-abcdef' },
      });
      expect(admin.statusCode).toBe(200);
      expect(JSON.parse(admin.payload).some((r: any) => r.id === roomId)).toBe(true);
    });

    it('requires the host token to start and stop sessions', async () => {
      const url = `/api/rooms/${roomId}/session/start`;
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            payload: {},
            headers: { authorization: 'Bearer wrong-token-0000000000' },
          })
        ).statusCode
      ).toBe(403);

      const bad = await app.inject({
        method: 'POST',
        url,
        payload: { baseTimecode: 'not-a-timecode' },
        headers: { authorization: `Bearer ${hostToken}` },
      });
      expect(bad.statusCode).toBe(400);
      expect(JSON.parse(bad.payload).error).toMatch(/baseTimecode/);

      const ok = await app.inject({
        method: 'POST',
        url,
        payload: { name: 'Locked' },
        headers: { authorization: `Bearer ${hostToken}` },
      });
      expect(ok.statusCode).toBe(201);

      const stopAnon = await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/session/stop`, payload: {} });
      expect(stopAnon.statusCode).toBe(403);
    });

    it("never lets one room's host act on another room's sessions", async () => {
      const other = JSON.parse((await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).payload);
      const otherSession = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/rooms/${other.id}/session/start`,
            payload: { name: 'Other' },
            headers: { authorization: `Bearer ${other.hostToken}` },
          })
        ).payload
      );

      const crossStop = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/session/stop`,
        payload: { sessionId: otherSession.id },
        headers: { authorization: `Bearer ${hostToken}` },
      });
      expect(crossStop.statusCode).toBe(404);
      expect(db.getSession(otherSession.id)?.stoppedAt).toBeNull();

      const crossExport = await app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/export/csv?sessionId=${otherSession.id}`,
      });
      expect(crossExport.statusCode).toBe(404);
      const crossMarkers = await app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/markers?sessionId=${otherSession.id}`,
      });
      expect(crossMarkers.statusCode).toBe(404);
    });

    it('only allows configured origins cross-origin', async () => {
      const allowed = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://director.example' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://director.example');
      const denied = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rate limits room creation', async () => {
      const limited = await createServer({
        dbPath: path.resolve(process.cwd(), 'test-ratelimit-streamcollab.sqlite'),
        logger: false,
      });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 12; i++) {
          statuses.push((await limited.fastify.inject({ method: 'POST', url: '/api/rooms', payload: {} })).statusCode);
        }
        expect(statuses.filter((s) => s === 201)).toHaveLength(10);
        expect(statuses.slice(-2)).toEqual([429, 429]);
      } finally {
        await limited.fastify.close();
        limited.db.close();
        removeDb(path.resolve(process.cwd(), 'test-ratelimit-streamcollab.sqlite'));
      }
    });
  });

  describe('WebSocket', () => {
    it('gives host rights only to sockets that present the host token', async () => {
      const viewer = await connect();
      viewer.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'dashboard' } });
      expect((await viewer.waitFor((m) => m.type === 'JOINED')).payload.isHost).toBe(false);
      viewer.send({ type: 'STOP_SESSION', payload: {} });
      expect((await viewer.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');
      expect(db.getActiveSession(roomId)).not.toBeNull();

      const impostor = await connect();
      impostor.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'dashboard', hostToken: 'x'.repeat(43) } });
      expect((await impostor.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('HOST_TOKEN_INVALID');

      const host = await connect();
      host.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'dashboard', hostToken } });
      expect((await host.waitFor((m) => m.type === 'JOINED')).payload.isHost).toBe(true);
      host.send({ type: 'STOP_SESSION', payload: {} });
      await host.waitFor((m) => m.type === 'SESSION_STOPPED');
      expect(db.getActiveSession(roomId)).toBeNull();
    });

    it('binds a member id to the first device that claims it', async () => {
      const first = await joinDock('mem-owner');
      const joined = await first.waitFor((m) => m.type === 'JOINED');
      const memberToken = joined.payload.memberToken;
      expect(typeof memberToken).toBe('string');

      const thief = await joinDock('mem-owner');
      expect((await thief.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('MEMBER_TOKEN_INVALID');

      const sameDevice = await joinDock('mem-owner', { memberToken });
      const rejoined = await sameDevice.waitFor((m) => m.type === 'JOINED');
      expect(rejoined.payload.memberToken).toBeUndefined(); // only issued once
    });

    it('attributes markers and status to the authenticated dock, ignoring spoofed ids', async () => {
      const victim = await joinDock('mem-victim');
      await victim.waitFor((m) => m.type === 'ROOM_STATE');
      const attacker = await joinDock('mem-attacker');
      await attacker.waitFor((m) => m.type === 'ROOM_STATE');

      attacker.send({
        type: 'CREATE_MARKER',
        payload: {
          roomId: 'some-other-room',
          marker: { memberId: 'mem-victim', memberName: 'Victim', category: 'funny', label: 'Spoofed' },
        },
      });
      const marker = await attacker.waitFor((m) => m.type === 'MARKER_ADDED');
      expect(marker.payload.memberId).toBe('mem-attacker');
      expect(marker.payload.memberName).toBe('mem-attacker');
      expect(marker.payload.roomId).toBe(roomId);

      attacker.send({
        type: 'UPDATE_STATUS',
        payload: { roomId, memberId: 'mem-victim', status: { obsStatus: 'paused' } },
      });
      const updated = await attacker.waitFor((m) => m.type === 'MEMBER_UPDATED');
      expect(updated.payload.id).toBe('mem-attacker');
      expect(db.getRoomMembers(roomId).find((m) => m.id === 'mem-victim')?.obsStatus).toBe('stopped');
    });

    it('does not let observers or unjoined sockets write', async () => {
      const hud = await connect();
      hud.send({ type: 'JOIN_ROOM', payload: { roomId, clientKind: 'hud' } });
      await hud.waitFor((m) => m.type === 'JOINED');
      hud.send({ type: 'CREATE_MARKER', payload: { marker: { category: 'kill', label: 'Nope' } } });
      expect((await hud.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('FORBIDDEN');

      const stranger = await connect();
      stranger.send({ type: 'CREATE_MARKER', payload: { marker: { category: 'kill', label: 'Nope' } } });
      expect((await stranger.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('NOT_JOINED');
    });

    it('rejects malformed messages with a readable validation error', async () => {
      const dock = await joinDock('mem-validate');
      await dock.waitFor((m) => m.type === 'ROOM_STATE');

      dock.ws.send('not json');
      expect((await dock.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('INVALID_MESSAGE');

      dock.messages.length = 0;
      dock.send({ type: 'CREATE_MARKER', payload: { marker: { category: 'rage-quit', label: 'x'.repeat(500) } } });
      const error = await dock.waitFor((m) => m.type === 'ERROR');
      expect(error.payload.code).toBe('INVALID_MESSAGE');
      expect(error.payload.message).toMatch(/marker\.category/);
      expect(error.payload.message).toMatch(/marker\.label/);

      dock.messages.length = 0;
      dock.send({ type: 'DROP_TABLES', payload: {} });
      expect((await dock.waitFor((m) => m.type === 'ERROR')).payload.code).toBe('INVALID_MESSAGE');
    });

    it('rate limits message floods per socket', async () => {
      const flooder = await connect();
      for (let i = 0; i < 100; i++) {
        flooder.send({ type: 'SNTP_PING', payload: { t1: Date.now() } });
      }
      const limited = await flooder.waitFor((m) => m.type === 'ERROR');
      expect(limited.payload.code).toBe('RATE_LIMITED');
      expect(flooder.messages.filter((m) => m.type === 'SNTP_PONG').length).toBeLessThan(100);
    });

    it('closes sockets that send oversized frames', async () => {
      const big = await connect();
      const closed = new Promise<number>((resolve) => big.ws.once('close', (code) => resolve(code)));
      big.ws.send('x'.repeat(LIMITS.wsMessageBytes + 1));
      expect(await closed).toBe(1009); // "Message Too Big"
    });
  });

  describe('HTTP quick-mark', () => {
    it('requires the member token and uses the stored member name', async () => {
      const dock = await joinDock('mem-deck');
      const { memberToken } = (await dock.waitFor((m) => m.type === 'JOINED')).payload;
      const url = `/api/rooms/${roomId}/quick-mark`;
      const payload = { memberId: 'mem-deck', category: 'clutch', label: 'Deck Clutch', memberName: 'Fake Name' };

      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${hostToken}` } }))
          .statusCode
      ).toBe(403);

      const ok = await app.inject({
        method: 'POST',
        url,
        payload,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(ok.statusCode).toBe(201);
      expect(JSON.parse(ok.payload).memberName).toBe('mem-deck');

      const invalid = await app.inject({
        method: 'POST',
        url,
        payload: { ...payload, color: 'Chartreuse' },
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(invalid.statusCode).toBe(400);
    });
  });
});
