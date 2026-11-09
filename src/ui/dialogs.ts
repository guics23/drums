import { resolveSequence, buildTimeline } from '../model/timeline';
import type { App } from './app';
import { h, toast } from './dom';

function modal(title: string, body: HTMLElement, actions: HTMLElement[]): HTMLDialogElement {
  const dlg = h(
    'dialog',
    { class: 'modal' },
    h('h2', null, title),
    body,
    h('div', { class: 'modal-actions' }, ...actions),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function field(label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', null, hint) : null);
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function openWavExport(app: App) {
  const songEmpty = app.project.song.length === 0;
  const source = h(
    'select',
    null,
    h('option', { value: 'song', disabled: songEmpty }, songEmpty ? 'Song (empty)' : 'Song'),
    h('option', { value: 'pattern' }, `Current pattern (${app.store.selectedPattern.name})`),
  );
  source.value = app.store.ui.mode === 'song' && !songEmpty ? 'song' : 'pattern';
  const loops = h('input', { type: 'number', min: 1, max: 64, value: '1' });
  const tail = h('input', { type: 'number', min: 0, max: 10, step: 0.5, value: '2' });
  const rate = h('select', null, h('option', { value: '44100' }, '44.1 kHz'), h('option', { value: '48000' }, '48 kHz'));
  const depth = h('select', null, h('option', { value: '16' }, '16-bit'), h('option', { value: '24' }, '24-bit'));
  const info = h('p', { class: 'muted' });
  const updateInfo = () => {
    const seq = resolveSequence(app.project, source.value as 'song' | 'pattern', app.store.ui.selectedPatternId, Number(loops.value) || 1);
    const { duration } = buildTimeline(app.project, seq);
    info.textContent = `Length: ${formatTime(duration)} + ${tail.value || 0}s tail · ${seq.length} pattern${seq.length === 1 ? '' : 's'}`;
  };
  for (const el of [source, loops, tail]) el.addEventListener('input', updateInfo);
  updateInfo();

  const renderBtn = h('button', { class: 'btn accent' }, 'Render WAV');
  const cancelBtn = h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel');
  const dlg = modal(
    'Export WAV',
    h(
      'div',
      { class: 'form' },
      field('Source', source),
      field('Repeat', loops, 'times'),
      field('Tail', tail, 'seconds of reverb/delay ring-out'),
      field('Sample rate', rate),
      field('Bit depth', depth),
      info,
    ),
    [cancelBtn, renderBtn],
  );
  renderBtn.addEventListener('click', async () => {
    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering…';
    try {
      await app.exportWav({
        source: source.value as 'song' | 'pattern',
        loops: Math.max(1, Math.min(64, Number(loops.value) || 1)),
        tail: Math.max(0, Math.min(10, Number(tail.value) || 0)),
        sampleRate: Number(rate.value),
        bitDepth: Number(depth.value) as 16 | 24,
      });
      dlg.close();
      toast('WAV exported');
    } catch (err) {
      toast(`Export failed: ${(err as Error).message}`, 'error');
      renderBtn.disabled = false;
      renderBtn.textContent = 'Render WAV';
    }
  });
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / stop'],
  ['M', 'Toggle Pattern / Song mode'],
  ['T', 'Tap tempo'],
  ['1 – 9', 'Select pattern 1–9'],
  ['[ / ]', 'Previous / next pattern'],
  ['N', 'New pattern'],
  ['D', 'Duplicate pattern'],
  ['A', 'Append current pattern to the song'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+S', 'Export project JSON'],
  ['?', 'This help'],
];

const MOUSE: [string, string][] = [
  ['Click / drag', 'Add or remove hits'],
  ['Right-click', 'Cycle velocity: normal → accent → soft'],
  ['Shift+click', 'Toggle accent'],
  ['Mouse wheel on a hit', 'Fine-tune velocity'],
  ['Click track name', 'Audition the sound'],
  ['Drop audio file on track name', 'Replace the sound with your own sample'],
  ['Double-click a slider', 'Reset to default'],
  ['Drag song blocks', 'Reorder the song; double-click to play from there'],
];

export function openHelp() {
  const table = (rows: [string, string][]) =>
    h('table', { class: 'keys' }, ...rows.map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v))));
  const close = h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close');
  const dlg = modal('Shortcuts', h('div', { class: 'help' }, h('h3', null, 'Keyboard'), table(SHORTCUTS), h('h3', null, 'Mouse'), table(MOUSE)), [close]);
}
