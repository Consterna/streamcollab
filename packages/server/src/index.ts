import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { LIMITS } from '@streamcollab/shared';
import { DatabaseService } from './db/database.js';
import { RoomManager } from './rooms/roomManager.js';
import { registerApiRoutes } from './routes/api.js';
import { registerWebSocketHandler } from './websocket/handler.js';

export interface ServerOptions {
  dbPath?: string;
  logger?: boolean;
  heartbeatIntervalMs?: number;
  // Origins allowed to call the REST API cross-origin. Empty = same-origin only
  // (the client is served by the same host in production and proxied by Vite in dev).
  allowedOrigins?: string[];
  adminToken?: string;
  trustProxy?: boolean;
}

/** Parse a comma-separated env var like "https://a.com, https://b.com" */
export function parseOriginList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export async function createServer(options: ServerOptions = {}) {
  const fastify = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ?? false,
  });

  const allowedOrigins = options.allowedOrigins ?? [];
  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Per-route limits only (see routes/api.ts); must be registered before the routes
  await fastify.register(rateLimit, { global: false });

  await fastify.register(websocket, {
    options: { maxPayload: LIMITS.wsMessageBytes },
  });

  const db = new DatabaseService(options.dbPath);
  const roomManager = new RoomManager(db);

  registerApiRoutes(fastify, roomManager, db, { adminToken: options.adminToken });
  registerWebSocketHandler(fastify, roomManager, { heartbeatIntervalMs: options.heartbeatIntervalMs });

  return { fastify, db, roomManager };
}

async function start() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  const { fastify } = await createServer({
    dbPath: process.env.DATABASE_PATH,
    allowedOrigins: parseOriginList(process.env.ALLOWED_ORIGIN),
    adminToken: process.env.ADMIN_TOKEN || undefined,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });

  try {
    const address = await fastify.listen({ port, host });
    console.log(`[StreamCollab Server] Listening on ${address}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Start if executed directly
if (process.argv[1]) {
  try {
    const mainFile = fileURLToPath(import.meta.url).toLowerCase();
    const argvFile = path.resolve(process.argv[1]).toLowerCase();
    if (mainFile === argvFile) {
      start();
    }
  } catch {
    // Ignore URL parse errors
  }
}

