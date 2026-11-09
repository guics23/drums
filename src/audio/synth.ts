/**
 * Data-driven drum synthesis. Every kit sound is described by a list of layers
 * and rendered once into an AudioBuffer with an OfflineAudioContext, so the
 * engine treats synthesized and user-loaded sounds identically.
 */

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  q?: number;
}

interface LayerBase {
  /** Peak gain of the layer before instrument normalization. */
  gain: number;
  /** Seconds to reach peak. */
  attack?: number;
  /** Seconds from peak to silence (exponential). */
  decay: number;
  /** Start offset in seconds. */
  delay?: number;
  filters?: FilterSpec[];
}

export interface OscLayer extends LayerBase {
  type: 'osc';
  wave: OscillatorType;
  freq: number;
  /** If set, frequency sweeps exponentially to this value over pitchDecay. */
  endFreq?: number;
  pitchDecay?: number;
}

export interface NoiseLayer extends LayerBase {
  type: 'noise';
  /** Clap-style repeated short bursts before the main decay. */
  bursts?: { count: number; spacing: number; decay: number };
}

export interface MetalLayer extends LayerBase {
  type: 'metal';
  /** Base frequency multiplied by each ratio (square oscillators). */
  freq: number;
  ratios?: number[];
}

export type Layer = OscLayer | NoiseLayer | MetalLayer;

export interface PostSpec {
  /** Waveshaper drive amount (0 = clean). */
  drive?: number;
  lowpass?: number;
  highpass?: number;
  /** Bit-crush: bit depth and sample-and-hold factor. */
  crush?: { bits: number; hold: number };
}

export interface InstrumentSpec {
  layers: Layer[];
  /** Buffer length in seconds. */
  length: number;
  /** Peak level after normalization, 0..1. */
  level?: number;
  post?: PostSpec;
}

const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

/** Small deterministic PRNG so renders are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = mulberry32(seed);
  for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1;
  return buf;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * 10;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function chainFilters(ctx: BaseAudioContext, input: AudioNode, filters: FilterSpec[] | undefined): AudioNode {
  let node = input;
  for (const f of filters ?? []) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.value = f.freq;
    if (f.q !== undefined) bq.Q.value = f.q;
    node.connect(bq);
    node = bq;
  }
  return node;
}

function envelope(param: AudioParam, start: number, attack: number, decay: number, peak: number) {
  param.setValueAtTime(0.0001, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.exponentialRampToValueAtTime(0.0001, start + attack + Math.max(0.005, decay));
  param.setValueAtTime(0, start + attack + Math.max(0.005, decay) + 0.001);
}

function renderLayer(ctx: BaseAudioContext, layer: Layer, dest: AudioNode, noise: AudioBuffer) {
  const start = layer.delay ?? 0;
  const attack = layer.attack ?? 0.001;
  const env = ctx.createGain();
  env.gain.value = 0;
  chainFilters(ctx, env, layer.filters).connect(dest);
  const end = start + attack + layer.decay + 0.05;

  if (layer.type === 'osc') {
    const osc = ctx.createOscillator();
    osc.type = layer.wave;
    osc.frequency.setValueAtTime(layer.freq, start);
    if (layer.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.endFreq), start + (layer.pitchDecay ?? 0.05));
    }
    osc.connect(env);
    osc.start(start);
    osc.stop(end);
    envelope(env.gain, start, attack, layer.decay, layer.gain);
  } else if (layer.type === 'metal') {
    for (const r of layer.ratios ?? METAL_RATIOS) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = layer.freq * r;
      osc.connect(env);
      osc.start(start);
      osc.stop(end);
    }
    envelope(env.gain, start, attack, layer.decay, layer.gain);
  } else {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.connect(env);
    src.start(start);
    src.stop(end);
    let t = start;
    if (layer.bursts) {
      const { count, spacing, decay } = layer.bursts;
      env.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < count; i++) {
        const bt = start + i * spacing;
        env.gain.setValueAtTime(0.0001, bt);
        env.gain.linearRampToValueAtTime(layer.gain, bt + 0.001);
        env.gain.exponentialRampToValueAtTime(layer.gain * 0.1, bt + Math.min(decay, spacing - 0.001));
      }
      t = start + count * spacing;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(layer.gain, t + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, t + attack + layer.decay);
      env.gain.setValueAtTime(0, t + attack + layer.decay + 0.001);
    } else {
      envelope(env.gain, start, attack, layer.decay, layer.gain);
    }
  }
}

/** Normalize, bit-crush and fade out a rendered buffer in place. */
export function postProcess(data: Float32Array, sampleRate: number, level: number, crush?: PostSpec['crush']) {
  if (crush) {
    const steps = Math.pow(2, crush.bits - 1);
    const hold = Math.max(1, Math.round(crush.hold));
    let held = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % hold === 0) held = Math.round(data[i] * steps) / steps;
      data[i] = held;
    }
  }
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const k = peak > 0 ? level / peak : 0;
  const fade = Math.min(data.length, Math.round(sampleRate * 0.01));
  for (let i = 0; i < data.length; i++) {
    let g = k;
    const fromEnd = data.length - 1 - i;
    if (fromEnd < fade) g *= fromEnd / fade;
    data[i] *= g;
  }
}

export async function renderInstrument(spec: InstrumentSpec, sampleRate = 44100, seed = 1): Promise<AudioBuffer> {
  const length = Math.ceil(spec.length * sampleRate);
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const noise = makeNoiseBuffer(ctx, spec.length + 0.1, seed);
  const sum = ctx.createGain();
  let node: AudioNode = sum;
  const post = spec.post ?? {};
  if (post.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(post.drive);
    ws.oversample = '2x';
    node.connect(ws);
    node = ws;
  }
  const postFilters: FilterSpec[] = [];
  if (post.highpass) postFilters.push({ type: 'highpass', freq: post.highpass, q: 0.7 });
  if (post.lowpass) postFilters.push({ type: 'lowpass', freq: post.lowpass, q: 0.7 });
  chainFilters(ctx, node, postFilters).connect(ctx.destination);
  for (const layer of spec.layers) renderLayer(ctx, layer, sum, noise);
  const buf = await ctx.startRendering();
  postProcess(buf.getChannelData(0), sampleRate, spec.level ?? 0.9, post.crush);
  return buf;
}
