import {
  SquadMarker,
  RecordingSession,
  SquadMember,
  SyncMatrix,
  SyncMatrixMember,
  SessionMemberAnchor,
} from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';

export interface MulticamMatrixOptions {
  members: SquadMember[];
}

/**
 * Resolve an exact rational framerate for a member, preferring the numerator/denominator
 * reported by OBS and falling back to snapping the float fps to a broadcast standard.
 */
export function resolveMemberFramerate(
  member: Pick<SquadMember, 'fps' | 'fpsNumerator' | 'fpsDenominator'>,
  anchor?: SessionMemberAnchor
): { numerator: number; denominator: number; dropFrame: boolean } {
  let num = anchor?.framerateNumerator || member.fpsNumerator || 0;
  let den = anchor?.framerateDenominator || member.fpsDenominator || 0;

  if (!num || !den) {
    const memberFps = member.fps || 60;
    num = Math.round(memberFps);
    den = 1;
    if (Math.abs(memberFps - 59.94) < 0.05) {
      num = 60000;
      den = 1001;
    } else if (Math.abs(memberFps - 29.97) < 0.05) {
      num = 30000;
      den = 1001;
    } else if (Math.abs(memberFps - 23.976) < 0.05) {
      num = 24000;
      den = 1001;
    }
  }

  // Drop-frame only applies to the NTSC 29.97 / 59.94 rates
  const nominal = Math.round(num / den);
  const dropFrame = den === 1001 && (nominal === 30 || nominal === 60);
  return { numerator: num, denominator: den, dropFrame };
}

/**
 * Generate a Multicam Sync Matrix JSON structure for synchronizing multi-POV squad recordings.
 *
 * Each member's offset is the distance between the session start and the moment their own
 * OBS recording file began (both on the server-calibrated clock), so an editor can slide
 * every POV clip into place on a shared multicam timeline.
 */
export function generateMulticamSyncMatrix(
  session: RecordingSession,
  markers: SquadMarker[],
  members: SquadMember[],
  anchors: SessionMemberAnchor[] = []
): SyncMatrix {
  const matrixMembers: SyncMatrixMember[] = members.map((member) => {
    const anchor = anchors.find((a) => a.memberId === member.id && a.sessionId === session.id);
    const rate = resolveMemberFramerate(member, anchor);

    const memberTc = new SMPTETimecode({
      framerateNumerator: rate.numerator,
      framerateDenominator: rate.denominator,
      dropFrame: rate.dropFrame,
    });

    const recordStartedAt = anchor?.recordStartedAt ?? null;
    const sessionOffsetMs = recordStartedAt !== null ? recordStartedAt - session.startedAt : 0;
    const sessionOffsetFrames = memberTc.millisecondsToFrames(Math.abs(sessionOffsetMs));

    return {
      memberId: member.id,
      name: member.name,
      obsStatus: member.obsStatus,
      aligned: recordStartedAt !== null,
      recordStartedAt,
      clockOffsetMs: member.clockOffsetMs || 0,
      sessionOffsetMs,
      sessionOffsetFrames: sessionOffsetMs >= 0 ? sessionOffsetFrames : -sessionOffsetFrames,
      startTimecode: memberTc.framesToTimecode(0),
      durationMs: member.outputDurationMs || (session.stoppedAt ? session.stoppedAt - session.startedAt : 0),
      fps: member.fps || Math.round((rate.numerator / rate.denominator) * 100) / 100,
    };
  });

  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  return {
    roomId: session.roomId,
    sessionId: session.id,
    sessionName: session.name,
    referenceTimestamp: session.startedAt,
    framerate: `${session.framerateNumerator}/${session.framerateDenominator}`,
    members: matrixMembers,
    markers: sortedMarkers,
  };
}
