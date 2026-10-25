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

// The 16 timeline marker colors of DaVinci Resolve, as written in its marker EDLs (`ResolveColor<Name>`).
// 'White' predates this list and has no Resolve equivalent: Cream is the closest.
const RESOLVE_MARKER_COLORS = new Set([
  'Blue',
  'Cyan',
  'Green',
  'Yellow',
  'Red',
  'Pink',
  'Purple',
  'Fuchsia',
  'Rose',
  'Lavender',
  'Sky',
  'Mint',
  'Lemon',
  'Sand',
  'Cocoa',
  'Cream',
]);

export function toResolveMarkerColor(color: string | undefined): string {
  if (color === 'White') return 'ResolveColorCream';
  return `ResolveColor${color && RESOLVE_MARKER_COLORS.has(color) ? color : 'Blue'}`;
}

/** EDL header fields are plain ASCII: fold accents ("Sesión" -> "Sesion") before dropping other symbols */
function toEdlAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '');
}

// `|` separates the fields of a marker line and line breaks end it
function toMarkerText(text: string): string {
  return text
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * DaVinci Resolve timeline markers as an EDL: Timeline > Import > Timeline Markers from EDL.
 *
 * Same layout as Resolve's own "Export > Timeline Markers to EDL": every marker is a one-frame
 * CMX 3600 event followed by ` |C:ResolveColor<Color> |M:<name> |D:<duration in frames>`, with CRLF
 * line endings.
 */
export function exportToEdl(session: RecordingSession, markers: SquadMarker[], options?: EdlExportOptions): string {
  const tc = new SMPTETimecode({
    framerateNumerator: session.framerateNumerator,
    framerateDenominator: session.framerateDenominator,
    dropFrame: session.dropFrame,
  });

  const title = toEdlAscii(options?.title || session.name || 'StreamCollab Session');
  const fcm = tc.dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME';

  const lines: string[] = [`TITLE: ${title}`, `FCM: ${fcm}`, ''];

  // Sort markers chronologically
  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  const baseFrames = tc.timecodeToFrames(session.baseTimecode || '01:00:00:00');

  // Resolve keeps at most one marker per frame (its timeline markers are keyed by frame), so markers
  // two streamers dropped on the same frame become one marker carrying both names
  const byFrame = new Map<number, SquadMarker[]>();
  for (const marker of sortedMarkers) {
    const frame = baseFrames + tc.millisecondsToFrames(marker.relativeTimeMs);
    byFrame.set(frame, [...(byFrame.get(frame) ?? []), marker]);
  }

  [...byFrame].forEach(([startFrames, frameMarkers], index) => {
    const eventNum = String(index + 1).padStart(3, '0');
    const endFrames = startFrames + 1; // 1-frame event: the marker's position

    const startTc = tc.framesToTimecode(startFrames);
    const endTc = tc.framesToTimecode(endFrames);

    const first = frameMarkers[0];
    const color = toResolveMarkerColor(first.color || CATEGORY_TO_DAVINCI_COLOR[first.category]);
    const name = frameMarkers
      .map((marker) => {
        const creatorTag = marker.memberName ? ` [${marker.memberName}]` : '';
        const commentPart = marker.comment ? ` - ${marker.comment}` : '';
        return toMarkerText(`${marker.label}${creatorTag}${commentPart}`);
      })
      .join(' / ');

    // Event Reel Track Edit SourceIn SourceOut RecordIn RecordOut
    lines.push(`${eventNum}  001      V     C        ${startTc} ${endTc} ${startTc} ${endTc}  `);
    lines.push(` |C:${color} |M:${name} |D:1`);
    lines.push('');
  });

  // CRLF, as in CMX 3600 EDLs written by NLEs
  return lines.join('\r\n') + '\r\n';
}
