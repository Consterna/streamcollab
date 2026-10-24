import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObsService } from '../src/services/obs';
import { StreamCollabSocketClient, SNTP_REBASELINE_AFTER_SPIKES } from '../src/services/socket';

class MemoryStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: { type: string; payload?: any }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.all.push(this);
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
  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('credentials are kept per server (v1.6.2)', () => {
  let storage: MemoryStorage;

  const load = async (search: string) => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { search, origin: 'https://app.example' } });
    vi.stubGlobal('localStorage', storage);
    return import('../src/services/credentials');
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    // Saved by an earlier version, when every server shared these keys
    storage.setItem('streamcollab_host_token:ROOM-1', 'legacy-host-token');
    storage.setItem('streamcollab_member_token:mem_old', 'legacy-member-token');
    storage.setItem('streamcollab_member_id', 'mem_old');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the existing keys for the page own server', async () => {
    const c = await load('');
    expect(c.getHostToken('ROOM-1')).toBe('legacy-host-token');
    expect(c.getStoredMemberId()).toBe('mem_old');
    expect(c.serverAwaitingTrust()).toBeNull();
  });

  it('never hands the saved tokens to a ?server= the user has not trusted', async () => {
    const c = await load('?server=https://evil.example');
    expect(c.getHostToken('ROOM-1')).toBeUndefined();
    expect(c.getMemberToken('mem_old')).toBeUndefined();
    expect(c.getStoredMemberId()).toBeUndefined();
    expect(c.serverAwaitingTrust()).toBe('https://evil.example');

    // Tokens issued by that server stay with it
    c.saveHostToken('ROOM-2', 'evil-room-token');
    const own = await load('');
    expect(own.getHostToken('ROOM-2')).toBeUndefined();
  });

  it('reuses the saved credentials once the user trusts that server', async () => {
    const c = await load('?server=https://collab.example');
    c.trustCurrentServer();
    expect(c.getHostToken('ROOM-1')).toBe('legacy-host-token');
    expect(c.getStoredMemberId()).toBe('mem_old');
    expect(c.serverAwaitingTrust()).toBeNull();
  });

  it('does not ask again about a server the user refused', async () => {
    const c = await load('?server=https://other.example');
    c.distrustCurrentServer();
    expect(c.serverAwaitingTrust()).toBeNull();
    expect(c.getHostToken('ROOM-1')).toBeUndefined();
  });

  it('keeps tokens saved now for the own server out of the legacy keys (never offered to another server)', async () => {
    storage = new MemoryStorage();
    const own = await load('');
    own.saveHostToken('ROOM-NEW', 'own-token-saved-today');
    expect(own.getHostToken('ROOM-NEW')).toBe('own-token-saved-today');

    const remote = await load('?server=https://other.example');
    expect(remote.serverAwaitingTrust()).toBeNull(); // nothing from before v1.6.2 to offer
    remote.trustCurrentServer();
    expect(remote.getHostToken('ROOM-NEW')).toBeUndefined();
  });

  it('clearing a token also clears its pre-v1.6.2 copy', async () => {
    const c = await load('');
    c.saveHostToken('ROOM-1', null);
    expect(c.getHostToken('ROOM-1')).toBeUndefined();
    expect(storage.getItem('streamcollab_host_token:ROOM-1')).toBeNull();
  });

  it('treats ?server= pointing at the page itself as the own server', async () => {
    const c = await load('?server=https://app.example');
    expect(c.getHostToken('ROOM-1')).toBe('legacy-host-token');
  });
});

describe('socket client recovery (v1.6.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.all = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const member = {
    id: 'mem_1',
    name: 'P',
    role: 'player' as const,
    obsStatus: 'stopped' as const,
    fps: 60,
    outputDurationMs: 0,
  };

  it('keeps backing off while the server accepts the socket but never lets it into the room', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ws = FakeWebSocket.all.at(-1)!;
      ws.open();
      const before = Date.now();
      ws.serverClose(); // e.g. join timeout or rate limit
      vi.advanceTimersToNextTimer();
      delays.push(Date.now() - before);
    }
    expect(delays).toEqual([1000, 1500, 2250, 3375]);
    client.disconnect();
  });

  it('resets the backoff once the server confirms the join', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    for (let i = 0; i < 3; i++) {
      FakeWebSocket.all.at(-1)!.open();
      FakeWebSocket.all.at(-1)!.serverClose();
      vi.advanceTimersToNextTimer();
    }
    const ws = FakeWebSocket.all.at(-1)!;
    client.joinRoom('ROOM-1', 'dock', member);
    ws.open();
    ws.receive({ type: 'JOINED', payload: { roomId: 'ROOM-1', clientKind: 'dock', isHost: false } });
    const before = Date.now();
    ws.serverClose();
    vi.advanceTimersToNextTimer();
    expect(Date.now() - before).toBe(1000);
    client.disconnect();
  });

  it('does not rejoin a room that was deleted or does not exist after reconnecting', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    let ws = FakeWebSocket.all.at(-1)!;
    client.joinRoom('GONE-ROOM', 'dock', member);
    ws.open();
    ws.receive({ type: 'ROOM_DELETED', payload: { roomId: 'GONE-ROOM' } });
    ws.serverClose();
    vi.advanceTimersToNextTimer();
    ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    expect(ws.sent.filter((m) => m.type === 'JOIN_ROOM')).toEqual([]);

    client.joinRoom('NOPE-ROOM', 'dock', member);
    ws.receive({ type: 'ERROR', payload: { code: 'ROOM_NOT_FOUND', message: 'not found' } });
    ws.serverClose();
    vi.advanceTimersToNextTimer();
    ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    expect(ws.sent.filter((m) => m.type === 'JOIN_ROOM')).toEqual([]);
    client.disconnect();
  });

  it('asks again for a room that was unknown when the user requests it (it may exist now)', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    let ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    client.joinRoom('LATE-ROOM', 'dock', member);
    ws.receive({ type: 'ERROR', payload: { code: 'ROOM_NOT_FOUND', message: 'not found' } });
    ws.serverClose(); // join timeout
    vi.advanceTimersToNextTimer();
    ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    expect(ws.sent.filter((m) => m.type === 'JOIN_ROOM')).toEqual([]);

    // The host has created it meanwhile; the user enters the same code again
    client.rejoin();
    expect(ws.sent.filter((m) => m.type === 'JOIN_ROOM').map((m) => m.payload.roomId)).toEqual(['LATE-ROOM']);
    client.disconnect();
  });

  it('forgets the room on disconnect(), so a later connect() only joins what it is told', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    client.joinRoom('OLD-ROOM', 'dock', member);
    FakeWebSocket.all.at(-1)!.open();
    client.disconnect();
    client.connect();
    const ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    expect(ws.sent.filter((m) => m.type === 'JOIN_ROOM')).toEqual([]);
  });

  it('ignores late events from a socket it already replaced', () => {
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const first = FakeWebSocket.all.at(-1)!;
    first.open();
    first.readyState = FakeWebSocket.CLOSING; // closing, but its close event hasn't fired yet
    client.connect();
    const second = FakeWebSocket.all.at(-1)!;
    second.open();
    first.serverClose(); // late close of the old socket
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('re-baselines the clock filter when the network path settles at a higher RTT', () => {
    vi.setSystemTime(10_000);
    const client = new StreamCollabSocketClient('ws://test/ws');
    client.connect();
    const ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    const pong = (t1: number, rtt: number, offset: number) => {
      vi.setSystemTime(t1 + rtt);
      ws.receive({ type: 'SNTP_PONG', payload: { t1, t2: t1 + rtt / 2 + offset, t3: t1 + rtt / 2 + offset } });
    };

    pong(20_000, 20, 40);
    expect(client.rtt).toBe(20);
    // The streamer moves from Wi-Fi to 4G: every ping now takes 150 ms and the offset moved
    for (let i = 1; i < SNTP_REBASELINE_AFTER_SPIKES; i++) pong(20_000 + i * 5000, 150, 90);
    expect(client.rtt).toBe(20); // isolated spikes are still rejected
    pong(20_000 + SNTP_REBASELINE_AFTER_SPIKES * 5000, 150, 90);
    expect(client.rtt).toBe(150);
    expect(client.offset).toBe(90);
    client.disconnect();
  });
});

describe('OBS reconnect (v1.6.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // obs-websocket-js behaviour that matters here: connect() closes the socket of a previous call,
  // which rejects that call if it was still pending and fires ConnectionClosed if it had opened
  function fakeObs() {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    let pending: { resolve: () => void; reject: (e: Error) => void } | null = null;
    let open = false;
    const fake = {
      connectCalls: 0,
      on(event: string, fn: (...args: any[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      removeAllListeners(event: string) {
        listeners.delete(event);
      },
      emit(event: string, ...args: any[]) {
        listeners.get(event)?.forEach((fn) => fn(...args));
      },
      connect() {
        fake.connectCalls++;
        if (pending) {
          pending.reject(new Error('superseded'));
          pending = null;
        }
        if (open) {
          open = false;
          fake.emit('ConnectionClosed');
        }
        return new Promise<void>((resolve, reject) => {
          pending = {
            resolve: () => {
              open = true;
              resolve();
            },
            reject,
          };
        });
      },
      succeed() {
        const p = pending;
        pending = null;
        p?.resolve();
      },
      async disconnect() {
        if (open) {
          open = false;
          fake.emit('ConnectionClosed');
        }
      },
      call: vi.fn(async () => ({ outputActive: false, outputPaused: false, outputDuration: 0 })),
    };
    return fake;
  }

  it('a second Connect while the first attempt is pending does not start a reconnect loop', async () => {
    const service = new ObsService();
    const obs = fakeObs();
    (service as unknown as { obs: unknown }).obs = obs;

    const first = service.connect();
    const second = service.connect();
    await Promise.resolve();
    obs.succeed();
    await expect(second).resolves.toBe(true);
    await first;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(obs.connectCalls).toBe(2);
    expect(service.connected).toBe(true);
    expect(service.retrying).toBe(false);
    await service.disconnect();
  });

  it('an attempt that finishes after disconnect() leaves nothing connected', async () => {
    const service = new ObsService();
    const obs = fakeObs();
    (service as unknown as { obs: unknown }).obs = obs;

    const attempt = service.connect();
    await service.disconnect();
    obs.succeed();
    await attempt;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.connected).toBe(false);
    expect(obs.connectCalls).toBe(1);
  });
});
