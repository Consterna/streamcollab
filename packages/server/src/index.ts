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
import { loadConfig, loadDotEnv, parseOriginList } from './config.js';

export { parseOriginList };

export interface ServerOptions {
  dbPath?: string;
  logger?: boolean | { level: string };
  heartbeatIntervalMs?: number;
  // Origins allowed to call the REST API cross-origin. Empty = same-origin only
  // (the client is served by the same host in production and proxied by Vite in dev).
  allowedOrigins?: string[];
  adminToken?: string;
  trustProxy?: boolean;
  // Compiled client (packages/client/dist) to serve at "/". Omit to serve the API only.
  clientDir?: string;
}

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

  if (options.clientDir) {
    await registerClientApp(fastify, options.clientDir);
  }

  return { fastify, db, roomManager };
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start() {
  const envFile = loadDotEnv();

  let config;
  try {
    config = loadConfig();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const { fastify, db } = await createServer({
    dbPath: config.databasePath,
    logger: { level: config.logLevel },
    allowedOrigins: config.allowedOrigins,
    adminToken: config.adminToken,
    trustProxy: config.trustProxy,
    clientDir: config.clientDist,
  });

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

    try {
      await fastify.close();
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
      start();
    }
  } catch {
    // Ignore URL parse errors
  }
}
