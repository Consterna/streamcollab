import { CreateRoomResponse } from '@streamcollab/shared';
import { getHostToken, saveHostToken } from './credentials';
import { apiUrl } from './serverUrl';

/**
 * Create a room on the server. The host token is returned only once, so it is stored
 * right away for this browser; the room id is the code the squad joins with.
 */
export async function createRoom(name?: string): Promise<CreateRoomResponse> {
  const res = await fetch(apiUrl('/api/rooms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Could not create room (HTTP ${res.status})`);
  }
  const room = body as CreateRoomResponse;
  saveHostToken(room.id, room.hostToken);
  return room;
}

async function hostDelete(roomId: string, path: string) {
  const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}${path}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getHostToken(roomId) ?? ''}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (HTTP ${res.status})`);
  }
}

/** Host only: delete a finished session and its markers */
export function deleteSession(roomId: string, sessionId: string): Promise<void> {
  return hostDelete(roomId, `/sessions/${encodeURIComponent(sessionId)}`);
}

/** Host only: delete the room and everything in it */
export async function deleteRoom(roomId: string): Promise<void> {
  await hostDelete(roomId, '');
  saveHostToken(roomId, null);
}
