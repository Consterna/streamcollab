import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { RoomManager, RoomError } from '../rooms/roomManager.js';
import { DatabaseService } from '../db/database.js';
import { bearerToken } from '../auth/tokens.js';
import {
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  generateMulticamSyncMatrix,
  rebaseSessionForMember,
  roomIdSchema,
  createRoomBodySchema,
  sessionSettingsSchema,
  stopSessionBodySchema,
  quickMarkBodySchema,
  undoMarkerBodySchema,
  formatValidationError,
} from '@streamcollab/shared';

/**
 * Build a Content-Disposition header that survives quotes, slashes and non-ASCII session names:
 * an ASCII-only `filename` fallback plus an RFC 5987 UTF-8 `filename*`.
 */
export function attachmentDisposition(filename: string): string {
  // Also drop characters Windows forbids in filenames (e.g. the ':' in "Auto Session 23:07:27")
  const cleaned = filename.replace(/[\r\n"\\/:*?<>|]/g, '').replace(/\s+/g, '_') || 'export';
  const ascii = cleaned.normalize('NFKD').replace(/[^\x20-\x7E]/g, '') || 'export';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

export interface ApiRouteOptions {
  // When set, GET /api/rooms lists every room for `Authorization: Bearer <adminToken>`
  adminToken?: string;
  // Rooms one IP may create per minute (default 10)
  roomCreateLimitPerMinute?: number;
}

// Room creation and HTTP markers are the only unauthenticated-ish writes; keep them cheap to abuse
export const DEFAULT_ROOM_CREATE_LIMIT_PER_MINUTE = 10;
const QUICK_MARK_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: formatValidationError(error) });
}

function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function registerApiRoutes(
  fastify: FastifyInstance,
  roomManager: RoomManager,
  db: DatabaseService,
  options: ApiRouteOptions = {}
) {
  // Room codes work in any letter case: rewrite `:id` to the stored spelling before handlers run
  fastify.addHook('preHandler', async (req) => {
    const params = req.params as { id?: string } | undefined;
    if (params?.id && req.url.startsWith('/api/rooms/')) {
      const canonical = db.resolveRoomId(params.id);
      if (canonical) params.id = canonical;
    }
  });

  const requireRoom = (id: string, reply: FastifyReply) => {
    if (!roomIdSchema.safeParse(id).success || !db.roomExists(id)) {
      reply.status(404).send({ error: `Room ${id} not found` });
      return false;
    }
    return true;
  };

  const requireHost = (id: string, req: FastifyRequest, reply: FastifyReply) => {
    if (!roomManager.isHostToken(id, bearerToken(req.headers.authorization))) {
      reply.status(403).send({ error: 'Host token required (Authorization: Bearer <hostToken>)' });
      return false;
    }
    return true;
  };

  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'ok', serverTime: Date.now() };
  });

  // List rooms (admin only: room codes are the invites, so never list them publicly)
  fastify.get('/api/rooms', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!safeEqual(bearerToken(req.headers.authorization), options.adminToken)) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return roomManager.listRooms();
  });

  // Create room: returns the room code (id) and a host token shown only once
  fastify.post(
    '/api/rooms',
    {
      config: {
        rateLimit: {
          max: options.roomCreateLimitPerMinute ?? DEFAULT_ROOM_CREATE_LIMIT_PER_MINUTE,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createRoomBodySchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      try {
        const room = roomManager.createRoom(body.data.id, body.data.name);
        return reply.status(201).send(room);
      } catch (err) {
        if (err instanceof RoomError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // Get room
  fastify.get('/api/rooms/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!requireRoom(id, reply)) return reply;
    const room = roomManager.getRoom(id);
    const activeSession = roomManager.getActiveSession(id);
    return { room, activeSession, isHost: roomManager.isHostToken(id, bearerToken(req.headers.authorization)) };
  });

  // Start session (host only)
  fastify.post(
    '/api/rooms/:id/session/start',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      if (!requireRoom(id, reply) || !requireHost(id, req, reply)) return reply;

      const body = sessionSettingsSchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      const session = roomManager.startSession(id, {
        ...body.data,
        name: body.data.name || 'Main Stream Session',
      });
      return reply.status(201).send(session);
    }
  );

  // Stop session (host only)
  fastify.post(
    '/api/rooms/:id/session/stop',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      if (!requireRoom(id, reply) || !requireHost(id, req, reply)) return reply;

      const body = stopSessionBodySchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      const sessionId = body.data.sessionId || roomManager.getActiveSession(id)?.id;
      if (!sessionId) {
        return reply.status(400).send({ error: 'No active session found to stop' });
      }

      const session = roomManager.stopSession(id, sessionId);
      if (!session) {
        return reply.status(404).send({ error: `Session ${sessionId} not found in room ${id}` });
      }
      return { session };
    }
  );

  // Quick mark over HTTP (Stream Deck, Streamer.bot...): Authorization: Bearer <memberToken>
  fastify.post(
    '/api/rooms/:id/quick-mark',
    { config: { rateLimit: QUICK_MARK_RATE_LIMIT } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      if (!requireRoom(id, reply)) return reply;

      const body = quickMarkBodySchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      const { memberId, category, label, comment, color, tags } = body.data;
      const member = db.getRoomMembers(id).find((m) => m.id === memberId);
      if (!member || !roomManager.isMemberToken(memberId, bearerToken(req.headers.authorization))) {
        return reply.status(403).send({ error: 'Member token required (Authorization: Bearer <memberToken>)' });
      }

      const marker = roomManager.createMarker({
        roomId: id,
        memberId,
        memberName: member.name,
        category,
        label,
        comment: comment || undefined,
        color,
        tags,
      });

      return reply.status(201).send(marker);
    }
  );

  // Undo a member's last marker over HTTP (Stream Deck "oops" button)
  fastify.post(
    '/api/rooms/:id/markers/undo',
    { config: { rateLimit: QUICK_MARK_RATE_LIMIT } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      if (!requireRoom(id, reply)) return reply;

      const body = undoMarkerBodySchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      const { memberId } = body.data;
      const member = db.getRoomMembers(id).find((m) => m.id === memberId);
      if (!member || !roomManager.isMemberToken(memberId, bearerToken(req.headers.authorization))) {
        return reply.status(403).send({ error: 'Member token required (Authorization: Bearer <memberToken>)' });
      }

      try {
        const removed = roomManager.undoLastMarker(id, memberId);
        return { removed };
      } catch (err) {
        if (err instanceof RoomError && err.code === 'NOT_FOUND') {
          return reply.status(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // Delete a finished session (host only)
  fastify.delete(
    '/api/rooms/:id/sessions/:sessionId',
    async (req: FastifyRequest<{ Params: { id: string; sessionId: string } }>, reply: FastifyReply) => {
      const { id, sessionId } = req.params;
      if (!requireRoom(id, reply) || !requireHost(id, req, reply)) return reply;
      try {
        roomManager.deleteSession(id, sessionId);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof RoomError) {
          return reply.status(err.code === 'NOT_FOUND' ? 404 : 409).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // Delete the whole room (host only)
  fastify.delete('/api/rooms/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!requireRoom(id, reply) || !requireHost(id, req, reply)) return reply;
    roomManager.deleteRoom(id);
    return reply.status(204).send();
  });

  // Session history (newest first) with marker counts
  fastify.get(
    '/api/rooms/:id/sessions',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      if (!requireRoom(id, reply)) return reply;
      return roomManager.listSessions(id);
    }
  );

  // List markers
  fastify.get(
    '/api/rooms/:id/markers',
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { sessionId?: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      if (!requireRoom(id, reply)) return reply;
      const { sessionId } = req.query;

      if (sessionId) {
        const session = db.getSession(sessionId);
        if (!session || session.roomId !== id) {
          return reply.status(404).send({ error: `Session ${sessionId} not found in room ${id}` });
        }
        return db.getSessionMarkers(sessionId);
      }

      const activeSession = roomManager.getActiveSession(id);
      if (activeSession) {
        return db.getSessionMarkers(activeSession.id);
      }

      const latestSession = db.getLatestSession(id);
      if (latestSession) {
        return db.getSessionMarkers(latestSession.id);
      }

      return db.getRoomMarkers(id);
    }
  );

  // NLE Timeline Exporters
  fastify.get(
    '/api/rooms/:id/export/:format',
    async (
      req: FastifyRequest<{
        Params: { id: string; format: string };
        Querystring: { sessionId?: string; memberId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id, format } = req.params;
      const { sessionId, memberId } = req.query;

      const room = roomManager.getRoom(id);
      if (!room) {
        return reply.status(404).send({ error: `Room ${id} not found` });
      }

      let session = sessionId ? db.getSession(sessionId) : roomManager.getActiveSession(id);
      if (session && session.roomId !== id) {
        return reply.status(404).send({ error: `Session ${sessionId} not found in room ${id}` });
      }
      if (!session) {
        // Fallback: get the most recent session in this room
        session = db.getLatestSession(id);
      }

      if (!session) {
        return reply.status(404).send({ error: 'No recording session found for export' });
      }

      const members = db.getRoomMembers(id);
      const anchors = db.getSessionAnchors(session.id);
      let markers = db.getSessionMarkers(session.id);

      // Per-POV export: re-time every marker against one member's own recording file
      if (memberId) {
        const anchor = anchors.find((a) => a.memberId === memberId);
        if (!anchor) {
          return reply.status(404).send({
            error: `Member ${memberId} has no recording anchor in session ${session.id} (OBS was not recording)`,
          });
        }
        const memberName = members.find((m) => m.id === memberId)?.name;
        const rebased = rebaseSessionForMember(session, markers, anchor, memberName);
        session = rebased.session;
        markers = rebased.markers;
      }

      switch (format.toLowerCase()) {
        case 'edl': {
          const edlContent = exportToEdl(session, markers, { title: session.name });
          reply.header('Content-Type', 'text/plain; charset=utf-8');
          reply.header('Content-Disposition', attachmentDisposition(`${session.name}.edl`));
          return reply.send(edlContent);
        }

        case 'xml': {
          const xmlContent = exportToFcpXml(session, markers, { sequenceName: session.name });
          reply.header('Content-Type', 'application/xml; charset=utf-8');
          reply.header('Content-Disposition', attachmentDisposition(`${session.name}.xml`));
          return reply.send(xmlContent);
        }

        case 'csv': {
          const csvContent = exportToCsv(session, markers);
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          reply.header('Content-Disposition', attachmentDisposition(`${session.name}.csv`));
          return reply.send(csvContent);
        }

        case 'youtube': {
          const ytContent = exportToYouTubeChapters(session, markers);
          reply.header('Content-Type', 'text/plain; charset=utf-8');
          reply.header('Content-Disposition', attachmentDisposition(`${session.name}_chapters.txt`));
          return reply.send(ytContent);
        }

        case 'matrix': {
          const matrix = generateMulticamSyncMatrix(session, markers, members, anchors);
          reply.header('Content-Type', 'application/json; charset=utf-8');
          reply.header('Content-Disposition', attachmentDisposition(`${session.name}_matrix.json`));
          return reply.send(matrix);
        }

        default:
          return reply.status(400).send({
            error: `Unsupported format: "${format}". Supported formats are: edl, xml, csv, youtube, matrix`,
          });
      }
    }
  );
}
