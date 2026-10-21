import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { RoomManager, RoomError } from '../rooms/roomManager.js';
import { SntpClockEngine } from '../sntp/clock.js';
import { clientMessageSchema, formatValidationError, ErrorCode, ServerMessage } from '@streamcollab/shared';

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

// Token bucket per socket: generous for SNTP pings, 1s status updates and hotkey bursts
export const WS_RATE_LIMIT = { burst: 40, refillPerSecond: 20 };

export interface WebSocketHandlerOptions {
  heartbeatIntervalMs?: number;
}

export function registerWebSocketHandler(
  fastify: FastifyInstance,
  roomManager: RoomManager,
  options: WebSocketHandlerOptions = {}
) {
  // Heartbeat: every interval each socket must answer a ping, or it is terminated.
  // Terminated sockets fire 'close', which removes them from their room.
  const liveSockets = new Map<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const [socket, isAlive] of liveSockets) {
      if (!isAlive) {
        socket.terminate();
        continue;
      }
      liveSockets.set(socket, false);
      socket.ping();
    }
  }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(heartbeat);
  });

  fastify.get('/ws', { websocket: true }, (socket: WebSocket /*, req */) => {
    liveSockets.set(socket, true);
    socket.on('pong', () => {
      liveSockets.set(socket, true);
    });

    const send = (message: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };
    const sendError = (code: ErrorCode, message: string) => send({ type: 'ERROR', payload: { code, message } });

    let tokens: number = WS_RATE_LIMIT.burst;
    let lastRefill = Date.now();
    const allowMessage = () => {
      const now = Date.now();
      tokens = Math.min(WS_RATE_LIMIT.burst, tokens + ((now - lastRefill) / 1000) * WS_RATE_LIMIT.refillPerSecond);
      lastRefill = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    socket.on('message', (data: Buffer | string) => {
      if (!allowMessage()) {
        sendError('RATE_LIMITED', 'Too many messages, slow down');
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        sendError('INVALID_MESSAGE', 'Message is not valid JSON');
        return;
      }

      const parsed = clientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        sendError('INVALID_MESSAGE', formatValidationError(parsed.error));
        return;
      }
      const message = parsed.data;

      try {
        if (message.type === 'SNTP_PING') {
          send({ type: 'SNTP_PONG', payload: SntpClockEngine.handlePing(message.payload) });
          return;
        }

        if (message.type === 'JOIN_ROOM') {
          const { roomId, member, clientKind, memberToken, hostToken } = message.payload;
          roomManager.joinRoom(socket, roomId, clientKind, member, { memberToken, hostToken });
          return;
        }

        if (message.type === 'LEAVE_ROOM') {
          roomManager.removeClient(socket);
          return;
        }

        // Everything else acts on the room this socket joined, as the identity it proved at join time.
        // Room / member ids in the payload are ignored so a client can't act on another room or member.
        const client = roomManager.getClient(socket);
        if (!client) {
          throw new RoomError('NOT_JOINED', 'Join a room first');
        }

        switch (message.type) {
          case 'UPDATE_STATUS': {
            if (client.kind !== 'dock' || !client.memberId) {
              throw new RoomError('FORBIDDEN', 'Only a streamer dock can update member status');
            }
            roomManager.updateMember(client.roomId, client.memberId, message.payload.status);
            break;
          }

          case 'CREATE_MARKER': {
            if (client.kind !== 'dock' || !client.memberId) {
              throw new RoomError('FORBIDDEN', 'Only a streamer dock can create markers');
            }
            const { marker, clientTimestamp } = message.payload;
            const member = roomManager.getRoom(client.roomId)?.members.find((m) => m.id === client.memberId);
            roomManager.createMarker({
              roomId: client.roomId,
              sessionId: marker.sessionId || undefined,
              memberId: client.memberId,
              memberName: member?.name ?? client.memberId,
              category: marker.category,
              label: marker.label,
              comment: marker.comment || undefined,
              color: marker.color,
              tags: marker.tags,
              clientTimestamp,
              obsRecordMs: marker.obsRecordMs,
            });
            break;
          }

          case 'START_SESSION': {
            if (!client.isHost) {
              throw new RoomError('FORBIDDEN', 'Only the room host can start a session');
            }
            const settings = message.payload.session;
            roomManager.startSession(client.roomId, { ...settings, name: settings.name || '' });
            break;
          }

          case 'STOP_SESSION': {
            if (!client.isHost) {
              throw new RoomError('FORBIDDEN', 'Only the room host can stop a session');
            }
            const sessionId = message.payload.sessionId || roomManager.getActiveSession(client.roomId)?.id;
            if (sessionId) {
              roomManager.stopSession(client.roomId, sessionId);
            }
            break;
          }

          case 'UPDATE_MARKER': {
            roomManager.updateMarker(client, message.payload.markerId, message.payload.changes);
            break;
          }

          case 'DELETE_MARKER': {
            roomManager.deleteMarker(client, message.payload.markerId);
            break;
          }

          case 'UNDO_LAST_MARKER': {
            if (client.kind !== 'dock' || !client.memberId) {
              throw new RoomError('FORBIDDEN', 'Only a streamer dock can undo its markers');
            }
            roomManager.undoLastMarker(client.roomId, client.memberId);
            break;
          }
        }
      } catch (err: any) {
        if (err instanceof RoomError) {
          sendError(err.code, err.message);
        } else {
          fastify.log.error({ err }, 'WebSocket message handling failed');
          sendError('INVALID_MESSAGE', 'Could not process message');
        }
      }
    });

    const cleanup = () => {
      liveSockets.delete(socket);
      roomManager.removeClient(socket);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
