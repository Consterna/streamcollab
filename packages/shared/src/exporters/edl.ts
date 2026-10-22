import { SquadMarker, RecordingSession, DaVinciMarkerColor } from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';

export interface EdlExportOptions {
  title?: string;
  clipName?: string;
}

export const CATEGORY_TO_DAVINCI_COLOR: Record<string, DaVinciMarkerColor> = {
  kill: 'Red',
  wipe: 'Fuchsia',
  clutch: 'Yellow',
  funny: 'Cyan',
  note: 'Blue',
  custom: 'Green',
};

/** EDL header fields are plain ASCII: fold accents ("Sesión" -> "Sesion") before dropping other symbols */
function toEdlAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '');
}

/**
 * Generate DaVinci Resolve CMX 3600 EDL format with strict CRLF line endings
 */
export function exportToEdl(session: RecordingSession, markers: SquadMarker[], options?: EdlExportOptions): string {
  const tc = new SMPTETimecode({
    framerateNumerator: session.framerateNumerator,
    framerateDenominator: session.framerateDenominator,
    dropFrame: session.dropFrame,
  });

  const title = toEdlAscii(options?.title || session.name || 'StreamCollab Session');
  const clipName = toEdlAscii(options?.clipName || 'StreamCollab');
  const fcm = tc.dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME';

  const lines: string[] = [`TITLE: ${title}`, `FCM: ${fcm}`, ''];

  // Sort markers chronologically
  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  const baseFrames = tc.timecodeToFrames(session.baseTimecode || '01:00:00:00');

  sortedMarkers.forEach((marker, index) => {
    const eventNum = String(index + 1).padStart(3, '0');
    const elapsedFrames = tc.millisecondsToFrames(marker.relativeTimeMs);
    const startFrames = baseFrames + elapsedFrames;
    const endFrames = startFrames + 1; // 1-frame edit event for marker locator

    const startTc = tc.framesToTimecode(startFrames);
    const endTc = tc.framesToTimecode(endFrames);

    const color = marker.color || CATEGORY_TO_DAVINCI_COLOR[marker.category] || 'Blue';
    const cleanLabel = marker.label.replace(/[\r\n]/g, ' ').trim();
    const cleanComment = marker.comment ? ` - ${marker.comment.replace(/[\r\n]/g, ' ').trim()}` : '';
    const creatorTag = marker.memberName ? ` [${marker.memberName}]` : '';

    const locatorText = `${cleanLabel}${creatorTag}${cleanComment}`;

    // Standard CMX 3600 record line:
    // Event Reel Track Edit In Out RecordIn RecordOut
    lines.push(`${eventNum}  AX       V     C        ${startTc} ${endTc} ${startTc} ${endTc}`);
    lines.push(`* FROM CLIP NAME: ${clipName}`);
    lines.push(`* LOC: ${startTc} ${color} ${locatorText}`);
    lines.push('');
  });

  // Strict CRLF as required by CMX 3600 specification and DaVinci Resolve parser
  return lines.join('\r\n') + '\r\n';
}
