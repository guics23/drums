import { TRACK_IDS, type Pattern, type Project, type TrackId } from '../types';
import { patternDuration, stepDuration, swingOffset } from './pattern';

export interface NoteEvent {
  time: number;
  trackId: TrackId;
  velocity: number;
}

export interface Timeline {
  events: NoteEvent[];
  /** Musical length in seconds (excluding effect tails). */
  duration: number;
}

/** The list of patterns to play, in order, for the given mode. */
export function resolveSequence(project: Project, mode: 'pattern' | 'song', patternId: string, loops = 1): Pattern[] {
  const byId = new Map(project.patterns.map((p) => [p.id, p]));
  let seq: Pattern[];
  if (mode === 'song') {
    seq = project.song.map((id) => byId.get(id)).filter((p): p is Pattern => !!p);
  } else {
    const p = byId.get(patternId);
    seq = p ? [p] : [];
  }
  const out: Pattern[] = [];
  for (let i = 0; i < Math.max(1, loops); i++) out.push(...seq);
  return out;
}

/** Whether a track should sound given mute/solo states. */
export function audibleTracks(project: Project): Set<TrackId> {
  const anySolo = project.tracks.some((t) => t.solo);
  return new Set(project.tracks.filter((t) => (anySolo ? t.solo : !t.mute)).map((t) => t.id));
}

/** Build every note of a sequence of patterns with absolute times starting at 0. */
export function buildTimeline(project: Project, sequence: Pattern[]): Timeline {
  const events: NoteEvent[] = [];
  const audible = audibleTracks(project);
  let t0 = 0;
  for (const p of sequence) {
    const d = stepDuration(project.bpm, p.subdivision);
    const count = p.beats * p.subdivision;
    for (let s = 0; s < count; s++) {
      const time = t0 + s * d + swingOffset(s, p.subdivision, d, project.swing);
      for (const id of TRACK_IDS) {
        const v = p.steps[id][s];
        if (v > 0 && audible.has(id)) events.push({ time, trackId: id, velocity: v });
      }
    }
    t0 += patternDuration(p, project.bpm);
  }
  return { events, duration: t0 };
}
