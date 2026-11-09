import { describe, expect, it } from 'vitest';
import { TRACK_IDS, type Project } from './types';
import { createPattern, resizePattern, stepCount, stepDuration, swingOffset, clonePattern, isPatternEmpty } from './model/pattern';
import { buildTimeline, resolveSequence, audibleTracks } from './model/timeline';
import { PRESETS, parseRow, patternFromPreset } from './model/presets';
import { TapTempo } from './model/tapTempo';
import { encodeWav } from './audio/wav';
import { parseSoundSpec, pickLayer } from './audio/kits';
import { delaySeconds, dbToGain } from './audio/engine';
import { createDefaultProject } from './state/defaults';
import { normalizeProject, projectFromJson, projectToJson } from './state/serialize';
import { Store } from './state/store';

function project(): Project {
  const p = createDefaultProject();
  p.bpm = 120;
  p.effects.reverb.enabled = false;
  return p;
}

describe('patterns', () => {
  it('defaults to 4 beats × 4 subdivisions', () => {
    const p = createPattern('P1');
    expect(p.beats).toBe(4);
    expect(p.subdivision).toBe(4);
    for (const id of TRACK_IDS) expect(p.steps[id]).toHaveLength(16);
  });

  it('keeps notes at their musical position when changing subdivision', () => {
    const p = createPattern('P', 4, 4);
    p.steps.kick[0] = 1; // beat 1
    p.steps.kick[4] = 0.75; // beat 2
    p.steps.snare[2] = 0.5; // beat 1 "and"
    const r = resizePattern(p, 4, 8);
    expect(stepCount(r)).toBe(32);
    expect(r.steps.kick[0]).toBe(1);
    expect(r.steps.kick[8]).toBe(0.75);
    expect(r.steps.snare[4]).toBe(0.5);
  });

  it('moves notes to the nearest step in a triplet grid, louder note wins collisions', () => {
    const p = createPattern('P', 1, 4);
    p.steps.chh = [0.5, 0.4, 0.9, 0.3];
    const r = resizePattern(p, 1, 2);
    // grid positions 0, 0.5, 1, 1.5 → steps 0, 1, 1 (louder wins), 2 (beyond length, dropped)
    expect(r.steps.chh).toEqual([0.5, 0.9]);
  });

  it('drops notes beyond the new length and pads when growing', () => {
    const p = createPattern('P', 4, 4);
    p.steps.kick[15] = 1;
    expect(resizePattern(p, 3, 4).steps.kick.every((v) => v === 0)).toBe(true);
    const g = resizePattern(p, 8, 4);
    expect(g.steps.kick).toHaveLength(32);
    expect(g.steps.kick[15]).toBe(1);
  });

  it('clamps beats', () => {
    const p = createPattern('P');
    expect(resizePattern(p, 0, 4).beats).toBe(1);
    expect(resizePattern(p, 99, 4).beats).toBe(16);
  });

  it('clones independently', () => {
    const p = createPattern('P');
    const c = clonePattern(p, 'C');
    c.steps.kick[0] = 1;
    expect(p.steps.kick[0]).toBe(0);
    expect(c.id).not.toBe(p.id);
    expect(isPatternEmpty(p)).toBe(true);
  });

  it('computes step durations and swing', () => {
    expect(stepDuration(120, 4)).toBeCloseTo(0.125);
    const d = 0.125;
    expect(swingOffset(0, 4, d, 1)).toBe(0);
    expect(swingOffset(1, 4, d, 1)).toBeCloseTo(d / 3); // 2:1 triplet feel
    expect(swingOffset(1, 3, d, 1)).toBe(0); // odd subdivisions don't swing
    expect(swingOffset(1, 4, d, 0)).toBe(0);
  });
});

describe('presets', () => {
  it('parses rows ignoring separators', () => {
    expect(parseRow('x.X o|..', 6)).toEqual([0.75, 0, 1, 0.4, 0, 0]);
  });
  it('every preset matches its declared length', () => {
    for (const def of PRESETS) {
      const len = def.beats * def.subdivision;
      for (const row of Object.values(def.rows)) expect(row!.replace(/[\s|]/g, '').length, def.id).toBe(len);
      expect(isPatternEmpty(patternFromPreset(def))).toBe(false);
    }
  });
});

describe('timeline', () => {
  it('builds a song with repeated patterns', () => {
    const proj = project();
    const p1 = createPattern('P1', 4, 4);
    p1.steps.kick[0] = 1;
    const p2 = createPattern('P2', 2, 3);
    p2.steps.snare[1] = 0.5;
    proj.patterns = [p1, p2];
    proj.song = [p1.id, p1.id, p2.id, p1.id];
    const seq = resolveSequence(proj, 'song', p1.id);
    expect(seq.map((p) => p.name)).toEqual(['P1', 'P1', 'P2', 'P1']);
    const tl = buildTimeline(proj, seq);
    // 4 + 4 + 2 + 4 beats at 120 BPM
    expect(tl.duration).toBeCloseTo(7);
    expect(tl.events.filter((e) => e.trackId === 'kick').map((e) => e.time)).toEqual([0, 2, 5]);
    const snare = tl.events.find((e) => e.trackId === 'snare')!;
    expect(snare.time).toBeCloseTo(4 + 0.5 / 3);
    expect(snare.velocity).toBe(0.5);
  });

  it('repeats the current pattern for loops', () => {
    const proj = project();
    expect(resolveSequence(proj, 'pattern', proj.patterns[0].id, 3)).toHaveLength(3);
  });

  it('skips missing song entries and respects mute/solo', () => {
    const proj = project();
    proj.song = ['nope', proj.patterns[0].id];
    expect(resolveSequence(proj, 'song', '')).toHaveLength(1);
    proj.tracks.find((t) => t.id === 'kick')!.mute = true;
    expect(audibleTracks(proj).has('kick')).toBe(false);
    proj.tracks.find((t) => t.id === 'snare')!.solo = true;
    expect([...audibleTracks(proj)]).toEqual(['snare']);
    const tl = buildTimeline(proj, resolveSequence(proj, 'song', ''));
    expect(tl.events.every((e) => e.trackId === 'snare')).toBe(true);
  });
});

describe('wav encoder', () => {
  it('writes a valid 16-bit stereo header and clamps samples', () => {
    const buf = encodeWav([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, 0, 0, -2])], 44100, 16);
    const v = new DataView(buf);
    const str = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16);
    expect(buf.byteLength).toBe(44 + 16);
    expect(v.getInt16(44 + 4, true)).toBe(32767); // L[1] = 1
    expect(v.getInt16(44 + 8, true)).toBe(-32768); // L[2] = -1
    expect(v.getInt16(44 + 12, true)).toBe(32767); // L[3] clamped
    expect(v.getInt16(44 + 14, true)).toBe(-32768); // R[3] clamped
  });

  it('writes 24-bit samples', () => {
    const buf = encodeWav([new Float32Array([1, -1])], 48000, 24);
    const b = new Uint8Array(buf, 44);
    expect(buf.byteLength).toBe(44 + 6);
    expect([b[0], b[1], b[2]]).toEqual([0xff, 0xff, 0x7f]);
    expect([b[3], b[4], b[5]]).toEqual([0x00, 0x00, 0x80]);
  });
});

describe('audio helpers', () => {
  it('picks velocity layers evenly', () => {
    const layers = ['softest', 'soft', 'med', 'hard', 'hardest'];
    expect(pickLayer(layers, 0.1)).toBe('softest');
    expect(pickLayer(layers, 0.4)).toBe('soft');
    expect(pickLayer(layers, 0.75)).toBe('hard');
    expect(pickLayer(layers, 1)).toBe('hardest');
    expect(pickLayer(['only'], 0.2)).toBe('only');
    expect(pickLayer([], 1)).toBeUndefined();
  });
  it('parses kit sound specs into layers of round robins', () => {
    expect(parseSoundSpec('a.wav')).toEqual([['a.wav']]);
    expect(parseSoundSpec(['soft.wav', 'hard.wav'])).toEqual([['soft.wav'], ['hard.wav']]);
    expect(parseSoundSpec([['r1.wav', 'r2.wav'], 'hard.wav'])).toEqual([['r1.wav', 'r2.wav'], ['hard.wav']]);
    expect(parseSoundSpec([[], 3, ['x.wav', 7]])).toEqual([['x.wav']]);
    expect(parseSoundSpec(undefined)).toEqual([]);
  });
  it('computes tempo-synced delay times', () => {
    expect(delaySeconds('1/4', 120)).toBeCloseTo(0.5);
    expect(delaySeconds('1/8d', 120)).toBeCloseTo(0.375);
    expect(delaySeconds('1/8t', 120)).toBeCloseTo(1 / 6);
    expect(dbToGain(0)).toBe(1);
  });
});

describe('tap tempo', () => {
  it('averages taps and resets after a pause', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBeCloseTo(120);
    expect(t.tap(1000)).toBeCloseTo(120);
    expect(t.tap(5000)).toBeNull();
    expect(t.tap(5600)).toBeCloseTo(100);
  });
});

describe('serialization', () => {
  it('round-trips a project', () => {
    const p = project();
    p.patterns[0].steps.kick[3] = 0.4;
    p.song = [p.patterns[0].id, p.patterns[0].id];
    p.samples = { s1: { name: 'a.wav', mime: 'audio/wav', data: 'AAAA' }, unused: { name: 'b.wav', mime: 'audio/wav', data: 'BBBB' } };
    p.tracks[0].sampleId = 's1';
    const back = projectFromJson(projectToJson(p));
    expect(back.patterns).toEqual(p.patterns);
    expect(back.song).toEqual(p.song);
    expect(back.tracks).toEqual(p.tracks);
    expect(Object.keys(back.samples)).toEqual(['s1']); // unused samples are not exported
  });

  it('repairs bad input', () => {
    const fixed = normalizeProject({
      bpm: 9999,
      tracks: [{ id: 'kick', volume: 'loud', sampleId: 'missing' }],
      patterns: [{ id: 'a', beats: 3, subdivision: 5, steps: { kick: [1, 2, -1] } }, 'junk'],
      song: ['a', 'zzz', 'a'],
    });
    expect(fixed.bpm).toBe(300);
    expect(fixed.tracks).toHaveLength(TRACK_IDS.length);
    expect(fixed.tracks[0].volume).toBe(0.8);
    expect(fixed.tracks[0].sampleId).toBeNull();
    expect(fixed.patterns).toHaveLength(1);
    expect(fixed.patterns[0].subdivision).toBe(4);
    expect(fixed.patterns[0].steps.kick.slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(fixed.patterns[0].steps.snare).toHaveLength(12);
    expect(fixed.song).toEqual(['a', 'a']);
  });

  it('rejects non-projects', () => {
    expect(() => projectFromJson('nope')).toThrow(/JSON/);
    expect(() => projectFromJson('{"a":1}')).toThrow(/project/);
  });
});

describe('store undo/redo', () => {
  it('undoes, redoes and coalesces', () => {
    const s = new Store(project());
    s.update((p) => (p.bpm = 100));
    s.update((p) => (p.bpm = 101), { coalesce: 'k' });
    s.update((p) => (p.bpm = 102), { coalesce: 'k' });
    expect(s.project.bpm).toBe(102);
    s.undo();
    expect(s.project.bpm).toBe(100);
    s.undo();
    expect(s.project.bpm).toBe(120);
    s.redo();
    expect(s.project.bpm).toBe(100);
  });

  it('keeps samples across undo and fixes selection', () => {
    const s = new Store(project());
    const first = s.ui.selectedPatternId;
    const extra = createPattern('X');
    s.update((p) => p.patterns.push(extra));
    s.setUi({ selectedPatternId: extra.id });
    s.project.samples.k = { name: 'k', mime: 'audio/wav', data: '' };
    s.undo();
    expect(s.project.patterns).toHaveLength(1);
    expect(s.ui.selectedPatternId).toBe(first);
    expect(s.project.samples.k).toBeDefined();
  });
});
