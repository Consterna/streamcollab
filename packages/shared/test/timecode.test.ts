import { describe, it, expect } from 'vitest';
import { SMPTETimecode } from '../src/timecode/index.js';

describe('SMPTE Timecode Engine', () => {
  describe('60 fps Non-Drop Frame (NDF)', () => {
    const tc = new SMPTETimecode({ framerateNumerator: 60, framerateDenominator: 1 });

    it('calculates frame count for 0 ms', () => {
      expect(tc.millisecondsToFrames(0)).toBe(0);
      expect(tc.framesToTimecode(0)).toBe('00:00:00:00');
    });

    it('calculates frame count for 1000 ms (exactly 60 frames)', () => {
      expect(tc.millisecondsToFrames(1000)).toBe(60);
      expect(tc.framesToTimecode(60)).toBe('00:00:01:00');
      expect(tc.timecodeToFrames('00:00:01:00')).toBe(60);
    });

    it('calculates frame count for 1 minute (3600 frames)', () => {
      expect(tc.millisecondsToFrames(60000)).toBe(3600);
      expect(tc.framesToTimecode(3600)).toBe('00:01:00:00');
      expect(tc.timecodeToFrames('00:01:00:00')).toBe(3600);
    });

    it('calculates frame count for 1 hour (216000 frames)', () => {
      expect(tc.framesToTimecode(216000)).toBe('01:00:00:00');
      expect(tc.timecodeToFrames('01:00:00:00')).toBe(216000);
    });

    it('handles relative offset with base timecode', () => {
      const result = tc.relativeMsToTimecode(1500, '01:00:00:00');
      // 1.5s = 90 frames = 01 sec 30 frames
      expect(result).toBe('01:00:01:30');
    });
  });

  describe('29.97 fps Drop Frame (DF)', () => {
    const tc = new SMPTETimecode({
      framerateNumerator: 30000,
      framerateDenominator: 1001,
      dropFrame: true,
    });

    it('marks drop frame separator as semicolon (;)', () => {
      expect(tc.framesToTimecode(0)).toBe('00:00:00;00');
    });

    it('correctly drops 2 frames at the 1st minute mark', () => {
      // Nominal 1 minute is 30 * 60 = 1800 frames.
      // But in 29.97 DF, at minute 1:00;00, frames 00 and 01 are dropped,
      // so the first frame of minute 1 is 00:01:00;02.
      // Frame 1799 is 00:00:59;29
      expect(tc.framesToTimecode(1799)).toBe('00:00:59;29');
      // Frame 1800 jumps to 00:01:00;02!
      expect(tc.framesToTimecode(1800)).toBe('00:01:00;02');
      expect(tc.timecodeToFrames('00:01:00;02')).toBe(1800);
    });

    it('does NOT drop frames at 10-minute intervals', () => {
      // 10 minutes is exactly 17,982 frames in 29.97 DF
      expect(tc.framesToTimecode(17981)).toBe('00:09:59;29');
      // Frame 17,982 is exactly 00:10:00;00 (NO frames dropped at the 10th minute!)
      expect(tc.framesToTimecode(17982)).toBe('00:10:00;00');
      expect(tc.timecodeToFrames('00:10:00;00')).toBe(17982);
    });
  });

  describe('59.94 fps Drop Frame (DF)', () => {
    const tc = new SMPTETimecode({
      framerateNumerator: 60000,
      framerateDenominator: 1001,
      dropFrame: true,
    });

    it('drops 4 frames at minute 1:00', () => {
      // Frame 3599 is 00:00:59;59
      expect(tc.framesToTimecode(3599)).toBe('00:00:59;59');
      // Frame 3600 drops frames 00, 01, 02, 03 -> jumps to 00:01:00;04
      expect(tc.framesToTimecode(3600)).toBe('00:01:00;04');
      expect(tc.timecodeToFrames('00:01:00;04')).toBe(3600);
    });

    it('does NOT drop frames at 10-minute intervals for 59.94 DF', () => {
      // 10 minutes in 59.94 DF is 35,964 frames
      expect(tc.framesToTimecode(35963)).toBe('00:09:59;59');
      // At minute 10, no frames dropped: 00:10:00;00
      expect(tc.framesToTimecode(35964)).toBe('00:10:00;00');
      expect(tc.timecodeToFrames('00:10:00;00')).toBe(35964);
    });
  });

  describe('24 fps Cinematic & Edge Cases', () => {
    const tc = new SMPTETimecode({ framerateNumerator: 24, framerateDenominator: 1 });

    it('handles negative or 0 milliseconds gracefully', () => {
      expect(tc.millisecondsToFrames(-500)).toBe(0);
      expect(tc.framesToMilliseconds(0)).toBe(0);
    });

    it('throws descriptive error on malformed timecode input', () => {
      expect(() => tc.timecodeToFrames('invalid-timecode')).toThrowError(/Invalid SMPTE timecode format/);
    });
  });
});
