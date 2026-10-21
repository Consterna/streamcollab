import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { RoomManager } from '../rooms/roomManager.js';
import { SntpClockEngine } from '../sntp/clock.js';
import { ClientMessage } from '@streamcollab/shared';

export function registerWebSocketHandler(fastify: FastifyInstance, roomManager: RoomManager) {
  fastify.get('/ws', { websocket: true }, (socket: WebSocket /*, req */) => {
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
            const { roomId, member } = message.payload;
            const fullMember = {
              ...member,
              lastHeartbeat: Date.now(),
              clockOffsetMs: 0,
              rttMs: 0,
            };
            roomManager.addClient(socket, roomId, fullMember);
            break;
          }

          case 'UPDATE_STATUS': {
            const { roomId, memberId, status } = message.payload;
            roomManager.updateMember(roomId, memberId, status);
            break;
          }

          case 'CREATE_MARKER': {
            const { roomId, marker } = message.payload;
            roomManager.createMarker({
              roomId,
              sessionId: marker.sessionId,
              memberId: marker.memberId,
              memberName: marker.memberName,
              category: marker.category,
              label: marker.label,
              comment: marker.comment,
              color: marker.color,
              tags: marker.tags,
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

    socket.on('close', () => {
      roomManager.removeClient(socket);
    });

    socket.on('error', () => {
      roomManager.removeClient(socket);
    });
  });
}
