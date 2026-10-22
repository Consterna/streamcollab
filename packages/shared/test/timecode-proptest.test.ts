import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SMPTETimecode, STANDARD_FRAMERATES } from '../src/timecode/index.js';

describe('SMPTE Timecode Property-Based Tests (fast-check)', () => {
  describe('Bijectivity across all standard framerates', () => {
    Object.entries(STANDARD_FRAMERATES).forEach(([rateKey, spec]) => {
      it(`guarantees frames -> timecode -> frames bijectivity for ${rateKey} fps (NDF)`, () => {
        const tc = new SMPTETimecode({
          framerateNumerator: spec.numerator,
          framerateDenominator: spec.denominator,
          dropFrame: false,
        });

        const maxFramesIn24h = 24 * 3600 * spec.nominalFps - 1;

        fc.assert(
          fc.property(fc.integer({ min: 0, max: maxFramesIn24h }), (frame) => {
            const timecodeStr = tc.framesToTimecode(frame);
            const roundtripFrame = tc.timecodeToFrames(timecodeStr);
            return roundtripFrame === frame;
          }),
          { numRuns: 200 }
        );
      });

      if (spec.isDropFrameSupported) {
        it(`guarantees frames -> timecode -> frames bijectivity for ${rateKey} fps (DF)`, () => {
          const tc = new SMPTETimecode({
            framerateNumerator: spec.numerator,
            framerateDenominator: spec.denominator,
            dropFrame: true,
          });

          // In drop-frame, total frames in 24 hours
          // Each 10 min has spec.framesPerTenMinutes
          // 24 hours = 144 ten-minute blocks
          const maxFramesIn24h = 144 * spec.framesPerTenMinutes - 1;

          fc.assert(
            fc.property(fc.integer({ min: 0, max: maxFramesIn24h }), (frame) => {
              const timecodeStr = tc.framesToTimecode(frame);
              const roundtripFrame = tc.timecodeToFrames(timecodeStr);
              return roundtripFrame === frame;
            }),
            { numRuns: 300 }
          );
        });
      }
    });
  });

  describe('Drop frame minute boundaries & dropped frame validation', () => {
    const dropFrameConfigs = [
      { name: '29.97 DF', num: 30000, den: 1001, droppedCount: 2, nominal: 30 },
      { name: '59.94 DF', num: 60000, den: 1001, droppedCount: 4, nominal: 60 },
    ];

    dropFrameConfigs.forEach(({ name, num, den, droppedCount }) => {
      it(`enforces dropped frame exclusion on ${name} non-tenth minute marks`, () => {
        const tc = new SMPTETimecode({
          framerateNumerator: num,
          framerateDenominator: den,
          dropFrame: true,
        });

        // Test every minute 0 to 59
        for (let minute = 0; minute < 60; minute++) {
          const isTenthMinute = minute % 10 === 0;
          const mm = String(minute).padStart(2, '0');

          for (let droppedFrame = 0; droppedFrame < droppedCount; droppedFrame++) {
            const ff = String(droppedFrame).padStart(2, '0');
            const tcStr = `00:${mm}:00;${ff}`;

            if (isTenthMinute) {
              // At 10-minute marks, frames 00.. are NOT dropped!
              expect(() => tc.timecodeToFrames(tcStr)).not.toThrow();
            } else {
              // On non-tenth minute marks, frames 00..droppedCount-1 ARE dropped!
              expect(() => tc.timecodeToFrames(tcStr)).toThrowError(/Invalid drop-frame timecode/);
            }
          }
        }
      });

      it(`never produces invalid dropped frames when formatting random frames for ${name}`, () => {
        const tc = new SMPTETimecode({
          framerateNumerator: num,
          framerateDenominator: den,
          dropFrame: true,
        });

        const maxFramesIn24h = 144 * tc.framesPerTenMinutes;

        fc.assert(
          fc.property(fc.integer({ min: 0, max: maxFramesIn24h * 2 }), (frame) => {
            const tcStr = tc.framesToTimecode(frame);
            // It must parse back without throwing "Invalid drop-frame timecode"
            let parsed = -1;
            expect(() => {
              parsed = tc.timecodeToFrames(tcStr);
            }).not.toThrow();
            return parsed === frame % maxFramesIn24h;
          }),
          { numRuns: 500 }
        );
      });
    });
  });

  describe('24h Rollover and multi-day frame counts', () => {
    const tc60 = new SMPTETimecode({ framerateNumerator: 60, framerateDenominator: 1 });
    const framesPer24h = 24 * 3600 * 60; // 5,184,000 frames

    it('rolls over cleanly modulo 24 hours for arbitrary day offsets', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 0, max: framesPer24h - 1 }),
          (days, offsetFrames) => {
            const totalFrames = days * framesPer24h + offsetFrames;
            const tcRolled = tc60.framesToTimecode(totalFrames);
            const tcBase = tc60.framesToTimecode(offsetFrames);
            return tcRolled === tcBase;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('handles exactly 24:00:00:00 by rolling over to 00:00:00:00', () => {
      expect(tc60.framesToTimecode(framesPer24h)).toBe('00:00:00:00');
      expect(tc60.framesToTimecode(framesPer24h * 2)).toBe('00:00:00:00');
      expect(tc60.framesToTimecode(framesPer24h + 60)).toBe('00:00:01:00');
    });
  });

  describe('Sub-ms Rational Precision and Round-tripping', () => {
    Object.entries(STANDARD_FRAMERATES).forEach(([rateKey, spec]) => {
      it(`preserves rational bijection for framesToMilliseconds -> millisecondsToFrames on ${rateKey} fps`, () => {
        const tc = new SMPTETimecode({
          framerateNumerator: spec.numerator,
          framerateDenominator: spec.denominator,
        });

        fc.assert(
          fc.property(fc.integer({ min: 0, max: 500_000 }), (frame) => {
            const ms = tc.framesToMilliseconds(frame);
            const roundtrip = tc.millisecondsToFrames(ms);
            return roundtrip === frame;
          }),
          { numRuns: 200 }
        );
      });

      it(`tolerates sub-millisecond precision jitter on ${rateKey} fps`, () => {
        const tc = new SMPTETimecode({
          framerateNumerator: spec.numerator,
          framerateDenominator: spec.denominator,
        });

        const frameDurationMs = (spec.denominator * 1000) / spec.numerator;

        fc.assert(
          fc.property(
            fc.integer({ min: 0, max: 50_000 }),
            fc.double({ min: 0.0001, max: frameDurationMs * 0.4, noNaN: true }),
            (frame, jitter) => {
              const baseMs = tc.framesToMilliseconds(frame);
              const jitteredMs = baseMs + jitter;
              return tc.millisecondsToFrames(jitteredMs) === frame;
            }
          ),
          { numRuns: 150 }
        );
      });
    });
  });
});
