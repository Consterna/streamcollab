// Room credentials kept in this browser / OBS profile. Storage can be unavailable (private
// windows, locked-down CEF profiles), so every access is guarded and failures fall back to "none".

const HOST_TOKEN_PREFIX = 'streamcollab_host_token:';
const MEMBER_TOKEN_PREFIX = 'streamcollab_member_token:';
const LAST_ROOM_KEY = 'streamcollab_room';

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // storage unavailable: the token only lives for this page load
  }
}

export const getHostToken = (roomId: string) => read(HOST_TOKEN_PREFIX + roomId);
export const saveHostToken = (roomId: string, token: string | null) => write(HOST_TOKEN_PREFIX + roomId, token);

export const getMemberToken = (memberId: string) => read(MEMBER_TOKEN_PREFIX + memberId);
export const saveMemberToken = (memberId: string, token: string) => write(MEMBER_TOKEN_PREFIX + memberId, token);

export const getLastRoom = () => read(LAST_ROOM_KEY);
export const saveLastRoom = (roomId: string) => write(LAST_ROOM_KEY, roomId);

// This device's streamer identity (same keys as before v1.6.1, so existing docks keep their member id)
const MEMBER_ID_KEY = 'streamcollab_member_id';
const USER_NAME_KEY = 'streamcollab_username';

export const getStoredMemberId = () => read(MEMBER_ID_KEY);
export const saveMemberId = (memberId: string) => write(MEMBER_ID_KEY, memberId);
export const getStoredUserName = () => read(USER_NAME_KEY);
export const saveUserName = (name: string) => write(USER_NAME_KEY, name);
