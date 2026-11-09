import { MAX_BPM, MIN_BPM, type Pattern, type Project, type Subdivision, type TrackId } from '../types';
import { clonePattern, createPattern, isPatternEmpty, newId, resizePattern } from '../model/pattern';
import { findPreset, patternFromPreset } from '../model/presets';
import { resolveSequence } from '../model/timeline';
import { TapTempo } from '../model/tapTempo';
import { MixGraph } from '../audio/engine';
import { KitLibrary } from '../audio/kits';
import { Transport } from '../audio/transport';
import { renderWav, type RenderOptions } from '../audio/exportWav';
import { Store } from '../state/store';
import { createDefaultProject } from '../state/defaults';
import { projectFromJson, projectToJson } from '../state/serialize';
import { download, safeFilename, toast } from './dom';

export function patternColor(index: number): string {
  return `hsl(${(index * 47 + 200) % 360} 65% 58%)`;
}

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export interface WavExportRequest extends RenderOptions {
  source: 'song' | 'pattern';
  loops: number;
}

/** Owns the audio objects and exposes every user action. */
export class App {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly kits = new KitLibrary();
  readonly graph = new MixGraph(this.ctx, this.ctx.destination);
  readonly samples = new Map<string, AudioBuffer>();
  readonly transport: Transport;
  readonly tapper = new TapTempo();
  kitLoading: string | null = null;

  constructor(readonly store: Store) {
    this.transport = new Transport({
      ctx: this.ctx,
      graph: this.graph,
      kits: this.kits,
      getProject: () => this.store.project,
      getSampleBuffer: (id) => this.samples.get(id),
      getSelectedPatternId: () => this.store.ui.selectedPatternId,
    });
    this.graph.apply(store.project, true);
    store.subscribe((changed) => {
      if (changed) this.graph.apply(store.project);
    });
  }

  get project(): Project {
    return this.store.project;
  }

  async init() {
    await this.kits.init();
    if (!this.kits.has(this.project.kitId)) this.store.update((p) => (p.kitId = this.kits.kits[0].id), { noHistory: true });
    await this.decodeSamples();
    void this.loadKit(this.project.kitId);
  }

  /** Decode all user samples referenced by the project that aren't decoded yet. */
  async decodeSamples() {
    for (const [id, s] of Object.entries(this.project.samples)) {
      if (this.samples.has(id)) continue;
      try {
        this.samples.set(id, await this.kits.decode(base64ToBytes(s.data)));
      } catch (err) {
        console.warn('Could not decode sample', s.name, err);
      }
    }
  }

  private async loadKit(id: string) {
    this.kitLoading = id;
    this.store.setUi({});
    try {
      await this.kits.load(id);
    } catch (err) {
      toast(`Could not load kit: ${(err as Error).message}`, 'error');
    } finally {
      if (this.kitLoading === id) this.kitLoading = null;
      this.store.setUi({});
    }
  }

  // ---------- transport ----------

  togglePlay() {
    if (this.transport.playing) this.transport.stop();
    else void this.play();
  }

  async play(fromSongIndex = 0) {
    const mode = this.store.ui.mode;
    if (mode === 'song' && this.project.song.length === 0) {
      toast('The song is empty: add patterns to it first');
      return;
    }
    await this.transport.start(mode, fromSongIndex);
  }

  setMode(mode: 'pattern' | 'song') {
    if (mode === this.store.ui.mode) return;
    const wasPlaying = this.transport.playing && !this.transport.preview;
    this.transport.stop();
    this.store.setUi({ mode });
    if (wasPlaying) void this.play();
  }

  /** Preview a kit: plays the current pattern (or the kit's demo if empty) with that kit. */
  async previewKit(kitId: string) {
    const tag = `kit:${kitId}`;
    if (this.transport.preview?.tag === tag) {
      this.transport.stop();
      return;
    }
    const current = this.store.selectedPattern;
    let pattern: Pattern | undefined;
    let bpm: number | undefined;
    if (!current || isPatternEmpty(current)) {
      const demo = findPreset(this.kits.info(kitId)?.demo ?? 'rock');
      if (demo) {
        pattern = patternFromPreset(demo);
        bpm = demo.bpm;
      }
    }
    this.kitLoading = kitId;
    this.store.setUi({});
    try {
      await this.transport.startPreview({ tag, kitId, pattern, bpm });
    } finally {
      this.kitLoading = null;
      this.store.setUi({});
    }
  }

  /** Preview a preset groove with the current kit at its suggested tempo. */
  async previewPreset(presetId: string) {
    const tag = `preset:${presetId}`;
    if (this.transport.preview?.tag === tag) {
      this.transport.stop();
      return;
    }
    const def = findPreset(presetId);
    if (!def) return;
    await this.transport.startPreview({ tag, pattern: patternFromPreset(def), bpm: def.bpm });
  }

  selectKit(kitId: string) {
    if (kitId === this.project.kitId) return;
    this.store.update((p) => (p.kitId = kitId));
    void this.loadKit(kitId);
    // A running kit preview keeps going, now with the chosen kit.
    const pv = this.transport.preview;
    if (pv?.tag.startsWith('kit:')) {
      if (pv.pattern) void this.transport.startPreview({ ...pv, tag: `kit:${kitId}`, kitId });
      else void this.transport.startPreview({ tag: `kit:${kitId}`, kitId });
    }
  }

  setBpm(bpm: number, done = true) {
    const v = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 10) / 10;
    this.store.update((p) => (p.bpm = v), { coalesce: done ? undefined : 'bpm' });
  }

  tapTempo() {
    const bpm = this.tapper.tap(performance.now());
    if (bpm !== null) this.store.update((p) => (p.bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)))), { coalesce: 'tap' });
  }

  // ---------- patterns ----------

  selectPattern(id: string) {
    this.store.setUi({ selectedPatternId: id });
  }

  private nextPatternName(): string {
    const used = new Set(this.project.patterns.map((p) => p.name));
    for (let i = this.project.patterns.length + 1; ; i++) if (!used.has(`P${i}`)) return `P${i}`;
  }

  addPattern() {
    const cur = this.store.selectedPattern;
    const p = createPattern(this.nextPatternName(), cur?.beats ?? 4, cur?.subdivision ?? 4);
    this.store.update((proj) => proj.patterns.push(p));
    this.selectPattern(p.id);
  }

  duplicatePattern(id = this.store.ui.selectedPatternId) {
    const src = this.project.patterns.find((p) => p.id === id);
    if (!src) return;
    const copy = clonePattern(src, `${src.name} copy`.slice(0, 40));
    this.store.update((proj) => proj.patterns.splice(proj.patterns.indexOf(src) + 1, 0, copy));
    this.selectPattern(copy.id);
  }

  addPresetPattern(presetId: string) {
    const def = findPreset(presetId);
    if (!def) return;
    const p = patternFromPreset(def);
    this.store.update((proj) => proj.patterns.push(p));
    this.selectPattern(p.id);
    toast(`Added "${def.name}" (suggested tempo ${def.bpm} BPM)`);
  }

  deletePattern(id = this.store.ui.selectedPatternId) {
    if (this.project.patterns.length <= 1) {
      toast('A project needs at least one pattern');
      return;
    }
    const idx = this.project.patterns.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const inSong = this.project.song.filter((s) => s === id).length;
    const name = this.project.patterns[idx].name;
    if (inSong && !confirm(`"${name}" is used ${inSong}× in the song. Delete it and remove it from the song?`)) return;
    this.store.update((p) => {
      p.patterns.splice(idx, 1);
      p.song = p.song.filter((s) => s !== id);
    });
    this.selectPattern(this.project.patterns[Math.max(0, idx - 1)].id);
  }

  clearPattern(id = this.store.ui.selectedPatternId) {
    this.updatePattern(id, (pat) => {
      for (const row of Object.values(pat.steps)) row.fill(0);
    });
  }

  renamePattern(id: string, name: string) {
    this.updatePattern(id, (p) => (p.name = name.trim().slice(0, 40) || p.name), 'rename');
  }

  updatePattern(id: string, fn: (p: Pattern) => void, coalesce?: string) {
    this.store.update(
      (proj) => {
        const p = proj.patterns.find((x) => x.id === id);
        if (p) fn(p);
      },
      { coalesce },
    );
  }

  resize(id: string, beats: number, subdivision: Subdivision) {
    this.store.update((proj) => {
      const i = proj.patterns.findIndex((x) => x.id === id);
      if (i >= 0) proj.patterns[i] = resizePattern(proj.patterns[i], beats, subdivision);
    });
  }

  movePattern(id: string, delta: number) {
    this.store.update((proj) => {
      const i = proj.patterns.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= proj.patterns.length) return;
      const [p] = proj.patterns.splice(i, 1);
      proj.patterns.splice(j, 0, p);
    });
  }

  // ---------- song ----------

  songAppend(patternId: string) {
    this.store.update((p) => p.song.push(patternId));
  }

  songInsert(index: number, patternId: string) {
    this.store.update((p) => p.song.splice(index, 0, patternId));
  }

  songRemove(index: number) {
    this.store.update((p) => p.song.splice(index, 1));
  }

  songMove(from: number, to: number) {
    this.store.update((p) => {
      if (from === to || from < 0 || from >= p.song.length) return;
      const [id] = p.song.splice(from, 1);
      p.song.splice(Math.max(0, Math.min(p.song.length, to)), 0, id);
    });
  }

  songClear() {
    if (this.project.song.length && confirm('Remove all patterns from the song?')) this.store.update((p) => (p.song = []));
  }

  // ---------- tracks & samples ----------

  updateTrack(id: TrackId, fn: (t: Project['tracks'][number]) => void, coalesce?: string) {
    this.store.update(
      (p) => {
        const t = p.tracks.find((x) => x.id === id);
        if (t) fn(t);
      },
      { coalesce },
    );
  }

  async loadTrackSample(id: TrackId, file: File) {
    try {
      const bytes = await file.arrayBuffer();
      const buffer = await this.kits.decode(bytes.slice(0));
      const sampleId = newId('s');
      this.samples.set(sampleId, buffer);
      this.store.update((p) => {
        p.samples[sampleId] = { name: file.name, mime: file.type || 'audio/wav', data: bytesToBase64(bytes) };
        const t = p.tracks.find((x) => x.id === id);
        if (t) t.sampleId = sampleId;
      });
      toast(`Loaded "${file.name}"`);
    } catch (err) {
      toast(`Could not load ${file.name}: ${(err as Error).message || 'unsupported audio'}`, 'error');
    }
  }

  async auditionTrack(id: TrackId, velocity = 0.8) {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const track = this.project.tracks.find((t) => t.id === id);
    if (!track) return;
    const custom = track.sampleId ? this.samples.get(track.sampleId) : undefined;
    const sounds = custom ? [custom] : (await this.kits.load(this.project.kitId))[id];
    // Audition ignores mute/solo so you can always hear what a row sounds like.
    this.graph.trigger({ ...track, mute: false, solo: false }, this.ctx.currentTime + 0.005, velocity, sounds);
  }

  // ---------- files ----------

  exportJson() {
    const blob = new Blob([projectToJson(this.project)], { type: 'application/json' });
    download(blob, `${safeFilename(this.project.name)}.drums.json`);
  }

  async importJson(file: File) {
    try {
      const project = projectFromJson(await file.text());
      this.transport.stop();
      this.store.replaceProject(project);
      await this.decodeSamples();
      if (!this.kits.has(project.kitId)) {
        toast(`Kit "${project.kitId}" not found, using ${this.kits.kits[0].name}`);
        this.store.update((p) => (p.kitId = this.kits.kits[0].id), { noHistory: true });
      }
      void this.loadKit(this.project.kitId);
      toast(`Imported "${project.name}"`);
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error');
    }
  }

  newProject() {
    if (!confirm('Start a new project? (Undo can bring the current one back.)')) return;
    this.transport.stop();
    const p = createDefaultProject();
    p.kitId = this.project.kitId;
    this.store.replaceProject(p);
  }

  async exportWav(req: WavExportRequest): Promise<void> {
    const seq = resolveSequence(this.project, req.source, this.store.ui.selectedPatternId, req.loops);
    if (seq.length === 0) throw new Error(req.source === 'song' ? 'The song is empty' : 'No pattern selected');
    const sounds = await this.kits.load(this.project.kitId);
    const blob = await renderWav(this.project, seq, sounds, this.samples, req);
    const suffix = req.source === 'song' ? 'song' : safeFilename(this.store.selectedPattern.name);
    download(blob, `${safeFilename(this.project.name)}-${suffix}.wav`);
  }
}
