import {
  ClientMessage,
  ServerMessage,
  SquadMember,
  SquadMarker,
  RecordingSession,
  MarkerCategory,
  ClientKind,
  ErrorCode,
  MarkerChanges,
  DaVinciMarkerColor,
} from '@streamcollab/shared';
import { getHostToken, getMemberToken, saveMemberToken } from './credentials';
import { wsUrl } from './serverUrl';

// Errors after which the server did not add this socket to the room
const JOIN_REFUSED_CODES = new Set<ErrorCode>(['ROOM_NOT_FOUND', 'HOST_TOKEN_INVALID', 'MEMBER_TOKEN_INVALID']);

export interface JoinedInfo {
  roomId: string;
  clientKind: ClientKind;
  isHost: boolean;
}

export interface SocketClientCallbacks {
  onJoined?: (info: JoinedInfo) => void;
  onError?: (error: { message: string; code?: ErrorCode }) => void;
  onRoomState?: (state: Extract<ServerMessage, { type: 'ROOM_STATE' }>['payload']) => void;
  onMemberJoined?: (member: SquadMember) => void;
  onMemberLeft?: (memberId: string) => void;
  onMemberRemoved?: (memberId: string) => void;
  onMemberUpdated?: (member: SquadMember) => void;
  onMarkerAdded?: (marker: SquadMarker) => void;
  onMarkerUpdated?: (marker: SquadMarker) => void;
  onMarkerDeleted?: (deleted: { markerId: string; sessionId: string }) => void;
  onSessionStarted?: (session: RecordingSession) => void;
  onSessionStopped?: (session: RecordingSession) => void;
  onSessionDeleted?: (sessionId: string) => void;
  onRoomDeleted?: (roomId: string) => void;
  onClockSync?: (offsetMs: number, rttMs: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class StreamCollabSocketClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private sntpInterval: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  // The server confirmed the current JOIN_ROOM (JOINED); room actions are only sent while true
  private isJoined = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private sntpBurstTimeouts: ReturnType<typeof setTimeout>[] = [];

  // SNTP Calibration state
  private clockOffsetMs = 0;
  private rttMs = 0;
  private hasSntpSample = false;

  // Current session/room context
  private currentRoomId = '';
  private currentKind: ClientKind = 'dock';
  private currentMember: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'> | undefined;

  // Any number of listeners per event (App state, views, overlays)
  private listeners: { [K in keyof SocketClientCallbacks]?: Set<NonNullable<SocketClientCallbacks[K]>> } = {};

  /** Subscribe to a socket event; returns an unsubscribe function for use in effect cleanups */
  on<K extends keyof SocketClientCallbacks>(event: K, handler: NonNullable<SocketClientCallbacks[K]>): () => void {
    let set = this.listeners[event] as Set<NonNullable<SocketClientCallbacks[K]>> | undefined;
    if (!set) {
      set = new Set();
      (this.listeners as Record<string, Set<unknown>>)[event] = set as Set<unknown>;
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  private lastReportedConnected: boolean | null = null;

  private emit<K extends keyof SocketClientCallbacks>(
    event: K,
    ...args: Parameters<NonNullable<SocketClientCallbacks[K]>>
  ) {
    this.listeners[event]?.forEach((handler) => (handler as (...a: typeof args) => void)(...args));
  }

  private emitConnectionChange(connected: boolean) {
    if (this.lastReportedConnected !== connected) {
      this.lastReportedConnected = connected;
      this.emit('onConnectionChange', connected);
    }
  }

  constructor(serverUrl?: string) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
    } else {
      // Same origin (Vite proxy in dev, Fastify in production) unless ?server= points elsewhere
      this.serverUrl = wsUrl();
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  /** Not connected yet, but the first connection (or a new one) is still being opened */
  get connecting(): boolean {
    return !this.ws || this.ws.readyState === WebSocket.CONNECTING;
  }

  /** Connected and accepted into the current room */
  get joined(): boolean {
    return this.isConnected && this.isJoined;
  }

  get offset(): number {
    return this.clockOffsetMs;
  }

  get rtt(): number {
    return this.rttMs;
  }

  /**
   * Returns current time calibrated with the server clock
   */
  getCalibratedNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  connect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emitConnectionChange(true);
        this.startSntpCalibration();

        // If we were already in a room, rejoin
        if (this.currentRoomId) {
          this.joinRoom(this.currentRoomId, this.currentKind, this.currentMember);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.warn('[SocketClient] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onerror = () => {
        this.handleDisconnect();
      };
    } catch (err) {
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    this.isConnected = false;
    this.isJoined = false;
    this.hasSntpSample = false;
    this.emitConnectionChange(false);
    this.stopSntpCalibration();

    if (!this.reconnectTimeout) {
      // Exponential backoff: 1s, 1.5s, 2.25s... up to 15s max
      const delay = Math.min(15000, Math.round(1000 * Math.pow(1.5, this.reconnectAttempts)));
      this.reconnectAttempts++;
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.connect();
      }, delay);
    }
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'SNTP_PONG': {
        const t4 = Date.now();
        const { t1, t2, t3 } = msg.payload;
        const currentRtt = Math.max(0, t4 - t1 - (t3 - t2));
        const currentOffset = (t2 - t1 + (t3 - t4)) / 2;

        // Jitter spike outlier rejection:
        // Reject samples with extreme RTT spikes (> 2.5x baseline and > 100ms)
        // to protect the calibrated timeline from transient network congestion / bufferbloat.
        if (this.hasSntpSample && currentRtt > Math.max(100, this.rttMs * 2.5)) {
          break;
        }

        // Exponential moving average filter
        if (!this.hasSntpSample) {
          this.clockOffsetMs = currentOffset;
          this.rttMs = currentRtt;
          this.hasSntpSample = true;
        } else {
          // Weight lower RTT samples more heavily (NTP minimum dispersion principle)
          const weight = currentRtt < this.rttMs ? 0.5 : 0.3;
          this.clockOffsetMs = this.clockOffsetMs * (1 - weight) + currentOffset * weight;
          this.rttMs = this.rttMs * 0.7 + currentRtt * 0.3;
        }

        this.emit('onClockSync', this.clockOffsetMs, this.rttMs);
        break;
      }

      case 'ROOM_STATE':
        this.emit('onRoomState', msg.payload);
        break;

      case 'MEMBER_JOINED':
        this.emit('onMemberJoined', msg.payload);
        break;

      case 'MEMBER_LEFT':
        this.emit('onMemberLeft', msg.payload.memberId);
        break;

      case 'MEMBER_REMOVED':
        this.emit('onMemberRemoved', msg.payload.memberId);
        break;

      case 'MEMBER_UPDATED':
        this.emit('onMemberUpdated', msg.payload);
        break;

      case 'MARKER_ADDED':
        this.emit('onMarkerAdded', msg.payload);
        break;

      case 'MARKER_UPDATED':
        this.emit('onMarkerUpdated', msg.payload);
        break;

      case 'MARKER_DELETED':
        this.emit('onMarkerDeleted', msg.payload);
        break;

      case 'SESSION_STARTED':
        this.emit('onSessionStarted', msg.payload);
        break;

      case 'SESSION_DELETED':
        this.emit('onSessionDeleted', msg.payload.sessionId);
        break;

      case 'ROOM_DELETED':
        this.isJoined = false;
        this.emit('onRoomDeleted', msg.payload.roomId);
        break;

      case 'SESSION_STOPPED':
        this.emit('onSessionStopped', msg.payload);
        break;

      case 'JOINED': {
        const { memberToken, ...info } = msg.payload;
        // Issued once, the first time this member id is claimed; needed to rejoin as this member
        if (memberToken && this.currentMember) {
          saveMemberToken(this.currentMember.id, memberToken);
        }
        this.isJoined = true;
        this.emit('onJoined', info);
        break;
      }

      case 'ERROR':
        // A refused join leaves this socket outside any room
        if (msg.payload.code && JOIN_REFUSED_CODES.has(msg.payload.code)) {
          this.isJoined = false;
        }
        this.emit('onError', msg.payload);
        break;

      default:
        break;
    }
  }

  private startSntpCalibration() {
    this.stopSntpCalibration();
    // 4-ping initial calibration burst: immediate ping followed by 3 pings spaced 150ms apart
    this.sendPing();
    for (let i = 1; i <= 3; i++) {
      const timeout = setTimeout(() => {
        this.sendPing();
      }, i * 150);
      this.sntpBurstTimeouts.push(timeout);
    }

    // Ping every 5 seconds for continuous high-accuracy clock calibration
    this.sntpInterval = setInterval(() => {
      this.sendPing();
    }, 5000);
  }

  private stopSntpCalibration() {
    if (this.sntpInterval) {
      clearInterval(this.sntpInterval);
      this.sntpInterval = null;
    }
    for (const t of this.sntpBurstTimeouts) {
      clearTimeout(t);
    }
    this.sntpBurstTimeouts = [];
  }

  private sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'SNTP_PING',
        payload: { t1: Date.now() },
      });
    }
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Join a room. Docks join as squad members; HUD overlays and dashboards join as observers
   * so they never replace or impersonate the streamer's dock connection.
   */
  joinRoom(
    roomId: string,
    clientKind: ClientKind,
    member?: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'>
  ) {
    this.currentRoomId = roomId;
    this.currentKind = clientKind;
    this.currentMember = clientKind === 'dock' ? member : undefined;
    this.isJoined = false;
    this.send({
      type: 'JOIN_ROOM',
      payload: {
        roomId,
        clientKind,
        member: this.currentMember,
        memberToken: this.currentMember ? getMemberToken(this.currentMember.id) : undefined,
        hostToken: getHostToken(roomId),
      },
    });
  }

  /** Re-send JOIN_ROOM with freshly stored credentials (e.g. after pasting a host token) */
  rejoin() {
    if (this.currentRoomId) {
      this.joinRoom(this.currentRoomId, this.currentKind, this.currentMember);
    }
  }

  updateStatus(roomId: string, memberId: string, status: Partial<SquadMember>) {
    // Not in a room yet (or any more): the next status poll after JOINED reports it
    if (!this.joined) return;
    this.send({
      type: 'UPDATE_STATUS',
      payload: {
        roomId,
        memberId,
        status: {
          ...status,
          clockOffsetMs: this.clockOffsetMs,
          rttMs: this.rttMs,
        },
      },
    });
  }

  createMarker(data: {
    roomId: string;
    sessionId: string;
    memberId: string;
    memberName: string;
    category: MarkerCategory;
    label: string;
    comment?: string;
    color?: DaVinciMarkerColor;
    tags?: string[];
    obsRecordMs?: number | null;
  }): boolean {
    // Never drop a marker silently: the dock tells the streamer it was not sent
    if (!this.joined) return false;
    this.send({
      type: 'CREATE_MARKER',
      payload: {
        roomId: data.roomId,
        // Stamp the keypress on the server clock now, so network latency doesn't shift the marker
        clientTimestamp: this.getCalibratedNow(),
        marker: {
          roomId: data.roomId,
          sessionId: data.sessionId,
          memberId: data.memberId,
          memberName: data.memberName,
          category: data.category,
          label: data.label,
          comment: data.comment,
          color: data.color || 'Blue',
          tags: data.tags,
          obsRecordMs: data.obsRecordMs ?? undefined,
        },
      },
    });
    return true;
  }

  /** Edit a marker (author dock or host only; the server enforces it) */
  updateMarker(markerId: string, changes: MarkerChanges) {
    this.send({ type: 'UPDATE_MARKER', payload: { markerId, changes } });
  }

  deleteMarker(markerId: string) {
    this.send({ type: 'DELETE_MARKER', payload: { markerId } });
  }

  /** Host only: forget an offline member */
  removeMember(memberId: string) {
    this.send({ type: 'REMOVE_MEMBER', payload: { memberId } });
  }

  /** Remove this dock's most recent marker in the current session */
  undoLastMarker() {
    this.send({ type: 'UNDO_LAST_MARKER' });
  }

  startSession(
    roomId: string,
    sessionData: {
      name: string;
      framerateNumerator?: number;
      framerateDenominator?: number;
      dropFrame?: boolean;
      baseTimecode?: string;
    }
  ) {
    this.send({
      type: 'START_SESSION',
      payload: {
        roomId,
        session: {
          roomId,
          name: sessionData.name,
          baseTimecode: sessionData.baseTimecode || '01:00:00:00',
          framerateNumerator: sessionData.framerateNumerator || 60,
          framerateDenominator: sessionData.framerateDenominator || 1,
          dropFrame: sessionData.dropFrame ?? false,
        },
      },
    });
  }

  stopSession(roomId: string, sessionId: string) {
    this.send({
      type: 'STOP_SESSION',
      payload: { roomId, sessionId },
    });
  }

  disconnect() {
    this.stopSntpCalibration();
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      // Detach handlers first so an intentional close doesn't schedule a reconnect
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isJoined = false;
    this.hasSntpSample = false;
    this.emitConnectionChange(false);
  }
}
