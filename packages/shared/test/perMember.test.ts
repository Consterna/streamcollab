import { describe, it, expect } from 'vitest';
import {
  RecordingSession,
  SquadMarker,
  SessionMemberAnchor,
  rebaseSessionForMember,
  exportToEdl,
} from '../src/index.js';

const session: RecordingSession = {
  id: 'sess-pov',
  roomId: 'room-pov',
  name: 'Scrim 3',
  startedAt: 1700000000000,
  stoppedAt: 1700000600000,
  baseTimecode: '00:00:00:00',
  framerateNumerator: 60,
  framerateDenominator: 1,
  dropFrame: false,
};

function marker(partial: Partial<SquadMarker>): SquadMarker {
  return {
    id: 'm',
    roomId: 'room-pov',
    sessionId: 'sess-pov',
    memberId: 'mem-a',
    memberName: 'Alpha',
    timestamp: session.startedAt,
    relativeTimeMs: 0,
    timecode: '00:00:00:00',
    frameNumber: 0,
    category: 'kill',
    label: 'Kill',
    color: 'Red',
    ...partial,
  };
}

// Bravo started recording 4s after the session, at 30 fps
const bravoAnchor: SessionMemberAnchor = {
  sessionId: 'sess-pov',
  memberId: 'mem-b',
  recordStartedAt: session.startedAt + 4000,
  framerateNumerator: 30,
  framerateDenominator: 1,
};

describe('Per-member (POV) timeline rebasing', () => {
  it('re-times squadmates markers against the member file start via the calibrated clock', () => {
    const markers = [marker({ id: 'a1', timestamp: session.startedAt + 10000, relativeTimeMs: 10000 })];
    const { session: pov, markers: rebased } = rebaseSessionForMember(session, markers, bravoAnchor, 'Bravo');

    expect(pov.name).toBe('Scrim 3 - Bravo');
    expect(pov.startedAt).toBe(bravoAnchor.recordStartedAt);
    expect(pov.framerateNumerator).toBe(30);
    expect(rebased[0].relativeTimeMs).toBe(6000);
    expect(rebased[0].frameNumber).toBe(180);
    expect(rebased[0].timecode).toBe('00:00:06:00');
  });

  it("uses the member's own exact in-file position (obsRecordMs) for their markers", () => {
    const markers = [
      marker({
        id: 'b1',
        memberId: 'mem-b',
        memberName: 'Bravo',
        timestamp: session.startedAt + 10000,
        obsRecordMs: 5900,
      }),
    ];
    const { markers: rebased } = rebaseSessionForMember(session, markers, bravoAnchor);
    expect(rebased[0].relativeTimeMs).toBe(5900);
    expect(rebased[0].timecode).toBe('00:00:05:27');
  });

  it('drops markers that happened before the member started recording and keeps chronological order', () => {
    const markers = [
      marker({ id: 'late', timestamp: session.startedAt + 20000 }),
      marker({ id: 'early', timestamp: session.startedAt + 1000 }),
      marker({ id: 'mid', timestamp: session.startedAt + 8000 }),
    ];
    const { markers: rebased } = rebaseSessionForMember(session, markers, bravoAnchor);
    expect(rebased.map((m) => m.id)).toEqual(['mid', 'late']);
  });

  it('produces an EDL whose locators land on the POV file timecode', () => {
    const markers = [marker({ id: 'a1', timestamp: session.startedAt + 10000, label: 'Entry Frag' })];
    const rebased = rebaseSessionForMember(session, markers, bravoAnchor, 'Bravo');
    const edl = exportToEdl(rebased.session, rebased.markers);
    expect(edl).toContain('* LOC: 00:00:06:00 Red Entry Frag');
  });
});
