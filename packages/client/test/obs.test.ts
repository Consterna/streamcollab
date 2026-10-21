import { describe, it, expect, vi } from 'vitest';
import { ObsService, ObsChapterSupport } from '../src/services/obs';

// Replace the obs-websocket client with a stub so the chapter logic runs without OBS
function serviceWith(call: (request: string, data?: unknown) => Promise<unknown>) {
  const service = new ObsService();
  const internals = service as unknown as {
    obs: { call: typeof call };
    isConnected: boolean;
    lastRecordStatus: { outputActive: boolean; outputPaused: boolean; outputDuration: number } | null;
    detectChapterSupport: () => Promise<void>;
  };
  internals.obs = { call: vi.fn(call) };
  internals.isConnected = true;
  return { service, internals };
}

const recording = { outputActive: true, outputPaused: false, outputDuration: 1000 };

describe('ObsService native recording chapters', () => {
  it('detects support from GetVersion.availableRequests', async () => {
    const { service, internals } = serviceWith(async () => ({
      obsVersion: '31.1.0',
      availableRequests: ['GetVersion', 'CreateRecordChapter'],
    }));
    const events: ObsChapterSupport[] = [];
    service.on('chapters', (support) => events.push(support));

    await internals.detectChapterSupport();
    expect(service.chapters).toEqual({ state: 'available', obsVersion: '31.1.0' });
    expect(events).toHaveLength(1);
  });

  it('reports older OBS versions as unsupported and never calls the request', async () => {
    const { service, internals } = serviceWith(async (request) =>
      request === 'GetVersion' ? { obsVersion: '29.1.3', availableRequests: ['GetVersion'] } : undefined
    );
    await internals.detectChapterSupport();
    internals.lastRecordStatus = recording;

    expect(service.chapters.state).toBe('unsupported');
    expect(await service.createChapter('KILL: Ace')).toBe('unsupported');
    expect(internals.obs.call).toHaveBeenCalledTimes(1); // only GetVersion
  });

  it('only writes chapters while recording, and passes the chapter name', async () => {
    const { service, internals } = serviceWith(async (request) =>
      request === 'GetVersion' ? { obsVersion: '31.1.0', availableRequests: ['CreateRecordChapter'] } : {}
    );
    await internals.detectChapterSupport();

    expect(await service.createChapter('KILL: Ace')).toBe('not-recording');

    internals.lastRecordStatus = recording;
    expect(await service.createChapter('KILL: Ace')).toBe('created');
    expect(internals.obs.call).toHaveBeenLastCalledWith('CreateRecordChapter', { chapterName: 'KILL: Ace' });
  });

  it('surfaces a rejected chapter (e.g. not Hybrid MP4) and clears it after a success', async () => {
    let reject = true;
    const { service, internals } = serviceWith(async (request) => {
      if (request === 'GetVersion') return { obsVersion: '31.1.0', availableRequests: ['CreateRecordChapter'] };
      if (reject) throw new Error('The current recording format does not support chapters');
      return {};
    });
    await internals.detectChapterSupport();
    internals.lastRecordStatus = recording;

    expect(await service.createChapter('NOTE: test')).toBe('failed');
    expect(service.chapters.lastError).toMatch(/does not support chapters/);

    reject = false;
    expect(await service.createChapter('NOTE: test')).toBe('created');
    expect(service.chapters.lastError).toBeUndefined();
  });

  it('truncates very long chapter names', async () => {
    const { service, internals } = serviceWith(async (request) =>
      request === 'GetVersion' ? { obsVersion: '31.1.0', availableRequests: ['CreateRecordChapter'] } : {}
    );
    await internals.detectChapterSupport();
    internals.lastRecordStatus = recording;

    await service.createChapter('x'.repeat(500));
    const [, data] = (internals.obs.call as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect((data as { chapterName: string }).chapterName).toHaveLength(120);
  });
});

describe('ObsService automatic reconnection', () => {
  // A fake obs-websocket client whose connect() fails `failures` times before succeeding
  function flakyObs(failures: number) {
    const handlers: Record<string, () => void> = {};
    let remaining = failures;
    const fake = {
      connect: vi.fn(async () => {
        if (remaining > 0) {
          remaining--;
          throw new Error('connect ECONNREFUSED 127.0.0.1:4455');
        }
        return {};
      }),
      disconnect: vi.fn(async () => undefined),
      call: vi.fn(async () => ({ obsVersion: '31.1.0', availableRequests: [] })),
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
      removeAllListeners: vi.fn(),
    };
    const service = new ObsService();
    (service as unknown as { obs: typeof fake }).obs = fake;
    return { service, fake, handlers };
  }

  it('keeps retrying with exponential backoff until OBS is up', async () => {
    vi.useFakeTimers();
    try {
      const { service, fake } = flakyObs(2);
      const retries: Array<number | null> = [];
      service.on('retry', (delay) => retries.push(delay));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(await service.connect('ws://127.0.0.1:4455', 'secret')).toBe(false);
      expect(service.retrying).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fake.connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4_000);

      expect(fake.connect).toHaveBeenCalledTimes(3);
      expect(fake.connect).toHaveBeenLastCalledWith('ws://127.0.0.1:4455', 'secret', expect.anything());
      expect(service.connected).toBe(true);
      expect(service.retrying).toBe(false);
      expect(retries.filter((d) => d !== null)).toEqual([2_000, 4_000]);
      await service.disconnect();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('reconnects after OBS closes, but not after a manual disconnect', async () => {
    vi.useFakeTimers();
    try {
      const { service, fake, handlers } = flakyObs(0);
      expect(await service.connect('ws://127.0.0.1:4455')).toBe(true);

      handlers.ConnectionClosed(); // OBS quit or crashed
      expect(service.connected).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fake.connect).toHaveBeenCalledTimes(2);
      expect(service.connected).toBe(true);

      await service.disconnect();
      handlers.ConnectionClosed();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.connect).toHaveBeenCalledTimes(2);
      expect(service.retrying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
