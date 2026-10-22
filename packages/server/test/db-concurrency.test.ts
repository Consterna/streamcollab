import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from '../src/db/database.js';
import { RoomManager } from '../src/rooms/roomManager.js';
import { backupDatabase } from '../src/backup.js';
import { SquadMarker, SquadMember } from '@streamcollab/shared';

function removeDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) {
      try {
        fs.unlinkSync(`${dbPath}${suffix}`);
      } catch {
        // Ignored if busy
      }
    }
  }
}

describe('Database High-Concurrency & Hot Backup Contention', () => {
  const dbPath = path.resolve(process.cwd(), 'test-concurrency-streamcollab.sqlite');
  const backupPath = path.resolve(process.cwd(), 'test-concurrency-backup.sqlite');
  let db: DatabaseService;
  let roomManager: RoomManager;

  beforeAll(() => {
    removeDb(dbPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    db = new DatabaseService(dbPath);
    roomManager = new RoomManager(db);
  });

  afterAll(() => {
    db.close();
    removeDb(dbPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  });

  it('handles 20 concurrent workers executing 2,000 writes while hot backup runs simultaneously', async () => {
    const roomId = 'CONCURRENT-ROOM';
    roomManager.createRoom(roomId, 'Concurrency Stress Room');

    const session = roomManager.startSession(roomId, {
      name: 'Concurrent Stress Session',
      baseTimecode: '01:00:00:00',
      framerateNumerator: 60,
      framerateDenominator: 1,
      dropFrame: false,
    });

    const WORKER_COUNT = 20;
    const WRITES_PER_WORKER = 100;
    const TOTAL_WRITES = WORKER_COUNT * WRITES_PER_WORKER; // 2,000 writes

    // Setup 20 members
    const members: SquadMember[] = Array.from({ length: WORKER_COUNT }, (_, i) => ({
      id: `worker-${i}`,
      name: `Streamer ${i}`,
      role: 'player',
      obsStatus: 'recording',
      fps: 60,
      outputDurationMs: 0,
      clockOffsetMs: 0,
      rttMs: 5,
      lastHeartbeat: Date.now(),
      recordStartedAt: Date.now() - 10000,
    }));

    members.forEach((m) => db.upsertMember(roomId, m));

    // Launch 20 concurrent workers
    const startTime = performance.now();

    let backupCompleted = false;
    let backupResult: { path: string; bytes: number } | null = null;

    // Start background backup after a short delay so writers are already active
    const backupPromise = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      backupResult = backupDatabase(dbPath, backupPath);
      backupCompleted = true;
    })();

    const workerPromises = Array.from({ length: WORKER_COUNT }, async (_, workerIdx) => {
      const member = members[workerIdx];
      for (let j = 0; j < WRITES_PER_WORKER; j++) {
        const markerTime = Date.now();
        const marker: SquadMarker = {
          id: `m-${workerIdx}-${j}-${Math.random().toString(36).slice(2, 7)}`,
          roomId,
          sessionId: session.id,
          memberId: member.id,
          memberName: member.name,
          timestamp: markerTime,
          relativeTimeMs: j * 100,
          timecode: `01:00:${String(Math.floor(j / 60)).padStart(2, '0')}:${String(j % 60).padStart(2, '0')}`,
          frameNumber: j,
          category: j % 2 === 0 ? 'kill' : 'clutch',
          label: `Action ${j} by ${member.name}`,
          color: j % 2 === 0 ? 'Red' : 'Yellow',
        };

        db.createMarker(marker);

        // Also interleave occasional member updates and anchor updates
        if (j % 25 === 0) {
          db.upsertMember(roomId, {
            ...member,
            lastHeartbeat: Date.now(),
            outputDurationMs: j * 100,
          });
          db.upsertSessionAnchor({
            sessionId: session.id,
            memberId: member.id,
            recordStartedAt: Date.now() - 5000,
            framerateNumerator: 60,
            framerateDenominator: 1,
          });
        }
      }
    });

    // Wait for all 20 workers and backup to complete
    await Promise.all([...workerPromises, backupPromise]);

    const durationSeconds = (performance.now() - startTime) / 1000;
    const writesPerSec = TOTAL_WRITES / durationSeconds;

    expect(backupCompleted).toBe(true);
    expect(backupResult).not.toBeNull();
    expect(backupResult!.bytes).toBeGreaterThan(0);

    // Verify all 2,000 markers were written without loss
    const writtenMarkers = db.getSessionMarkers(session.id);
    expect(writtenMarkers.length).toBe(TOTAL_WRITES);

    // Verify write throughput
    expect(writesPerSec).toBeGreaterThan(500); // High throughput without lock failure
  });

  it('runs concurrent transactions without SQLITE_BUSY deadlocks', async () => {
    const promises = Array.from({ length: 30 }, async (_, i) => {
      return db.transaction(() => {
        const testSessionId = `sess-tx-${i}`;
        db.createSession({
          id: testSessionId,
          roomId: 'CONCURRENT-ROOM',
          name: `Tx Session ${i}`,
          startedAt: Date.now(),
          stoppedAt: null,
          baseTimecode: '01:00:00:00',
          framerateNumerator: 60,
          framerateDenominator: 1,
          dropFrame: false,
        });

        db.stopSession(testSessionId, Date.now() + 1000);
        return true;
      });
    });

    const results = await Promise.all(promises);
    expect(results.every((r) => r === true)).toBe(true);
  });
});
