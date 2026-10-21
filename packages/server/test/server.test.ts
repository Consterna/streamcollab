import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/index.js';
import { SntpClockEngine } from '../src/sntp/clock.js';
import path from 'node:path';
import fs from 'node:fs';

describe('StreamCollab Server & SQLite WAL Integration', () => {
  const testDbPath = path.resolve(process.cwd(), 'test-streamcollab.sqlite');
  let app: any;
  let db: any;

  beforeAll(async () => {
    // Clean up test DB if left from prior run
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

    const serverInstance = await createServer({ dbPath: testDbPath });
    app = serverInstance.fastify;
    db = serverInstance.db;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();

    // Clean up test files
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  });

  it('GET /api/health returns status ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
    expect(typeof body.serverTime).toBe('number');
  });

  it('POST /api/rooms creates a new room', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { id: 'test-room', name: 'Test Tournament Room' },
    });
    expect(res.statusCode).toBe(201);
    const room = JSON.parse(res.payload);
    expect(room.id).toBe('test-room');
    expect(room.name).toBe('Test Tournament Room');
  });

  it('POST /api/rooms/:id/session/start starts a recording session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/test-room/session/start',
      payload: {
        name: 'Tournament Match 1',
        framerateNumerator: 60,
        framerateDenominator: 1,
        dropFrame: false,
        baseTimecode: '01:00:00:00',
      },
    });
    expect(res.statusCode).toBe(201);
    const session = JSON.parse(res.payload);
    expect(session.name).toBe('Tournament Match 1');
    expect(session.baseTimecode).toBe('01:00:00:00');
    expect(session.framerateNumerator).toBe(60);
  });

  it('POST /api/rooms/:id/quick-mark creates a marker with SMPTE timecode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/test-room/quick-mark',
      payload: {
        memberId: 'mem-tester',
        memberName: 'Tester',
        category: 'kill',
        label: 'Sniper Headshot',
        comment: 'Across the map through wall',
      },
    });
    expect(res.statusCode).toBe(201);
    const marker = JSON.parse(res.payload);
    expect(marker.label).toBe('Sniper Headshot');
    expect(marker.category).toBe('kill');
    expect(marker.timecode).toMatch(/^01:\d{2}:\d{2}:\d{2}$/);
    expect(marker.color).toBe('Red');
  });

  it('GET /api/rooms/:id/export/edl returns DaVinci Resolve EDL with CRLF', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/edl',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('TITLE: Tournament Match 1');
    expect(res.payload).toContain('* LOC:');
    expect(res.payload).toContain('Sniper Headshot');
    expect(res.payload.includes('\r\n')).toBe(true);
  });

  it('GET /api/rooms/:id/export/xml returns Adobe Premiere FCP7 XML', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/xml',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.payload).toContain('<xmeml version="4">');
    expect(res.payload).toContain('<name>[KILL] Sniper Headshot</name>');
  });

  it('GET /api/rooms/:id/export/csv returns Universal CSV', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/csv',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.payload).toContain('Marker ID,Timestamp (UTC),Timecode,Frame');
    expect(res.payload).toContain('Sniper Headshot');
  });

  it('GET /api/rooms/:id/export/youtube returns YouTube chapters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/youtube',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('00:00 Sniper Headshot');
  });

  it('GET /api/rooms/:id/export/matrix returns Multicam sync matrix JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/matrix',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const matrix = JSON.parse(res.payload);
    expect(matrix.sessionName).toBe('Tournament Match 1');
    expect(matrix.markers.length).toBeGreaterThan(0);
  });

  it('POST /api/rooms/:id/session/stop stops active session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/test-room/session/stop',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.session.stoppedAt).toBeGreaterThan(0);
  });

  it('GET /api/rooms/:id/export/edl exports completed session even when activeSession is null', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/export/edl',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('TITLE: Tournament Match 1');
    expect(res.payload).toContain('Sniper Headshot');
  });

  it('GET /api/rooms/:id/markers returns markers for completed session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/markers',
    });
    expect(res.statusCode).toBe(200);
    const markers = JSON.parse(res.payload);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0].label).toBe('Sniper Headshot');
  });

  it('DatabaseService supports WAL checkpointing without errors', () => {
    expect(() => db.checkpoint()).not.toThrow();
  });

  it('SNTP 4-timestamp engine computes correct RTT and offset', () => {
    const measurement = SntpClockEngine.calculateOffset(1000, 1050, 1060, 1120);
    expect(measurement.rtt).toBe(110);
    expect(measurement.offset).toBe(-5);
  });
});
