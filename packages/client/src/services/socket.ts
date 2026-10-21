import {
  ClientMessage,
  ServerMessage,
  SquadMember,
  SquadMarker,
  RecordingSession,
  Room,
  MarkerCategory,
  ClientKind,
} from '@streamcollab/shared';

export interface SocketClientCallbacks {
  onRoomState?: (state: { room: Room; activeSession: RecordingSession | null; markers: SquadMarker[] }) => void;
  onMemberJoined?: (member: SquadMember) => void;
  onMemberLeft?: (memberId: string) => void;
  onMemberUpdated?: (member: SquadMember) => void;
  onMarkerAdded?: (marker: SquadMarker) => void;
  onSessionStarted?: (session: RecordingSession) => void;
  onSessionStopped?: (session: RecordingSession) => void;
  onClockSync?: (offsetMs: number, rttMs: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class StreamCollabSocketClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private sntpInterval: any = null;
  private isConnected = false;
  private reconnectTimeout: any = null;

  // SNTP Calibration state
  private clockOffsetMs = 0;
  private rttMs = 0;

  // Current session/room context
  private currentRoomId = '';
  private currentKind: ClientKind = 'dock';
  private currentMember: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'> | undefined;

  // Single-slot callbacks (owned by App) plus any number of extra listeners (views)
  callbacks: SocketClientCallbacks = {};
  private listeners: { [K in keyof SocketClientCallbacks]?: Set<NonNullable<SocketClientCallbacks[K]>> } = {};

  /**
   * Subscribe to a socket event without replacing the App-level callback.
   * Returns an unsubscribe function for use in effect cleanups.
   */
  on<K extends keyof SocketClientCallbacks>(event: K, handler: NonNullable<SocketClientCallbacks[K]>): () => void {
    let set = this.listeners[event] as Set<NonNullable<SocketClientCallbacks[K]>> | undefined;
    if (!set) {
      set = new Set();
      (this.listeners as any)[event] = set;
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  private emit<K extends keyof SocketClientCallbacks>(
    event: K,
    ...args: Parameters<NonNullable<SocketClientCallbacks[K]>>
  ) {
    (this.callbacks[event] as ((...a: any[]) => void) | undefined)?.(...args);
    this.listeners[event]?.forEach((handler) => (handler as (...a: any[]) => void)(...args));
  }

  constructor(serverUrl?: string) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
    } else {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      // Connect through Vite proxy (/ws) on dev server or direct host in production
      this.serverUrl = `${proto}//${loc.host}/ws`;
    }
  }

  get connected(): boolean {
    return this.isConnected;
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
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('onConnectionChange', true);
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
    this.emit('onConnectionChange', false);
    this.stopSntpCalibration();

    if (!this.reconnectTimeout) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.connect();
      }, 2000);
    }
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'SNTP_PONG': {
        const t4 = Date.now();
        const { t1, t2, t3 } = msg.payload;
        const currentRtt = Math.max(0, (t4 - t1) - (t3 - t2));
        const currentOffset = ((t2 - t1) + (t3 - t4)) / 2;

        // Exponential moving average filter
        if (this.clockOffsetMs === 0) {
          this.clockOffsetMs = currentOffset;
          this.rttMs = currentRtt;
        } else {
          this.clockOffsetMs = this.clockOffsetMs * 0.7 + currentOffset * 0.3;
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

      case 'MEMBER_UPDATED':
        this.emit('onMemberUpdated', msg.payload);
        break;

      case 'MARKER_ADDED':
        this.emit('onMarkerAdded', msg.payload);
        break;

      case 'SESSION_STARTED':
        this.emit('onSessionStarted', msg.payload);
        break;

      case 'SESSION_STOPPED':
        this.emit('onSessionStopped', msg.payload);
        break;

      default:
        break;
    }
  }

  private startSntpCalibration() {
    this.stopSntpCalibration();
    // Immediate ping
    this.sendPing();
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
    this.send({
      type: 'JOIN_ROOM',
      payload: { roomId, clientKind, member: this.currentMember },
    });
  }

  updateStatus(roomId: string, memberId: string, status: Partial<SquadMember>) {
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
    color?: any;
    tags?: string[];
    obsRecordMs?: number | null;
  }) {
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
  }

  startSession(roomId: string, sessionData: { name: string; framerateNumerator?: number; framerateDenominator?: number; dropFrame?: boolean; baseTimecode?: string }) {
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
  }
}
