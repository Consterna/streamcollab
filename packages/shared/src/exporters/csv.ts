import { SquadMarker, RecordingSession } from '../types/index.js';
import { SMPTETimecode } from '../timecode/index.js';

// Text a spreadsheet would run as a formula (CSV / formula injection, see OWASP)
const FORMULA_TRIGGER = /^\s*[=+\-@|]|[\t\r]/;

function escapeCsvField(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  // Labels, comments and names are typed by squad members: a leading ' makes Excel / Sheets show them as text
  const str = typeof val === 'string' && FORMULA_TRIGGER.test(val) ? `'${val}` : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Universal CSV exporter compatible with Google Sheets, Excel, and Markerbox
 */
export function exportToCsv(session: RecordingSession, markers: SquadMarker[]): string {
  const tc = new SMPTETimecode({
    framerateNumerator: session.framerateNumerator,
    framerateDenominator: session.framerateDenominator,
    dropFrame: session.dropFrame,
  });

  const headers = [
    'Marker ID',
    'Timestamp (UTC)',
    'Timecode',
    'Frame',
    'Relative Time (ms)',
    'Category',
    'Creator',
    'Label',
    'Comment',
    'Color',
    'Session ID',
  ];

  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  const rows = sortedMarkers.map((marker) => {
    const timecode = tc.relativeMsToTimecode(marker.relativeTimeMs, session.baseTimecode || '01:00:00:00');
    const frame = tc.millisecondsToFrames(marker.relativeTimeMs);

    return [
      escapeCsvField(marker.id),
      escapeCsvField(new Date(marker.timestamp).toISOString()),
      escapeCsvField(timecode),
      escapeCsvField(frame),
      escapeCsvField(marker.relativeTimeMs),
      escapeCsvField(marker.category.toUpperCase()),
      escapeCsvField(marker.memberName),
      escapeCsvField(marker.label),
      escapeCsvField(marker.comment || ''),
      escapeCsvField(marker.color),
      escapeCsvField(session.id),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n') + '\r\n';
}
