import { describe, it, expect } from 'vitest';
import {
  SMPTETimecode,
  STANDARD_FRAMERATES,
  DAVINCI_MARKER_COLORS,
  sessionSettingsSchema,
  exportToEdl,
  toResolveMarkerColor,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  formatYouTubeTimestamp,
  RecordingSession,
  SquadMarker,
} from '../src/index.js';

// Cases for the mutants Stryker still found alive in v1.6.2 (stryker.config.mjs, 60 s timeout).
//
// Mutants left alive on purpose, because no test can tell them apart from the real code:
// - timecode/index.ts: `ms <= 0` / `frames <= 0` -> `< 0` (0 gives 0 either way); `if (this.dropFrame)` ->
//   `true` in framesToTimecode / timecodeToFrames (without drop-frame, dropFramesPerMinute is 0 and adds
//   nothing); `m > D` -> `m >= D` (the extra term is D * floor(0 / ...) = 0); `> 1e-6` -> `>= 1e-6` (a
//   float tolerance, never hit exactly); the `framesPerTenMinutes` fields of STANDARD_FRAMERATES (the
//   table is only read for numerator / denominator / isDropFrameSupported; SMPTETimecode derives its own).
// - exporters/edl.ts: `/[\r\n|]+/` -> `/[\r\n|]/` (the next replace collapses the extra spaces); removing
//   'Blue' or 'Cream' from the Resolve color set (both still end as ResolveColorBlue / ResolveColorCream).
// - exporters/xml.ts: `.join('\n')` -> `.join('')` between <marker> elements (whitespace between XML
//   elements carries no data); `stoppedAt && startedAt` -> `||` / `true` (startedAt is an epoch time,
//   never 0, and a running session's negative duration is clamped to 0); `>` -> `>=` on the 5 s padding
//   (sets the same value); `|| ''` for an empty base timecode (it fails to parse and falls back to
//   01:00:00:00 like the original).
// - exporters/youtube.ts: the start value of lastTimeMs when no intro chapter was added, and the
//   `|| chapters.length === 0` clause (the first marker is always far enough from -minIntervalMs).
// - exporters/csv.ts: `typeof val === 'string'` -> `true` (no exported number is ever negative).
// - exporters/matrix.ts: `< 0.05` -> `<= 0.05` (float tolerance); the `anchors = []` default (any other
//   default is filtered out by session id). exporters/perMember.ts: `{ fps: 0 }` -> `{}` (both mean
//   "unknown fps").

const session = (overrides: Partial<RecordingSession> = {}): RecordingSession => ({
  id: 's1',
  roomId: 'r1',
  name: 'Scrim',
  startedAt: 1_000_000,
  stoppedAt: 1_000_000 + 600_000,
  baseTimecode: '01:00:00:00',
  framerateNumerator: 30,
  framerateDenominator: 1,
  dropFrame: false,
  ...overrides,
});

const marker = (overrides: Partial<SquadMarker>): SquadMarker => ({
  id: 'k',
  roomId: 'r1',
  sessionId: 's1',
  memberId: 'm',
  memberName: '',
  timestamp: 1_000_000,
  relativeTimeMs: 0,
  timecode: '',
  frameNumber: 0,
  category: 'kill',
  label: 'x',
  color: 'Red',
  ...overrides,
});

describe('SMPTE timecode parser and constructor', () => {
  const tc60 = new SMPTETimecode({ framerateNumerator: 60, framerateDenominator: 1 });

  it('accepts surrounding spaces but nothing else around a timecode', () => {
    expect(tc60.timecodeToFrames(' 01:00:00:00 ')).toBe(216_000);
    expect(() => tc60.timecodeToFrames('x01:00:00:00')).toThrow(/Invalid SMPTE timecode format/);
    expect(() => tc60.timecodeToFrames('01:00:00:00x')).toThrow(/Invalid SMPTE timecode format/);
    expect(() => tc60.timecodeToFrames('01:00:00:000')).toThrow(/Invalid SMPTE timecode format/);
  });

  it('names the dropped frames in the drop-frame error', () => {
    const df2997 = new SMPTETimecode({ framerateNumerator: 30000, framerateDenominator: 1001, dropFrame: true });
    const df5994 = new SMPTETimecode({ framerateNumerator: 60000, framerateDenominator: 1001, dropFrame: true });
    expect(() => df2997.timecodeToFrames('00:01:00;01')).toThrow('Frames 00 to 01 are dropped at minute 1');
    expect(() => df5994.timecodeToFrames('00:02:00;03')).toThrow('Frames 00 to 03 are dropped at minute 2');
  });

  it('defaults to 60 fps without drop-frame', () => {
    for (const tc of [new SMPTETimecode(), new SMPTETimecode({})]) {
      expect(tc.nominalFps).toBe(60);
      expect(tc.dropFrame).toBe(false);
      expect(tc.framesToTimecode(60)).toBe('00:00:01:00');
    }
  });

  it('only drops frames at 29.97 and 59.94, however the rate is written', () => {
    const film = new SMPTETimecode({ framerateNumerator: 24000, framerateDenominator: 1001, dropFrame: true });
    expect(film.dropFrame).toBe(false);
    expect(film.dropFramesPerMinute).toBe(0);
    expect(film.framesPerTenMinutes).toBe(24 * 600);
    // 120/2 is 60 fps exactly: an integer rate, so no drop-frame
    const sixty = new SMPTETimecode({ framerateNumerator: 120, framerateDenominator: 2, dropFrame: true });
    expect(sixty.dropFrame).toBe(false);
    expect(sixty.framesPerTenMinutes).toBe(36_000);
  });

  it('reports the exact rate and never returns negative times', () => {
    const ntsc = new SMPTETimecode({ framerateNumerator: 30000, framerateDenominator: 1001 });
    expect(ntsc.realFps).toBeCloseTo(29.97003, 5);
    expect(ntsc.framesToMilliseconds(-5)).toBe(0);
    expect(ntsc.millisecondsToFrames(-5)).toBe(0);
  });

  it('starts relative timecodes at 00:00:00:00 when no base is given', () => {
    expect(tc60.relativeMsToTimecode(1000)).toBe('00:00:01:00');
  });
});

describe('session framerate validation', () => {
  it('accepts drop-frame at 29.97 and 59.94 fps only', () => {
    const ntscDropFrame = new Set(['30000/1001', '60000/1001']);
    for (const rate of Object.values(STANDARD_FRAMERATES)) {
      const key = `${rate.numerator}/${rate.denominator}`;
      const result = sessionSettingsSchema.safeParse({
        framerateNumerator: rate.numerator,
        framerateDenominator: rate.denominator,
        dropFrame: true,
      });
      expect(result.success, key).toBe(ntscDropFrame.has(key));
      // Without drop-frame every standard rate is fine
      expect(
        sessionSettingsSchema.safeParse({ framerateNumerator: rate.numerator, framerateDenominator: rate.denominator })
          .success,
        key
      ).toBe(true);
    }
  });
});

describe('Resolve marker EDL details', () => {
  const markerNames = (edl: string) => [...edl.matchAll(/^ \|C:\w+ \|M:(.*) \|D:1\r$/gm)].map((m) => m[1]);

  it('turns separators and runs of spaces in marker text into single spaces', () => {
    const edl = exportToEdl(session(), [
      marker({ relativeTimeMs: 0, label: 'a|b' }),
      marker({ relativeTimeMs: 1000, label: 'a  b' }),
      marker({ relativeTimeMs: 2000, label: ' a ' }),
      marker({ relativeTimeMs: 3000, label: 'a\r\nb' }),
    ]);
    expect(markerNames(edl)).toEqual(['a b', 'a b', 'a', 'a b']);
  });

  it('keeps every StreamCollab color, and falls back to the category color', () => {
    for (const color of DAVINCI_MARKER_COLORS) {
      expect(toResolveMarkerColor(color)).toBe(color === 'White' ? 'ResolveColorCream' : `ResolveColor${color}`);
    }
    const edl = exportToEdl(session(), [
      marker({ category: 'wipe', color: undefined as unknown as 'Red' }),
      marker({ relativeTimeMs: 1000, category: 'funny', color: undefined as unknown as 'Red' }),
    ]);
    expect([...edl.matchAll(/\|C:(\w+) /g)].map((m) => m[1])).toEqual(['ResolveColorFuchsia', 'ResolveColorCyan']);
  });

  it('names an unnamed session and starts at 01:00:00:00 without a base timecode', () => {
    const edl = exportToEdl(session({ name: '', baseTimecode: '' }), [marker({})]);
    expect(edl).toMatch(/^TITLE: StreamCollab Session\r$/m);
    expect(edl).toContain('001  001      V     C        01:00:00:00 01:00:00:01');
  });
});

describe('FCP 7 XML details (v1.6.2)', () => {
  it('uses 1920 x 1080 unless told otherwise', () => {
    const plain = exportToFcpXml(session(), []);
    expect(plain).toContain('<width>1920</width>');
    expect(plain).toContain('<height>1080</height>');
    const custom = exportToFcpXml(session(), [], { width: 1280, height: 720 });
    expect(custom).toContain('<width>1280</width>');
    expect(custom).toContain('<height>720</height>');
  });

  it('names an unnamed sequence and keeps a non-default base timecode', () => {
    const xml = exportToFcpXml(session({ name: '', baseTimecode: '00:00:00:00' }), []);
    expect(xml).toContain('<name>StreamCollab Sequence</name>');
    expect(xml).toContain('<string>00:00:00:00</string>');
    expect(xml).toContain('<frame>0</frame>');
  });

  it('pads the sequence 5 s past a marker in the last seconds of the session', () => {
    // 10 min at 30 fps = 18000 frames; a marker at 598 s (frame 17940) needs 17940 + 150
    const xml = exportToFcpXml(session(), [marker({ relativeTimeMs: 598_000 })]);
    expect(xml).toContain('<duration>18090</duration>');
  });

  it('writes the author alone when a marker has no comment, and nothing without an author', () => {
    const xml = exportToFcpXml(session(), [
      marker({ relativeTimeMs: 0, memberName: 'Ana' }),
      marker({ relativeTimeMs: 1000, memberName: '' }),
    ]);
    expect([...xml.matchAll(/<comment>(.*)<\/comment>/g)].map((m) => m[1])).toEqual(['(By: Ana)', '']);
  });
});

describe('YouTube chapter details (v1.6.2)', () => {
  it('writes hours once a chapter is an hour or more in', () => {
    expect(formatYouTubeTimestamp(59_000)).toBe('00:59');
    expect(formatYouTubeTimestamp(3_600_000)).toBe('01:00:00');
    expect(formatYouTubeTimestamp(3_725_000)).toBe('01:02:05');
  });

  it('opens with a marker pressed in the first 2 s, inclusive', () => {
    const text = exportToYouTubeChapters(session(), [marker({ relativeTimeMs: 2000, label: 'Kill' })]);
    expect(text.split('\n')[0]).toBe('00:00 Kill');
  });

  it('keeps 10 s after the intro chapter too', () => {
    const text = exportToYouTubeChapters(session(), [
      marker({ relativeTimeMs: 5000, label: 'Early' }),
      marker({ relativeTimeMs: 20_000, label: 'Later' }),
    ]);
    expect(text.trimEnd().split('\n')).toEqual(['00:00 Start of Stream', '00:20 Later']);
  });

  it('puts multi-line titles on one line without edge spaces', () => {
    const text = exportToYouTubeChapters(session(), [marker({ relativeTimeMs: 0, label: ' Clutch\nplay ' })]);
    expect(text.split('\n')[0]).toBe('00:00 Clutch play');
  });
});

describe('CSV export details (v1.6.2)', () => {
  const firstRow = (csv: string) => csv.split('\r\n')[1].split(',');

  it('leaves fields missing in old database rows empty', () => {
    const row = firstRow(
      exportToCsv(session(), [marker({ memberName: undefined as unknown as string, color: null as unknown as 'Red' })])
    );
    expect(row[6]).toBe(''); // creator
    expect(row[9]).toBe(''); // color
  });

  it('writes drop-frame timecodes at the session rate', () => {
    const df = session({ framerateNumerator: 30000, framerateDenominator: 1001, dropFrame: true });
    const row = firstRow(exportToCsv(df, [marker({ relativeTimeMs: 60_000 })]));
    expect(row[2]).toBe('01:00:59;28');
    expect(row[3]).toBe('1798');
  });
});
