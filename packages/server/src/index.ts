import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { DatabaseService } from './db/database.js';
import { RoomManager } from './rooms/roomManager.js';
import { registerApiRoutes } from './routes/api.js';
import { registerWebSocketHandler } from './websocket/handler.js';

export async function createServer(options?: { dbPath?: string; logger?: boolean; heartbeatIntervalMs?: number }) {
  const fastify = Fastify({ logger: options?.logger ?? true });

  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(websocket);

  const db = new DatabaseService(options?.dbPath);
  const roomManager = new RoomManager(db);

  registerApiRoutes(fastify, roomManager, db);
  registerWebSocketHandler(fastify, roomManager, { heartbeatIntervalMs: options?.heartbeatIntervalMs });

  return { fastify, db, roomManager };
}

async function start() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  const { fastify } = await createServer({ dbPath: process.env.DATABASE_PATH });

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

