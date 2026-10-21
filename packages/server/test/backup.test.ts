import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../src/db/database.js';
import { backupDatabase, defaultBackupPath } from '../src/backup.js';

describe('Hot database backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamcollab-backup-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('copies a live database, including writes still in the WAL', () => {
    const dbPath = path.join(dir, 'live.sqlite');
    const db = new DatabaseService(dbPath); // stays open, like the running server
    db.createRoom('BACK-UP01', 'Backed up room', null);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);

    const target = path.join(dir, 'copies', 'snapshot.sqlite');
    const result = backupDatabase(dbPath, target);
    expect(result.bytes).toBeGreaterThan(0);

    const restored = new DatabaseService(target);
    expect(restored.getRoom('BACK-UP01')?.name).toBe('Backed up room');
    restored.close();
    db.close();
  });

  it('never overwrites an existing file or invents a missing database', () => {
    const dbPath = path.join(dir, 'other.sqlite');
    new DatabaseService(dbPath).close();
    const target = path.join(dir, 'taken.sqlite');
    fs.writeFileSync(target, 'keep me');

    expect(() => backupDatabase(dbPath, target)).toThrow(/Refusing to overwrite/);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep me');
    expect(() => backupDatabase(path.join(dir, 'missing.sqlite'), path.join(dir, 'x.sqlite'))).toThrow(/not found/);
  });

  it('names default backups by timestamp next to the database', () => {
    const name = defaultBackupPath('/data/streamcollab.sqlite', new Date('2026-10-21T05:30:00.123Z'));
    expect(name.replace(/\\/g, '/')).toBe('/data/backups/streamcollab-2026-10-21T05-30-00.sqlite');
  });
});
