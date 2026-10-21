import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { RoomManager } from '../rooms/roomManager.js';
import { SntpClockEngine } from '../sntp/clock.js';
import { ClientMessage } from '@streamcollab/shared';

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

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

    socket.on('message', (data: Buffer | string) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'SNTP_PING': {
            const pongPayload = SntpClockEngine.handlePing(message.payload);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: 'SNTP_PONG',
                payload: pongPayload,
              }));
            }
            break;
          }

          case 'JOIN_ROOM': {
            const { roomId, member, clientKind } = message.payload;
            roomManager.joinRoom(socket, roomId, clientKind ?? 'dock', member);
            break;
          }

          case 'UPDATE_STATUS': {
            const { roomId, memberId, status } = message.payload;
            roomManager.updateMember(roomId, memberId, status);
            break;
          }

          case 'CREATE_MARKER': {
            const { roomId, marker, clientTimestamp } = message.payload;
            roomManager.createMarker({
              roomId,
              sessionId: marker.sessionId || undefined,
              memberId: marker.memberId,
              memberName: marker.memberName,
              category: marker.category,
              label: marker.label,
              comment: marker.comment,
              color: marker.color,
              tags: marker.tags,
              clientTimestamp,
              obsRecordMs: marker.obsRecordMs,
            });
            break;
          }

          case 'START_SESSION': {
            const { roomId, session } = message.payload;
            roomManager.startSession(roomId, session);
            break;
          }

          case 'STOP_SESSION': {
            const { roomId, sessionId } = message.payload;
            roomManager.stopSession(roomId, sessionId);
            break;
          }

          case 'LEAVE_ROOM': {
            roomManager.removeClient(socket);
            break;
          }

          default:
            break;
        }
      } catch (err: any) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'ERROR',
            payload: { message: err.message || 'Invalid message payload' },
          }));
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
