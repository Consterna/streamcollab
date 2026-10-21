import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Empty strings from .env files / compose mean "not set"
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const booleanFlag = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : String(v).toLowerCase()),
  z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1')
);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_PATH: optionalString,
  CLIENT_DIST: optionalString,
  ALLOWED_ORIGIN: optionalString,
  ADMIN_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16, 'ADMIN_TOKEN must be at least 16 characters').optional()
  ),
  TRUST_PROXY: booleanFlag,
  ROOM_CREATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface ServerConfig {
  port: number;
  host: string;
  databasePath?: string;
  clientDist: string;
  allowedOrigins: string[];
  adminToken?: string;
  trustProxy: boolean;
  logLevel: string;
  roomCreateLimitPerMinute: number;
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));
// Same layout from src/ (tsx) and dist/ (compiled): packages/server/{src,dist} -> packages/client/dist
export const DEFAULT_CLIENT_DIST = path.resolve(serverDir, '../../client/dist');
const REPO_ROOT = path.resolve(serverDir, '../../..');

/** Parse a comma-separated env var like "https://a.com, https://b.com" */
export function parseOriginList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Validate the environment once at startup; fail fast with every problem listed */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid StreamCollab server configuration:\n${problems}`);
  }

  const e = parsed.data;
  const allowedOrigins = parseOriginList(e.ALLOWED_ORIGIN);
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new Error(
        `Invalid StreamCollab server configuration:\n  - ALLOWED_ORIGIN: "${origin}" must look like https://host[:port]`
      );
    }
  }

  return {
    port: e.PORT,
    host: e.HOST,
    databasePath: e.DATABASE_PATH,
    clientDist: e.CLIENT_DIST ? path.resolve(e.CLIENT_DIST) : DEFAULT_CLIENT_DIST,
    allowedOrigins,
    adminToken: e.ADMIN_TOKEN,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    roomCreateLimitPerMinute: e.ROOM_CREATE_LIMIT_PER_MINUTE,
  };
}

/** Load a .env file from the working directory or the repository root, if present (never overrides real env) */
export function loadDotEnv() {
  for (const candidate of [path.resolve(process.cwd(), '.env'), path.join(REPO_ROOT, '.env')]) {
    if (fs.existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return null;
}
