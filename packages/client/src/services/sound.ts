import type { MarkerCategory } from '@streamcollab/shared';

/**
 * Optional alert sounds for the HUD overlay, synthesized with the Web Audio API (no audio files).
 * Enabled per Browser Source with `?sound=1` and `&volume=0..1`; OBS captures the page audio
 * ("Control audio via OBS" in the source settings puts it on its own mixer channel).
 */
export interface HudSoundOptions {
  enabled: boolean;
  volume: number; // 0..1
}

export const DEFAULT_HUD_VOLUME = 0.6;

export function readHudSoundOptions(search: string): HudSoundOptions {
  const params = new URLSearchParams(search);
  const enabled = ['1', 'true', 'on', 'yes'].includes((params.get('sound') ?? '').toLowerCase());
  const raw = Number(params.get('volume'));
  const volume = params.has('volume') && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_HUD_VOLUME;
  return { enabled, volume };
}

interface Tone {
  wave: OscillatorType;
  // [frequency Hz, start offset s, duration s]
  notes: [number, number, number][];
}

// Short, distinct cues per category (all under 0.6 s so they don't step on game audio)
export const CATEGORY_TONES: Record<MarkerCategory, Tone> = {
  kill: {
    wave: 'square',
    notes: [
      [880, 0, 0.08],
      [1320, 0.09, 0.12],
    ],
  },
  wipe: {
    wave: 'sawtooth',
    notes: [
      [660, 0, 0.1],
      [523, 0.11, 0.1],
      [392, 0.22, 0.22],
    ],
  },
  clutch: {
    wave: 'triangle',
    notes: [
      [523, 0, 0.09],
      [659, 0.1, 0.09],
      [784, 0.2, 0.09],
      [1047, 0.3, 0.25],
    ],
  },
  funny: {
    wave: 'sine',
    notes: [
      [392, 0, 0.12],
      [587, 0.14, 0.12],
      [392, 0.28, 0.16],
    ],
  },
  note: { wave: 'sine', notes: [[740, 0, 0.18]] },
  custom: {
    wave: 'triangle',
    notes: [
      [600, 0, 0.12],
      [900, 0.13, 0.12],
    ],
  },
};

type AudioContextFactory = () => AudioContext;

export class HudSound {
  private context: AudioContext | null = null;

  constructor(
    private options: HudSoundOptions,
    private createContext: AudioContextFactory = () => new AudioContext()
  ) {}

  get enabled(): boolean {
    return this.options.enabled && this.options.volume > 0;
  }

  /** Play the cue for a category. Returns false when sound is disabled or unavailable. */
  play(category: MarkerCategory): boolean {
    if (!this.enabled) return false;
    try {
      this.context ??= this.createContext();
      const ctx = this.context;
      // Browsers start contexts suspended until a user gesture; OBS Browser Sources allow autoplay
      if (ctx.state === 'suspended') void ctx.resume();

      const tone = CATEGORY_TONES[category] ?? CATEGORY_TONES.note;
      const start = ctx.currentTime + 0.01;
      const peak = 0.3 * this.options.volume;

      for (const [frequency, offset, duration] of tone.notes) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(frequency, start + offset);
        // Quick attack and exponential release to avoid clicks
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(peak, start + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + duration + 0.02);
      }
      return true;
    } catch {
      return false; // no Web Audio support: the visual toast still shows
    }
  }

  close() {
    void this.context?.close();
    this.context = null;
  }
}
