import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamCollabSocketClient } from '../src/services/socket';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: { type: string; payload?: any }[] = [];
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

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  errorAndClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.();
    this.onclose?.();
  }
}

describe('SNTP Calibration Burst & WebSocket Resilience (Client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('triggers a 4-ping initial calibration burst on connect before transitioning to 5s interval', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();

    // 1st ping is sent immediately on open
    const pingCount = () => ws.sent.filter((m) => m.type === 'SNTP_PING').length;
    expect(pingCount()).toBe(1);

    // Burst ping 2 at +150ms
    vi.advanceTimersByTime(150);
    expect(pingCount()).toBe(2);

    // Burst ping 3 at +300ms
    vi.advanceTimersByTime(150);
    expect(pingCount()).toBe(3);

    // Burst ping 4 at +450ms
    vi.advanceTimersByTime(150);
    expect(pingCount()).toBe(4);

    // No extra burst pings between 450ms and 5000ms
    vi.advanceTimersByTime(1000);
    expect(pingCount()).toBe(4);

    // Periodic steady-state ping arrives at 5000ms
    vi.advanceTimersByTime(4000);
    expect(pingCount()).toBe(5);

    client.disconnect();
  });

  it('rejects jitter spike outliers to protect timeline accuracy', () => {
    vi.setSystemTime(10000);
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();

    const syncEvents: { offset: number; rtt: number }[] = [];
    client.on('onClockSync', (offset, rtt) => syncEvents.push({ offset, rtt }));

    // 1. Initial baseline healthy ping/pong (10ms RTT, offset +40ms)
    // t1=10000, t2=10045, t3=10045, t4=10010
    vi.setSystemTime(10010);
    ws.receive({
      type: 'SNTP_PONG',
      payload: { t1: 10000, t2: 10045, t3: 10045 },
    });

    expect(syncEvents.length).toBe(1);
    expect(client.rtt).toBe(10);
    expect(client.offset).toBe(40);
    const baselineOffset = client.offset;

    // 2. Simulate severe network jitter / bufferbloat spike: RTT = 600ms (> max(100, 10 * 2.5))
    // t1=20000, t2=20300, t3=20300, t4=20600
    vi.setSystemTime(20600);
    ws.receive({
      type: 'SNTP_PONG',
      payload: { t1: 20000, t2: 20800, t3: 20800 },
    });

    // Outlier must be rejected: no new onClockSync emitted and offset remains unchanged
    expect(syncEvents.length).toBe(1);
    expect(client.offset).toBe(baselineOffset);

    // 3. Healthy sample arrives (12ms RTT, offset +42ms)
    // t1=30000, t2=30048, t3=30048, t4=30012 => RTT=12, offset=42
    vi.setSystemTime(30012);
    ws.receive({
      type: 'SNTP_PONG',
      payload: { t1: 30000, t2: 30048, t3: 30048 },
    });

    // Accepted and smoothed
    expect(syncEvents.length).toBe(2);
    expect(client.offset).not.toBe(baselineOffset);

    client.disconnect();
  });

  it('prevents duplicate onConnectionChange(false) events when onerror and onclose fire sequentially', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    const connectionEvents: boolean[] = [];
    client.on('onConnectionChange', (connected) => connectionEvents.push(connected));

    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();

    expect(connectionEvents).toEqual([true]);

    // Standard browser failure: onerror fires followed immediately by onclose
    ws.errorAndClose();

    // Must receive false exactly once, not twice
    expect(connectionEvents).toEqual([true, false]);

    // Calling disconnect() when already disconnected should not emit another false
    client.disconnect();
    expect(connectionEvents).toEqual([true, false]);
  });

  it('applies exponential backoff to reconnect delays', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    let ws = FakeWebSocket.last!;
    ws.open();

    // 1st disconnect -> reconnect scheduled with base delay ~1000ms
    ws.errorAndClose();
    expect(client.connected).toBe(false);

    // Advance 900ms -> should not have connected yet
    vi.advanceTimersByTime(900);
    expect(FakeWebSocket.last).toBe(ws);

    // Advance 200ms -> triggers 1st reconnect
    vi.advanceTimersByTime(200);
    expect(FakeWebSocket.last).not.toBe(ws);
    ws = FakeWebSocket.last!;

    // 2nd disconnect without successful open -> delay increases (1000 * 1.5 = 1500ms)
    ws.errorAndClose();
    vi.advanceTimersByTime(1200);
    expect(FakeWebSocket.last).toBe(ws); // Not yet

    vi.advanceTimersByTime(400); // Now 1600ms elapsed
    expect(FakeWebSocket.last).not.toBe(ws); // Reconnected
    ws = FakeWebSocket.last!;

    // 3rd disconnect -> delay increases further (1000 * 1.5^2 = 2250ms)
    ws.errorAndClose();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.last).toBe(ws); // Not yet

    vi.advanceTimersByTime(400); // 2400ms elapsed
    expect(FakeWebSocket.last).not.toBe(ws);

    client.disconnect();
  });

  it('rejects jitter spike outliers even when initial baseline RTT is 0 (loopback/localhost)', () => {
    vi.setSystemTime(10000);
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();

    const syncEvents: { offset: number; rtt: number }[] = [];
    client.on('onClockSync', (offset, rtt) => syncEvents.push({ offset, rtt }));

    // 1. Initial localhost ping/pong: 0ms RTT, 0ms offset
    // t1=10000, t2=10000, t3=10000, t4=10000
    ws.receive({
      type: 'SNTP_PONG',
      payload: { t1: 10000, t2: 10000, t3: 10000 },
    });

    expect(syncEvents.length).toBe(1);
    expect(client.rtt).toBe(0);
    expect(client.offset).toBe(0);

    // 2. Severe spike arrives with RTT = 500ms (> max(100, 0 * 2.5) = 100)
    // t1=20000, t2=20250, t3=20250, t4=20500
    vi.setSystemTime(20500);
    ws.receive({
      type: 'SNTP_PONG',
      payload: { t1: 20000, t2: 20250, t3: 20250 },
    });

    // Outlier must be rejected despite baseline RTT being 0
    expect(syncEvents.length).toBe(1);
    expect(client.rtt).toBe(0);
    expect(client.offset).toBe(0);

    client.disconnect();
  });

  it('cancels pending reconnect timer when connect() is invoked explicitly', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws1 = FakeWebSocket.last!;
    ws1.open();

    // Disconnect schedules reconnect in ~1000ms
    ws1.errorAndClose();
    expect(client.connected).toBe(false);

    // Explicit manual connect before timer expires
    vi.advanceTimersByTime(200);
    client.connect();
    const ws2 = FakeWebSocket.last!;
    expect(ws2).not.toBe(ws1);

    // Advance beyond the original 1000ms timer
    vi.advanceTimersByTime(1000);
    // Should NOT have triggered a redundant connect
    expect(FakeWebSocket.last).toBe(ws2);

    client.disconnect();
  });
});
