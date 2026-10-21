import { SquadMarker, RecordingSession, SessionMemberAnchor } from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';
import { resolveMemberFramerate } from './matrix.js';

export interface MemberTimeline {
  session: RecordingSession;
  markers: SquadMarker[];
}

/**
 * Re-express a session's markers relative to one member's own OBS recording file.
 *
 * The returned "virtual" session starts when that member's file started and uses the file's
 * framerate, so the existing EDL / XML / CSV exporters produce markers that land on the
 * right frame when the editor drops that POV clip on a timeline.
 *
 * Markers made by the member themself use the exact in-file position reported by OBS
 * (`obsRecordMs`); everyone else's markers are placed via the calibrated wall clock.
 * Markers that happened before the file started are dropped.
 */
export function rebaseSessionForMember(
  session: RecordingSession,
  markers: SquadMarker[],
  anchor: SessionMemberAnchor,
  memberName?: string
): MemberTimeline {
  const rate = resolveMemberFramerate({ fps: 0 }, anchor);
  const tc = new SMPTETimecode({
    framerateNumerator: rate.numerator,
    framerateDenominator: rate.denominator,
    dropFrame: rate.dropFrame,
  });

  const memberSession: RecordingSession = {
    ...session,
    name: memberName ? `${session.name} - ${memberName}` : session.name,
    startedAt: anchor.recordStartedAt,
    framerateNumerator: rate.numerator,
    framerateDenominator: rate.denominator,
    dropFrame: rate.dropFrame,
  };

  const baseTimecode = memberSession.baseTimecode || '00:00:00:00';

  const rebased = markers
    .map((marker): SquadMarker => {
      const ownMarker = marker.memberId === anchor.memberId && typeof marker.obsRecordMs === 'number';
      const relativeTimeMs = ownMarker
        ? (marker.obsRecordMs as number)
        : marker.timestamp - anchor.recordStartedAt;

      return {
        ...marker,
        relativeTimeMs,
        frameNumber: tc.millisecondsToFrames(relativeTimeMs),
        timecode: tc.relativeMsToTimecode(Math.max(0, relativeTimeMs), baseTimecode),
      };
    })
    .filter((marker) => marker.relativeTimeMs >= 0)
    .sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  return { session: memberSession, markers: rebased };
}
