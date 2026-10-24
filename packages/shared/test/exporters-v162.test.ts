import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { exportToEdl, exportToFcpXml, toResolveMarkerColor, RecordingSession, SquadMarker } from '../src/index.js';

const session: RecordingSession = {
  id: 's-golden',
  roomId: 'r-golden',
  name: 'Sesión final',
  startedAt: 1_700_000_000_000,
  stoppedAt: 1_700_000_600_000,
  baseTimecode: '00:00:00:00',
  framerateNumerator: 24,
  framerateDenominator: 1,
  dropFrame: false,
};

const marker = (overrides: Partial<SquadMarker>): SquadMarker => ({
  id: 'm',
  roomId: session.roomId,
  sessionId: session.id,
  memberId: 'mem',
  memberName: '',
  timestamp: session.startedAt,
  relativeTimeMs: 0,
  timecode: '',
  frameNumber: 0,
  category: 'note',
  label: 'x',
  color: 'Blue',
  ...overrides,
});

// Event line of a marker EDL, as DaVinci Resolve writes it in "Timeline Markers to EDL"
// (the same pattern SubtitleEdit uses to read those files)
const RESOLVE_EVENT_LINE =
  /^\d{1,6}\s+\S+\s+V\s+C\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s*$/;

describe('DaVinci Resolve marker EDL (v1.6.2)', () => {
  it('matches the layout of an EDL exported by Resolve itself, byte for byte', () => {
    const edl = exportToEdl(session, [
      marker({ id: 'a', relativeTimeMs: 4_709, label: 'Intro' }), // frame 113 = 00:00:04:17 at 24 fps
      marker({ id: 'b', relativeTimeMs: 76_209, label: 'Erklärung zu "Bomben"', color: 'Red' }),
    ]);
    expect(edl).toBe(
      [
        'TITLE: Sesion final',
        'FCM: NON-DROP FRAME',
        '',
        '001  001      V     C        00:00:04:17 00:00:04:18 00:00:04:17 00:00:04:18  ',
        ' |C:ResolveColorBlue |M:Intro |D:1',
        '',
        '002  001      V     C        00:01:16:05 00:01:16:06 00:01:16:05 00:01:16:06  ',
        ' |C:ResolveColorRed |M:Erklärung zu "Bomben" |D:1',
        '',
        '',
      ].join('\r\n')
    );
  });

  it('merges markers that land on the same frame (Resolve keeps one marker per frame)', () => {
    // 1000 ms and 1040 ms are both frame 24 at 24 fps; 1042 ms is frame 25
    const edl = exportToEdl(session, [
      marker({ id: 'b', relativeTimeMs: 1040, label: 'Second', memberName: 'Bravo', color: 'Red' }),
      marker({ id: 'a', relativeTimeMs: 1000, label: 'First', memberName: 'Alpha', color: 'Blue' }),
      marker({ id: 'c', relativeTimeMs: 1042, label: 'Third' }),
    ]);
    const lines = edl.split('\r\n');
    const fields = lines.filter((line) => line.startsWith(' |C:'));
    expect(fields).toEqual([
      ' |C:ResolveColorBlue |M:First [Alpha] / Second [Bravo] |D:1',
      ' |C:ResolveColorBlue |M:Third |D:1',
    ]);
    expect(lines.filter((line) => RESOLVE_EVENT_LINE.test(line)).map((line) => line.slice(0, 3))).toEqual([
      '001',
      '002',
    ]);
  });

  it('maps every StreamCollab color to one of the 16 Resolve marker colors', () => {
    expect(toResolveMarkerColor('Fuchsia')).toBe('ResolveColorFuchsia');
    expect(toResolveMarkerColor('Cocoa')).toBe('ResolveColorCocoa');
    // Resolve has no white marker
    expect(toResolveMarkerColor('White')).toBe('ResolveColorCream');
    expect(toResolveMarkerColor(undefined)).toBe('ResolveColorBlue');
    expect(toResolveMarkerColor('Orange')).toBe('ResolveColorBlue');
  });

  it('always produces one readable event + marker line pair per marker (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            relativeTimeMs: fc.integer({ min: 0, max: 20 * 3600 * 1000 }),
            label: fc.string({ minLength: 1, maxLength: 80 }),
            comment: fc.option(fc.string({ maxLength: 280 }), { nil: undefined }),
            memberName: fc.string({ maxLength: 40 }),
          }),
          { maxLength: 30 }
        ),
        fc.constantFrom(
          { num: 24, den: 1, df: false },
          { num: 30000, den: 1001, df: true },
          { num: 60000, den: 1001, df: true },
          { num: 25, den: 1, df: false }
        ),
        (inputs, rate) => {
          const edl = exportToEdl(
            { ...session, framerateNumerator: rate.num, framerateDenominator: rate.den, dropFrame: rate.df },
            inputs.map((input, i) => marker({ id: `p${i}`, ...input }))
          );
          const lines = edl.split('\r\n');
          expect(edl.match(/[^\r]\n/g)).toBeNull(); // CRLF only
          const events = lines.filter((line) => RESOLVE_EVENT_LINE.test(line));
          const fields = lines.filter((line) => line.startsWith(' |C:ResolveColor'));
          // One event per distinct frame (markers on the same frame are merged)
          const frames = new Set(
            inputs.map((input) => Math.floor((input.relativeTimeMs * rate.num) / (rate.den * 1000) + 1e-6))
          );
          expect(events).toHaveLength(frames.size);
          expect(fields).toHaveLength(frames.size);
          for (const line of fields) {
            expect(line).toMatch(/^ \|C:ResolveColor[A-Za-z]+ \|M:.* \|D:1$/);
            expect(line.split('|')).toHaveLength(4);
          }
          // Drop-frame timecodes use ';' before the frames, non-drop ':'
          for (const line of events) {
            const [, tcIn] = line.match(RESOLVE_EVENT_LINE)!;
            expect(tcIn[8]).toBe(rate.df ? ';' : ':');
          }
        }
      ),
      { numRuns: 150 }
    );
  });
});

describe('Final Cut Pro 7 XML (v1.6.2)', () => {
  it('writes the base timecode with the drop-frame separator of the session', () => {
    const xml = exportToFcpXml(
      {
        ...session,
        framerateNumerator: 30000,
        framerateDenominator: 1001,
        dropFrame: true,
        baseTimecode: '01:00:00:00',
      },
      []
    );
    expect(xml).toContain('<string>01:00:00;00</string>');
    expect(xml).toContain('<displayformat>DF</displayformat>');

    const ndf = exportToFcpXml({ ...session, baseTimecode: '01:00:00:00' }, []);
    expect(ndf).toContain('<string>01:00:00:00</string>');
  });
});
