import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamCollabSocketClient } from '../src/services/socket';

// Minimal browser WebSocket stand-in: records what the client sends and lets the test play the server
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: { type: string; payload?: unknown }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  types() {
    return this.sent.map((m) => m.type).filter((type) => type !== 'SNTP_PING');
  }
}

const member = {
  id: 'mem-test',
  name: 'Tester',
  role: 'player' as const,
  obsStatus: 'stopped' as const,
  fps: 60,
  outputDurationMs: 0,
};

const markerData = {
  roomId: 'ROOM-TEST',
  sessionId: '',
  memberId: member.id,
  memberName: member.name,
  category: 'kill' as const,
  label: 'Kill',
};

describe('StreamCollabSocketClient room membership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const joinedClient = () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    client.joinRoom('ROOM-TEST', 'dock', member);
    return { client, ws };
  };

  it('sends no status or markers until the server confirms the join', () => {
    const { client, ws } = joinedClient();
    expect(ws.types()).toEqual(['JOIN_ROOM']);

    client.updateStatus('ROOM-TEST', member.id, { obsStatus: 'recording' });
    expect(client.createMarker(markerData)).toBe(false);
    expect(ws.types()).toEqual(['JOIN_ROOM']);

    ws.receive({ type: 'JOINED', payload: { roomId: 'ROOM-TEST', clientKind: 'dock', isHost: false } });
    expect(client.joined).toBe(true);
    client.updateStatus('ROOM-TEST', member.id, { obsStatus: 'recording' });
    expect(client.createMarker(markerData)).toBe(true);
    expect(ws.types()).toEqual(['JOIN_ROOM', 'UPDATE_STATUS', 'CREATE_MARKER']);
  });

  it('stops sending when the room does not exist, is deleted or the connection drops', () => {
    const missing = joinedClient();
    missing.ws.receive({ type: 'ERROR', payload: { code: 'ROOM_NOT_FOUND', message: 'Room not found' } });
    expect(missing.client.createMarker(markerData)).toBe(false);

    const deleted = joinedClient();
    deleted.ws.receive({ type: 'JOINED', payload: { roomId: 'ROOM-TEST', clientKind: 'dock', isHost: false } });
    deleted.ws.receive({ type: 'ROOM_DELETED', payload: { roomId: 'ROOM-TEST' } });
    deleted.client.updateStatus('ROOM-TEST', member.id, { obsStatus: 'recording' });
    expect(deleted.ws.types()).toEqual(['JOIN_ROOM']);

    const dropped = joinedClient();
    const changes: boolean[] = [];
    dropped.client.on('onConnectionChange', (connected) => changes.push(connected));
    dropped.ws.receive({ type: 'JOINED', payload: { roomId: 'ROOM-TEST', clientKind: 'dock', isHost: false } });
    dropped.ws.drop();
    expect(changes).toEqual([false]);
    expect(dropped.client.joined).toBe(false);
    expect(dropped.client.createMarker(markerData)).toBe(false);
  });

  it('keeps the join after errors that do not concern it', () => {
    const { client, ws } = joinedClient();
    ws.receive({ type: 'JOINED', payload: { roomId: 'ROOM-TEST', clientKind: 'dock', isHost: false } });
    ws.receive({ type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Only the host can do that' } });
    expect(client.createMarker(markerData)).toBe(true);
  });
});
