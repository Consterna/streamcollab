import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from '../src/db/database.js';
import { RoomManager } from '../src/rooms/roomManager.js';
import { SquadMarker } from '@streamcollab/shared';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) {
      try {
        fs.unlinkSync(`${dbPath}${suffix}`);
      } catch {
        // Ignored if file handle is busy
      }
    }
  }
}

describe('Crash Recovery & Orphan Session Reconciliation', () => {
  const dbPath = path.resolve(process.cwd(), 'test-crash-recovery-streamcollab.sqlite');

  beforeAll(() => {
    removeDb(dbPath);
  });

  afterAll(() => {
    removeDb(dbPath);
  });

  it('auto-closes an unstopped session using the last marker timestamp after process crash', () => {
    // 1. Simulate active server before crash
    const db1 = new DatabaseService(dbPath);
    const rm1 = new RoomManager(db1);

    rm1.createRoom('CRASH-ROOM-1', 'Crash Room 1');
    const session = rm1.startSession('CRASH-ROOM-1', {
      name: 'Unsaved Stream Session',
      baseTimecode: '01:00:00:00',
    });

    const marker1: SquadMarker = {
      id: 'm-crash-1',
      roomId: 'CRASH-ROOM-1',
      sessionId: session.id,
      memberId: 'mem-1',
      memberName: 'Player1',
      timestamp: 1700000010000,
      relativeTimeMs: 10000,
      timecode: '01:00:10:00',
      frameNumber: 600,
      category: 'kill',
      label: 'Marker 1',
      color: 'Red',
    };

    const marker2: SquadMarker = {
      id: 'm-crash-2',
      roomId: 'CRASH-ROOM-1',
      sessionId: session.id,
      memberId: 'mem-1',
      memberName: 'Player1',
      timestamp: 1700000035000, // 35 seconds (latest marker)
      relativeTimeMs: 35000,
      timecode: '01:00:35:00',
      frameNumber: 2100,
      category: 'clutch',
      label: 'Marker 2',
      color: 'Yellow',
    };

    db1.createMarker(marker1);
    db1.createMarker(marker2);

    // Verify it is active before "crash"
    expect(db1.getActiveSession('CRASH-ROOM-1')?.id).toBe(session.id);
    expect(db1.getSession(session.id)?.stoppedAt).toBeNull();

    // Abrupt termination: close database without stopSession
    db1.close();

    // 2. Simulate server restart: new process opens database and runs startup crash recovery
    const db2 = new DatabaseService(dbPath);
    const rm2 = new RoomManager(db2);

    const result = rm2.reconcileCrashRecovery();
    expect(result.closedCount).toBe(1);

    // Verify session was auto-closed at the timestamp of the last marker (1700000035000)
    const recoveredSession = db2.getSession(session.id);
    expect(recoveredSession).not.toBeNull();
    expect(recoveredSession?.stoppedAt).toBe(1700000035000);

    // Verify active session was cleared on the room
    expect(db2.getActiveSession('CRASH-ROOM-1')).toBeNull();

    // Verify latestSession still finds the closed session for exports
    const latest = db2.getLatestSession('CRASH-ROOM-1');
    expect(latest?.id).toBe(session.id);
    expect(latest?.stoppedAt).toBe(1700000035000);

    // Verify markers survived intact
    const markers = db2.getSessionMarkers(session.id);
    expect(markers.length).toBe(2);

    db2.close();
  });

  it('falls back to started_at if server crashed with 0 markers recorded', () => {
    const db1 = new DatabaseService(dbPath);
    const rm1 = new RoomManager(db1);

    rm1.createRoom('CRASH-ROOM-2', 'Crash Room 2');
    const startedAt = 1700000000000;
    const session = db1.createSession({
      id: 'sess-empty-crash',
      roomId: 'CRASH-ROOM-2',
      name: 'Zero Markers Session',
      startedAt,
      stoppedAt: null,
      baseTimecode: '01:00:00:00',
      framerateNumerator: 60,
      framerateDenominator: 1,
      dropFrame: false,
    });

    expect(db1.getActiveSession('CRASH-ROOM-2')?.id).toBe(session.id);
    db1.close();

    // Restart and recover
    const db2 = new DatabaseService(dbPath);
    const rm2 = new RoomManager(db2);

    const result = rm2.reconcileCrashRecovery();
    expect(result.closedCount).toBeGreaterThanOrEqual(1);

    const recovered = db2.getSession(session.id);
    expect(recovered?.stoppedAt).toBe(startedAt);
    expect(db2.getActiveSession('CRASH-ROOM-2')).toBeNull();

    db2.close();
  });

  it('reconciles multiple orphaned sessions across multiple rooms atomically and idempotently', () => {
    const db = new DatabaseService(dbPath);
    const rm = new RoomManager(db);

    rm.createRoom('MULTI-A', 'Room A');
    rm.createRoom('MULTI-B', 'Room B');

    // Create orphaned sessions in both rooms
    db.createSession({
      id: 'orphan-a',
      roomId: 'MULTI-A',
      name: 'Orphan A',
      startedAt: 1000,
      stoppedAt: null,
      baseTimecode: '01:00:00:00',
      framerateNumerator: 60,
      framerateDenominator: 1,
      dropFrame: false,
    });

    db.createSession({
      id: 'orphan-b',
      roomId: 'MULTI-B',
      name: 'Orphan B',
      startedAt: 2000,
      stoppedAt: null,
      baseTimecode: '01:00:00:00',
      framerateNumerator: 60,
      framerateDenominator: 1,
      dropFrame: false,
    });

    // First recovery run closes both
    const firstRun = rm.reconcileCrashRecovery();
    expect(firstRun.closedCount).toBe(2);
    expect(db.getSession('orphan-a')?.stoppedAt).toBe(1000);
    expect(db.getSession('orphan-b')?.stoppedAt).toBe(2000);

    // Second run is a no-op (idempotent)
    const secondRun = rm.reconcileCrashRecovery();
    expect(secondRun.closedCount).toBe(0);

    // Can immediately start fresh sessions in both rooms without issue
    const newSessionA = rm.startSession('MULTI-A', { name: 'Fresh Session A' });
    expect(newSessionA.stoppedAt).toBeNull();
    expect(db.getActiveSession('MULTI-A')?.id).toBe(newSessionA.id);

    db.close();
  });
});
