import crypto from 'node:crypto';

// Unambiguous characters for human-typed room codes (no 0/O, 1/I/L)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random secret for host / member tokens (256 bits, URL-safe) */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Only token hashes are stored, so a leaked database can't be used to take over rooms */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenMatches(token: string | undefined, storedHash: string | null | undefined): boolean {
  if (!token || !storedHash) return false;
  const candidate = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** Room codes are the join codes shared with the squad, e.g. "KQ7P-M3XD" (~40 bits) */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    // randomInt draws uniformly; `byte % 31` favoured the first 8 characters (256 % 31 = 8)
    code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    if (i === 3) code += '-';
  }
  return code;
}

/** Extract a bearer token from an Authorization header */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}
