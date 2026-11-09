import { MAX_BEATS, MIN_BEATS, SUBDIVISIONS, TRACK_IDS, VELOCITY, type Pattern, type Subdivision, type TrackId } from '../types';
import { patternColor, type App } from './app';
import { h } from './dom';
import type { PlayheadState } from './song';

const SUBDIVISION_HINT: Record<Subdivision, string> = {
  2: '8th notes',
  3: '8th triplets',
  4: '16th notes',
  6: '16th triplets',
  8: '32nd notes',
  12: '32nd triplets',
  16: '64th notes',
  32: '128th notes',
};

function velClass(v: number): string {
  if (!v) return '';
  if (v >= 0.95) return 'on accent';
  if (v < 0.6) return 'on soft';
  return 'on';
}

export function buildPatternEditor(app: App, playhead: PlayheadState) {
  const { store } = app;

  // ---------- tabs ----------
  const tabs = h('div', { class: 'tabs' });
  let tabsKey = '';
  const renderTabs = () => {
    tabs.replaceChildren(
      ...store.project.patterns.map((p, i) => {
        const t = h(
          'button',
          {
            class: 'tab',
            dataset: { id: p.id },
            title: `${p.name}${i < 9 ? ` (${i + 1})` : ''}`,
            onclick: () => app.selectPattern(p.id),
          },
          h('span', { class: 'tab-dot' }),
          p.name,
        );
        t.style.setProperty('--c', patternColor(i));
        return t;
      }),
      h('button', { class: 'tab add', title: 'New pattern (N)', onclick: () => app.addPattern() }, '+'),
    );
  };

  // ---------- settings ----------
  const nameInput = h('input', { class: 'pat-name', maxLength: 40, spellcheck: false, title: 'Pattern name' });
  nameInput.addEventListener('change', () => app.renamePattern(store.ui.selectedPatternId, nameInput.value));

  const beatsInput = h('input', { type: 'number', class: 'beats-input', min: MIN_BEATS, max: MAX_BEATS, title: 'Beats in this pattern' });
  const setBeats = (n: number) => {
    const p = store.selectedPattern;
    if (n >= MIN_BEATS && n <= MAX_BEATS && n !== p.beats) app.resize(p.id, n, p.subdivision);
  };
  beatsInput.addEventListener('change', () => setBeats(Math.round(Number(beatsInput.value))));

  const subSelect = h(
    'select',
    { title: 'Steps per beat' },
    ...SUBDIVISIONS.map((s) => h('option', { value: String(s) }, `${s} · ${SUBDIVISION_HINT[s]}`)),
  );
  subSelect.addEventListener('change', () => {
    const p = store.selectedPattern;
    app.resize(p.id, p.beats, Number(subSelect.value) as Subdivision);
  });

  const settings = h(
    'div',
    { class: 'pat-settings' },
    nameInput,
    h(
      'div',
      { class: 'group' },
      h('span', { class: 'lbl' }, 'Beats'),
      h('button', { class: 'btn small', onclick: () => setBeats(store.selectedPattern.beats - 1) }, '−'),
      beatsInput,
      h('button', { class: 'btn small', onclick: () => setBeats(store.selectedPattern.beats + 1) }, '+'),
    ),
    h('div', { class: 'group' }, h('span', { class: 'lbl' }, 'Steps / beat'), subSelect),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn small', title: 'Move pattern left', onclick: () => app.movePattern(store.ui.selectedPatternId, -1) }, '◀'),
    h('button', { class: 'btn small', title: 'Move pattern right', onclick: () => app.movePattern(store.ui.selectedPatternId, 1) }, '▶'),
    h('button', { class: 'btn small', title: 'Append to song (A)', onclick: () => app.songAppend(store.ui.selectedPatternId) }, '→ Song'),
    h('button', { class: 'btn small', title: 'Duplicate (D)', onclick: () => app.duplicatePattern() }, 'Duplicate'),
    h('button', { class: 'btn small', title: 'Remove all hits', onclick: () => app.clearPattern() }, 'Clear'),
    h('button', { class: 'btn small danger', title: 'Delete pattern', onclick: () => app.deletePattern() }, 'Delete'),
  );

  // ---------- grid ----------
  const grid = h('div', { class: 'grid' });
  const gridWrap = h('div', { class: 'grid-wrap' }, grid);
  let gridKey = '';
  let cells: HTMLElement[][] = [];
  let labels: HTMLElement[] = [];
  let headCells: HTMLElement[] = [];
  let lastCol = -1;

  const current = (): Pattern => store.selectedPattern;

  const setStep = (track: TrackId, step: number, v: number, coalesce?: string) => {
    const pid = current().id;
    app.updatePattern(pid, (p) => (p.steps[track][step] = Math.round(v * 100) / 100), coalesce);
  };

  let drag: { mode: 'draw' | 'erase'; key: string } | null = null;
  let dragCounter = 0;

  const cellInfo = (el: EventTarget | null): { track: TrackId; step: number } | null => {
    const c = (el as HTMLElement | null)?.closest?.('.cell') as HTMLElement | null;
    if (!c) return null;
    return { track: c.dataset.track as TrackId, step: Number(c.dataset.step) };
  };

  grid.addEventListener('pointerdown', (e) => {
    const info = cellInfo(e.target);
    if (!info || e.button !== 0) return;
    e.preventDefault();
    const v = current().steps[info.track][info.step];
    if (e.shiftKey) {
      setStep(info.track, info.step, v >= VELOCITY.accent ? VELOCITY.normal : VELOCITY.accent);
      return;
    }
    drag = { mode: v > 0 ? 'erase' : 'draw', key: `paint-${++dragCounter}` };
    setStep(info.track, info.step, drag.mode === 'draw' ? VELOCITY.normal : 0, drag.key);
    if (drag.mode === 'draw' && !app.transport.playing) void app.auditionTrack(info.track, VELOCITY.normal);
  });
  grid.addEventListener('pointerover', (e) => {
    if (!drag || !(e.buttons & 1)) return;
    const info = cellInfo(e.target);
    if (!info) return;
    const v = current().steps[info.track][info.step];
    if (drag.mode === 'draw' && !v) setStep(info.track, info.step, VELOCITY.normal, drag.key);
    if (drag.mode === 'erase' && v) setStep(info.track, info.step, 0, drag.key);
  });
  window.addEventListener('pointerup', () => (drag = null));

  grid.addEventListener('contextmenu', (e) => {
    const info = cellInfo(e.target);
    if (!info) return;
    e.preventDefault();
    const v = current().steps[info.track][info.step];
    const next = !v ? VELOCITY.normal : v >= 0.95 ? VELOCITY.soft : v < 0.6 ? VELOCITY.normal : VELOCITY.accent;
    setStep(info.track, info.step, next);
  });

  grid.addEventListener(
    'wheel',
    (e) => {
      const info = cellInfo(e.target);
      if (!info) return;
      const v = current().steps[info.track][info.step];
      if (!v) return;
      e.preventDefault();
      const nv = Math.min(1, Math.max(0.05, v + (e.deltaY < 0 ? 0.05 : -0.05)));
      setStep(info.track, info.step, nv, `wheel-${info.track}-${info.step}`);
    },
    { passive: false },
  );

  const trackLabel = (id: TrackId): HTMLElement => {
    const t = () => store.project.tracks.find((x) => x.id === id)!;
    const name = h('button', { class: 'track-name', title: 'Click to audition · drop an audio file to replace the sound', onclick: () => void app.auditionTrack(id) });
    const m = h('button', { class: 'ms mute', title: 'Mute', onclick: () => app.updateTrack(id, (x) => (x.mute = !x.mute)) }, 'M');
    const s = h('button', { class: 'ms solo', title: 'Solo', onclick: () => app.updateTrack(id, (x) => (x.solo = !x.solo)) }, 'S');
    const label = h('div', { class: 'track-label', dataset: { track: id } }, name, m, s);
    label.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        label.classList.add('drop');
      }
    });
    label.addEventListener('dragleave', () => label.classList.remove('drop'));
    label.addEventListener('drop', (e) => {
      e.preventDefault();
      label.classList.remove('drop');
      const f = e.dataTransfer?.files[0];
      if (f) void app.loadTrackSample(id, f);
    });
    (label as HTMLElement & { sync?: () => void }).sync = () => {
      const tr = t();
      name.textContent = app.trackName(id);
      name.classList.toggle('custom', !!tr.sampleId);
      if (tr.sampleId) name.title = `Custom sample: ${store.project.samples[tr.sampleId]?.name ?? ''}`;
      m.classList.toggle('active', tr.mute);
      s.classList.toggle('active', tr.solo);
    };
    return label;
  };

  const renderGrid = () => {
    const p = current();
    const n = p.beats * p.subdivision;
    const minCell = n > 96 ? 9 : n > 64 ? 12 : n > 32 ? 16 : 22;
    grid.style.setProperty('--cols', String(n));
    grid.style.setProperty('--cell-min', `${minCell}px`);
    grid.classList.toggle('dense', n > 64);
    cells = [];
    labels = [];
    headCells = [];
    lastCol = -1;

    const head = h('div', { class: 'grid-row head' }, h('div', { class: 'track-label head-label' }, `${p.beats} × ${p.subdivision}`));
    for (let s = 0; s < n; s++) {
      const beatStart = s % p.subdivision === 0;
      const hc = h('div', { class: `head-cell${beatStart ? ' beat-start' : ''}` }, beatStart ? String(s / p.subdivision + 1) : '');
      headCells.push(hc);
      head.append(hc);
    }
    const rows: HTMLElement[] = [head];
    for (const id of TRACK_IDS) {
      const label = trackLabel(id);
      labels.push(label);
      const row = h('div', { class: 'grid-row', dataset: { track: id } }, label);
      const rowCells: HTMLElement[] = [];
      for (let s = 0; s < n; s++) {
        const beat = Math.floor(s / p.subdivision);
        const c = h(
          'div',
          {
            class: `cell${s % p.subdivision === 0 ? ' beat-start' : ''}${beat % 2 ? ' beat-odd' : ''}`,
            dataset: { track: id, step: String(s) },
          },
          h('div', { class: 'vel' }),
        );
        rowCells.push(c);
        row.append(c);
      }
      cells.push(rowCells);
      rows.push(row);
    }
    grid.replaceChildren(...rows);
  };

  const syncCells = () => {
    const p = current();
    TRACK_IDS.forEach((id, ti) => {
      const row = p.steps[id];
      const rowCells = cells[ti];
      for (let s = 0; s < rowCells.length; s++) {
        const v = row[s] ?? 0;
        const c = rowCells[s];
        const want = velClass(v);
        if (c.dataset.v !== String(v)) {
          c.dataset.v = String(v);
          c.classList.remove('on', 'soft', 'accent');
          if (want) c.classList.add(...want.split(' '));
          (c.firstChild as HTMLElement).style.height = `${Math.round(v * 100)}%`;
          c.title = v ? `Velocity ${Math.round(v * 100)}%` : '';
        }
      }
    });
    for (const l of labels) (l as HTMLElement & { sync?: () => void }).sync?.();
    const anySolo = store.project.tracks.some((t) => t.solo);
    store.project.tracks.forEach((t, i) => {
      cells[i]?.[0]?.parentElement?.classList.toggle('silent', anySolo ? !t.solo : t.mute);
    });
  };

  const updatePlayhead = () => {
    const p = current();
    const show = app.transport.playing && playhead.patternId === p.id;
    const col = show ? playhead.step : -1;
    if (col === lastCol) return;
    const setCol = (c: number, on: boolean) => {
      if (c < 0) return;
      headCells[c]?.classList.toggle('playhead', on);
      for (const row of cells) row[c]?.classList.toggle('playhead', on);
    };
    setCol(lastCol, false);
    setCol(col, true);
    lastCol = col;
  };

  const updateTabs = () => {
    const playingId = app.transport.playing && !app.transport.preview ? playhead.patternId : null;
    for (const t of tabs.querySelectorAll<HTMLElement>('.tab[data-id]')) {
      const id = t.dataset.id!;
      t.classList.toggle('selected', id === store.ui.selectedPatternId);
      t.classList.toggle('playing', id === playingId);
      t.classList.toggle(
        'queued',
        !!playingId && app.transport.mode === 'pattern' && id === store.ui.selectedPatternId && id !== playingId,
      );
    }
  };

  const update = () => {
    const p = current();
    const tk = store.project.patterns.map((x) => `${x.id}:${x.name}`).join('|');
    if (tk !== tabsKey) {
      tabsKey = tk;
      renderTabs();
    }
    updateTabs();
    const gk = `${p.id}|${p.beats}|${p.subdivision}`;
    if (gk !== gridKey) {
      gridKey = gk;
      renderGrid();
    }
    syncCells();
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    if (document.activeElement !== beatsInput) beatsInput.value = String(p.beats);
    subSelect.value = String(p.subdivision);
    lastCol = -2; // force playhead refresh
    for (const c of grid.querySelectorAll('.playhead')) c.classList.remove('playhead');
    updatePlayhead();
  };

  const el = h('section', { class: 'panel editor' }, tabs, settings, gridWrap);
  return {
    el,
    update,
    updatePlayhead: () => {
      updatePlayhead();
      updateTabs();
    },
  };
}
