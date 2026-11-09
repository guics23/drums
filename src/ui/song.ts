import { patternDuration } from '../model/pattern';
import { patternColor, type App } from './app';
import { h } from './dom';

export interface PlayheadState {
  patternId: string | null;
  songIndex: number;
  step: number;
}

const DND_SONG = 'application/x-song-index';
const DND_PATTERN = 'application/x-pattern-id';

/** Song arrangement: an ordered strip of pattern blocks (repeats allowed). */
export function buildSong(app: App, playhead: PlayheadState): { el: HTMLElement; update(): void; updatePlayhead(): void } {
  const { store } = app;
  const strip = h('div', { class: 'song-strip' });
  const palette = h('div', { class: 'song-palette' });
  const info = h('span', { class: 'muted' });
  let key = '';

  const loopBtn = h('button', { class: 'btn toggle', title: 'Loop the song', onclick: () => store.update((p) => (p.songLoop = !p.songLoop)) }, '⟲ Loop');
  const followBtn = h(
    'button',
    { class: 'btn toggle', title: 'While playing the song, show the pattern that is playing', onclick: () => store.setUi({ follow: !store.ui.follow }) },
    'Follow',
  );

  /** Index at which a drop at clientX would insert. */
  const dropIndex = (clientX: number): number => {
    const blocks = [...strip.querySelectorAll<HTMLElement>('.song-block')];
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return blocks.length;
  };

  const clearMarkers = () => strip.querySelectorAll('.drop-before,.drop-after').forEach((e) => e.classList.remove('drop-before', 'drop-after'));

  strip.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes(DND_SONG) && !types.includes(DND_PATTERN)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = types.includes(DND_SONG) ? 'move' : 'copy';
    clearMarkers();
    const i = dropIndex(e.clientX);
    const blocks = strip.querySelectorAll<HTMLElement>('.song-block');
    if (i < blocks.length) blocks[i].classList.add('drop-before');
    else blocks[blocks.length - 1]?.classList.add('drop-after');
  });
  strip.addEventListener('dragleave', (e) => {
    if (!strip.contains(e.relatedTarget as Node)) clearMarkers();
  });
  strip.addEventListener('drop', (e) => {
    e.preventDefault();
    clearMarkers();
    const to = dropIndex(e.clientX);
    const from = e.dataTransfer?.getData(DND_SONG);
    const pid = e.dataTransfer?.getData(DND_PATTERN);
    if (from) {
      const f = Number(from);
      app.songMove(f, f < to ? to - 1 : to);
    } else if (pid) app.songInsert(to, pid);
  });

  const render = () => {
    const p = store.project;
    const idx = new Map(p.patterns.map((x, i) => [x.id, i]));
    strip.replaceChildren(
      ...p.song.map((pid, i) => {
        const pi = idx.get(pid) ?? 0;
        const pat = p.patterns[pi];
        const block = h(
          'div',
          {
            class: 'song-block',
            draggable: true,
            dataset: { index: String(i), pid },
            style: { flexGrow: String(pat.beats) },
            title: `${pat.name} · ${pat.beats} beats\nClick: edit · Double-click: play from here · Drag: move`,
            onclick: () => app.selectPattern(pid),
            ondblclick: () => {
              app.setMode('song');
              app.transport.stop();
              void app.play(i);
            },
            ondragstart: (e: DragEvent) => {
              e.dataTransfer!.setData(DND_SONG, String(i));
              e.dataTransfer!.effectAllowed = 'move';
            },
          },
          h('span', { class: 'song-pos' }, String(i + 1)),
          h('span', { class: 'song-name' }, pat.name),
          h(
            'button',
            {
              class: 'song-x',
              title: 'Remove from song',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                app.songRemove(i);
              },
            },
            '×',
          ),
        );
        block.style.setProperty('--c', patternColor(pi));
        return block;
      }),
    );
    if (p.song.length === 0) strip.append(h('div', { class: 'song-empty' }, 'Song is empty. Click + below (or drag a pattern here) to add blocks.'));

    palette.replaceChildren(
      h('span', { class: 'lbl' }, 'Add:'),
      ...p.patterns.map((pat, i) => {
        const b = h(
          'button',
          {
            class: 'pal-btn',
            draggable: true,
            title: `Append ${pat.name} to the song (or drag it into position)`,
            onclick: () => app.songAppend(pat.id),
            ondragstart: (e: DragEvent) => {
              e.dataTransfer!.setData(DND_PATTERN, pat.id);
              e.dataTransfer!.effectAllowed = 'copy';
            },
          },
          `+ ${pat.name}`,
        );
        b.style.setProperty('--c', patternColor(i));
        return b;
      }),
      h('button', { class: 'btn small', title: 'Remove everything from the song', onclick: () => app.songClear() }, 'Clear'),
    );

    const byId = new Map(p.patterns.map((x) => [x.id, x]));
    const secs = p.song.reduce((s, id) => s + patternDuration(byId.get(id)!, p.bpm), 0);
    const beats = p.song.reduce((s, id) => s + (byId.get(id)?.beats ?? 0), 0);
    info.textContent = `${p.song.length} blocks · ${beats} beats · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  };

  const updatePlayhead = () => {
    const active = app.transport.playing && app.transport.mode === 'song' && !app.transport.preview ? playhead.songIndex : -1;
    for (const b of strip.querySelectorAll<HTMLElement>('.song-block')) {
      b.classList.toggle('playing', Number(b.dataset.index) === active);
    }
  };

  const update = () => {
    const p = store.project;
    const k = JSON.stringify([p.song, p.patterns.map((x) => [x.id, x.name, x.beats]), p.bpm]);
    if (k !== key) {
      key = k;
      render();
    }
    for (const b of strip.querySelectorAll<HTMLElement>('.song-block')) b.classList.toggle('selected', b.dataset.pid === store.ui.selectedPatternId);
    loopBtn.classList.toggle('active', p.songLoop);
    followBtn.classList.toggle('active', store.ui.follow);
    el.classList.toggle('song-mode', store.ui.mode === 'song');
    updatePlayhead();
  };

  const el = h(
    'section',
    { class: 'panel song' },
    h('div', { class: 'panel-head' }, h('h3', null, 'Song'), info, h('div', { class: 'spacer' }), followBtn, loopBtn),
    strip,
    palette,
  );
  return { el, update, updatePlayhead };
}
