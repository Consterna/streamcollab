/**
 * Counts unknown room codes per IP across the WebSocket and the REST API. Room codes are the
 * invite, so a client that tries many of them is guessing; opening new sockets or requests is
 * free, which is why this is tracked per IP rather than per connection.
 */
export interface LookupLimit {
  max: number;
  windowMs: number;
}

// Unknown room codes tolerated per IP and window before lookups from that IP are refused
export const DEFAULT_JOIN_FAILURE_LIMIT: LookupLimit = { max: 20, windowMs: 60_000 };

export class RoomLookupGuard {
  private failures = new Map<string, { count: number; windowStart: number }>();
  private pruneTimer: ReturnType<typeof setInterval>;

  constructor(readonly limit: LookupLimit = DEFAULT_JOIN_FAILURE_LIMIT) {
    this.pruneTimer = setInterval(() => this.prune(), limit.windowMs);
    this.pruneTimer.unref();
  }

  isBlocked(ip: string, now = Date.now()): boolean {
    const entry = this.failures.get(ip);
    if (!entry) return false;
    if (now - entry.windowStart > this.limit.windowMs) {
      this.failures.delete(ip);
      return false;
    }
    return entry.count >= this.limit.max;
  }

  recordFailure(ip: string, now = Date.now()) {
    const entry = this.failures.get(ip);
    if (!entry || now - entry.windowStart > this.limit.windowMs) {
      this.failures.set(ip, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  prune(now = Date.now()) {
    for (const [ip, entry] of this.failures) {
      if (now - entry.windowStart > this.limit.windowMs) this.failures.delete(ip);
    }
  }

  close() {
    clearInterval(this.pruneTimer);
  }
}
