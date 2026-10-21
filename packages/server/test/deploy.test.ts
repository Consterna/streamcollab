import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createServer } from '../src/index.js';
import { loadConfig, DEFAULT_CLIENT_DIST } from '../src/config.js';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.unlinkSync(`${dbPath}${suffix}`);
  }
}

describe('Server configuration', () => {
  it('applies production-safe defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      allowedOrigins: [],
      trustProxy: false,
      logLevel: 'info',
      clientDist: DEFAULT_CLIENT_DIST,
      roomCreateLimitPerMinute: 10,
    });
    expect(loadConfig({ ROOM_CREATE_LIMIT_PER_MINUTE: '50' }).roomCreateLimitPerMinute).toBe(50);
    expect(() => loadConfig({ ROOM_CREATE_LIMIT_PER_MINUTE: '0' })).toThrow(/ROOM_CREATE_LIMIT_PER_MINUTE/);
    expect(config.adminToken).toBeUndefined();
    expect(config.databasePath).toBeUndefined();
  });

  it('treats empty .env values as unset and parses flags and origins', () => {
    const config = loadConfig({
      PORT: '8080',
      ADMIN_TOKEN: '',
      DATABASE_PATH: '',
      TRUST_PROXY: 'TRUE',
      ALLOWED_ORIGIN: 'https://collab.example.com, http://localhost:5173',
      LOG_LEVEL: 'warn',
    });
    expect(config.port).toBe(8080);
    expect(config.adminToken).toBeUndefined();
    expect(config.databasePath).toBeUndefined();
    expect(config.trustProxy).toBe(true);
    expect(config.allowedOrigins).toEqual(['https://collab.example.com', 'http://localhost:5173']);
    expect(config.logLevel).toBe('warn');
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'eighty', ADMIN_TOKEN: 'short', TRUST_PROXY: 'maybe' })).toThrow(
      /PORT[\s\S]*ADMIN_TOKEN[\s\S]*TRUST_PROXY|PORT[\s\S]*TRUST_PROXY[\s\S]*ADMIN_TOKEN/
    );
    expect(() => loadConfig({ ALLOWED_ORIGIN: 'collab.example.com' })).toThrow(/ALLOWED_ORIGIN/);
    expect(() => loadConfig({ ALLOWED_ORIGIN: 'https://collab.example.com/path' })).toThrow(/ALLOWED_ORIGIN/);
  });
});

describe('Serving the compiled client', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamcollab-client-'));
  const clientDir = path.join(tmp, 'dist');
  const dbPath = path.resolve(process.cwd(), 'test-deploy-streamcollab.sqlite');
  let app: any;
  let db: any;

  beforeAll(async () => {
    fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, 'index.html'),
      '<!doctype html><title>StreamCollab</title><div id="root"></div>'
    );
    fs.writeFileSync(path.join(clientDir, 'assets', 'index-abc123.js'), 'console.log("app")');
    // A file outside the served root that must never be reachable
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');

    removeDb(dbPath);
    const server = await createServer({ dbPath, logger: false, clientDir });
    app = server.fastify;
    db = server.db;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
    removeDb(dbPath);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const html = { accept: 'text/html,application/xhtml+xml' };

  it('serves the app shell at / and the view routes without caching it', async () => {
    for (const url of ['/', '/dock', '/hud', '/dashboard', '/?view=dock&room=ABCD-2345']) {
      const res = await app.inject({ method: 'GET', url, headers: html });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.payload).toContain('<div id="root">');
    }
  });

  it('serves hashed assets as long-lived immutable files', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cache-control']).toContain('max-age=2592000');
  });

  it('falls back to the app shell for unknown browser navigations only', async () => {
    const navigation = await app.inject({ method: 'GET', url: '/some/deep/link', headers: html });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.payload).toContain('<div id="root">');

    const missingAsset = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missingAsset.statusCode).toBe(404);

    const missingApi = await app.inject({ method: 'GET', url: '/api/nope', headers: html });
    expect(missingApi.statusCode).toBe(404);
    expect(JSON.parse(missingApi.payload).error).toBe('Not found');
  });

  it('keeps the API working alongside the client', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe('ok');
  });

  it('never serves files outside the client directory', async () => {
    for (const url of ['/../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.payload, url).not.toContain('top secret');
    }
  });

  it('adds baseline security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

describe('API-only mode', () => {
  it('starts without a client build and keeps 404s for the root', async () => {
    const dbPath = path.resolve(process.cwd(), 'test-apionly-streamcollab.sqlite');
    removeDb(dbPath);
    const server = await createServer({
      dbPath,
      logger: false,
      clientDir: path.join(os.tmpdir(), 'does-not-exist-sc'),
    });
    try {
      expect((await server.fastify.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect((await server.fastify.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    } finally {
      await server.fastify.close();
      server.db.close();
      removeDb(dbPath);
    }
  });
});
