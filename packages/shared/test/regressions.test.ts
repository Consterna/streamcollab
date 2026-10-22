import { describe, it, expect } from 'vitest';
import {
  SMPTETimecode,
  exportToEdl,
  exportToCsv,
  exportToYouTubeChapters,
  countYouTubeChapters,
  resolveMemberFramerate,
  sessionSettingsSchema,
  memberStatusSchema,
  RecordingSession,
  SquadMarker,
} from '../src/index.js';

const session: RecordingSession = {
  id: 'sess-161',
  roomId: 'room-161',
  name: 'Sesión de transmisión',
  startedAt: 1700000000000,
  stoppedAt: null,
  baseTimecode: '01:00:00:00',
  framerateNumerator: 60,
  framerateDenominator: 1,
  dropFrame: false,
};

const marker = (relativeTimeMs: number, label: string, extra: Partial<SquadMarker> = {}): SquadMarker => ({
  id: `m-${relativeTimeMs}`,
  roomId: session.roomId,
  sessionId: session.id,
  memberId: 'mem-a',
  memberName: 'Ana',
  timestamp: session.startedAt + relativeTimeMs,
  relativeTimeMs,
  timecode: '',
  frameNumber: 0,
  category: 'kill',
  label,
  color: 'Red',
  ...extra,
});

describe('v1.6.1 exporter and validation regressions', () => {
  it('always opens YouTube chapters at 00:00, even when the first marker lands in the first 2 s', () => {
    const yt = exportToYouTubeChapters(session, [marker(1500, 'First'), marker(30_000, 'Second')]);
    expect(yt).toBe('00:00 First\n00:30 Second\n');
    expect(countYouTubeChapters(yt)).toBe(2);
  });

  it('keeps 10 s between chapters counted from 00:00', () => {
    const yt = exportToYouTubeChapters(session, [
      marker(1500, 'First'),
      marker(10_000, 'Ten'),
      marker(15_000, 'Too close'),
    ]);
    expect(yt).toBe('00:00 First\n00:10 Ten\n');
  });

  it('neutralises spreadsheet formulas typed into labels, comments and names', () => {
    const csv = exportToCsv(session, [
      marker(1000, '=HYPERLINK("http://evil.example")', { comment: '+SUM(A1)', memberName: '@cmd' }),
      marker(2000, '-1 HP'),
    ]);
    const rows = csv.trim().split('\r\n');
    expect(rows[1]).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(rows[1]).toContain(`'+SUM(A1)`);
    expect(rows[1]).toContain(`'@cmd`);
    expect(rows[2]).toContain(`'-1 HP`);
    // Numbers and timecodes are untouched
    expect(rows[1]).toContain(',01:00:01:00,60,1000,');
  });

  it('folds accents in EDL titles instead of dropping the letters', () => {
    const edl = exportToEdl(session, []);
    expect(edl).toContain('TITLE: Sesion de transmision');
  });

  it('never applies drop-frame to integer 30 / 60 fps', () => {
    const integer60 = new SMPTETimecode({ framerateNumerator: 60, framerateDenominator: 1, dropFrame: true });
    expect(integer60.dropFrame).toBe(false);
    expect(integer60.framesToTimecode(3600)).toBe('00:01:00:00');
    const ntsc = new SMPTETimecode({ framerateNumerator: 60000, framerateDenominator: 1001, dropFrame: true });
    expect(ntsc.dropFrame).toBe(true);
  });

  it('falls back to 60 fps for impossible stored member framerates', () => {
    expect(resolveMemberFramerate({ fps: 60, fpsNumerator: 1, fpsDenominator: 1_000_000 })).toEqual({
      numerator: 60,
      denominator: 1,
      dropFrame: false,
    });
    expect(resolveMemberFramerate({ fps: 0.2 })).toEqual({ numerator: 60, denominator: 1, dropFrame: false });
  });

  it('only accepts the broadcast session rates, with drop-frame for 29.97 / 59.94 only', () => {
    expect(sessionSettingsSchema.safeParse({}).success).toBe(true);
    expect(sessionSettingsSchema.safeParse({ framerateNumerator: 24000, framerateDenominator: 1001 }).success).toBe(
      true
    );
    expect(sessionSettingsSchema.safeParse({ framerateNumerator: 1, framerateDenominator: 1_000_000 }).success).toBe(
      false
    );
    expect(sessionSettingsSchema.safeParse({ framerateNumerator: 30, dropFrame: true }).success).toBe(false);
    expect(
      sessionSettingsSchema.safeParse({ framerateNumerator: 30000, framerateDenominator: 1001, dropFrame: true })
        .success
    ).toBe(true);
  });

  it('accepts real OBS canvas rates from docks and rejects impossible ones', () => {
    expect(memberStatusSchema.safeParse({ fpsNumerator: 60000, fpsDenominator: 1001 }).success).toBe(true);
    expect(memberStatusSchema.safeParse({ fpsNumerator: 1, fpsDenominator: 1_000_000 }).success).toBe(false);
    expect(memberStatusSchema.safeParse({ fps: 0.5 }).success).toBe(false);
  });
});
