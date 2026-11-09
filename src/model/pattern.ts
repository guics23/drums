import { MAX_BEATS, MIN_BEATS, SUBDIVISIONS, TRACK_IDS, type Pattern, type Subdivision, type TrackId } from '../types';

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter.toString(36)}`;
}

export function stepCount(p: Pick<Pattern, 'beats' | 'subdivision'>): number {
  return p.beats * p.subdivision;
}

export function emptySteps(count: number): Record<TrackId, number[]> {
  const steps = {} as Record<TrackId, number[]>;
  for (const id of TRACK_IDS) steps[id] = new Array<number>(count).fill(0);
  return steps;
}

export function createPattern(name: string, beats = 4, subdivision: Subdivision = 4): Pattern {
  return { id: newId('p'), name, beats, subdivision, steps: emptySteps(beats * subdivision) };
}

export function clampBeats(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(MAX_BEATS, Math.max(MIN_BEATS, Math.round(n)));
}

export function isSubdivision(n: unknown): n is Subdivision {
  return typeof n === 'number' && (SUBDIVISIONS as readonly number[]).includes(n);
}

/**
 * Return a copy of the pattern with a new beat count and/or subdivision.
 * Notes keep their musical position: each hit is moved to the nearest step of
 * the new grid (by time). Hits that fall beyond the new length are dropped.
 * When two hits collapse onto one step the louder one wins.
 */
export function resizePattern(p: Pattern, beats: number, subdivision: Subdivision): Pattern {
  beats = clampBeats(beats);
  const newCount = beats * subdivision;
  const steps = emptySteps(newCount);
  for (const id of TRACK_IDS) {
    const src = p.steps[id] ?? [];
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (!v) continue;
      const beatPos = i / p.subdivision;
      if (beatPos >= beats) continue;
      const j = Math.round(beatPos * subdivision);
      if (j >= newCount) continue;
      steps[id][j] = Math.max(steps[id][j], v);
    }
  }
  return { ...p, beats, subdivision, steps };
}

export function clonePattern(p: Pattern, name: string): Pattern {
  const steps = {} as Record<TrackId, number[]>;
  for (const id of TRACK_IDS) steps[id] = [...p.steps[id]];
  return { ...p, id: newId('p'), name, steps };
}

export function isPatternEmpty(p: Pattern): boolean {
  return TRACK_IDS.every((id) => p.steps[id].every((v) => !v));
}

/** Duration of one step in seconds. */
export function stepDuration(bpm: number, subdivision: number): number {
  return 60 / bpm / subdivision;
}

/**
 * Swing delay for a step, in seconds. Only even subdivisions swing: every odd
 * step is pushed later. swing=1 gives a full triplet feel (2:1).
 */
export function swingOffset(step: number, subdivision: number, stepDur: number, swing: number): number {
  if (swing <= 0 || subdivision % 2 !== 0 || step % 2 === 0) return 0;
  return (swing * stepDur) / 3;
}

/** Pattern length in seconds. */
export function patternDuration(p: Pick<Pattern, 'beats'>, bpm: number): number {
  return (p.beats * 60) / bpm;
}
