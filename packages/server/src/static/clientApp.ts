import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';

// Client routes that must return the SPA shell (the view is picked from the path / query / hash)
const SPA_ROUTES = ['/', '/dock', '/hud', '/dashboard'];

function wantsHtml(req: FastifyRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.url.startsWith('/api/') || req.url === '/api' || req.url.startsWith('/ws')) return false;
  return (req.headers.accept ?? '').includes('text/html');
}

/**
 * Serve the compiled Vite client (packages/client/dist) from the API server, so production
 * needs a single origin: `/api` and `/ws` for the backend, everything else for the app.
 * Returns false (and serves nothing) when the build is missing, e.g. in development.
 */
export async function registerClientApp(fastify: FastifyInstance, clientDir: string): Promise<boolean> {
  const root = path.resolve(clientDir);
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    fastify.log.warn({ clientDir: root }, 'Client build not found; serving API only (run `npm run build`)');
    return false;
  }

  // Hashed Vite assets are safe to cache "forever"; index.html must always be revalidated
  await fastify.register(fastifyStatic, {
    root,
    prefix: '/',
    index: false,
    maxAge: '30d',
    immutable: true,
  });

  const sendIndex = (reply: FastifyReply) =>
    reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html', { cacheControl: false });

  for (const route of SPA_ROUTES) {
    fastify.get(route, (_req, reply) => sendIndex(reply));
  }

  // Unknown browser navigations get the app shell; API / asset misses stay real 404s
  fastify.setNotFoundHandler((req, reply) => {
    if (wantsHtml(req)) {
      return sendIndex(reply);
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return true;
}
