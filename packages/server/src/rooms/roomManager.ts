import { WebSocket } from 'ws';
import {
  Room,
  SquadMember,
  RecordingSession,
  SquadMarker,
  ServerMessage,
  ClientKind,
  CreateRoomResponse,
  ErrorCode,
  SMPTETimecode,
  CATEGORY_TO_DAVINCI_COLOR,
  MarkerCategory,
  MarkerChanges,
  DaVinciMarkerColor,
  SessionSummary,
  resolveMemberFramerate,
} from '@streamcollab/shared';
import { DatabaseService } from '../db/database.js';
import { generateRoomCode, generateToken, hashToken, tokenMatches } from '../auth/tokens.js';
import crypto from 'node:crypto';

export interface ConnectedClient {
  socket: WebSocket;
  roomId: string;
  kind: ClientKind;
  memberId: string | null; // Only docks represent a squad member
  isHost: boolean; // Presented the room's host token at join time
}

/** An error that is safe to send back to the client, with a machine-readable code */
export class RoomError extends Error {
  constructor(
    public code: ErrorCode,
    message: string
  ) {
    super(message);
  }
}

// How far a client-reported marker time may differ from the moment the server received it.
// Keypresses can't be in the future, and anything older than a few seconds is a stale/forged clock.
export const MARKER_MAX_PAST_SKEW_MS = 10_000;
export const MARKER_MAX_FUTURE_SKEW_MS = 1_000;

/**
 * Pick the authoritative timestamp for a marker: the client's SNTP-calibrated keypress time
 * (removes network latency from the timeline), clamped to a sane window around arrival.
 */
export function resolveMarkerTimestamp(clientTimestamp: number | undefined, receivedAt: number): number {
  if (typeof clientTimestamp !== 'number' || !Number.isFinite(clientTimestamp)) {
    return receivedAt;
  }
  return Math.min(
    receivedAt + MARKER_MAX_FUTURE_SKEW_MS,
    Math.max(receivedAt - MARKER_MAX_PAST_SKEW_MS, Math.round(clientTimestamp))
  );
}

export class RoomManager {
  private db: DatabaseService;
  // Every live connection, keyed by socket so a dock and a HUD sharing a member id never collide
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  // roomId -> sockets subscribed to that room
  private roomSockets: Map<string, Set<WebSocket>> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /** Auto-close any unstopped sessions left orphaned after crash/restart */
  reconcileOrphanSessions(options?: { closeActive?: boolean }): { closedCount: number } {
    return this.db.reconcileOrphanSessions(options);
  }

  /** Crash recovery reconciliation: auto-close unstopped sessions across all rooms */
  reconcileCrashRecovery(): { closedCount: number } {
    return this.db.reconcileCrashRecovery();
  }

  // Room lifecycle
  createRoom(id?: string, name?: string): CreateRoomResponse {
    let roomId = id;
    if (roomId) {
      if (this.db.resolveRoomId(roomId)) {
        throw new RoomError('FORBIDDEN', `Room ${roomId} already exists`);
      }
    } else {
      do {
        roomId = generateRoomCode();
      } while (this.db.roomExists(roomId));
    }

    const hostToken = generateToken();
    const room = this.db.createRoom(roomId, name || `Squad Room ${roomId}`, hashToken(hostToken));
    return { ...room, hostToken };
  }

  isHostToken(roomId: string, token: string | undefined): boolean {
    return tokenMatches(token, this.db.getRoomHostTokenHash(roomId));
  }

  isMemberToken(memberId: string, token: string | undefined): boolean {
    return tokenMatches(token, this.db.getMemberTokenHash(memberId));
  }

  /** Room with each member's live presence (`online` = a dock for them is connected) */
  getRoom(roomId: string): Room | null {
    const room = this.db.getRoom(roomId);
    if (!room) return null;
    return { ...room, members: room.members.map((m) => ({ ...m, online: this.isMemberOnline(roomId, m.id) })) };
  }

  isMemberOnline(roomId: string, memberId: string): boolean {
    return [...(this.roomSockets.get(roomId) ?? [])].some((s) => {
      const client = this.clients.get(s);
      return client?.kind === 'dock' && client.memberId === memberId;
    });
  }

  /** Delete a finished session and everything recorded in it (host-only, enforced by callers) */
  deleteSession(roomId: string, sessionId: string) {
    const session = this.db.getSession(sessionId);
    if (!session || session.roomId !== roomId) {
      throw new RoomError('NOT_FOUND', `Session ${sessionId} not found in this room`);
    }
    if (!session.stoppedAt) {
      throw new RoomError('FORBIDDEN', 'Stop the session before deleting it');
    }
    this.db.deleteSession(sessionId);
    this.broadcastToRoom(roomId, { type: 'SESSION_DELETED', payload: { sessionId } });
  }

  /** Delete the room and all its data; connected clients are told and detached (host-only) */
  deleteRoom(roomId: string) {
    this.broadcastToRoom(roomId, { type: 'ROOM_DELETED', payload: { roomId } });
    for (const socket of [...(this.roomSockets.get(roomId) ?? [])]) {
      this.clients.delete(socket);
    }
    this.roomSockets.delete(roomId);
    this.db.deleteRoom(roomId);
  }

  /** Host only: forget an offline member (its row and member token). Markers keep their author name. */
  removeMember(actor: { roomId: string; isHost: boolean }, memberId: string) {
    if (!actor.isHost) {
      throw new RoomError('FORBIDDEN', 'Only the room host can remove members');
    }
    const member = this.db.getRoomMembers(actor.roomId).find((m) => m.id === memberId);
    if (!member) {
      throw new RoomError('NOT_FOUND', `Member ${memberId} is not in this room`);
    }
    if (this.isMemberOnline(actor.roomId, memberId)) {
      throw new RoomError('FORBIDDEN', 'This member is online; only offline members can be removed');
    }
    this.db.removeMember(actor.roomId, memberId);
    this.broadcastToRoom(actor.roomId, { type: 'MEMBER_REMOVED', payload: { memberId } });
  }

  listRooms(): Room[] {
    return this.db.listRooms();
  }

  // WebSocket connection tracking
  joinRoom(
    socket: WebSocket,
    roomId: string,
    kind: ClientKind,
    member?: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'>,
    credentials: { memberToken?: string; hostToken?: string } = {}
  ) {
    if (kind === 'dock' && !member) {
      throw new RoomError('INVALID_MESSAGE', 'Dock clients must provide member details to join a room');
    }

    // The room code is the invite: rooms must be created first (POST /api/rooms).
    // Codes are matched in any letter case and continue under their canonical spelling.
    const canonicalRoomId = this.db.resolveRoomId(roomId);
    if (!canonicalRoomId) {
      throw new RoomError('ROOM_NOT_FOUND', `Room ${roomId} not found. Ask your host for the room code.`);
    }
    roomId = canonicalRoomId;

    const isHost = this.isHostToken(roomId, credentials.hostToken);
    if (credentials.hostToken && !isHost) {
      throw new RoomError('HOST_TOKEN_INVALID', 'Invalid host token for this room');
    }

    // A member id belongs to whoever first claimed it; later joins must prove it with the member token
    let issuedMemberToken: string | undefined;
    if (kind === 'dock' && member) {
      const storedHash = this.db.getMemberTokenHash(member.id);
      if (storedHash && !tokenMatches(credentials.memberToken, storedHash)) {
        throw new RoomError('MEMBER_TOKEN_INVALID', 'This member id is already claimed by another device');
      }
      if (!storedHash) {
        issuedMemberToken = generateToken();
      }
    }

    // A socket lives in exactly one room; rejoining moves it
    if (this.clients.has(socket)) {
      this.removeClient(socket);
    }

    const memberId = kind === 'dock' && member ? member.id : null;
    this.clients.set(socket, { socket, roomId, kind, memberId, isHost });
    let sockets = this.roomSockets.get(roomId);
    if (!sockets) {
      sockets = new Set();
      this.roomSockets.set(roomId, sockets);
    }
    sockets.add(socket);

    if (kind === 'dock' && member) {
      const existing = this.db.getRoomMembers(roomId).find((m) => m.id === member.id);
      const fullMember: SquadMember = {
        ...member,
        lastHeartbeat: Date.now(),
        clockOffsetMs: existing?.clockOffsetMs ?? 0,
        rttMs: existing?.rttMs ?? 0,
        recordStartedAt: member.recordStartedAt ?? existing?.recordStartedAt ?? null,
      };
      this.db.upsertMember(roomId, fullMember);
      if (issuedMemberToken) {
        this.db.setMemberTokenHash(fullMember.id, hashToken(issuedMemberToken));
      }

      this.broadcastToRoom(
        roomId,
        {
          type: 'MEMBER_JOINED',
          payload: { ...fullMember, online: true },
        },
        socket
      );
    }

    this.sendToSocket(socket, {
      type: 'JOINED',
      payload: { roomId, clientKind: kind, isHost, memberToken: issuedMemberToken },
    });

    // Send the current room state: the running session, or else the most recent one, so a reloaded
    // client can still review and export it (never every marker the room ever had)
    const room = this.getRoom(roomId);
    const activeSession = this.db.getActiveSession(roomId);
    const latestSession = activeSession ?? this.db.getLatestSession(roomId);
    const markers = latestSession ? this.db.getSessionMarkers(latestSession.id) : [];

    if (room) {
      this.sendToSocket(socket, {
        type: 'ROOM_STATE',
        payload: {
          room,
          activeSession,
          latestSession,
          markers,
        },
      });
    }
  }

  removeClient(socket: WebSocket) {
    const client = this.clients.get(socket);
    if (!client) return;

    this.clients.delete(socket);
    const sockets = this.roomSockets.get(client.roomId);
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) {
      this.roomSockets.delete(client.roomId);
    }

    // Sockets that close during shutdown (after the database closed) have nothing left to update
    if (client.kind !== 'dock' || !client.memberId || !this.db.isOpen) return;

    // The member is only gone once their last dock connection closes
    const stillConnected = [...(sockets ?? [])].some((s) => {
      const other = this.clients.get(s);
      return other?.kind === 'dock' && other.memberId === client.memberId;
    });
    if (stillConnected) return;

    const member = this.db.getRoomMembers(client.roomId).find((m) => m.id === client.memberId);
    if (member) {
      member.obsStatus = 'disconnected';
      this.db.upsertMember(client.roomId, member);
    }

    this.broadcastToRoom(client.roomId, {
      type: 'MEMBER_LEFT',
      payload: { memberId: client.memberId },
    });
  }

  getClient(socket: WebSocket): ConnectedClient | undefined {
    return this.clients.get(socket);
  }

  getConnections(roomId: string): { kind: ClientKind; memberId: string | null }[] {
    return [...(this.roomSockets.get(roomId) ?? [])]
      .map((s) => this.clients.get(s))
      .filter((c): c is ConnectedClient => Boolean(c))
      .map((c) => ({ kind: c.kind, memberId: c.memberId }));
  }

  updateMember(roomId: string, memberId: string, partial: Partial<SquadMember>) {
    const members = this.db.getRoomMembers(roomId);
    const existing = members.find((m) => m.id === memberId);
    if (!existing) return;

    const updated: SquadMember = {
      ...existing,
      ...partial,
      id: existing.id,
      lastHeartbeat: Date.now(),
    };

    this.db.upsertMember(roomId, updated);

    // A new recording start becomes this member's anchor in the running session
    if (typeof updated.recordStartedAt === 'number' && updated.recordStartedAt !== existing.recordStartedAt) {
      const activeSession = this.db.getActiveSession(roomId);
      if (activeSession) {
        this.saveAnchor(activeSession.id, updated);
      }
    }

    this.broadcastToRoom(roomId, {
      type: 'MEMBER_UPDATED',
      payload: { ...updated, online: this.isMemberOnline(roomId, updated.id) },
    });
  }

  private saveAnchor(sessionId: string, member: SquadMember) {
    if (typeof member.recordStartedAt !== 'number') return;
    const rate = resolveMemberFramerate(member);
    this.db.upsertSessionAnchor({
      sessionId,
      memberId: member.id,
      recordStartedAt: member.recordStartedAt,
      framerateNumerator: rate.numerator,
      framerateDenominator: rate.denominator,
    });
  }

  // Session handling
  startSession(
    roomId: string,
    sessionData: {
      name: string;
      baseTimecode?: string;
      framerateNumerator?: number;
      framerateDenominator?: number;
      dropFrame?: boolean;
    }
  ): RecordingSession {
    // One running session per room: a new start closes the previous one instead of orphaning it
    const previous = this.db.getActiveSession(roomId);
    if (previous) {
      this.stopSession(roomId, previous.id);
    }

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

    // Members already recording when the session starts keep their existing file anchor
    for (const member of this.db.getRoomMembers(roomId)) {
      if (member.obsStatus === 'recording' || member.obsStatus === 'paused') {
        this.saveAnchor(session.id, member);
      }
    }

    this.broadcastToRoom(roomId, {
      type: 'SESSION_STARTED',
      payload: session,
    });

    return session;
  }

  stopSession(roomId: string, sessionId: string): RecordingSession | null {
    // Never let one room stop another room's session
    const session = this.db.getSession(sessionId);
    if (!session || session.roomId !== roomId) return null;

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
    color?: DaVinciMarkerColor;
    tags?: string[];
    clientTimestamp?: number;
    obsRecordMs?: number;
  }): SquadMarker {
    const now = resolveMarkerTimestamp(data.clientTimestamp, Date.now());
    let session = data.sessionId ? this.db.getSession(data.sessionId) : null;
    if (!session || session.roomId !== data.roomId) {
      session = this.db.getActiveSession(data.roomId);
    }

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

    const markerColor: DaVinciMarkerColor = data.color || CATEGORY_TO_DAVINCI_COLOR[data.category] || 'Blue';

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
      obsRecordMs:
        typeof data.obsRecordMs === 'number' && data.obsRecordMs >= 0 ? Math.round(data.obsRecordMs) : undefined,
    };

    this.db.createMarker(marker);

    this.broadcastToRoom(data.roomId, {
      type: 'MARKER_ADDED',
      payload: marker,
    });

    return marker;
  }

  listSessions(roomId: string): SessionSummary[] {
    return this.db.listSessions(roomId);
  }

  // Marker editing: only the author (from their own dock) or the room host
  private requireEditableMarker(
    actor: { roomId: string; memberId: string | null; isHost: boolean },
    markerId: string
  ): SquadMarker {
    const marker = this.db.getMarker(markerId);
    if (!marker || marker.roomId !== actor.roomId) {
      throw new RoomError('NOT_FOUND', `Marker ${markerId} not found in this room`);
    }
    if (!actor.isHost && marker.memberId !== actor.memberId) {
      throw new RoomError('FORBIDDEN', 'Only the marker author or the room host can change it');
    }
    return marker;
  }

  updateMarker(
    actor: { roomId: string; memberId: string | null; isHost: boolean },
    markerId: string,
    changes: MarkerChanges
  ): SquadMarker {
    const marker = this.requireEditableMarker(actor, markerId);
    const category = changes.category ?? marker.category;
    // A new category brings its own NLE color unless one was chosen explicitly
    const color =
      changes.color ??
      (changes.category && changes.category !== marker.category
        ? (CATEGORY_TO_DAVINCI_COLOR[category] as SquadMarker['color']) || marker.color
        : marker.color);

    const updated: SquadMarker = {
      ...marker,
      category,
      color,
      label: changes.label ?? marker.label,
      comment: changes.comment === null ? undefined : (changes.comment ?? marker.comment),
    };
    this.db.updateMarker(updated);
    this.broadcastToRoom(marker.roomId, { type: 'MARKER_UPDATED', payload: updated });
    return updated;
  }

  deleteMarker(actor: { roomId: string; memberId: string | null; isHost: boolean }, markerId: string): SquadMarker {
    const marker = this.requireEditableMarker(actor, markerId);
    this.db.deleteMarker(marker.id);
    this.broadcastToRoom(marker.roomId, {
      type: 'MARKER_DELETED',
      payload: { markerId: marker.id, sessionId: marker.sessionId },
    });
    return marker;
  }

  /** Delete a member's most recent marker in the active session (the "oops" button) */
  undoLastMarker(roomId: string, memberId: string): SquadMarker {
    const session = this.db.getActiveSession(roomId) ?? this.db.getLatestSession(roomId);
    const marker = session ? this.db.getLatestMemberMarker(session.id, memberId) : null;
    if (!marker) {
      throw new RoomError('NOT_FOUND', 'No marker of yours to undo in this session');
    }
    return this.deleteMarker({ roomId, memberId, isHost: false }, marker.id);
  }

  // Messaging helpers
  broadcastToRoom(roomId: string, message: ServerMessage, excludeSocket?: WebSocket) {
    const sockets = this.roomSockets.get(roomId);
    if (!sockets) return;

    const payloadStr = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket === excludeSocket) continue;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payloadStr);
      }
    }
  }

  sendToSocket(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
