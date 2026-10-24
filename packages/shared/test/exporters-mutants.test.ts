import { describe, it, expect } from 'vitest';
import {
  resolveMemberFramerate,
  generateMulticamSyncMatrix,
  rebaseSessionForMember,
  exportToYouTubeChapters,
  countYouTubeChapters,
  exportToCsv,
  exportToFcpXml,
  RecordingSession,
  SquadMarker,
  SquadMember,
  SessionMemberAnchor,
} from '../src/index.js';

// Cases written for the mutants Stryker found alive (stryker.config.mjs): each pins a behaviour
// that a small change in matrix.ts / perMember.ts / youtube.ts would otherwise break unnoticed.

const session: RecordingSession = {
  id: 's1',
  roomId: 'r1',
  name: 'Scrim',
  startedAt: 1_000_000,
  stoppedAt: 1_000_000 + 600_000,
  baseTimecode: '01:00:00:00',
  framerateNumerator: 30000,
  framerateDenominator: 1001,
  dropFrame: true,
};

const member = (overrides: Partial<SquadMember>): SquadMember => ({
  id: 'm',
  name: 'M',
  role: 'player',
  obsStatus: 'recording',
  fps: 60,
  outputDurationMs: 0,
  clockOffsetMs: 0,
  rttMs: 0,
  lastHeartbeat: 0,
  ...overrides,
});

const marker = (overrides: Partial<SquadMarker>): SquadMarker => ({
  id: 'k',
  roomId: 'r1',
  sessionId: 's1',
  memberId: 'm',
  memberName: 'M',
  timestamp: session.startedAt,
  relativeTimeMs: 0,
  timecode: '',
  frameNumber: 0,
  category: 'kill',
  label: 'x',
  color: 'Red',
  ...overrides,
});

describe('resolveMemberFramerate', () => {
  it('snaps the float fps OBS reports to the NTSC rates and keeps integer rates', () => {
    expect(resolveMemberFramerate({ fps: 59.94 })).toEqual({ numerator: 60000, denominator: 1001, dropFrame: true });
    expect(resolveMemberFramerate({ fps: 29.97 })).toEqual({ numerator: 30000, denominator: 1001, dropFrame: true });
    expect(resolveMemberFramerate({ fps: 23.976 })).toEqual({ numerator: 24000, denominator: 1001, dropFrame: false });
    expect(resolveMemberFramerate({ fps: 60 })).toEqual({ numerator: 60, denominator: 1, dropFrame: false });
    expect(resolveMemberFramerate({ fps: 25 })).toEqual({ numerator: 25, denominator: 1, dropFrame: false });
    // 0.05 is the snapping tolerance: 59.88 is not 59.94
    expect(resolveMemberFramerate({ fps: 59.88 })).toEqual({ numerator: 60, denominator: 1, dropFrame: false });
    expect(resolveMemberFramerate({ fps: 29.91 })).toEqual({ numerator: 30, denominator: 1, dropFrame: false });
    expect(resolveMemberFramerate({ fps: 23.92 })).toEqual({ numerator: 24, denominator: 1, dropFrame: false });
  });

  it('defaults to 60 fps when nothing is known', () => {
    expect(resolveMemberFramerate({ fps: 0 })).toEqual({ numerator: 60, denominator: 1, dropFrame: false });
  });

  it('prefers the exact rate of the anchor, then the member, over the float fps', () => {
    const anchor: SessionMemberAnchor = {
      sessionId: 's1',
      memberId: 'm',
      recordStartedAt: 0,
      framerateNumerator: 50,
      framerateDenominator: 1,
    };
    expect(resolveMemberFramerate({ fps: 59.94, fpsNumerator: 30000, fpsDenominator: 1001 }, anchor).numerator).toBe(
      50
    );
    expect(resolveMemberFramerate({ fps: 59.94, fpsNumerator: 30000, fpsDenominator: 1001 })).toEqual({
      numerator: 30000,
      denominator: 1001,
      dropFrame: true,
    });
    // Only one half of the exact rate: falls back to the float fps
    expect(resolveMemberFramerate({ fps: 25, fpsNumerator: 30000 }).numerator).toBe(25);
  });

  it('accepts exactly 1 fps and replaces anything slower', () => {
    expect(resolveMemberFramerate({ fps: 0, fpsNumerator: 1, fpsDenominator: 1 }).numerator).toBe(1);
    expect(resolveMemberFramerate({ fps: 0, fpsNumerator: 1, fpsDenominator: 2 }).numerator).toBe(60);
  });

  it('only drops frames at 29.97 and 59.94', () => {
    expect(resolveMemberFramerate({ fps: 0, fpsNumerator: 48000, fpsDenominator: 1001 }).dropFrame).toBe(false);
    expect(resolveMemberFramerate({ fps: 0, fpsNumerator: 120000, fpsDenominator: 1001 }).dropFrame).toBe(false);
  });
});

describe('generateMulticamSyncMatrix', () => {
  const anchorFor = (memberId: string, offsetMs: number, sessionId = 's1'): SessionMemberAnchor => ({
    sessionId,
    memberId,
    recordStartedAt: session.startedAt + offsetMs,
    framerateNumerator: 60,
    framerateDenominator: 1,
  });

  it('uses the anchors of this session only', () => {
    const matrix = generateMulticamSyncMatrix(session, [], [member({ id: 'a' })], [anchorFor('a', 5000, 'other')]);
    expect(matrix.members[0].aligned).toBe(false);
    expect(matrix.members[0].recordStartedAt).toBeNull();
  });

  it('gives signed offsets in milliseconds and frames (positive = file started later)', () => {
    const matrix = generateMulticamSyncMatrix(
      session,
      [],
      [member({ id: 'late' }), member({ id: 'early' }), member({ id: 'exact' })],
      [anchorFor('late', 2000), anchorFor('early', -1500), anchorFor('exact', 0)]
    );
    const byId = Object.fromEntries(matrix.members.map((m) => [m.memberId, m]));
    expect(byId.late).toMatchObject({ sessionOffsetMs: 2000, sessionOffsetFrames: 120, aligned: true });
    expect(byId.early).toMatchObject({ sessionOffsetMs: -1500, sessionOffsetFrames: -90 });
    expect(byId.exact.sessionOffsetFrames).toBe(0);
    expect(Object.is(byId.exact.sessionOffsetFrames, -0)).toBe(false);
  });

  it("reports each member's recorded duration, or the session length when OBS reported none", () => {
    const matrix = generateMulticamSyncMatrix(
      session,
      [],
      [member({ id: 'a', outputDurationMs: 4321 }), member({ id: 'b', outputDurationMs: 0 })]
    );
    expect(matrix.members.map((m) => m.durationMs)).toEqual([4321, 600_000]);
    const running = generateMulticamSyncMatrix({ ...session, stoppedAt: null }, [], [member({ id: 'c' })]);
    expect(running.members[0].durationMs).toBe(0);
  });

  it('reports the fps OBS gave, or the resolved rate rounded to 2 decimals', () => {
    const matrix = generateMulticamSyncMatrix(
      session,
      [],
      [member({ id: 'a', fps: 59.94 }), member({ id: 'b', fps: 0, fpsNumerator: 30000, fpsDenominator: 1001 })]
    );
    expect(matrix.members.map((m) => m.fps)).toEqual([59.94, 29.97]);
  });

  it('lists markers in time order and names the session rate', () => {
    const matrix = generateMulticamSyncMatrix(
      session,
      [marker({ id: 'second', relativeTimeMs: 9000 }), marker({ id: 'first', relativeTimeMs: 100 })],
      []
    );
    expect(matrix.markers.map((m) => m.id)).toEqual(['first', 'second']);
    expect(matrix.framerate).toBe('30000/1001');
    expect(matrix).toMatchObject({
      roomId: 'r1',
      sessionId: 's1',
      sessionName: 'Scrim',
      referenceTimestamp: 1_000_000,
    });
  });
});

describe('rebaseSessionForMember', () => {
  const anchor: SessionMemberAnchor = {
    sessionId: 's1',
    memberId: 'me',
    recordStartedAt: session.startedAt + 1000,
    framerateNumerator: 60,
    framerateDenominator: 1,
  };

  it("uses OBS's in-file position only for the member's own markers", () => {
    const { markers } = rebaseSessionForMember(
      session,
      [
        marker({ id: 'mine', memberId: 'me', timestamp: session.startedAt + 6000, obsRecordMs: 4800 }),
        marker({ id: 'theirs', memberId: 'other', timestamp: session.startedAt + 6000, obsRecordMs: 1 }),
        marker({ id: 'mine-no-obs', memberId: 'me', timestamp: session.startedAt + 3000 }),
      ],
      anchor
    );
    const byId = Object.fromEntries(markers.map((m) => [m.id, m.relativeTimeMs]));
    expect(byId).toEqual({ mine: 4800, theirs: 5000, 'mine-no-obs': 2000 });
  });

  it('keeps a marker taken exactly when the file started and drops earlier ones', () => {
    const { markers } = rebaseSessionForMember(
      session,
      [
        marker({ id: 'at-start', memberId: 'other', timestamp: anchor.recordStartedAt }),
        marker({ id: 'before', memberId: 'other', timestamp: anchor.recordStartedAt - 1 }),
      ],
      anchor
    );
    expect(markers.map((m) => m.id)).toEqual(['at-start']);
    expect(markers[0].timecode).toBe('01:00:00:00');
  });

  it('starts a POV timeline at 00:00:00:00 when the session has no base timecode', () => {
    const { markers, session: pov } = rebaseSessionForMember(
      { ...session, baseTimecode: '' },
      [marker({ memberId: 'other', timestamp: anchor.recordStartedAt + 1000 })],
      anchor,
      'Me'
    );
    expect(markers[0].timecode).toBe('00:00:01:00');
    expect(pov.name).toBe('Scrim - Me');
    expect(pov.startedAt).toBe(anchor.recordStartedAt);
  });
});

describe('YouTube chapters', () => {
  it('orders chapters by time whatever order the markers come in', () => {
    const text = exportToYouTubeChapters(session, [
      marker({ id: 'b', relativeTimeMs: 120_000, label: 'Second' }),
      marker({ id: 'a', relativeTimeMs: 60_000, label: 'First' }),
    ]);
    expect(text).toBe('00:00 Start of Stream\n01:00 First\n02:00 Second\n');
  });

  it('opens with the first marker when it is within 2 s and spaces the next ones 10 s apart', () => {
    const text = exportToYouTubeChapters(session, [
      marker({ id: 'a', relativeTimeMs: 1500, label: 'Go' }),
      marker({ id: 'b', relativeTimeMs: 9000, label: 'Too soon' }),
      marker({ id: 'c', relativeTimeMs: 10_000, label: 'Ten seconds in' }),
    ]);
    expect(text).toBe('00:00 Go\n00:10 Ten seconds in\n');
  });

  it('counts only lines that hold a chapter', () => {
    expect(countYouTubeChapters('00:00 A\n   \n00:10 B\n\n')).toBe(2);
  });
});

describe('CSV export details', () => {
  const ndf: RecordingSession = { ...session, framerateNumerator: 60, framerateDenominator: 1, dropFrame: false };
  const rows = (csv: string) =>
    csv
      .trimEnd()
      .split('\r\n')
      .slice(1)
      .map((line) => line.split(','));

  it('sorts rows by time and leaves missing values empty', () => {
    const csv = exportToCsv(ndf, [
      marker({ id: 'late', relativeTimeMs: 2000, timestamp: 0, comment: undefined }),
      marker({ id: 'early', relativeTimeMs: 1000, comment: 'ok' }),
    ]);
    const [first, second] = rows(csv);
    expect(first[0]).toBe('early');
    expect(second[0]).toBe('late');
    expect(second[1]).toBe(''); // no valid timestamp: no ISO time
    expect(second[8]).toBe(''); // no comment
    expect(first[1]).toBe(new Date(session.startedAt).toISOString());
  });

  it('defaults the base timecode to 01:00:00:00 and never prefixes numbers', () => {
    const csv = exportToCsv({ ...ndf, baseTimecode: '' }, [marker({ relativeTimeMs: 1000 })]);
    const [row] = rows(csv);
    expect(row[2]).toBe('01:00:01:00');
    expect(row[3]).toBe('60');
    expect(row[4]).toBe('1000');
  });
});

describe('FCP 7 XML details', () => {
  const ndf: RecordingSession = { ...session, framerateNumerator: 30, framerateDenominator: 1, dropFrame: false };
  const duration = (xml: string) => Number(xml.match(/<duration>(\d+)<\/duration>/)![1]);

  it('sizes the sequence to the session, or 5 s past the last marker', () => {
    expect(duration(exportToFcpXml(ndf, []))).toBe(30 * 600); // 10 min session at 30 fps
    // A marker 5 s before the end does not lengthen the sequence; one at the end adds 5 s
    expect(duration(exportToFcpXml(ndf, [marker({ relativeTimeMs: 595_000 })]))).toBe(18_000);
    expect(duration(exportToFcpXml(ndf, [marker({ relativeTimeMs: 600_000 })]))).toBe(18_000 + 150);
  });

  it('falls back to one minute for a running session without markers', () => {
    expect(duration(exportToFcpXml({ ...ndf, stoppedAt: null }, []))).toBe(30 * 60);
    expect(duration(exportToFcpXml({ ...ndf, stoppedAt: null }, [marker({ relativeTimeMs: 1000 })]))).toBe(30 + 150);
  });

  it('flags NTSC rates, orders markers and adds no empty marker block', () => {
    const ntsc = exportToFcpXml(session, [
      marker({ id: 'b', relativeTimeMs: 2000, label: 'Second' }),
      marker({ id: 'a', relativeTimeMs: 1000, label: 'First' }),
    ]);
    expect(ntsc).toContain('<ntsc>TRUE</ntsc>');
    expect(ntsc.indexOf('First')).toBeLessThan(ntsc.indexOf('Second'));
    const empty = exportToFcpXml(ndf, []);
    expect(empty).toContain('<ntsc>FALSE</ntsc>');
    expect(empty).toContain('</timecode>\n    <media>');
  });
});
