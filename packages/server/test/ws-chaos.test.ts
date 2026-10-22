import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { createServer } from '../src/index.js';
import { DatabaseService } from '../src/db/database.js';
import { RoomManager } from '../src/rooms/roomManager.js';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) {
      try {
        fs.unlinkSync(`${dbPath}${suffix}`);
      } catch {
        // Ignored if busy
      }
    }
  }
}

interface TestClient {
  ws: WebSocket;
  messages: any[];
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  send: (msg: unknown) => void;
  sendRaw: (data: string | Buffer) => void;
}

function wrap(ws: WebSocket): TestClient {
  const messages: any[] = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      messages.push({ __raw: data.toString() });
    }
  });
  return {
    ws,
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendRaw: (data) => ws.send(data),
    waitFor: (predicate, timeoutMs = 3000) =>
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

describe('WebSocket Chaos & Protocol Stress', () => {
  const dbPath = path.resolve(process.cwd(), 'test-ws-chaos.sqlite');
  let app: any;
  let db: DatabaseService;
  let roomManager: RoomManager;
  let wsUrl = '';
  const openSockets: WebSocket[] = [];

  const connect = () =>
    new Promise<TestClient>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      openSockets.push(ws);
      const client = wrap(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', (err) => reject(err));
    });

  beforeAll(async () => {
    removeDb(dbPath);
    const serverInstance = await createServer({
      dbPath,
      logger: false,
      unjoinedTimeoutMs: 500, // Short timeout for test
    });
    app = serverInstance.fastify;
    db = serverInstance.db;
    roomManager = serverInstance.roomManager;

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = address.split(':').pop();
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    await app.close();
    db.close();
    removeDb(dbPath);
  });

  it('enforces rate limiting on rapid burst flooding', async () => {
    const roomId = 'CHAOS-FLOOD';
    roomManager.createRoom(roomId, 'Flood Room');

    const client = await connect();
    client.send({
      type: 'JOIN_ROOM',
      payload: { roomId, clientKind: 'hud' },
    });
    await client.waitFor((m) => m.type === 'JOINED');

    // WS_RATE_LIMIT has burst: 40. Send 60 messages rapidly
    for (let i = 0; i < 60; i++) {
      client.send({
        type: 'SNTP_PING',
        payload: { t1: Date.now() },
      });
    }

    // Must receive RATE_LIMITED error
    const rateLimitedError = await client.waitFor((m) => m.type === 'ERROR' && m.payload.code === 'RATE_LIMITED', 3000);
    expect(rateLimitedError).toBeDefined();
    expect(rateLimitedError.payload.message).toContain('slow down');
  });

  it('handles reconnect storms of 30 parallel connections', async () => {
    const roomId = 'CHAOS-STORM';
    roomManager.createRoom(roomId, 'Storm Room');

    const STORM_SIZE = 30;
    const clients = await Promise.all(Array.from({ length: STORM_SIZE }, () => connect()));

    // All 30 join simultaneously
    clients.forEach((c) => {
      c.send({
        type: 'JOIN_ROOM',
        payload: { roomId, clientKind: 'hud' },
      });
    });

    const joinedResults = await Promise.all(clients.map((c) => c.waitFor((m) => m.type === 'JOINED', 4000)));
    expect(joinedResults.length).toBe(STORM_SIZE);

    // Clean up storm sockets
    clients.forEach((c) => c.ws.close());
  });

  it('processes 16KB payloads successfully and drops frames exceeding limit', async () => {
    const roomId = 'CHAOS-PAYLOAD';
    roomManager.createRoom(roomId, 'Payload Room');

    const client = await connect();
    client.send({
      type: 'JOIN_ROOM',
      payload: { roomId, clientKind: 'hud' },
    });
    await client.waitFor((m) => m.type === 'JOINED');

    // 1. Send 16KB message (within 32KB maxPayload)
    client.send({
      type: 'SNTP_PING',
      payload: { t1: Date.now(), padding: 'A'.repeat(16 * 1024 - 100) },
    });
    const pong = await client.waitFor((m) => m.type === 'SNTP_PONG');
    expect(pong).toBeDefined();

    // 2. Send 40KB payload exceeding LIMITS.wsMessageBytes (32KB)
    const clientTooBig = await connect();
    const oversizedPayload = JSON.stringify({
      type: 'SNTP_PING',
      payload: { t1: Date.now(), padding: 'X'.repeat(40 * 1024) },
    });

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      clientTooBig.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    clientTooBig.sendRaw(oversizedPayload);
    const closeEvent = await closePromise;
    // WebSocket status code 1009 = Message Too Big
    expect(closeEvent.code).toBe(1009);
  });

  it('safely tolerates malformed JSON and garbage fuzzing without crashing server', async () => {
    const client = await connect();

    // Send malformed JSON variants
    client.sendRaw('{"type": "SNTP_PING"'); // Incomplete JSON
    let err = await client.waitFor((m) => m.type === 'ERROR' && m.payload.code === 'INVALID_MESSAGE');
    expect(err.payload.message).toContain('valid JSON');

    client.sendRaw('not a json at all');
    err = await client.waitFor((m) => m.type === 'ERROR' && m.payload.code === 'INVALID_MESSAGE');
    expect(err.payload.message).toContain('valid JSON');

    client.sendRaw(Buffer.from([0x00, 0x1f, 0xff, 0xfe]));
    err = await client.waitFor((m) => m.type === 'ERROR' && m.payload.code === 'INVALID_MESSAGE');
    expect(err.payload.message).toContain('valid JSON');

    // Send valid JSON but invalid schema
    client.sendRaw(JSON.stringify({ type: 'UNKNOWN_MESSAGE_TYPE' }));
    err = await client.waitFor((m) => m.type === 'ERROR' && m.payload.code === 'INVALID_MESSAGE');
    expect(err).toBeDefined();

    // Verify socket remains alive and valid requests still work
    client.send({
      type: 'SNTP_PING',
      payload: { t1: Date.now() },
    });
    const pong = await client.waitFor((m) => m.type === 'SNTP_PONG');
    expect(pong).toBeDefined();

    client.ws.close();
  });

  it('terminates sockets that do not join a room within the unjoined socket timeout', async () => {
    // Server unjoinedTimeoutMs was set to 500ms
    const idleClient = await connect();

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      idleClient.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    // Do NOT send JOIN_ROOM
    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toContain('Join timeout');
  });
});
