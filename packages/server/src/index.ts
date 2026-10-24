import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LIMITS } from '@streamcollab/shared';
import { DatabaseService } from './db/database.js';
import { RoomManager } from './rooms/roomManager.js';
import { registerApiRoutes } from './routes/api.js';
import { registerWebSocketHandler } from './websocket/handler.js';
import { registerClientApp } from './static/clientApp.js';
import { RoomLookupGuard, DEFAULT_JOIN_FAILURE_LIMIT } from './security/lookupGuard.js';
import { loadConfig, loadDotEnv, parseOriginList } from './config.js';

export { parseOriginList };

export interface ServerOptions {
  dbPath?: string;
  logger?: boolean | { level: string };
  heartbeatIntervalMs?: number;
  joinFailureLimit?: { max: number; windowMs: number };
  // Origins allowed to call the REST API cross-origin. Empty = same-origin only
  // (the client is served by the same host in production and proxied by Vite in dev).
  allowedOrigins?: string[];
  adminToken?: string;
  roomCreateLimitPerMinute?: number;
  trustProxy?: boolean;
  unjoinedTimeoutMs?: number;
  maxSocketsPerIp?: number;
  // How often the server records that it is alive (bounds a session's end time after a crash)
  aliveIntervalMs?: number;
  // Compiled client (packages/client/dist) to serve at "/". Omit to serve the API only.
  clientDir?: string;
}

export const DEFAULT_ALIVE_INTERVAL_MS = 30_000;

export async function createServer(options: ServerOptions = {}) {
  const fastify = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ?? false,
  });

  // Baseline hardening headers for every response (API and app)
  fastify.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  const allowedOrigins = options.allowedOrigins ?? [];
  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Per-route limits only (see routes/api.ts); must be registered before the routes
  await fastify.register(rateLimit, { global: false });

  await fastify.register(websocket, {
    options: { maxPayload: LIMITS.wsMessageBytes },
  });

  const db = new DatabaseService(options.dbPath);
  const roomManager = new RoomManager(db);
  roomManager.recoverAfterRestart();

  db.markAlive();
  const alive = setInterval(() => {
    if (db.isOpen) db.markAlive();
  }, options.aliveIntervalMs ?? DEFAULT_ALIVE_INTERVAL_MS);
  alive.unref();

  // One count of unknown room codes per IP for both the WebSocket joins and the REST lookups
  const lookupGuard = new RoomLookupGuard(options.joinFailureLimit ?? DEFAULT_JOIN_FAILURE_LIMIT);
  fastify.addHook('onClose', async () => {
    clearInterval(alive);
    lookupGuard.close();
  });

  registerApiRoutes(fastify, roomManager, db, {
    adminToken: options.adminToken,
    roomCreateLimitPerMinute: options.roomCreateLimitPerMinute,
    lookupGuard,
  });
  registerWebSocketHandler(fastify, roomManager, {
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    lookupGuard,
    unjoinedTimeoutMs: options.unjoinedTimeoutMs,
    maxSocketsPerIp: options.maxSocketsPerIp,
  });

  if (options.clientDir) {
    await registerClientApp(fastify, options.clientDir);
  }

  return { fastify, db, roomManager };
}

const SHUTDOWN_TIMEOUT_MS = 10_000;
// Docks that vanished without a close frame would hold the shutdown for ws's 30 s close timeout
const SOCKET_CLOSE_GRACE_MS = 3_000;

async function start() {
  const envFile = loadDotEnv();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let server;
  try {
    server = await createServer({
      dbPath: config.databasePath,
      logger: { level: config.logLevel },
      allowedOrigins: config.allowedOrigins,
      adminToken: config.adminToken,
      trustProxy: config.trustProxy,
      roomCreateLimitPerMinute: config.roomCreateLimitPerMinute,
      clientDir: config.clientDist,
    });
  } catch (err) {
    // e.g. a locked database file, a failed migration or a newer schema
    console.error('[StreamCollab Server] Could not start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const { fastify, db } = server;

  if (envFile) {
    fastify.log.info({ envFile }, 'Loaded environment file');
  }

  // Graceful shutdown (docker stop / Ctrl+C): stop accepting traffic, close sockets,
  // then fold the WAL back into the main database file before exiting
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => {
      fastify.log.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    const terminateSockets = setTimeout(() => {
      for (const client of fastify.websocketServer?.clients ?? []) client.terminate();
    }, SOCKET_CLOSE_GRACE_MS);
    terminateSockets.unref();

    try {
      await fastify.close();
      // The next start resumes running sessions instead of treating this like a crash
      db.markCleanShutdown();
      db.checkpoint('TRUNCATE');
      db.close();
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    const address = await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`[StreamCollab Server] Listening on ${address}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Start if executed directly
if (process.argv[1]) {
  try {
    const mainFile = fileURLToPath(import.meta.url).toLowerCase();
    const argvFile = path.resolve(process.argv[1]).toLowerCase();
    if (mainFile === argvFile) {
      start().catch((err) => {
        console.error('[StreamCollab Server] Fatal error:', err);
        process.exit(1);
      });
    }
  } catch {
    // Ignore URL parse errors
  }
}
