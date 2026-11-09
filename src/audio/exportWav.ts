import type { Pattern, Project } from '../types';
import { buildTimeline } from '../model/timeline';
import { MixGraph } from './engine';
import type { KitSounds } from './kits';
import { encodeWav } from './wav';

export interface RenderOptions {
  sampleRate: number;
  bitDepth: 16 | 24;
  /** Extra seconds after the last bar for reverb/delay tails. */
  tail: number;
}

export async function renderWav(
  project: Project,
  sequence: Pattern[],
  sounds: KitSounds,
  samples: Map<string, AudioBuffer>,
  opts: RenderOptions,
): Promise<Blob> {
  const timeline = buildTimeline(project, sequence);
  if (timeline.duration <= 0) throw new Error('Nothing to render');
  const length = Math.ceil((timeline.duration + opts.tail) * opts.sampleRate);
  const ctx = new OfflineAudioContext(2, length, opts.sampleRate);
  const graph = new MixGraph(ctx, ctx.destination);
  graph.apply(project, true);
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));
  for (const ev of timeline.events) {
    const track = tracks.get(ev.trackId);
    if (!track) continue;
    const custom = track.sampleId ? samples.get(track.sampleId) : undefined;
    graph.trigger(track, ev.time, ev.velocity, custom ? [[custom]] : sounds[ev.trackId]);
  }
  const rendered = await ctx.startRendering();
  const wav = encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], opts.sampleRate, opts.bitDepth);
  return new Blob([wav], { type: 'audio/wav' });
}
