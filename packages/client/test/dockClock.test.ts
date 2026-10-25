import { describe, it, expect } from 'vitest';
import { dockClockMs } from '../src/views/dockClock';

describe("Dock's SMPTE clock", () => {
  it('follows the session timeline while a session runs, even if OBS started recording earlier', () => {
    // OBS has been recording for 6 min 25 s; the session started 25 s ago
    expect(
      dockClockMs({ now: 100_000, session: { startedAt: 75_000 }, recording: true, recordingElapsedMs: 385_000 })
    ).toBe(25_000);
  });

  it('shows the recording position when no session runs', () => {
    expect(dockClockMs({ now: 100_000, session: null, recording: true, recordingElapsedMs: 385_000 })).toBe(385_000);
  });

  it('is 0 with neither a session nor a recording', () => {
    expect(dockClockMs({ now: 100_000, session: null, recording: false, recordingElapsedMs: 0 })).toBe(0);
  });
});
