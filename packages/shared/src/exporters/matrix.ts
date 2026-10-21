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
    let num = Math.round(memberFps);
    let den = 1;
    let dropFrame = false;

    if (Math.abs(memberFps - 59.94) < 0.05) {
      num = 60000;
      den = 1001;
      dropFrame = true;
    } else if (Math.abs(memberFps - 29.97) < 0.05) {
      num = 30000;
      den = 1001;
      dropFrame = true;
    } else if (Math.abs(memberFps - 23.976) < 0.05) {
      num = 24000;
      den = 1001;
      dropFrame = false;
    }

    const memberTc = new SMPTETimecode({
      framerateNumerator: num,
      framerateDenominator: den,
      dropFrame,
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
