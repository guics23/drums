export const TRACK_IDS = [
  'kick',
  'snare',
  'clap',
  'rim',
  'chh',
  'ohh',
  'ltom',
  'mtom',
  'htom',
  'crash',
  'ride',
  'cowbell',
] as const;

export type TrackId = (typeof TRACK_IDS)[number];

export const TRACK_NAMES: Record<TrackId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  rim: 'Rim',
  chh: 'Closed Hat',
  ohh: 'Open Hat',
  ltom: 'Low Tom',
  mtom: 'Mid Tom',
  htom: 'High Tom',
  crash: 'Crash',
  ride: 'Ride',
  cowbell: 'Cowbell',
};

export const SUBDIVISIONS = [2, 3, 4, 6, 8, 12, 16, 32] as const;
export type Subdivision = (typeof SUBDIVISIONS)[number];

export const MIN_BEATS = 1;
export const MAX_BEATS = 16;
export const MIN_BPM = 30;
export const MAX_BPM = 300;

/** Velocity presets used by the grid. 0 means "no hit". */
export const VELOCITY = { soft: 0.4, normal: 0.75, accent: 1 } as const;

export interface Pattern {
  id: string;
  name: string;
  beats: number;
  subdivision: Subdivision;
  /** One array per track, length = beats * subdivision; values 0 (off) or 0..1 velocity. */
  steps: Record<TrackId, number[]>;
}

export interface Track {
  id: TrackId;
  name: string;
  /** Linear gain, 0..1.5 */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  /** Semitones, -12..12 */
  pitch: number;
  /** Fraction of the sample length to keep, 0.05..1 */
  decay: number;
  mute: boolean;
  solo: boolean;
  reverbSend: number;
  delaySend: number;
  /** Id of a user sample in project.samples, overriding the kit sound. */
  sampleId: string | null;
}

export type DelayDivision = '1/4' | '1/8' | '1/8d' | '1/8t' | '1/16' | '1/16d' | '1/16t';
export const DELAY_DIVISIONS: DelayDivision[] = ['1/4', '1/8', '1/8d', '1/8t', '1/16', '1/16d', '1/16t'];

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface Effects {
  reverb: { enabled: boolean; decay: number; preDelay: number; mix: number };
  delay: { enabled: boolean; division: DelayDivision; feedback: number; tone: number; mix: number };
  filter: { enabled: boolean; type: FilterType; frequency: number; q: number };
  compressor: {
    enabled: boolean;
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    makeup: number;
  };
}

export interface UserSample {
  name: string;
  mime: string;
  /** Base64 of the original file bytes. */
  data: string;
}

export interface Project {
  version: 1;
  name: string;
  bpm: number;
  /** 0 = straight, 1 = full triplet feel. Applies to even subdivisions only. */
  swing: number;
  kitId: string;
  masterVolume: number;
  tracks: Track[];
  patterns: Pattern[];
  /** Ordered list of pattern ids; the same id may appear many times. */
  song: string[];
  songLoop: boolean;
  effects: Effects;
  samples: Record<string, UserSample>;
}
