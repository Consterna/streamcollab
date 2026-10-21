import { SquadMarker, RecordingSession, SquadMember, SyncMatrix, SyncMatrixMember } from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';

export interface MulticamMatrixOptions {
  members: SquadMember[];
}

/**
 * Generate a Multicam Sync Matrix JSON structure for synchronizing multi-POV squad recordings
 */
export function generateMulticamSyncMatrix(
  session: RecordingSession,
  markers: SquadMarker[],
  members: SquadMember[]
): SyncMatrix {
  const masterTc = new SMPTETimecode({
    framerateNumerator: session.framerateNumerator,
    framerateDenominator: session.framerateDenominator,
    dropFrame: session.dropFrame,
  });

  const matrixMembers: SyncMatrixMember[] = members.map((member) => {
    // Member clock offset calibrated via SNTP 4-timestamp engine
    const clockOffset = member.clockOffsetMs || 0;
    
    // Estimate member session start offset in ms
    // If member recorded duration is known, we can calculate alignment
    const memberFps = member.fps || 60;
    const memberTc = new SMPTETimecode({
      framerateNumerator: memberFps === 59.94 ? 60000 : Math.round(memberFps),
      framerateDenominator: memberFps === 59.94 ? 1001 : 1,
      dropFrame: memberFps === 59.94 || memberFps === 29.97,
    });

    const sessionOffsetMs = clockOffset;
    const sessionOffsetFrames = memberTc.millisecondsToFrames(Math.abs(sessionOffsetMs));

    return {
      memberId: member.id,
      name: member.name,
      obsStatus: member.obsStatus,
      sessionOffsetMs,
      sessionOffsetFrames: sessionOffsetMs >= 0 ? sessionOffsetFrames : -sessionOffsetFrames,
      startTimecode: memberTc.framesToTimecode(0),
      durationMs: member.outputDurationMs || (session.stoppedAt ? session.stoppedAt - session.startedAt : 0),
      fps: memberFps,
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
