import type { TrackId } from '../types';
import type { InstrumentSpec, Layer } from './synth';

export interface SynthKitDef {
  id: string;
  name: string;
  description: string;
  demo: string;
  sounds: Record<TrackId, InstrumentSpec>;
}

const osc = (wave: OscillatorType, freq: number, decay: number, gain = 1, extra: Partial<Layer> = {}): Layer =>
  ({ type: 'osc', wave, freq, decay, gain, ...extra }) as Layer;
const noise = (decay: number, gain: number, filters: Layer['filters'], extra: Partial<Layer> = {}): Layer =>
  ({ type: 'noise', decay, gain, filters, ...extra }) as Layer;
const metal = (freq: number, decay: number, gain: number, filters: Layer['filters']): Layer => ({
  type: 'metal',
  freq,
  decay,
  gain,
  filters,
});
const bp = (freq: number, q = 1) => ({ type: 'bandpass' as const, freq, q });
const hp = (freq: number, q = 0.7) => ({ type: 'highpass' as const, freq, q });
const lp = (freq: number, q = 0.7) => ({ type: 'lowpass' as const, freq, q });

function tom(freq: number, decay: number, wave: OscillatorType = 'sine', noiseGain = 0.15): InstrumentSpec {
  return {
    length: decay + 0.2,
    layers: [
      osc(wave, freq * 1.4, decay, 1, { endFreq: freq, pitchDecay: 0.08 }),
      noise(0.04, noiseGain, [bp(freq * 6, 1)]),
    ],
  };
}

const analog: SynthKitDef = {
  id: 'synth-analog',
  name: 'Analog Boom',
  description: 'Warm 808-style synthesized drums',
  demo: 'hiphop',
  sounds: {
    kick: { length: 1.2, layers: [osc('sine', 150, 1.0, 1, { endFreq: 47, pitchDecay: 0.09 })], post: { drive: 0.15 } },
    snare: {
      length: 0.4,
      layers: [osc('triangle', 185, 0.12, 0.7), osc('triangle', 330, 0.08, 0.4), noise(0.2, 0.8, [hp(1800)])],
    },
    clap: { length: 0.5, layers: [noise(0.28, 1, [bp(1100, 1.4)], { bursts: { count: 3, spacing: 0.011, decay: 0.009 } })] },
    rim: { length: 0.12, layers: [osc('triangle', 1700, 0.025, 0.7), osc('sine', 460, 0.04, 0.6)], post: { highpass: 300 } },
    chh: { length: 0.15, level: 0.6, layers: [metal(40, 0.05, 1, [bp(10000, 1), hp(7000)])] },
    ohh: { length: 0.7, level: 0.6, layers: [metal(40, 0.4, 1, [bp(10000, 1), hp(7000)])] },
    ltom: tom(80, 0.45),
    mtom: tom(120, 0.4),
    htom: tom(170, 0.35),
    crash: { length: 2, level: 0.6, layers: [metal(42, 1.6, 1, [bp(8000, 0.6), hp(5000)]), noise(1.4, 0.4, [hp(6000)])] },
    ride: { length: 1.6, level: 0.5, layers: [metal(60, 1.3, 1, [bp(6000, 2), hp(3500)])] },
    cowbell: {
      length: 0.4,
      level: 0.6,
      layers: [osc('square', 540, 0.3, 0.6, { filters: [bp(2640, 1)] }), osc('square', 800, 0.3, 0.6, { filters: [bp(2640, 1)] })],
    },
  },
};

const punch: SynthKitDef = {
  id: 'synth-punch',
  name: 'Punch Machine',
  description: '909-style punchy house and techno kit',
  demo: 'house',
  sounds: {
    kick: {
      length: 0.6,
      layers: [osc('sine', 260, 0.5, 1, { endFreq: 52, pitchDecay: 0.045 }), noise(0.006, 0.5, [lp(4000)])],
      post: { drive: 0.4 },
    },
    snare: {
      length: 0.35,
      layers: [
        osc('triangle', 190, 0.09, 0.6, { endFreq: 170, pitchDecay: 0.05 }),
        osc('triangle', 340, 0.06, 0.4),
        noise(0.22, 1, [hp(2000), lp(10000)]),
      ],
    },
    clap: { length: 0.45, layers: [noise(0.22, 1, [bp(1500, 1.2)], { bursts: { count: 4, spacing: 0.009, decay: 0.007 } })] },
    rim: { length: 0.1, layers: [osc('square', 1900, 0.02, 0.5, { filters: [bp(2200, 3)] }), osc('triangle', 520, 0.03, 0.5)] },
    chh: { length: 0.12, level: 0.55, layers: [metal(48, 0.04, 0.7, [hp(8500)]), noise(0.04, 0.5, [hp(9000)])] },
    ohh: { length: 0.6, level: 0.55, layers: [metal(48, 0.32, 0.7, [hp(8000)]), noise(0.3, 0.5, [hp(9000)])] },
    ltom: tom(90, 0.35, 'sine', 0.3),
    mtom: tom(135, 0.3, 'sine', 0.3),
    htom: tom(190, 0.25, 'sine', 0.3),
    crash: { length: 2, level: 0.55, layers: [noise(1.5, 1, [hp(5000)]), metal(52, 1, 0.5, [hp(6000)])] },
    ride: { length: 1.6, level: 0.45, layers: [metal(64, 1.2, 1, [bp(7000, 1.5), hp(4500)]), noise(0.8, 0.2, [hp(8000)])] },
    cowbell: { length: 0.3, level: 0.55, layers: [osc('square', 587, 0.2, 0.6, { filters: [bp(2000, 1)] }), osc('square', 845, 0.2, 0.6, { filters: [bp(2000, 1)] })] },
  },
};

const lofiPost = { lowpass: 5500, crush: { bits: 8, hold: 3 }, drive: 0.3 };
const lofi: SynthKitDef = {
  id: 'synth-lofi',
  name: 'Lo-Fi Dust',
  description: 'Crunchy, bit-crushed boom-bap kit',
  demo: 'boombap',
  sounds: {
    kick: { length: 0.5, layers: [osc('sine', 120, 0.38, 1, { endFreq: 50, pitchDecay: 0.06 }), noise(0.01, 0.3, [lp(1500)])], post: lofiPost },
    snare: { length: 0.35, layers: [osc('triangle', 210, 0.08, 0.6), noise(0.18, 1, [bp(3000, 0.6)])], post: lofiPost },
    clap: { length: 0.4, layers: [noise(0.2, 1, [bp(1300, 1)], { bursts: { count: 3, spacing: 0.012, decay: 0.009 } })], post: lofiPost },
    rim: { length: 0.1, layers: [osc('triangle', 1500, 0.03, 0.8), noise(0.01, 0.3, [bp(3000, 2)])], post: lofiPost },
    chh: { length: 0.12, level: 0.5, layers: [noise(0.045, 1, [hp(6000), bp(9000, 1)])], post: lofiPost },
    ohh: { length: 0.5, level: 0.5, layers: [noise(0.3, 1, [hp(6000), bp(9000, 1)])], post: lofiPost },
    ltom: { ...tom(85, 0.35), post: lofiPost },
    mtom: { ...tom(125, 0.3), post: lofiPost },
    htom: { ...tom(170, 0.28), post: lofiPost },
    crash: { length: 1.6, level: 0.5, layers: [noise(1.3, 1, [hp(4000)])], post: lofiPost },
    ride: { length: 1.2, level: 0.45, layers: [metal(58, 0.9, 0.8, [bp(5500, 2)]), noise(0.5, 0.2, [hp(7000)])], post: lofiPost },
    cowbell: { length: 0.3, level: 0.5, layers: [osc('square', 560, 0.2, 0.6, { filters: [bp(2400, 1)] }), osc('square', 830, 0.2, 0.6)], post: lofiPost },
  },
};

const electro: SynthKitDef = {
  id: 'synth-electro',
  name: 'Electro Minimal',
  description: 'Tight, clicky electronic sounds',
  demo: 'electro',
  sounds: {
    kick: { length: 0.35, layers: [osc('sine', 380, 0.25, 1, { endFreq: 58, pitchDecay: 0.025 }), osc('square', 1200, 0.004, 0.3)] },
    snare: { length: 0.25, layers: [noise(0.12, 1, [bp(2500, 0.8)]), osc('sine', 240, 0.05, 0.5)] },
    clap: { length: 0.3, layers: [noise(0.12, 1, [bp(1800, 2)], { bursts: { count: 2, spacing: 0.008, decay: 0.006 } })] },
    rim: { length: 0.06, layers: [osc('square', 2400, 0.012, 0.6, { filters: [bp(2400, 4)] })] },
    chh: { length: 0.06, level: 0.5, layers: [noise(0.02, 1, [hp(10000)])] },
    ohh: { length: 0.35, level: 0.5, layers: [noise(0.18, 1, [hp(9000)])] },
    ltom: tom(100, 0.18, 'triangle', 0),
    mtom: tom(150, 0.15, 'triangle', 0),
    htom: tom(220, 0.12, 'triangle', 0),
    crash: { length: 1.2, level: 0.45, layers: [noise(0.9, 1, [hp(7000)])] },
    ride: { length: 0.8, level: 0.4, layers: [osc('square', 3200, 0.5, 0.4, { filters: [bp(5000, 4)] }), noise(0.4, 0.3, [hp(9000)])] },
    cowbell: { length: 0.2, level: 0.5, layers: [osc('square', 700, 0.12, 0.6, { filters: [bp(1800, 2)] })] },
  },
};

export const SYNTH_KITS: SynthKitDef[] = [analog, punch, lofi, electro];
