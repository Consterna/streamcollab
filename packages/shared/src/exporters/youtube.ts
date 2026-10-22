import { SquadMarker, RecordingSession } from '../types/index.js';

export interface YouTubeChapterOptions {
  introTitle?: string;
  minDurationSeconds?: number;
}

/**
 * Format milliseconds into YouTube chapter timestamp string: MM:SS or HH:MM:SS
 */
export function formatYouTubeTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

// YouTube only shows chapters when the description lists at least this many timestamps
// (the first at 00:00, each chapter 10 s or longer): https://support.google.com/youtube/answer/9884579
export const YOUTUBE_MIN_CHAPTERS = 3;

/** Number of chapters in exported YouTube chapters text (one per non-empty line) */
export function countYouTubeChapters(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/**
 * Clean YouTube chapter generator adhering to YouTube video description requirements
 */
export function exportToYouTubeChapters(
  session: RecordingSession,
  markers: SquadMarker[],
  options?: YouTubeChapterOptions
): string {
  const introTitle = options?.introTitle || 'Start of Stream';
  const minIntervalMs = (options?.minDurationSeconds ?? 10) * 1000;

  const sortedMarkers = [...markers].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);

  const chapters: { timestamp: string; title: string; timeMs: number }[] = [];

  // YouTube requires the first chapter to be at 00:00
  const firstMarker = sortedMarkers[0];
  if (!firstMarker || firstMarker.relativeTimeMs > 2000) {
    chapters.push({
      timestamp: '00:00',
      title: introTitle,
      timeMs: 0,
    });
  }

  let lastTimeMs = chapters.length > 0 ? 0 : -minIntervalMs;

  for (const marker of sortedMarkers) {
    // Prevent chapters clustered closer than minIntervalMs
    if (marker.relativeTimeMs - lastTimeMs >= minIntervalMs || chapters.length === 0) {
      // A marker in the first 2 s becomes the opening chapter, which YouTube only accepts at 00:00
      const timeMs = chapters.length === 0 ? 0 : marker.relativeTimeMs;
      const title = marker.comment ? `${marker.label} - ${marker.comment}` : marker.label;
      chapters.push({
        timestamp: formatYouTubeTimestamp(timeMs),
        title: title.replace(/[\r\n]/g, ' ').trim(),
        timeMs,
      });
      lastTimeMs = timeMs;
    }
  }

  return chapters.map((c) => `${c.timestamp} ${c.title}`).join('\n') + '\n';
}
