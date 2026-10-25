export type MarkerCategory = 'kill' | 'wipe' | 'clutch' | 'funny' | 'note' | 'custom';

export type DaVinciMarkerColor =
  | 'Blue'
  | 'Cyan'
  | 'Green'
  | 'Yellow'
  | 'Red'
  | 'Pink'
  | 'Purple'
  | 'Fuchsia'
  | 'Rose'
  | 'Lavender'
  | 'Sky'
  | 'Mint'
  | 'Lemon'
  | 'Sand'
  | 'Cocoa'
  | 'White';

export type ObsRecordingStatus = 'recording' | 'streaming' | 'paused' | 'stopped' | 'disconnected';

export interface SquadMember {
  id: string;
  name: string;
  avatarUrl?: string;
  role: 'host' | 'player' | 'observer';
  obsStatus: ObsRecordingStatus;
  streamUrl?: string;
  fps: number;
  outputDurationMs: number;
  clockOffsetMs: number;
  rttMs: number;
  lastHeartbeat: number; // Last join / status update (shown as "last seen" while offline)
  online?: boolean; // A dock for this member is connected right now (computed by the server)
  activeSessionId?: string;
  fpsNumerator?: number; // Exact OBS canvas framerate (e.g. 60000)
  fpsDenominator?: number; // Exact OBS canvas framerate (e.g. 1001)
  recordStartedAt?: number | null; // Server-calibrated epoch ms when this member's OBS recording file began
}

// Which view a WebSocket connection belongs to. Only docks represent squad members;
// HUD overlays and director dashboards are read-only observers.
export type ClientKind = 'dock' | 'hud' | 'dashboard';

// Snapshot of where a member's recording file starts relative to a session
export interface SessionMemberAnchor {
  sessionId: string;
  memberId: string;
  recordStartedAt: number; // Server-calibrated epoch ms
  framerateNumerator: number;
  framerateDenominator: number;
}

export interface SquadMarker {
  id: string;
  roomId: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  timestamp: number; // UTC Epoch timestamp in milliseconds
  relativeTimeMs: number; // Milliseconds relative to session start
  timecode: string; // SMPTE timecode string e.g. "01:23:45:12"
  frameNumber: number; // Absolute frame count from session start
  category: MarkerCategory;
  label: string;
  comment?: string;
  color: DaVinciMarkerColor;
  tags?: string[];
  obsRecordMs?: number; // Position inside the marking member's own OBS recording file
}

export interface RecordingSession {
  id: string;
  roomId: string;
  name: string;
  startedAt: number; // UTC Epoch ms
  stoppedAt: number | null; // UTC Epoch ms or null if still recording
  baseTimecode: string; // e.g. "01:00:00:00" or "00:00:00:00"
  framerateNumerator: number; // e.g. 60 or 60000
  framerateDenominator: number; // e.g. 1 or 1001
  dropFrame: boolean;
}

export interface Room {
  id: string;
  name: string;
  createdAt: number;
  activeSessionId: string | null;
  members: SquadMember[];
}

export interface SyncMatrixMember {
  memberId: string;
  name: string;
  obsStatus: ObsRecordingStatus;
  aligned: boolean; // false when the member never reported a recording start for this session
  recordStartedAt: number | null;
  clockOffsetMs: number;
  sessionOffsetMs: number; // recordStartedAt - session.startedAt (positive = file started after session)
  sessionOffsetFrames: number;
  startTimecode: string;
  durationMs: number;
  fps: number;
}

export interface SyncMatrix {
  roomId: string;
  sessionId: string;
  sessionName: string;
  referenceTimestamp: number;
  framerate: string;
  members: SyncMatrixMember[];
  markers: SquadMarker[];
}

// WebSocket message protocols
export interface SntpPingPayload {
  t1: number; // Client transmit timestamp
}

export interface SntpPongPayload {
  t1: number; // Client transmit timestamp
  t2: number; // Server receive timestamp
  t3: number; // Server transmit timestamp
}

export type ClientMessage =
  | { type: 'SNTP_PING'; payload: SntpPingPayload }
  | {
      type: 'JOIN_ROOM';
      payload: {
        roomId: string;
        clientKind?: ClientKind; // Defaults to 'dock' for backwards compatibility
        member?: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'>; // Required for docks
        memberToken?: string; // Proves ownership of an existing member id (issued in JOINED)
        hostToken?: string; // Grants session control (issued when the room is created)
      };
    }
  | { type: 'LEAVE_ROOM'; payload: { roomId: string; memberId: string } }
  | { type: 'UPDATE_STATUS'; payload: { roomId: string; memberId: string; status: Partial<SquadMember> } }
  | {
      type: 'CREATE_MARKER';
      payload: {
        roomId: string;
        // No color: the server gives the category's NLE color
        marker: Omit<SquadMarker, 'id' | 'timestamp' | 'relativeTimeMs' | 'timecode' | 'frameNumber' | 'color'> & {
          color?: DaVinciMarkerColor;
        };
        clientTimestamp?: number; // Server-calibrated epoch ms at the moment the key was pressed
      };
    }
  | {
      type: 'START_SESSION';
      payload: { roomId: string; session: Omit<RecordingSession, 'id' | 'startedAt' | 'stoppedAt'> };
    }
  | { type: 'STOP_SESSION'; payload: { roomId: string; sessionId: string } }
  // Edit / delete: the marker's author (from their dock) or the room host
  | { type: 'UPDATE_MARKER'; payload: { markerId: string; changes: MarkerChanges } }
  | { type: 'DELETE_MARKER'; payload: { markerId: string } }
  // Removes this dock's most recent marker in the active session (resolved server-side)
  | { type: 'UNDO_LAST_MARKER'; payload?: Record<string, never> }
  // Host only: forget a member that is offline (clean up old / test identities)
  | { type: 'REMOVE_MEMBER'; payload: { memberId: string } };

/** Editable marker fields. `comment: null` clears the comment. */
export interface MarkerChanges {
  label?: string;
  comment?: string | null;
  category?: MarkerCategory;
  color?: DaVinciMarkerColor;
}

/** A recording session with its marker count, for the session history */
export interface SessionSummary extends RecordingSession {
  markerCount: number;
}

export type ServerMessage =
  | { type: 'SNTP_PONG'; payload: SntpPongPayload }
  | {
      type: 'ROOM_STATE';
      payload: {
        room: Room;
        activeSession: RecordingSession | null;
        // The running session, or else the most recent one; `markers` belong to it (absent before v1.6.1)
        latestSession?: RecordingSession | null;
        markers: SquadMarker[];
      };
    }
  | { type: 'MEMBER_JOINED'; payload: SquadMember }
  | { type: 'MEMBER_LEFT'; payload: { memberId: string } }
  | { type: 'MEMBER_REMOVED'; payload: { memberId: string } }
  | { type: 'MEMBER_UPDATED'; payload: SquadMember }
  | { type: 'MARKER_ADDED'; payload: SquadMarker }
  | { type: 'MARKER_UPDATED'; payload: SquadMarker }
  | { type: 'MARKER_DELETED'; payload: { markerId: string; sessionId: string } }
  | { type: 'SESSION_STARTED'; payload: RecordingSession }
  | { type: 'SESSION_STOPPED'; payload: RecordingSession }
  | { type: 'SESSION_DELETED'; payload: { sessionId: string } }
  | { type: 'ROOM_DELETED'; payload: { roomId: string } }
  | {
      type: 'JOINED';
      payload: {
        roomId: string;
        clientKind: ClientKind;
        isHost: boolean;
        memberToken?: string; // Only sent to a dock the first time its member id is claimed
      };
    }
  | { type: 'ERROR'; payload: { message: string; code?: ErrorCode } };

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'ROOM_NOT_FOUND'
  | 'NOT_JOINED'
  | 'FORBIDDEN'
  | 'HOST_TOKEN_INVALID'
  | 'MEMBER_TOKEN_INVALID'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT';

// Response of POST /api/rooms. The host token is shown once and only its hash is stored.
export interface CreateRoomResponse extends Room {
  hostToken: string;
}
