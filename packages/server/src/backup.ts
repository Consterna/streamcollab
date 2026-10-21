import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, loadDotEnv } from './config.js';

/**
 * Hot backup of the SQLite database while the server keeps running.
 *
 * `VACUUM INTO` copies a consistent snapshot (including data still in the WAL) into a new,
 * compacted file, through its own read connection, so live writers are not blocked.
 */
export function backupDatabase(sourcePath: string, destinationPath: string): { path: string; bytes: number } {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database not found: ${sourcePath}`);
  }
  if (fs.existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite existing file: ${destinationPath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    source.close();
  }

  // Never hand back a backup that SQLite itself doesn't consider sound
  const copy = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') {
      throw new Error(`Backup failed integrity check: ${check.integrity_check}`);
    }
  } finally {
    copy.close();
  }

  return { path: destinationPath, bytes: fs.statSync(destinationPath).size };
}

/** e.g. backups/streamcollab-2026-10-21T05-30-00.sqlite next to the database */
export function defaultBackupPath(databasePath: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/:/g, '-');
  return path.join(path.dirname(databasePath), 'backups', `streamcollab-${stamp}.sqlite`);
}

function main() {
  loadDotEnv();
  const config = loadConfig();
  const databasePath = path.resolve(config.databasePath ?? 'streamcollab.sqlite');
  const destination = path.resolve(process.argv[2] ?? defaultBackupPath(databasePath));
  const result = backupDatabase(databasePath, destination);
  console.log(`Backup written: ${result.path} (${(result.bytes / 1024).toFixed(1)} KiB)`);
}

// Run when executed directly: `npm run backup [-- <destination>]`
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
