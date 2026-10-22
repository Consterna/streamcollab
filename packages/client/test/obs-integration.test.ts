import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObsService, ObsRecordStatus, ObsHotkeySignal } from '../src/services/obs';
import { MockObsServer } from './mockObsServer';

describe('OBS WebSocket v5 Protocol Integration', () => {
  let mockObs: MockObsServer;
  let obsUrl: string;
  let service: ObsService;

  beforeAll(async () => {
    mockObs = new MockObsServer();
    obsUrl = await mockObs.start();
    service = new ObsService();
    const connected = await service.connect(obsUrl);
    expect(connected).toBe(true);
  });

  afterAll(async () => {
    await service.disconnect();
    await mockObs.stop();
  });

  it('manages the full recording lifecycle (start -> pause -> resume -> stop) and extrapolates position', async () => {
    const recordEvents: ObsRecordStatus[] = [];
    service.on('record', (status) => recordEvents.push(status));

    // Initially stopped
    expect(service.getEstimatedRecordMs()).toBeNull();

    // 1. Start Recording
    mockObs.setRecordingState(true, false, 1500);

    // Wait for event to propagate and service to query status
    await new Promise((r) => setTimeout(r, 60));
    expect(recordEvents.length).toBeGreaterThanOrEqual(1);
    const lastEvent = recordEvents[recordEvents.length - 1];
    expect(lastEvent.outputActive).toBe(true);
    expect(lastEvent.outputPaused).toBe(false);

    const estimatedActive = service.getEstimatedRecordMs();
    expect(estimatedActive).not.toBeNull();
    expect(estimatedActive!).toBeGreaterThanOrEqual(1500);

    // 2. Pause Recording
    mockObs.setRecordingState(true, true, 4200);
    await new Promise((r) => setTimeout(r, 60));

    const pausedEvent = recordEvents[recordEvents.length - 1];
    expect(pausedEvent.outputPaused).toBe(true);
    // While paused, estimated duration must not advance with real-time clock
    expect(service.getEstimatedRecordMs()).toBe(4200);

    // 3. Resume Recording
    mockObs.setRecordingState(true, false, 4300);
    await new Promise((r) => setTimeout(r, 60));

    const resumedEvent = recordEvents[recordEvents.length - 1];
    expect(resumedEvent.outputActive).toBe(true);
    expect(resumedEvent.outputPaused).toBe(false);
    expect(service.getEstimatedRecordMs()).toBeGreaterThanOrEqual(4300);

    // 4. Stop Recording
    mockObs.setRecordingState(false, false, 0);
    await new Promise((r) => setTimeout(r, 60));

    const stoppedEvent = recordEvents[recordEvents.length - 1];
    expect(stoppedEvent.outputActive).toBe(false);
    expect(service.getEstimatedRecordMs()).toBeNull();
  });

  it('queries video settings dynamically when framerate changes in OBS', async () => {
    // Initial 60 fps
    const settings60 = await service.getVideoSettings();
    expect(settings60).not.toBeNull();
    expect(settings60?.fps).toBe(60);
    expect(settings60?.fpsNumerator).toBe(60);
    expect(settings60?.fpsDenominator).toBe(1);

    // Dynamically change OBS video canvas to NTSC 59.94 fps
    mockObs.setVideoSettings(60000, 1001);
    const settings59 = await service.getVideoSettings();
    expect(settings59).not.toBeNull();
    expect(settings59?.fpsNumerator).toBe(60000);
    expect(settings59?.fpsDenominator).toBe(1001);
    expect(settings59?.fps).toBe(59.94);

    // Change to 29.97 fps
    mockObs.setVideoSettings(30000, 1001);
    const settings29 = await service.getVideoSettings();
    expect(settings29?.fpsNumerator).toBe(30000);
    expect(settings29?.fpsDenominator).toBe(1001);
    expect(settings29?.fps).toBe(29.97);
  });

  it('bridges Lua hotkey signals and deduplicates sequence numbers', async () => {
    const hotkeySignals: ObsHotkeySignal[] = [];
    service.on('hotkey', (signal) => hotkeySignals.push(signal));

    // 1. Press global hotkey 1: "kill"
    mockObs.triggerHotkeySignal('kill', 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(hotkeySignals.length).toBe(1);
    expect(hotkeySignals[0]).toEqual({ category: 'kill', seq: 1 });

    // 2. Duplicate signal with same sequence number (e.g. repeated OBS input refresh) must be ignored
    mockObs.triggerHotkeySignal('kill', 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(hotkeySignals.length).toBe(1);

    // 3. Different input name must be ignored
    mockObs.emitEvent('InputSettingsChanged', 8, {
      inputName: 'Mic/Aux',
      inputSettings: { sc_category: 'clutch', sc_seq: 2 },
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(hotkeySignals.length).toBe(1);

    // 4. Next hotkey press with new sequence number
    mockObs.triggerHotkeySignal('clutch', 2);
    await new Promise((r) => setTimeout(r, 40));
    expect(hotkeySignals.length).toBe(2);
    expect(hotkeySignals[1]).toEqual({ category: 'clutch', seq: 2 });
  });

  it('handles native chapters with format error fallback without throwing', async () => {
    // 1. While stopped -> returns not-recording
    expect(await service.createChapter('Chapter 1')).toBe('not-recording');

    // 2. Start recording
    mockObs.setRecordingState(true, false, 2000);
    await new Promise((r) => setTimeout(r, 60));

    // Supported & recording -> created
    const successRes = await service.createChapter('Kill: Boss Fight');
    expect(successRes).toBe('created');
    expect(service.chapters.lastError).toBeUndefined();

    // 3. Simulate OBS rejecting chapters (e.g. user selected MKV or standard MP4 instead of Hybrid MP4)
    mockObs.state.rejectChapters = true;
    const failRes = await service.createChapter('Note: Marker');
    expect(failRes).toBe('failed');
    expect(service.chapters.lastError).toContain('does not support chapters');

    // 4. Recover when user switches back to Hybrid MP4
    mockObs.state.rejectChapters = false;
    const recoveredRes = await service.createChapter('Wipe: Recovery');
    expect(recoveredRes).toBe('created');
    expect(service.chapters.lastError).toBeUndefined();
  });
});
