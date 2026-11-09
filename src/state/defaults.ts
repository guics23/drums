import { TRACK_IDS, TRACK_NAMES, type Effects, type Project, type Track, type TrackId } from '../types';
import { findPreset, patternFromPreset } from '../model/presets';
import { createPattern } from '../model/pattern';

const DEFAULT_PAN: Partial<Record<TrackId, number>> = {
  chh: 0.25,
  ohh: 0.25,
  ltom: -0.3,
  mtom: -0.1,
  htom: 0.15,
  crash: -0.35,
  ride: 0.35,
  cowbell: 0.2,
};

export function defaultTrack(id: TrackId): Track {
  return {
    id,
    name: TRACK_NAMES[id],
    volume: 0.8,
    pan: DEFAULT_PAN[id] ?? 0,
    pitch: 0,
    decay: 1,
    mute: false,
    solo: false,
    reverbSend: id === 'snare' || id === 'clap' ? 0.25 : 0.1,
    delaySend: 0,
    sampleId: null,
  };
}

export function defaultEffects(): Effects {
  return {
    reverb: { enabled: true, decay: 1.8, preDelay: 10, mix: 0.35 },
    delay: { enabled: false, division: '1/8d', feedback: 0.35, tone: 4500, mix: 0.3 },
    filter: { enabled: false, type: 'lowpass', frequency: 8000, q: 0.8 },
    compressor: { enabled: true, threshold: -14, ratio: 3, attack: 0.01, release: 0.2, makeup: 2 },
  };
}

export const DEFAULT_KIT = 'gm-rock';

export function createDefaultProject(): Project {
  const preset = findPreset('rock');
  const first = preset ? patternFromPreset(preset, 'P1') : createPattern('P1');
  return {
    version: 1,
    name: 'Untitled',
    bpm: preset?.bpm ?? 110,
    swing: 0,
    kitId: DEFAULT_KIT,
    masterVolume: 0.9,
    tracks: TRACK_IDS.map(defaultTrack),
    patterns: [first],
    song: [first.id],
    songLoop: true,
    effects: defaultEffects(),
    samples: {},
  };
}
