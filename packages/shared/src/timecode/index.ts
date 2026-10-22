export interface FramerateSpec {
  numerator: number;
  denominator: number;
  nominalFps: number;
  isDropFrameSupported: boolean;
  dropFramesPerMinute: number;
  framesPerTenMinutes: number;
}

export const STANDARD_FRAMERATES: Record<string, FramerateSpec> = {
  '24': {
    numerator: 24,
    denominator: 1,
    nominalFps: 24,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 24 * 60 * 10,
  },
  '23.976': {
    numerator: 24000,
    denominator: 1001,
    nominalFps: 24,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 24 * 60 * 10,
  },
  '25': {
    numerator: 25,
    denominator: 1,
    nominalFps: 25,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 25 * 60 * 10,
  },
  '29.97': {
    numerator: 30000,
    denominator: 1001,
    nominalFps: 30,
    isDropFrameSupported: true,
    dropFramesPerMinute: 2,
    framesPerTenMinutes: 17982, // 18000 - 18
  },
  '30': {
    numerator: 30,
    denominator: 1,
    nominalFps: 30,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 30 * 60 * 10,
  },
  '50': {
    numerator: 50,
    denominator: 1,
    nominalFps: 50,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 50 * 60 * 10,
  },
  '59.94': {
    numerator: 60000,
    denominator: 1001,
    nominalFps: 60,
    isDropFrameSupported: true,
    dropFramesPerMinute: 4,
    framesPerTenMinutes: 35964, // 36000 - 36
  },
  '60': {
    numerator: 60,
    denominator: 1,
    nominalFps: 60,
    isDropFrameSupported: false,
    dropFramesPerMinute: 0,
    framesPerTenMinutes: 60 * 60 * 10,
  },
};

export interface TimecodeOptions {
  framerateNumerator?: number;
  framerateDenominator?: number;
  dropFrame?: boolean;
}

export class SMPTETimecode {
  readonly numerator: number;
  readonly denominator: number;
  readonly nominalFps: number;
  readonly dropFrame: boolean;
  readonly dropFramesPerMinute: number;
  readonly framesPerTenMinutes: number;

  constructor(options?: TimecodeOptions) {
    const num = options?.framerateNumerator ?? 60;
    const den = options?.framerateDenominator ?? 1;
    this.numerator = num;
    this.denominator = den;
    this.nominalFps = Math.round(num / den);

    // Drop-frame only exists for the NTSC rates (29.97 / 59.94): an integer 30 or 60 fps never drops frames
    const isNtscRate = Math.abs(num / den - this.nominalFps) > 1e-6;
    if (options?.dropFrame && isNtscRate) {
      if (this.nominalFps === 30) {
        this.dropFrame = true;
        this.dropFramesPerMinute = 2;
        this.framesPerTenMinutes = 17982;
      } else if (this.nominalFps === 60) {
        this.dropFrame = true;
        this.dropFramesPerMinute = 4;
        this.framesPerTenMinutes = 35964;
      } else {
        // Drop-frame only defined for 29.97 / 59.94
        this.dropFrame = false;
        this.dropFramesPerMinute = 0;
        this.framesPerTenMinutes = this.nominalFps * 600;
      }
    } else {
      this.dropFrame = false;
      this.dropFramesPerMinute = 0;
      this.framesPerTenMinutes = this.nominalFps * 600;
    }
  }

  get realFps(): number {
    return this.numerator / this.denominator;
  }

  /**
   * Convert elapsed milliseconds into total frame count using rational arithmetic
   */
  millisecondsToFrames(ms: number): number {
    if (ms <= 0) return 0;
    // Rational frame calculation with epsilon protection against IEEE 754 precision issues
    return Math.floor((ms * this.numerator) / (this.denominator * 1000) + 1e-6);
  }

  /**
   * Convert total frame count to elapsed milliseconds using rational arithmetic
   */
  framesToMilliseconds(frames: number): number {
    if (frames <= 0) return 0;
    return (frames * this.denominator * 1000) / this.numerator;
  }

  /**
   * Convert frame count to SMPTE Timecode string (HH:MM:SS:FF or HH:MM:SS;FF)
   */
  framesToTimecode(totalFrames: number): string {
    let f = Math.max(0, Math.floor(totalFrames));

    if (this.dropFrame) {
      const D = this.dropFramesPerMinute;
      const M = this.framesPerTenMinutes;

      const d = Math.floor(f / M);
      const m = f % M;

      if (m > D) {
        f += D * 9 * d + D * Math.floor((m - D) / (this.nominalFps * 60 - D));
      } else {
        f += D * 9 * d;
      }
    }

    const framesPerSec = this.nominalFps;
    const framesPerMin = framesPerSec * 60;
    const framesPerHour = framesPerMin * 60;

    const hours = Math.floor(f / framesPerHour);
    f %= framesPerHour;

    const minutes = Math.floor(f / framesPerMin);
    f %= framesPerMin;

    const seconds = Math.floor(f / framesPerSec);
    const frame = f % framesPerSec;

    const separator = this.dropFrame ? ';' : ':';
    const hh = String(hours % 24).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const ff = String(frame).padStart(2, '0');

    return `${hh}:${mm}:${ss}${separator}${ff}`;
  }

  /**
   * Parse SMPTE timecode string into absolute frame number
   */
  timecodeToFrames(tc: string): number {
    const match = tc.trim().match(/^(\d{2}):(\d{2}):(\d{2})[:;.](\d{2})$/);
    if (!match) {
      throw new Error(`Invalid SMPTE timecode format: "${tc}". Expected HH:MM:SS:FF or HH:MM:SS;FF`);
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const frames = parseInt(match[4], 10);

    const totalMinutes = hours * 60 + minutes;

    if (this.dropFrame) {
      if (totalMinutes % 10 !== 0 && seconds === 0 && frames < this.dropFramesPerMinute) {
        throw new Error(
          `Invalid drop-frame timecode: "${tc}". Frames 00 to 0${this.dropFramesPerMinute - 1} are dropped at minute ${minutes}`
        );
      }
      const dropFrames = this.dropFramesPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
      return (totalMinutes * 60 + seconds) * this.nominalFps + frames - dropFrames;
    }

    return hours * 3600 * this.nominalFps + minutes * 60 * this.nominalFps + seconds * this.nominalFps + frames;
  }

  /**
   * Add base timecode offset to elapsed milliseconds
   */
  relativeMsToTimecode(relativeMs: number, baseTimecode: string = '00:00:00:00'): string {
    const baseFrames = this.timecodeToFrames(baseTimecode);
    const elapsedFrames = this.millisecondsToFrames(relativeMs);
    return this.framesToTimecode(baseFrames + elapsedFrames);
  }
}
