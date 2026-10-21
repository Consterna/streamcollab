import { z } from 'zod';

/**
 * Runtime validation for everything that crosses the network. The server parses every
 * WebSocket message and REST body with these before touching the database.
 */

export const LIMITS = {
  roomId: 40,
  roomName: 80,
  memberId: 64,
  memberName: 40,
  label: 80,
  comment: 280,
  sessionName: 120,
  tag: 32,
  tags: 10,
  token: 128,
  wsMessageBytes: 16 * 1024,
} as const;

export const MARKER_CATEGORIES = ['kill', 'wipe', 'clutch', 'funny', 'note', 'custom'] as const;

export const DAVINCI_MARKER_COLORS = [
  'Blue',
  'Cyan',
  'Green',
  'Yellow',
  'Red',
  'Pink',
  'Purple',
  'Fuchsia',
  'Rose',
  'Lavender',
  'Sky',
  'Mint',
  'Lemon',
  'Sand',
  'Cocoa',
  'White',
] as const;

export const CLIENT_KINDS = ['dock', 'hud', 'dashboard'] as const;

// Room codes double as join codes: letters, digits and dashes only
export const roomIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{3,40}$/, 'Room code must be 3-40 letters, digits or dashes');
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.memberId)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const text = (max: number) => z.string().trim().max(max);
const tokenSchema = z.string().min(16).max(LIMITS.token);
const epochMs = z.number().finite().nonnegative();
const timecodeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}[:;]\d{2}$/, 'Timecode must be HH:MM:SS:FF');
const positiveInt = z.number().int().positive().max(1_000_000);

export const markerCategorySchema = z.enum(MARKER_CATEGORIES);
export const markerColorSchema = z.enum(DAVINCI_MARKER_COLORS);
export const clientKindSchema = z.enum(CLIENT_KINDS);
export const obsStatusSchema = z.enum(['recording', 'streaming', 'paused', 'stopped', 'disconnected']);

export const joinMemberSchema = z.object({
  id: idSchema,
  name: text(LIMITS.memberName).min(1),
  avatarUrl: z.url().max(500).optional(),
  role: z.enum(['host', 'player', 'observer']).default('player'),
  obsStatus: obsStatusSchema.default('disconnected'),
  streamUrl: z.url().max(500).optional(),
  fps: z.number().positive().max(1000).default(60),
  outputDurationMs: epochMs.default(0),
  fpsNumerator: positiveInt.optional(),
  fpsDenominator: positiveInt.optional(),
  recordStartedAt: epochMs.nullable().optional(),
});

// Fields a dock may change about itself. Identity (id/name/role) is fixed at join time.
export const memberStatusSchema = z.object({
  obsStatus: obsStatusSchema.optional(),
  fps: z.number().positive().max(1000).optional(),
  fpsNumerator: positiveInt.optional(),
  fpsDenominator: positiveInt.optional(),
  outputDurationMs: epochMs.optional(),
  clockOffsetMs: z.number().finite().min(-86_400_000).max(86_400_000).optional(),
  rttMs: z.number().finite().nonnegative().max(60_000).optional(),
  recordStartedAt: epochMs.nullable().optional(),
});

export const markerInputSchema = z.object({
  category: markerCategorySchema,
  label: text(LIMITS.label).min(1),
  comment: text(LIMITS.comment).optional(),
  color: markerColorSchema.optional(),
  tags: z.array(text(LIMITS.tag).min(1)).max(LIMITS.tags).optional(),
  sessionId: z.string().max(64).optional(),
  obsRecordMs: epochMs.optional(),
});

export const sessionSettingsSchema = z.object({
  name: text(LIMITS.sessionName).optional(),
  baseTimecode: timecodeSchema.optional(),
  framerateNumerator: positiveInt.optional(),
  framerateDenominator: positiveInt.optional(),
  dropFrame: z.boolean().optional(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SNTP_PING'), payload: z.object({ t1: z.number().finite() }) }),
  z.object({
    type: z.literal('JOIN_ROOM'),
    payload: z.object({
      roomId: roomIdSchema,
      clientKind: clientKindSchema.default('dock'),
      member: joinMemberSchema.optional(),
      memberToken: tokenSchema.optional(),
      hostToken: tokenSchema.optional(),
    }),
  }),
  z.object({ type: z.literal('LEAVE_ROOM'), payload: z.unknown().optional() }),
  z.object({
    type: z.literal('UPDATE_STATUS'),
    payload: z.object({ roomId: roomIdSchema.optional(), memberId: z.string().optional(), status: memberStatusSchema }),
  }),
  z.object({
    type: z.literal('CREATE_MARKER'),
    payload: z.object({
      roomId: roomIdSchema.optional(),
      // memberId / memberName in the payload are ignored: the server uses the authenticated dock
      marker: markerInputSchema,
      clientTimestamp: epochMs.optional(),
    }),
  }),
  z.object({
    type: z.literal('START_SESSION'),
    payload: z.object({ roomId: roomIdSchema.optional(), session: sessionSettingsSchema }),
  }),
  z.object({
    type: z.literal('STOP_SESSION'),
    payload: z.object({ roomId: roomIdSchema.optional(), sessionId: z.string().max(64).optional() }),
  }),
]);

// REST bodies
export const createRoomBodySchema = z
  .object({
    id: roomIdSchema.optional(),
    name: text(LIMITS.roomName).min(1).optional(),
  })
  .default({});

export const quickMarkBodySchema = markerInputSchema.extend({
  memberId: idSchema,
});

export const stopSessionBodySchema = z.object({ sessionId: z.string().max(64).optional() }).default({});

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

/** Flatten a ZodError into one readable line for API / WebSocket error payloads */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
