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
