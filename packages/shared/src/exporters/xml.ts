import { SquadMarker, RecordingSession } from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';

export interface XmlExportOptions {
  sequenceName?: string;
  width?: number;
  height?: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate Apple Final Cut Pro 7 / Adobe Premiere Pro XML (xmeml version 4)
 */
export function exportToFcpXml(
  session: RecordingSession,
  markers: SquadMarker[],
  options?: XmlExportOptions
): string {
  const tc = new SMPTETimecode({
    framerateNumerator: session.framerateNumerator,
    framerateDenominator: session.framerateDenominator,
    dropFrame: session.dropFrame,
  });

  const width = options?.width || 1920;
  const height = options?.height || 1080;
  const seqName = escapeXml(options?.sequenceName || session.name || 'StreamCollab Sequence');

  const timebase = tc.nominalFps;
  const isNtsc = session.framerateDenominator === 1001 ? 'TRUE' : 'FALSE';
  const displayFormat = session.dropFrame ? 'DF' : 'NDF';

  // Sort markers chronologically
  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  const baseFrames = tc.timecodeToFrames(session.baseTimecode || '01:00:00:00');

  // Calculate sequence duration (at least last marker + 30 seconds, or session duration)
  let maxFrame = baseFrames;
  if (session.stoppedAt && session.startedAt) {
    const sessionDurationMs = Math.max(0, session.stoppedAt - session.startedAt);
    maxFrame = Math.max(maxFrame, baseFrames + tc.millisecondsToFrames(sessionDurationMs));
  }
  for (const m of sortedMarkers) {
    const f = baseFrames + tc.millisecondsToFrames(m.relativeTimeMs);
    if (f + timebase * 5 > maxFrame) {
      maxFrame = f + timebase * 5;
    }
  }
  if (maxFrame === baseFrames) {
    maxFrame = baseFrames + timebase * 60; // Default minimum 1 minute
  }

  const markerXmlBlocks = sortedMarkers.map((marker) => {
    const inFrame = tc.millisecondsToFrames(marker.relativeTimeMs);
    const outFrame = inFrame + 1; // 1-frame marker

    const categoryTag = marker.category.toUpperCase();
    const markerName = escapeXml(`[${categoryTag}] ${marker.label}`);
    const authorPart = marker.memberName ? ` (By: ${marker.memberName})` : '';
    const commentBody = marker.comment ? `${marker.comment}${authorPart}` : authorPart.trim();
    const markerComment = escapeXml(commentBody);

    return `        <marker>
          <name>${markerName}</name>
          <comment>${markerComment}</comment>
          <in>${inFrame}</in>
          <out>${outFrame}</out>
        </marker>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${seqName}</name>
    <duration>${maxFrame}</duration>
    <rate>
      <timebase>${timebase}</timebase>
      <ntsc>${isNtsc}</ntsc>
    </rate>
    <timecode>
      <rate>
        <timebase>${timebase}</timebase>
        <ntsc>${isNtsc}</ntsc>
      </rate>
      <string>${session.baseTimecode || '01:00:00:00'}</string>
      <frame>${baseFrames}</frame>
      <displayformat>${displayFormat}</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc}</ntsc>
            </rate>
            <width>${width}</width>
            <height>${height}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <colordepth>24</colordepth>
          </samplecharacteristics>
        </format>
        <track>
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
${markerXmlBlocks}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
`;
}
