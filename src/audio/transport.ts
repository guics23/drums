import { TRACK_IDS, type Pattern, type Project } from '../types';
import { stepDuration, swingOffset } from '../model/pattern';
import type { MixGraph } from './engine';
import type { KitLibrary } from './kits';

export type PlayMode = 'pattern' | 'song';

export interface StepEvent {
  time: number;
  patternId: string;
  /** Index in the song, or -1 in pattern/preview mode. */
  songIndex: number;
  step: number;
}

export interface PreviewRequest {
  kitId?: string;
  pattern?: Pattern;
  bpm?: number;
  /** Arbitrary tag so the UI can tell which preview is playing. */
  tag: string;
}

interface Deps {
  ctx: AudioContext;
  graph: MixGraph;
  kits: KitLibrary;
  getProject(): Project;
  getSampleBuffer(sampleId: string): AudioBuffer | undefined;
  /** Pattern selected in the editor (played in pattern mode). */
  getSelectedPatternId(): string;
}

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

/** Timer in a worker so background tabs are not throttled to 1 Hz. */
function makeTicker(cb: () => void): { start(): void; stop(): void } {
  try {
    const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${TICK_MS})}else{clearInterval(id);id=null}}`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = cb;
    return { start: () => w.postMessage('start'), stop: () => w.postMessage('stop') };
  } catch {
    let id: number | undefined;
    return {
      start: () => {
        clearInterval(id);
        id = window.setInterval(cb, TICK_MS);
      },
      stop: () => clearInterval(id),
    };
  }
}

/**
 * Look-ahead scheduler. Reads the project on every step so edits made during
 * playback are heard immediately. Pattern changes take effect at the next
 * pattern boundary.
 */
export class Transport {
  playing = false;
  mode: PlayMode = 'pattern';
  preview: PreviewRequest | null = null;
  /** Pattern currently being played (null when stopped). */
  currentPatternId: string | null = null;
  songIndex = -1;

  private step = 0;
  private nextTime = 0;
  private endTime: number | null = null;
  private ticker = makeTicker(() => this.tick());
  private visualQueue: StepEvent[] = [];
  private listeners = new Set<() => void>();

  constructor(private deps: Deps) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async start(mode: PlayMode, fromSongIndex = 0) {
    this.preview = null;
    this.mode = mode;
    await this.begin(mode === 'song' ? fromSongIndex : -1);
  }

  async startPreview(req: PreviewRequest) {
    const wasPlaying = this.playing;
    this.preview = req;
    if (req.kitId) await this.deps.kits.load(req.kitId);
    if (wasPlaying && this.preview === req) {
      // Switch sound/pattern on the fly without restarting the clock.
      this.currentPatternId = req.pattern?.id ?? this.currentPatternId;
      if (req.pattern) this.step = this.step % (req.pattern.beats * req.pattern.subdivision);
      this.emit();
      return;
    }
    if (this.preview === req) await this.begin(-1);
  }

  stop() {
    this.ticker.stop();
    this.playing = false;
    this.preview = null;
    this.currentPatternId = null;
    this.songIndex = -1;
    this.endTime = null;
    this.visualQueue = [];
    this.emit();
  }

  private async begin(songIndex: number) {
    const { ctx, kits } = this.deps;
    if (ctx.state !== 'running') await ctx.resume();
    await kits.load(this.preview?.kitId ?? this.deps.getProject().kitId);
    this.ticker.stop();
    this.visualQueue = [];
    this.endTime = null;
    this.step = 0;
    this.songIndex = songIndex;
    this.currentPatternId = this.patternIdForPosition();
    if (!this.currentPatternId) {
      this.stop();
      return;
    }
    this.nextTime = ctx.currentTime + 0.06;
    this.playing = true;
    this.ticker.start();
    this.tick();
    this.emit();
  }

  private patternIdForPosition(): string | null {
    const project = this.deps.getProject();
    if (this.preview?.pattern) return this.preview.pattern.id;
    if (this.mode === 'song' && !this.preview) {
      return project.song[this.songIndex] ?? null;
    }
    return this.deps.getSelectedPatternId() || project.patterns[0]?.id || null;
  }

  private resolvePattern(id: string | null): Pattern | undefined {
    if (!id) return undefined;
    if (this.preview?.pattern?.id === id) return this.preview.pattern;
    return this.deps.getProject().patterns.find((p) => p.id === id);
  }

  private bpm(project: Project): number {
    return this.preview?.bpm ?? project.bpm;
  }

  private tick() {
    if (!this.playing) return;
    const { ctx } = this.deps;
    if (this.endTime !== null) {
      if (ctx.currentTime >= this.endTime) this.stop();
      return;
    }
    let guard = 0;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD && guard++ < 512) {
      if (!this.scheduleStep()) return;
    }
  }

  /** Schedule the current step and advance. Returns false when playback ended. */
  private scheduleStep(): boolean {
    const project = this.deps.getProject();
    let pattern = this.resolvePattern(this.currentPatternId);
    if (!pattern) {
      // The pattern was deleted while playing: restart from a valid position.
      if (this.mode === 'song' && !this.preview) this.songIndex = Math.min(this.songIndex, project.song.length - 1);
      this.currentPatternId = this.patternIdForPosition();
      pattern = this.resolvePattern(this.currentPatternId);
      this.step = 0;
      if (!pattern) {
        this.stop();
        return false;
      }
    }
    const count = pattern.beats * pattern.subdivision;
    if (this.step >= count) this.step = 0;

    const bpm = this.bpm(project);
    const d = stepDuration(bpm, pattern.subdivision);
    const time = this.nextTime + swingOffset(this.step, pattern.subdivision, d, project.swing);
    const kitId = this.preview?.kitId ?? project.kitId;
    const sounds = this.deps.kits.get(kitId);
    if (!sounds) void this.deps.kits.load(kitId);

    for (const id of TRACK_IDS) {
      const v = pattern.steps[id][this.step];
      if (!v) continue;
      const track = project.tracks.find((t) => t.id === id);
      if (!track) continue;
      const custom = track.sampleId && !this.preview?.kitId ? this.deps.getSampleBuffer(track.sampleId) : undefined;
      const layers = custom ? [custom] : sounds?.[id];
      if (layers) this.deps.graph.trigger(track, time, v, layers);
    }
    this.visualQueue.push({ time, patternId: pattern.id, songIndex: this.songIndex, step: this.step });

    this.nextTime += d;
    this.step++;
    if (this.step >= count) return this.advancePattern();
    return true;
  }

  private advancePattern(): boolean {
    const project = this.deps.getProject();
    this.step = 0;
    if (this.mode === 'song' && !this.preview) {
      this.songIndex++;
      if (this.songIndex >= project.song.length) {
        if (!project.songLoop || project.song.length === 0) {
          this.endTime = this.nextTime;
          return false;
        }
        this.songIndex = 0;
      }
    }
    const prev = this.currentPatternId;
    this.currentPatternId = this.patternIdForPosition();
    if (prev !== this.currentPatternId) queueMicrotask(() => this.emit());
    return true;
  }

  /** Pop step events that have become audible; returns the latest one. */
  consumeVisual(now: number): StepEvent | null {
    let last: StepEvent | null = null;
    while (this.visualQueue.length && this.visualQueue[0].time <= now) last = this.visualQueue.shift()!;
    return last;
  }
}
