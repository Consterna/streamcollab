import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Dedicated port and throwaway database: the E2E run never touches a server you have open on :3000
const PORT = Number(process.env.E2E_PORT ?? 3210);
const DATA_DIR = path.resolve(process.cwd(), 'e2e', '.data');
// The config is evaluated again inside each test worker; only the main process (which owns the
// web server and its open database) may reset the data directory
if (!process.env.TEST_WORKER_INDEX) {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The compiled production server (API + WebSocket + client). Run `npm run build` first.
  webServer: {
    command: 'node packages/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(DATA_DIR, 'e2e.sqlite'),
      LOG_LEVEL: 'warn',
      // Every test creates its own room from the same IP
      ROOM_CREATE_LIMIT_PER_MINUTE: '500',
      MAX_SOCKETS_PER_IP: process.env.E2E_MAX_SOCKETS_PER_IP ?? '64',
    },
  },
});
