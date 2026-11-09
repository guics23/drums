import { MAX_BPM, MIN_BPM } from '../types';
import type { App } from './app';
import { Bindings, h, pickFile, slider } from './dom';
import { openHelp, openWavExport } from './dialogs';

export function buildHeader(app: App): { el: HTMLElement; update(): void } {
  const b = new Bindings();
  const { store, transport } = app;

  const playBtn = h('button', { class: 'btn play', title: 'Play / stop (Space)', onclick: () => app.togglePlay() });
  b.add(() => {
    const playing = transport.playing && !transport.preview;
    playBtn.textContent = playing ? '■ Stop' : '▶ Play';
    playBtn.classList.toggle('active', playing);
  });

  const modeBtn = (mode: 'pattern' | 'song', label: string) => {
    const el = h('button', { class: 'seg', onclick: () => app.setMode(mode), title: `${label} mode (M toggles)` }, label);
    b.add(() => el.classList.toggle('active', store.ui.mode === mode));
    return el;
  };

  const bpmInput = h('input', {
    type: 'number',
    class: 'bpm-input',
    min: MIN_BPM,
    max: MAX_BPM,
    step: 1,
    title: 'Tempo (BPM). Arrow keys / wheel to adjust',
  });
  bpmInput.addEventListener('change', () => app.setBpm(Number(bpmInput.value)));
  bpmInput.addEventListener('wheel', (e) => {
    e.preventDefault();
    app.setBpm(store.project.bpm + (e.deltaY < 0 ? 1 : -1), false);
  });
  b.add(() => {
    if (document.activeElement !== bpmInput) bpmInput.value = String(store.project.bpm);
  });

  const tapBtn = h('button', { class: 'btn', title: 'Tap tempo (T)', onclick: () => app.tapTempo() }, 'Tap');

  const nameInput = h('input', { class: 'name-input', maxLength: 60, title: 'Project name', spellcheck: false });
  nameInput.addEventListener('change', () => store.update((p) => (p.name = nameInput.value.trim() || 'Untitled')));
  b.add(() => {
    if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  });

  const undoBtn = h('button', { class: 'btn', title: 'Undo (Ctrl+Z)', onclick: () => store.undo() }, '↶');
  const redoBtn = h('button', { class: 'btn', title: 'Redo (Ctrl+Shift+Z)', onclick: () => store.redo() }, '↷');
  b.add(() => {
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
  });

  const el = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '◼◻◼◻'), nameInput),
    h('div', { class: 'group' }, playBtn, h('div', { class: 'segmented' }, modeBtn('pattern', 'Pattern'), modeBtn('song', 'Song'))),
    h('div', { class: 'group' }, h('span', { class: 'lbl' }, 'BPM'), bpmInput, tapBtn),
    h(
      'div',
      { class: 'group' },
      slider(b, {
        label: 'Swing',
        min: 0,
        max: 1,
        step: 0.01,
        reset: 0,
        get: () => store.project.swing,
        set: (v) => store.update((p) => (p.swing = v), { coalesce: 'swing' }),
        format: (v) => `${Math.round(v * 100)}%`,
        title: 'Swing: delays every second step (even subdivisions only)',
      }),
      slider(b, {
        label: 'Master',
        min: 0,
        max: 1.5,
        step: 0.01,
        reset: 0.9,
        get: () => store.project.masterVolume,
        set: (v) => store.update((p) => (p.masterVolume = v), { coalesce: 'master' }),
        format: (v) => `${Math.round(v * 100)}%`,
      }),
    ),
    h('div', { class: 'group' }, undoBtn, redoBtn),
    h(
      'div',
      { class: 'group right' },
      h('button', { class: 'btn', title: 'New project', onclick: () => app.newProject() }, 'New'),
      h(
        'button',
        {
          class: 'btn',
          title: 'Import project (.json)',
          onclick: async () => {
            const f = await pickFile('.json,application/json');
            if (f) await app.importJson(f);
          },
        },
        'Import',
      ),
      h('button', { class: 'btn', title: 'Export project as JSON (Ctrl+S)', onclick: () => app.exportJson() }, 'Export JSON'),
      h('button', { class: 'btn accent', title: 'Render to WAV', onclick: () => openWavExport(app) }, 'Export WAV'),
      h('button', { class: 'btn', title: 'Keyboard shortcuts (?)', onclick: () => openHelp() }, '?'),
    ),
  );
  return { el, update: () => b.run() };
}
