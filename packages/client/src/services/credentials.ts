// Room credentials kept in this browser / OBS profile. Storage can be unavailable (private
// windows, locked-down CEF profiles), so every access is guarded and failures fall back to "none".
//
// Credentials belong to the server that issued them: `<prefix>self|<id>` for the page's own server,
// `<prefix><server>|<id>` for a server named with `?server=`, so a crafted link can't make this page
// send the tokens of one server to another. Keys without a server (`<prefix><id>`) were written
// before v1.6.2, when every server shared them: the own server still reads them, and another server
// only once the user trusts it with them.
import { getServerBase } from './serverUrl';

const HOST_TOKEN_PREFIX = 'streamcollab_host_token:';
const MEMBER_TOKEN_PREFIX = 'streamcollab_member_token:';
const LAST_ROOM_KEY = 'streamcollab_room';
const TRUSTED_SERVERS_KEY = 'streamcollab_trusted_servers';
const DECLINED_SERVERS_KEY = 'streamcollab_declined_servers';

// Copy kept for this page load: without it, a profile with storage blocked lost its member token
// right away and every reconnect was refused (MEMBER_TOKEN_INVALID), creating a new identity each time
const pageMemory = new Map<string, string>();
// Keys whose last write did not reach storage: for those, the page copy is the current value. For the
// others storage stays the source of truth, so a token another tab cleared is not brought back.
const unsavedKeys = new Set<string>();

function read(key: string): string | undefined {
  if (unsavedKeys.has(key)) return pageMemory.get(key);
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    // storage unavailable: fall back to this page load's copy
    return pageMemory.get(key);
  }
}

function write(key: string, value: string | null) {
  if (value === null) {
    pageMemory.delete(key);
  } else {
    pageMemory.set(key, value);
  }
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    unsavedKeys.delete(key);
  } catch {
    // storage unavailable: the value only lives for this page load (pageMemory)
    unsavedKeys.add(key);
  }
}

/** Another server than the page's own (named with `?server=`), or '' */
function remoteServer(): string {
  const base = getServerBase();
  try {
    return base && base !== window.location.origin ? base : '';
  } catch {
    return base;
  }
}

function trustedServers(): string[] {
  try {
    const list = JSON.parse(read(TRUSTED_SERVERS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function isServerTrusted(server: string = remoteServer()): boolean {
  return !server || trustedServers().includes(server);
}

/** The user agreed to use the credentials saved before v1.6.2 with the current `?server=` */
export function trustCurrentServer() {
  const server = remoteServer();
  if (server && !isServerTrusted(server)) {
    write(TRUSTED_SERVERS_KEY, JSON.stringify([...trustedServers(), server]));
  }
}

/** The user refused: this server gets credentials of its own and is not asked about again */
export function distrustCurrentServer() {
  const server = remoteServer();
  if (server && !declinedServers().includes(server)) {
    write(DECLINED_SERVERS_KEY, JSON.stringify([...declinedServers(), server]));
  }
}

function declinedServers(): string[] {
  try {
    const list = JSON.parse(read(DECLINED_SERVERS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Origin of the `?server=` the user still has to decide about, when there are older credentials to reuse */
export function serverAwaitingTrust(): string | null {
  const server = remoteServer();
  if (!server || isServerTrusted(server) || declinedServers().includes(server)) return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      const legacyToken =
        (key.startsWith(HOST_TOKEN_PREFIX) || key.startsWith(MEMBER_TOKEN_PREFIX)) && !key.includes('|');
      if (legacyToken) return server;
    }
  } catch {
    // storage unavailable: nothing to reuse
  }
  return null;
}

const keyFor = (prefix: string, id: string, server: string) => `${prefix}${server || 'self'}|${id}`;
const legacyKey = (prefix: string, id: string) => prefix + id;

function readScoped(prefix: string, id: string): string | undefined {
  const server = remoteServer();
  const scoped = read(keyFor(prefix, id, server));
  if (scoped) return scoped;
  return !server || isServerTrusted(server) ? read(legacyKey(prefix, id)) : undefined;
}

function writeScoped(prefix: string, id: string, value: string | null) {
  const server = remoteServer();
  write(keyFor(prefix, id, server), value);
  // Clearing a token also clears its pre-v1.6.2 copy where that copy would be read back (it would keep
  // failing). That copy is shared by the own server and every trusted one: the same room code on
  // two of them loses the older token for both, which then has to be pasted again.
  if (value === null && (!server || isServerTrusted(server))) write(legacyKey(prefix, id), null);
}

export const getHostToken = (roomId: string) => readScoped(HOST_TOKEN_PREFIX, roomId);
export const saveHostToken = (roomId: string, token: string | null) => writeScoped(HOST_TOKEN_PREFIX, roomId, token);

export const getMemberToken = (memberId: string) => readScoped(MEMBER_TOKEN_PREFIX, memberId);
export const saveMemberToken = (memberId: string, token: string) => writeScoped(MEMBER_TOKEN_PREFIX, memberId, token);

export const getLastRoom = () => read(LAST_ROOM_KEY);
export const saveLastRoom = (roomId: string) => write(LAST_ROOM_KEY, roomId);

// This device's streamer identity (same keys as before v1.6.1, so existing docks keep their member id).
// A member id is bound to a token on the server that issued it, so it is kept per server too.
const MEMBER_ID_KEY = 'streamcollab_member_id';
const USER_NAME_KEY = 'streamcollab_username';

/**
 * A fresh streamer identity. Unpredictable, so nobody can claim the id another Dock is about to use;
 * getRandomValues (not randomUUID) also works on plain-http LAN pages, where OBS docks may load.
 */
export function newMemberId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'mem_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const memberIdKey = (server: string) => (server ? `${MEMBER_ID_KEY}@${server}` : MEMBER_ID_KEY);

export function getStoredMemberId(): string | undefined {
  const server = remoteServer();
  const own = read(memberIdKey(server));
  if (own || !server) return own;
  return isServerTrusted(server) ? read(MEMBER_ID_KEY) : undefined;
}
export const saveMemberId = (memberId: string) => write(memberIdKey(remoteServer()), memberId);
export const getStoredUserName = () => read(USER_NAME_KEY);
export const saveUserName = (name: string) => write(USER_NAME_KEY, name);
