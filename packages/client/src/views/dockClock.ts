/**
 * Milliseconds the Dock's big SMPTE clock shows. While a session runs it is the session timeline,
 * the same one its markers (listed right below) and the master exports use. With no session, the
 * position in the OBS recording, or 0.
 */
export function dockClockMs(options: {
  now: number;
  session: { startedAt: number } | null;
  recording: boolean;
  recordingElapsedMs: number;
}): number {
  if (options.session) return Math.max(0, options.now - options.session.startedAt);
  return options.recording ? options.recordingElapsedMs : 0;
}
