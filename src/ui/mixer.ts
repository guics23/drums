import { DELAY_DIVISIONS, TRACK_IDS, type DelayDivision, type Effects, type FilterType, type TrackId } from '../types';
import type { App } from './app';
import { Bindings, h, pickFile, slider } from './dom';
import { defaultEffects, defaultTrack } from '../state/defaults';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function buildMixer(app: App, b: Bindings): HTMLElement {
  const { store } = app;
  const track = (id: TrackId) => store.project.tracks.find((t) => t.id === id)!;
  const cols = ['Track', 'Volume', 'Pan', 'Pitch', 'Decay', 'Reverb', 'Delay', 'Sound'];
  const rows = TRACK_IDS.map((id) => {
    const def = defaultTrack(id);
    const s = (key: 'volume' | 'pan' | 'pitch' | 'decay' | 'reverbSend' | 'delaySend', min: number, max: number, step: number, format: (v: number) => string) =>
      h(
        'td',
        null,
        slider(b, {
          label: '',
          class: 'compact',
          min,
          max,
          step,
          reset: def[key],
          get: () => track(id)[key],
          set: (v) => app.updateTrack(id, (t) => (t[key] = v), `${id}-${key}`),
          format,
        }),
      );

    const soundName = h('span', { class: 'sound-name' });
    const resetBtn = h('button', { class: 'icon-btn', title: 'Back to kit sound', onclick: () => app.updateTrack(id, (t) => (t.sampleId = null)) }, '×');
    b.add(() => {
      const t = track(id);
      const sample = t.sampleId ? store.project.samples[t.sampleId] : undefined;
      soundName.textContent = sample ? sample.name : 'Kit';
      soundName.title = sample ? sample.name : 'Sound from the selected kit';
      soundName.classList.toggle('custom', !!sample);
      resetBtn.hidden = !sample;
    });
    const name = h('button', { class: 'track-name', onclick: () => void app.auditionTrack(id) });
    b.add(() => (name.textContent = track(id).name));
    return h(
      'tr',
      null,
      h('td', null, name),
      s('volume', 0, 1.5, 0.01, pct),
      s('pan', -1, 1, 0.01, (v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)),
      s('pitch', -12, 12, 0.1, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`),
      s('decay', 0.05, 1, 0.01, pct),
      s('reverbSend', 0, 1, 0.01, pct),
      s('delaySend', 0, 1, 0.01, pct),
      h(
        'td',
        { class: 'sound-cell' },
        h(
          'button',
          {
            class: 'btn small',
            title: 'Load your own sample (wav, mp3, ogg, flac)',
            onclick: async () => {
              const f = await pickFile('audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff');
              if (f) await app.loadTrackSample(id, f);
            },
          },
          'Load…',
        ),
        soundName,
        resetBtn,
      ),
    );
  });
  return h('table', { class: 'mixer' }, h('thead', null, h('tr', null, ...cols.map((c) => h('th', null, c)))), h('tbody', null, ...rows));
}

function buildEffects(app: App, b: Bindings): HTMLElement {
  const { store } = app;
  const d = defaultEffects();
  const fx = () => store.project.effects;
  const set = <K extends keyof Effects>(k: K, field: keyof Effects[K], key: string) => (v: number) =>
    store.update((p) => ((p.effects[k] as Record<string, unknown>)[field as string] = v), { coalesce: key });

  const card = (k: keyof Effects, title: string, ...controls: HTMLElement[]) => {
    const toggle = h('input', { type: 'checkbox', title: `Enable ${title}` });
    toggle.addEventListener('change', () => store.update((p) => (p.effects[k].enabled = toggle.checked)));
    const el = h('div', { class: 'fx-card' }, h('label', { class: 'fx-head' }, toggle, h('span', null, title)), ...controls);
    b.add(() => {
      toggle.checked = fx()[k].enabled;
      el.classList.toggle('off', !fx()[k].enabled);
    });
    return el;
  };

  const select = <T extends string>(options: readonly T[], get: () => T, onSet: (v: T) => void, label: string) => {
    const s = h('select', null, ...options.map((o) => h('option', { value: o }, o)));
    s.addEventListener('change', () => onSet(s.value as T));
    b.add(() => (s.value = get()));
    return h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, label), s);
  };

  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

  return h(
    'div',
    { class: 'fx-grid' },
    card(
      'reverb',
      'Reverb',
      slider(b, { label: 'Size', min: 0.2, max: 6, step: 0.05, reset: d.reverb.decay, get: () => fx().reverb.decay, set: set('reverb', 'decay', 'rv-d'), format: (v) => `${v.toFixed(1)} s` }),
      slider(b, { label: 'Pre-delay', min: 0, max: 120, step: 1, reset: d.reverb.preDelay, get: () => fx().reverb.preDelay, set: set('reverb', 'preDelay', 'rv-p'), format: (v) => `${Math.round(v)} ms` }),
      slider(b, { label: 'Level', min: 0, max: 1, step: 0.01, reset: d.reverb.mix, get: () => fx().reverb.mix, set: set('reverb', 'mix', 'rv-m'), format: pct }),
    ),
    card(
      'delay',
      'Delay',
      select(DELAY_DIVISIONS, () => fx().delay.division, (v: DelayDivision) => store.update((p) => (p.effects.delay.division = v)), 'Time'),
      slider(b, { label: 'Feedback', min: 0, max: 0.9, step: 0.01, reset: d.delay.feedback, get: () => fx().delay.feedback, set: set('delay', 'feedback', 'dl-f'), format: pct }),
      slider(b, { label: 'Tone', min: 300, max: 16000, step: 1, log: true, reset: d.delay.tone, get: () => fx().delay.tone, set: set('delay', 'tone', 'dl-t'), format: hz }),
      slider(b, { label: 'Level', min: 0, max: 1, step: 0.01, reset: d.delay.mix, get: () => fx().delay.mix, set: set('delay', 'mix', 'dl-m'), format: pct }),
    ),
    card(
      'filter',
      'Filter',
      select(['lowpass', 'highpass', 'bandpass'] as const, () => fx().filter.type, (v: FilterType) => store.update((p) => (p.effects.filter.type = v)), 'Type'),
      slider(b, { label: 'Cutoff', min: 40, max: 20000, step: 1, log: true, reset: d.filter.frequency, get: () => fx().filter.frequency, set: set('filter', 'frequency', 'fl-f'), format: hz }),
      slider(b, { label: 'Resonance', min: 0.1, max: 18, step: 0.1, reset: d.filter.q, get: () => fx().filter.q, set: set('filter', 'q', 'fl-q'), format: (v) => v.toFixed(1) }),
    ),
    card(
      'compressor',
      'Compressor',
      slider(b, { label: 'Threshold', min: -60, max: 0, step: 0.5, reset: d.compressor.threshold, get: () => fx().compressor.threshold, set: set('compressor', 'threshold', 'c-t'), format: (v) => `${v.toFixed(1)} dB` }),
      slider(b, { label: 'Ratio', min: 1, max: 20, step: 0.1, reset: d.compressor.ratio, get: () => fx().compressor.ratio, set: set('compressor', 'ratio', 'c-r'), format: (v) => `${v.toFixed(1)}:1` }),
      slider(b, { label: 'Attack', min: 0, max: 0.2, step: 0.001, reset: d.compressor.attack, get: () => fx().compressor.attack, set: set('compressor', 'attack', 'c-a'), format: (v) => `${Math.round(v * 1000)} ms` }),
      slider(b, { label: 'Release', min: 0.01, max: 1, step: 0.01, reset: d.compressor.release, get: () => fx().compressor.release, set: set('compressor', 'release', 'c-rl'), format: (v) => `${Math.round(v * 1000)} ms` }),
      slider(b, { label: 'Makeup', min: 0, max: 18, step: 0.5, reset: d.compressor.makeup, get: () => fx().compressor.makeup, set: set('compressor', 'makeup', 'c-m'), format: (v) => `+${v.toFixed(1)} dB` }),
    ),
  );
}

export function buildBottom(app: App): { el: HTMLElement; update(): void } {
  const b = new Bindings();
  const { store } = app;
  const mixer = buildMixer(app, b);
  const effects = buildEffects(app, b);
  const tab = (id: 'mixer' | 'effects', label: string) => {
    const t = h('button', { class: 'tab', onclick: () => store.setUi({ bottomTab: id }) }, label);
    b.add(() => t.classList.toggle('selected', store.ui.bottomTab === id));
    return t;
  };
  const body = h('div', { class: 'bottom-body' });
  let shown = '';
  b.add(() => {
    if (shown === store.ui.bottomTab) return;
    shown = store.ui.bottomTab;
    body.replaceChildren(shown === 'mixer' ? mixer : effects);
  });
  const el = h('section', { class: 'panel bottom' }, h('div', { class: 'tabs' }, tab('mixer', 'Mixer'), tab('effects', 'Effects')), body);
  return { el, update: () => b.run() };
}
