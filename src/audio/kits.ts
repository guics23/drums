import { TRACK_IDS, type TrackId } from '../types';
import { renderInstrument } from './synth';
import { SYNTH_KITS } from './synthKits';

export interface KitInfo {
  id: string;
  name: string;
  description: string;
  source: 'synth' | 'sample';
  /** Preset id used when previewing this kit over an empty pattern. */
  demo: string;
}

/** Velocity layers per track, ordered soft → hard. */
export type KitSounds = Record<TrackId, AudioBuffer[]>;

interface SampleKitManifest {
  id: string;
  name: string;
  description?: string;
  dir: string;
  demo?: string;
  fallback?: string;
  sounds: Partial<Record<TrackId, string | string[]>>;
  /** Optional linear gain per track, to balance quiet or loud samples. */
  gain?: Partial<Record<TrackId, number>>;
}

/** Choose a velocity layer: the range 0..1 is split evenly between layers. */
export function pickLayer<T>(layers: T[], velocity: number): T | undefined {
  if (layers.length === 0) return undefined;
  const i = Math.ceil(velocity * layers.length) - 1;
  return layers[Math.min(layers.length - 1, Math.max(0, i))];
}

function isManifest(x: unknown): x is SampleKitManifest {
  const m = x as SampleKitManifest;
  return !!m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.dir === 'string' && typeof m.sounds === 'object';
}

export class KitLibrary {
  kits: KitInfo[] = SYNTH_KITS.map((k) => ({ id: k.id, name: k.name, description: k.description, source: 'synth', demo: k.demo }));
  private manifests = new Map<string, SampleKitManifest>();
  private cache = new Map<string, Promise<KitSounds>>();
  private loaded = new Map<string, KitSounds>();
  private decodeCtx = new OfflineAudioContext(1, 1, 44100);

  /** Load public/kits/kits.json. Sampled kits are listed first. */
  async init(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}kits/kits.json`);
      if (!res.ok) return;
      const json = (await res.json()) as { kits?: unknown[] };
      const sampled: KitInfo[] = [];
      for (const m of json.kits ?? []) {
        if (!isManifest(m) || this.manifests.has(m.id)) continue;
        this.manifests.set(m.id, m);
        sampled.push({ id: m.id, name: m.name, description: m.description ?? '', source: 'sample', demo: m.demo ?? 'rock' });
      }
      this.kits = [...sampled, ...this.kits];
    } catch (err) {
      console.warn('Could not load kits.json', err);
    }
  }

  has(id: string): boolean {
    return this.kits.some((k) => k.id === id);
  }

  info(id: string): KitInfo | undefined {
    return this.kits.find((k) => k.id === id);
  }

  /** Sounds for a kit if already loaded (synchronous, for the scheduler). */
  get(id: string): KitSounds | undefined {
    return this.loaded.get(id);
  }

  load(id: string): Promise<KitSounds> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.loadUncached(id).then((s) => {
        this.loaded.set(id, s);
        return s;
      });
      p.catch(() => this.cache.delete(id));
      this.cache.set(id, p);
    }
    return p;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.decodeCtx.decodeAudioData(data);
  }

  private async loadUncached(id: string): Promise<KitSounds> {
    const synth = SYNTH_KITS.find((k) => k.id === id);
    if (synth) {
      const entries = await Promise.all(
        TRACK_IDS.map(async (t, i): Promise<[TrackId, AudioBuffer[]]> => [t, [await renderInstrument(synth.sounds[t], 44100, i + 1)]]),
      );
      return Object.fromEntries(entries) as unknown as KitSounds;
    }
    const m = this.manifests.get(id);
    if (!m) throw new Error(`Unknown kit ${id}`);
    const base = `${import.meta.env.BASE_URL}kits/${m.dir}/`;
    const fallbackId = m.fallback && m.fallback !== id ? m.fallback : SYNTH_KITS[0].id;
    let fallback: KitSounds | undefined;
    const out = {} as KitSounds;
    await Promise.all(
      TRACK_IDS.map(async (t) => {
        const spec = m.sounds[t];
        const files = spec === undefined ? [] : Array.isArray(spec) ? spec : [spec];
        const buffers: AudioBuffer[] = [];
        for (const f of files) {
          try {
            const res = await fetch(base + encodeURI(f));
            if (!res.ok) throw new Error(`${res.status}`);
            const buf = await this.decode(await res.arrayBuffer());
            const g = m.gain?.[t];
            if (typeof g === 'number' && g > 0 && g !== 1) {
              for (let c = 0; c < buf.numberOfChannels; c++) {
                const d = buf.getChannelData(c);
                for (let i = 0; i < d.length; i++) d[i] *= g;
              }
            }
            buffers.push(buf);
          } catch (err) {
            console.warn(`Kit ${id}: failed to load ${f}`, err);
          }
        }
        if (buffers.length === 0) {
          fallback ??= await this.load(fallbackId);
          out[t] = fallback[t];
        } else {
          out[t] = buffers;
        }
      }),
    );
    return out;
  }
}
