/**
 * Where the StreamCollab server lives.
 *
 * By default the app talks to the origin it was loaded from (Vite proxy in dev, Fastify in
 * production). `?server=https://collab.example.com` points it at another origin instead, so a
 * Dock can be loaded from a local page (next to OBS) while the room server runs on a VPS.
 */
function readServerParam(): string {
  try {
    const raw = new URLSearchParams(window.location.search).get('server');
    if (!raw) return '';
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

const SERVER_BASE = readServerParam();

/** Origin of the server, or '' when it is the page's own origin */
export function getServerBase(): string {
  return SERVER_BASE;
}

/** Absolute or same-origin URL for a REST path like `/api/rooms` */
export function apiUrl(pathname: string): string {
  return `${SERVER_BASE}${pathname}`;
}

/** WebSocket endpoint (ws:// or wss:// to match the server's scheme) */
export function wsUrl(): string {
  if (SERVER_BASE) {
    return `${SERVER_BASE.replace(/^http/, 'ws')}/ws`;
  }
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

/**
 * Link to another view of the app (dock / hud) that keeps pointing at the same server.
 * `extra` adds options such as the UI language (`lang`) or HUD sound (`sound=1`).
 */
export function viewUrl(
  view: 'dock' | 'hud' | 'dashboard',
  roomId: string,
  extra: Record<string, string> = {}
): string {
  const params = new URLSearchParams({ view, room: roomId, ...extra });
  if (SERVER_BASE) params.set('server', SERVER_BASE);
  return `${window.location.origin}/?${params}`;
}
