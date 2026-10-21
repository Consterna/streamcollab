import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RoomManager } from '../rooms/roomManager.js';
import { DatabaseService } from '../db/database.js';
import {
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  generateMulticamSyncMatrix,
  MarkerCategory,
} from '@streamcollab/shared';

export function registerApiRoutes(fastify: FastifyInstance, roomManager: RoomManager, db: DatabaseService) {
  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'ok', serverTime: Date.now() };
  });

  // List rooms
  fastify.get('/api/rooms', async () => {
    return roomManager.listRooms();
  });

  // Create room
  fastify.post('/api/rooms', async (req: FastifyRequest<{ Body: { id?: string; name?: string } }>, reply: FastifyReply) => {
    const { id, name } = req.body || {};
    const room = roomManager.createRoom(id, name);
    return reply.status(201).send(room);
  });

  // Get room
  fastify.get('/api/rooms/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const room = roomManager.getRoom(id);
    if (!room) {
      return reply.status(404).send({ error: `Room ${id} not found` });
    }
    const activeSession = roomManager.getActiveSession(id);
    return { room, activeSession };
  });

  // Start session
  fastify.post('/api/rooms/:id/session/start', async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        baseTimecode?: string;
        framerateNumerator?: number;
        framerateDenominator?: number;
        dropFrame?: boolean;
      };
    }>,
    reply: FastifyReply
  ) => {
    const { id } = req.params;
    const room = roomManager.getRoom(id);
    if (!room) {
      return reply.status(404).send({ error: `Room ${id} not found` });
    }

    const body = req.body || {};
    const session = roomManager.startSession(id, {
      name: body.name || 'Main Stream Session',
      baseTimecode: body.baseTimecode,
      framerateNumerator: body.framerateNumerator,
      framerateDenominator: body.framerateDenominator,
      dropFrame: body.dropFrame,
    });
    return reply.status(201).send(session);
  });

  // Stop session
  fastify.post('/api/rooms/:id/session/stop', async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { sessionId?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { id } = req.params;
    const body = req.body || {};
    const sessionId = body.sessionId || roomManager.getActiveSession(id)?.id;
    if (!sessionId) {
      return reply.status(400).send({ error: 'No active session found to stop' });
    }

    const session = roomManager.stopSession(id, sessionId);
    return { session };
  });

  // Quick mark
  fastify.post('/api/rooms/:id/quick-mark', async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        memberId: string;
        memberName: string;
        category: MarkerCategory;
        label: string;
        comment?: string;
        color?: string;
        tags?: string[];
      };
    }>,
    reply: FastifyReply
  ) => {
    const { id } = req.params;
    const { memberId, memberName, category, label, comment, color, tags } = req.body;

    if (!memberId || !memberName || !category || !label) {
      return reply.status(400).send({ error: 'Missing required marker fields (memberId, memberName, category, label)' });
    }

    const marker = roomManager.createMarker({
      roomId: id,
      memberId,
      memberName,
      category,
      label,
      comment,
      color,
      tags,
    });

    return reply.status(201).send(marker);
  });

  // List markers
  fastify.get('/api/rooms/:id/markers', async (req: FastifyRequest<{ Params: { id: string }; Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const { sessionId } = req.query;

    if (sessionId) {
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
  });

  // NLE Timeline Exporters
  fastify.get('/api/rooms/:id/export/:format', async (
    req: FastifyRequest<{
      Params: { id: string; format: string };
      Querystring: { sessionId?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { id, format } = req.params;
    const { sessionId } = req.query;

    const room = roomManager.getRoom(id);
    if (!room) {
      return reply.status(404).send({ error: `Room ${id} not found` });
    }

    let session = sessionId ? db.getSession(sessionId) : roomManager.getActiveSession(id);
    if (!session) {
      // Fallback: get the most recent session in this room
      session = db.getLatestSession(id);
    }

    if (!session) {
      return reply.status(404).send({ error: 'No recording session found for export' });
    }

    const markers = db.getSessionMarkers(session.id);
    const members = db.getRoomMembers(id);

    switch (format.toLowerCase()) {
      case 'edl': {
        const edlContent = exportToEdl(session, markers, { title: session.name });
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${session.name.replace(/\s+/g, '_')}.edl"`);
        return reply.send(edlContent);
      }

      case 'xml': {
        const xmlContent = exportToFcpXml(session, markers, { sequenceName: session.name });
        reply.header('Content-Type', 'application/xml; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${session.name.replace(/\s+/g, '_')}.xml"`);
        return reply.send(xmlContent);
      }

      case 'csv': {
        const csvContent = exportToCsv(session, markers);
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${session.name.replace(/\s+/g, '_')}.csv"`);
        return reply.send(csvContent);
      }

      case 'youtube': {
        const ytContent = exportToYouTubeChapters(session, markers);
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${session.name.replace(/\s+/g, '_')}_chapters.txt"`);
        return reply.send(ytContent);
      }

      case 'matrix': {
        const matrix = generateMulticamSyncMatrix(session, markers, members);
        reply.header('Content-Type', 'application/json; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${session.name.replace(/\s+/g, '_')}_matrix.json"`);
        return reply.send(matrix);
      }

      default:
        return reply.status(400).send({
          error: `Unsupported format: "${format}". Supported formats are: edl, xml, csv, youtube, matrix`,
        });
    }
  });
}
