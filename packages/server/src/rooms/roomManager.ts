import { WebSocket } from 'ws';
import {
  Room,
  SquadMember,
  RecordingSession,
  SquadMarker,
  ServerMessage,
  SMPTETimecode,
  CATEGORY_TO_DAVINCI_COLOR,
  MarkerCategory,
} from '@streamcollab/shared';
import { DatabaseService } from '../db/database.js';
import crypto from 'node:crypto';

interface ConnectedClient {
  socket: WebSocket;
  memberId: string;
  roomId: string;
}

export class RoomManager {
  private db: DatabaseService;
  // Map of roomId -> Map of memberId -> ConnectedClient
  private roomClients: Map<string, Map<string, ConnectedClient>> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  // Room lifecycle
  createRoom(id?: string, name?: string): Room {
    const roomId = id || crypto.randomUUID().slice(0, 8);
    const roomName = name || `Squad Room ${roomId}`;
    return this.db.createRoom(roomId, roomName);
  }

  getRoom(roomId: string): Room | null {
    return this.db.getRoom(roomId);
  }

  listRooms(): Room[] {
    return this.db.listRooms();
  }

  // WebSocket connection tracking
  addClient(socket: WebSocket, roomId: string, member: SquadMember) {
    let clients = this.roomClients.get(roomId);
    if (!clients) {
      clients = new Map();
      this.roomClients.set(roomId, clients);
    }

    clients.set(member.id, { socket, memberId: member.id, roomId });

    // Update in DB
    this.db.upsertMember(roomId, member);

    // Broadcast member joined
    this.broadcastToRoom(roomId, {
      type: 'MEMBER_JOINED',
      payload: member,
    }, member.id);

    // Send complete current room state to newly joined client
    const room = this.db.getRoom(roomId);
    const activeSession = this.db.getActiveSession(roomId);
    const markers = activeSession ? this.db.getSessionMarkers(activeSession.id) : this.db.getRoomMarkers(roomId);

    if (room) {
      this.sendToSocket(socket, {
        type: 'ROOM_STATE',
        payload: {
          room,
          activeSession,
          markers,
        },
      });
    }
  }

  removeClient(socket: WebSocket) {
    for (const [roomId, clients] of this.roomClients.entries()) {
      for (const [memberId, client] of clients.entries()) {
        if (client.socket === socket) {
          clients.delete(memberId);
          // Broadcast member left
          this.broadcastToRoom(roomId, {
            type: 'MEMBER_LEFT',
            payload: { memberId },
          });

          // Update member status in DB
          const members = this.db.getRoomMembers(roomId);
          const member = members.find((m) => m.id === memberId);
          if (member) {
            member.obsStatus = 'disconnected';
            this.db.upsertMember(roomId, member);
          }
          break;
        }
      }
      if (clients.size === 0) {
        this.roomClients.delete(roomId);
      }
    }
  }

  updateMember(roomId: string, memberId: string, partial: Partial<SquadMember>) {
    const members = this.db.getRoomMembers(roomId);
    const existing = members.find((m) => m.id === memberId);
    if (!existing) return;

    const updated: SquadMember = {
      ...existing,
      ...partial,
      lastHeartbeat: Date.now(),
    };

    this.db.upsertMember(roomId, updated);

    this.broadcastToRoom(roomId, {
      type: 'MEMBER_UPDATED',
      payload: updated,
    });
  }

  // Session handling
  startSession(roomId: string, sessionData: {
    name: string;
    baseTimecode?: string;
    framerateNumerator?: number;
    framerateDenominator?: number;
    dropFrame?: boolean;
  }): RecordingSession {
    const sessionId = crypto.randomUUID();
    const session: RecordingSession = {
      id: sessionId,
      roomId,
      name: sessionData.name || `Session ${new Date().toLocaleTimeString()}`,
      startedAt: Date.now(),
      stoppedAt: null,
      baseTimecode: sessionData.baseTimecode || '01:00:00:00',
      framerateNumerator: sessionData.framerateNumerator || 60,
      framerateDenominator: sessionData.framerateDenominator || 1,
      dropFrame: sessionData.dropFrame ?? false,
    };

    this.db.createSession(session);

    this.broadcastToRoom(roomId, {
      type: 'SESSION_STARTED',
      payload: session,
    });

    return session;
  }

  stopSession(roomId: string, sessionId: string): RecordingSession | null {
    const stopped = this.db.stopSession(sessionId);
    if (stopped) {
      this.broadcastToRoom(roomId, {
        type: 'SESSION_STOPPED',
        payload: stopped,
      });
    }
    return stopped;
  }

  getActiveSession(roomId: string): RecordingSession | null {
    return this.db.getActiveSession(roomId);
  }

  // Marker creation
  createMarker(data: {
    roomId: string;
    sessionId?: string;
    memberId: string;
    memberName: string;
    category: MarkerCategory;
    label: string;
    comment?: string;
    color?: string;
    tags?: string[];
    timestamp?: number;
  }): SquadMarker {
    const now = data.timestamp || Date.now();
    let session = data.sessionId ? this.db.getSession(data.sessionId) : this.db.getActiveSession(data.roomId);

    // If no active session, auto-create one or fallback to base epoch session
    if (!session) {
      session = this.startSession(data.roomId, {
        name: `Auto Session ${new Date().toLocaleTimeString()}`,
        baseTimecode: '01:00:00:00',
        framerateNumerator: 60,
        framerateDenominator: 1,
        dropFrame: false,
      });
    }

    const tc = new SMPTETimecode({
      framerateNumerator: session.framerateNumerator,
      framerateDenominator: session.framerateDenominator,
      dropFrame: session.dropFrame,
    });

    const relativeTimeMs = Math.max(0, now - session.startedAt);
    const timecode = tc.relativeMsToTimecode(relativeTimeMs, session.baseTimecode);
    const frameNumber = tc.millisecondsToFrames(relativeTimeMs);

    const markerColor = (data.color as any) || CATEGORY_TO_DAVINCI_COLOR[data.category] || 'Blue';

    const marker: SquadMarker = {
      id: crypto.randomUUID(),
      roomId: data.roomId,
      sessionId: session.id,
      memberId: data.memberId,
      memberName: data.memberName,
      timestamp: now,
      relativeTimeMs,
      timecode,
      frameNumber,
      category: data.category,
      label: data.label,
      comment: data.comment,
      color: markerColor,
      tags: data.tags,
    };

    this.db.createMarker(marker);

    this.broadcastToRoom(data.roomId, {
      type: 'MARKER_ADDED',
      payload: marker,
    });

    return marker;
  }

  // Messaging helpers
  broadcastToRoom(roomId: string, message: ServerMessage, excludeMemberId?: string) {
    const clients = this.roomClients.get(roomId);
    if (!clients) return;

    const payloadStr = JSON.stringify(message);
    for (const [memberId, client] of clients.entries()) {
      if (excludeMemberId && memberId === excludeMemberId) continue;
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payloadStr);
      }
    }
  }

  sendToSocket(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
