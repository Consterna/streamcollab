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
  lastHeartbeat: number;
  activeSessionId?: string;
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
  sessionOffsetMs: number;
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
  | { type: 'JOIN_ROOM'; payload: { roomId: string; member: Omit<SquadMember, 'lastHeartbeat' | 'clockOffsetMs' | 'rttMs'> } }
  | { type: 'LEAVE_ROOM'; payload: { roomId: string; memberId: string } }
  | { type: 'UPDATE_STATUS'; payload: { roomId: string; memberId: string; status: Partial<SquadMember> } }
  | { type: 'CREATE_MARKER'; payload: { roomId: string; marker: Omit<SquadMarker, 'id' | 'timestamp' | 'relativeTimeMs' | 'timecode' | 'frameNumber'> } }
  | { type: 'START_SESSION'; payload: { roomId: string; session: Omit<RecordingSession, 'id' | 'startedAt' | 'stoppedAt'> } }
  | { type: 'STOP_SESSION'; payload: { roomId: string; sessionId: string } };

export type ServerMessage =
  | { type: 'SNTP_PONG'; payload: SntpPongPayload }
  | { type: 'ROOM_STATE'; payload: { room: Room; activeSession: RecordingSession | null; markers: SquadMarker[] } }
  | { type: 'MEMBER_JOINED'; payload: SquadMember }
  | { type: 'MEMBER_LEFT'; payload: { memberId: string } }
  | { type: 'MEMBER_UPDATED'; payload: SquadMember }
  | { type: 'MARKER_ADDED'; payload: SquadMarker }
  | { type: 'SESSION_STARTED'; payload: RecordingSession }
  | { type: 'SESSION_STOPPED'; payload: RecordingSession }
  | { type: 'ERROR'; payload: { message: string } };
