import { TRACK_IDS, type DelayDivision, type Effects, type Project, type Track, type TrackId } from '../types';
import { pickLayer, type Sound } from './kits';
import { mulberry32 } from './synth';

const DIVISION_BEATS: Record<DelayDivision, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/8d': 0.75,
  '1/8t': 1 / 3,
  '1/16': 0.25,
  '1/16d': 0.375,
  '1/16t': 1 / 6,
};

export function delaySeconds(division: DelayDivision, bpm: number): number {
  return (DIVISION_BEATS[division] * 60) / bpm;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Stereo exponentially decaying noise impulse response; `decay` is the RT60 in seconds. */
export function makeImpulse(ctx: BaseAudioContext, decay: number, preDelayMs: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.round((preDelayMs / 1000) * sr);
  const len = pre + Math.max(1, Math.round(decay * sr));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const rand = mulberry32(c + 7);
    const d = buf.getChannelData(c);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // -60 dB at `decay` seconds, with a short fade-in to soften the onset.
      const fadeIn = Math.min(1, t / 0.005);
      d[i] = (rand() * 2 - 1) * Math.exp((-6.9 * t) / decay) * fadeIn;
    }
  }
  return buf;
}

interface TrackNodes {
  gain: GainNode;
  pan: StereoPannerNode;
  rev: GainNode;
  del: GainNode;
}

interface Voice {
  env: GainNode;
  end: number;
}

/**
 * The full mixing graph: per-track gain/pan/sends, reverb and delay returns,
 * master filter → compressor → master volume. Works on both a live
 * AudioContext and an OfflineAudioContext (for WAV export).
 */
export class MixGraph {
  readonly analyser: AnalyserNode;
  private tracks = new Map<TrackId, TrackNodes>();
  private mix: GainNode;
  private filter: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;
  private master: GainNode;
  private convolver: ConvolverNode;
  private revReturn: GainNode;
  private delay: DelayNode;
  private delayFb: GainNode;
  private delayTone: BiquadFilterNode;
  private delayReturn: GainNode;
  private irKey = '';
  private routeKey = '';
  private openHat: Voice | null = null;
  /** Round-robin position per track. */
  private rrIndex = new Map<TrackId, number>();

  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.mix = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.comp = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(destination);
    this.master.connect(this.analyser);

    const revSend = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.revReturn = ctx.createGain();
    revSend.connect(this.convolver).connect(this.revReturn).connect(this.mix);

    const delSend = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.delayFb = ctx.createGain();
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayReturn = ctx.createGain();
    delSend.connect(this.delay);
    this.delay.connect(this.delayTone).connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayReturn).connect(this.mix);

    for (const id of TRACK_IDS) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const rev = ctx.createGain();
      const del = ctx.createGain();
      gain.connect(pan).connect(this.mix);
      pan.connect(rev).connect(revSend);
      pan.connect(del).connect(delSend);
      this.tracks.set(id, { gain, pan, rev, del });
    }
  }

  private set(param: AudioParam, value: number, instant: boolean) {
    if (instant || !(this.ctx instanceof AudioContext)) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  /** Push every project parameter into the graph. Cheap; call on each change. */
  apply(project: Project, instant = false) {
    const anySolo = project.tracks.some((t) => t.solo);
    for (const t of project.tracks) {
      const n = this.tracks.get(t.id);
      if (!n) continue;
      const audible = anySolo ? t.solo : !t.mute;
      this.set(n.gain.gain, audible ? t.volume : 0, instant);
      this.set(n.pan.pan, t.pan, instant);
      this.set(n.rev.gain, t.reverbSend, instant);
      this.set(n.del.gain, t.delaySend, instant);
    }
    this.applyEffects(project.effects, project.bpm, instant);
    this.set(this.master.gain, project.masterVolume, instant);
  }

  private applyEffects(fx: Effects, bpm: number, instant: boolean) {
    const irKey = `${fx.reverb.decay.toFixed(2)}|${fx.reverb.preDelay.toFixed(0)}`;
    if (irKey !== this.irKey) {
      this.irKey = irKey;
      this.convolver.buffer = makeImpulse(this.ctx, fx.reverb.decay, fx.reverb.preDelay);
    }
    this.set(this.revReturn.gain, fx.reverb.enabled ? fx.reverb.mix : 0, instant);

    this.set(this.delay.delayTime, delaySeconds(fx.delay.division, bpm), instant);
    this.set(this.delayFb.gain, Math.min(0.95, fx.delay.feedback), instant);
    this.set(this.delayTone.frequency, fx.delay.tone, instant);
    this.set(this.delayReturn.gain, fx.delay.enabled ? fx.delay.mix : 0, instant);

    this.filter.type = fx.filter.type;
    this.set(this.filter.frequency, fx.filter.frequency, instant);
    this.set(this.filter.Q, fx.filter.q, instant);

    const c = fx.compressor;
    this.set(this.comp.threshold, c.threshold, instant);
    this.set(this.comp.ratio, c.ratio, instant);
    this.set(this.comp.attack, c.attack, instant);
    this.set(this.comp.release, c.release, instant);
    this.set(this.makeup.gain, c.enabled ? dbToGain(c.makeup) : 1, instant);

    const routeKey = `${fx.filter.enabled}|${c.enabled}`;
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      this.mix.disconnect();
      this.filter.disconnect();
      this.comp.disconnect();
      this.makeup.disconnect();
      let node: AudioNode = this.mix;
      if (fx.filter.enabled) node = node.connect(this.filter);
      if (c.enabled) node = node.connect(this.comp);
      node.connect(this.makeup).connect(this.master);
    }
  }

  /** Schedule one hit. */
  trigger(track: Track, time: number, velocity: number, layers: Sound) {
    const variations = pickLayer(layers, velocity);
    if (!variations?.length) return;
    // Cycle through round-robin variations so repeated hits don't sound identical.
    const rr = this.rrIndex.get(track.id) ?? 0;
    this.rrIndex.set(track.id, rr + 1);
    const buffer = variations[rr % variations.length];
    const nodes = this.tracks.get(track.id);
    if (!buffer || !nodes) return;
    const rate = Math.pow(2, track.pitch / 12);
    const fullLen = buffer.duration / rate;
    const len = fullLen * Math.max(0.05, Math.min(1, track.decay));
    // Multi-velocity kits already vary in loudness, so velocity is scaled more gently.
    const gain = layers.length > 1 ? 0.55 + 0.45 * velocity : velocity;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    if (len < fullLen) {
      env.gain.setValueAtTime(gain, time + len * 0.6);
      env.gain.linearRampToValueAtTime(0, time + len);
    }
    src.connect(env).connect(nodes.gain);
    src.start(time);
    src.stop(time + len + 0.01);

    // Closed hat chokes a ringing open hat.
    if (track.id === 'chh' && this.openHat && this.openHat.end > time) {
      const g = this.openHat.env.gain;
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(time);
      else g.cancelScheduledValues(time);
      g.setTargetAtTime(0, time, 0.008);
      this.openHat = null;
    } else if (track.id === 'ohh') {
      this.openHat = { env, end: time + len };
    }
  }
}
