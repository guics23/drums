import {
  DELAY_DIVISIONS,
  MAX_BPM,
  MIN_BPM,
  TRACK_IDS,
  type Effects,
  type FilterType,
  type Pattern,
  type Project,
  type Track,
  type UserSample,
} from '../types';
import { clampBeats, emptySteps, isSubdivision, newId } from '../model/pattern';
import { createDefaultProject, defaultEffects, defaultTrack } from './defaults';

export const FILE_FORMAT = 'drums-project';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function num(x: unknown, fallback: number, min: number, max: number): number {
  const n = typeof x === 'number' ? x : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
const str = (x: unknown, fallback: string, max = 80) => (typeof x === 'string' ? x.slice(0, max) : fallback);

function normalizePattern(raw: unknown, index: number): Pattern | null {
  if (!isObj(raw)) return null;
  const beats = clampBeats(num(raw.beats, 4, 1, 1000));
  const subdivision = isSubdivision(raw.subdivision) ? raw.subdivision : 4;
  const count = beats * subdivision;
  const steps = emptySteps(count);
  const rawSteps = isObj(raw.steps) ? raw.steps : {};
  for (const id of TRACK_IDS) {
    const row = rawSteps[id];
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < count; i++) steps[id][i] = num(row[i], 0, 0, 1);
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('p'),
    name: str(raw.name, `Pattern ${index + 1}`, 40),
    beats,
    subdivision,
    steps,
  };
}

function normalizeTrack(raw: unknown, base: Track, samples: Record<string, UserSample>): Track {
  if (!isObj(raw)) return base;
  const sampleId = typeof raw.sampleId === 'string' && samples[raw.sampleId] ? raw.sampleId : null;
  return {
    ...base,
    name: str(raw.name, base.name, 30),
    volume: num(raw.volume, base.volume, 0, 1.5),
    pan: num(raw.pan, base.pan, -1, 1),
    pitch: num(raw.pitch, base.pitch, -12, 12),
    decay: num(raw.decay, base.decay, 0.05, 1),
    mute: bool(raw.mute, false),
    solo: bool(raw.solo, false),
    reverbSend: num(raw.reverbSend, base.reverbSend, 0, 1),
    delaySend: num(raw.delaySend, base.delaySend, 0, 1),
    sampleId,
  };
}

function normalizeEffects(raw: unknown): Effects {
  const d = defaultEffects();
  if (!isObj(raw)) return d;
  const r = isObj(raw.reverb) ? raw.reverb : {};
  const dl = isObj(raw.delay) ? raw.delay : {};
  const f = isObj(raw.filter) ? raw.filter : {};
  const c = isObj(raw.compressor) ? raw.compressor : {};
  const filterTypes: FilterType[] = ['lowpass', 'highpass', 'bandpass'];
  return {
    reverb: {
      enabled: bool(r.enabled, d.reverb.enabled),
      decay: num(r.decay, d.reverb.decay, 0.1, 8),
      preDelay: num(r.preDelay, d.reverb.preDelay, 0, 200),
      mix: num(r.mix, d.reverb.mix, 0, 1),
    },
    delay: {
      enabled: bool(dl.enabled, d.delay.enabled),
      division: DELAY_DIVISIONS.includes(dl.division as never) ? (dl.division as Effects['delay']['division']) : d.delay.division,
      feedback: num(dl.feedback, d.delay.feedback, 0, 0.95),
      tone: num(dl.tone, d.delay.tone, 200, 18000),
      mix: num(dl.mix, d.delay.mix, 0, 1),
    },
    filter: {
      enabled: bool(f.enabled, d.filter.enabled),
      type: filterTypes.includes(f.type as FilterType) ? (f.type as FilterType) : d.filter.type,
      frequency: num(f.frequency, d.filter.frequency, 20, 20000),
      q: num(f.q, d.filter.q, 0.1, 20),
    },
    compressor: {
      enabled: bool(c.enabled, d.compressor.enabled),
      threshold: num(c.threshold, d.compressor.threshold, -60, 0),
      ratio: num(c.ratio, d.compressor.ratio, 1, 20),
      attack: num(c.attack, d.compressor.attack, 0, 1),
      release: num(c.release, d.compressor.release, 0.01, 1),
      makeup: num(c.makeup, d.compressor.makeup, 0, 24),
    },
  };
}

/** Validate and repair arbitrary input into a complete Project. Throws if it is not a project at all. */
export function normalizeProject(input: unknown): Project {
  if (!isObj(input)) throw new Error('Not a project file');
  const raw = isObj(input.project) ? input.project : input;
  if (!Array.isArray(raw.patterns) || !Array.isArray(raw.tracks)) throw new Error('Not a project file');
  const def = createDefaultProject();

  const samples: Record<string, UserSample> = {};
  if (isObj(raw.samples)) {
    for (const [id, s] of Object.entries(raw.samples)) {
      if (isObj(s) && typeof s.data === 'string') {
        samples[id] = { name: str(s.name, 'sample', 120), mime: str(s.mime, 'audio/wav'), data: s.data };
      }
    }
  }

  const patterns: Pattern[] = [];
  const seen = new Set<string>();
  raw.patterns.forEach((p, i) => {
    const n = normalizePattern(p, i);
    if (!n) return;
    if (seen.has(n.id)) n.id = newId('p');
    seen.add(n.id);
    patterns.push(n);
  });
  if (patterns.length === 0) patterns.push(...def.patterns);

  const rawTracks = raw.tracks.filter(isObj);
  const tracks = TRACK_IDS.map((id) => normalizeTrack(rawTracks.find((t) => t.id === id), defaultTrack(id), samples));

  const ids = new Set(patterns.map((p) => p.id));
  const song = Array.isArray(raw.song) ? raw.song.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];

  return {
    version: 1,
    name: str(raw.name, 'Untitled', 60),
    bpm: num(raw.bpm, def.bpm, MIN_BPM, MAX_BPM),
    swing: num(raw.swing, 0, 0, 1),
    kitId: str(raw.kitId, def.kitId),
    masterVolume: num(raw.masterVolume, def.masterVolume, 0, 1.5),
    tracks,
    patterns,
    song,
    songLoop: bool(raw.songLoop, true),
    effects: normalizeEffects(raw.effects),
    samples,
  };
}

/** Samples actually referenced by tracks. */
export function usedSamples(project: Project): Record<string, UserSample> {
  const out: Record<string, UserSample> = {};
  for (const t of project.tracks) {
    if (t.sampleId && project.samples[t.sampleId]) out[t.sampleId] = project.samples[t.sampleId];
  }
  return out;
}

export function projectToJson(project: Project): string {
  return JSON.stringify({ format: FILE_FORMAT, project: { ...project, samples: usedSamples(project) } }, null, 1);
}

export function projectFromJson(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  return normalizeProject(parsed);
}
