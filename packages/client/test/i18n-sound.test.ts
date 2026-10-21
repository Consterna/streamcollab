import { describe, it, expect, vi } from 'vitest';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { translate } from '../src/i18n';
import { HudSound, readHudSoundOptions, CATEGORY_TONES, DEFAULT_HUD_VOLUME } from '../src/services/sound';

describe('i18n dictionaries', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('Spanish has exactly the English keys, none empty', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('keeps the same {placeholders} in every translation', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(translate('es', 'dock.markersCaptured', { count: 3 })).toBe('3 marcadores registrados');
    expect(translate('en', 'dock.markersCaptured', { count: 3 })).toBe('3 markers captured');
    expect(translate('en', 'dash.room')).toBe('Room: {name}');
  });
});

describe('HUD sound', () => {
  it('reads ?sound and ?volume from the Browser Source URL', () => {
    expect(readHudSoundOptions('')).toEqual({ enabled: false, volume: DEFAULT_HUD_VOLUME });
    expect(readHudSoundOptions('?view=hud&sound=1')).toEqual({ enabled: true, volume: DEFAULT_HUD_VOLUME });
    expect(readHudSoundOptions('?sound=true&volume=0.25')).toEqual({ enabled: true, volume: 0.25 });
    expect(readHudSoundOptions('?sound=1&volume=7').volume).toBe(1);
    expect(readHudSoundOptions('?sound=1&volume=-2').volume).toBe(0);
    expect(readHudSoundOptions('?sound=1&volume=loud').volume).toBe(DEFAULT_HUD_VOLUME);
  });

  // Minimal Web Audio stand-in that records what gets scheduled
  function fakeContext() {
    const started: number[] = [];
    const peaks: number[] = [];
    const param = () => ({
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn((value: number) => peaks.push(value)),
    });
    const node = () => ({ connect: vi.fn((target: unknown) => target) });
    const ctx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createOscillator: () => ({
        ...node(),
        type: 'sine',
        frequency: param(),
        start: vi.fn((when: number) => started.push(when)),
        stop: vi.fn(),
      }),
      createGain: () => ({ ...node(), gain: param() }),
    };
    return { ctx: ctx as unknown as AudioContext, started, peaks };
  }

  it('plays one oscillator per note of the category cue, scaled by volume', () => {
    const { ctx, started, peaks } = fakeContext();
    const sound = new HudSound({ enabled: true, volume: 0.5 }, () => ctx);

    expect(sound.play('clutch')).toBe(true);
    expect(started).toHaveLength(CATEGORY_TONES.clutch.notes.length);
    expect(Math.max(...peaks)).toBeCloseTo(0.15); // 0.3 * volume
  });

  it('does nothing when disabled or muted, and survives missing Web Audio', () => {
    const factory = vi.fn(() => fakeContext().ctx);
    expect(new HudSound({ enabled: false, volume: 1 }, factory).play('kill')).toBe(false);
    expect(new HudSound({ enabled: true, volume: 0 }, factory).play('kill')).toBe(false);
    expect(factory).not.toHaveBeenCalled();

    const broken = new HudSound({ enabled: true, volume: 1 }, () => {
      throw new Error('AudioContext is not defined');
    });
    expect(broken.play('kill')).toBe(false);
  });
});
