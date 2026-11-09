import './styles.css';
import type { Project } from './types';
import { App } from './ui/app';
import { h, toast } from './ui/dom';
import { buildHeader } from './ui/header';
import { buildSidebar } from './ui/sidebar';
import { buildSong, type PlayheadState } from './ui/song';
import { buildPatternEditor } from './ui/patternEditor';
import { buildBottom } from './ui/mixer';
import { openHelp } from './ui/dialogs';
import { Store, type UiState } from './state/store';
import { createDefaultProject } from './state/defaults';
import { normalizeProject } from './state/serialize';
import { kvGet, kvSet } from './state/persist';

interface Saved {
  project: Project;
  ui?: Partial<UiState>;
}

async function loadSaved(): Promise<Saved | null> {
  try {
    const saved = await kvGet<Saved>('autosave');
    if (!saved) return null;
    return { project: normalizeProject(saved.project), ui: saved.ui };
  } catch (err) {
    console.warn('Autosave could not be restored', err);
    return null;
  }
}

async function main() {
  const root = document.getElementById('app')!;
  root.textContent = 'Loading…';

  const saved = await loadSaved();
  const store = new Store(saved?.project ?? createDefaultProject(), saved?.ui);
  const app = new App(store);
  await app.init();
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

  const playhead: PlayheadState = { patternId: null, songIndex: -1, step: -1 };
  const header = buildHeader(app);
  const sidebar = buildSidebar(app);
  const song = buildSong(app, playhead);
  const editor = buildPatternEditor(app, playhead);
  const bottom = buildBottom(app);

  root.replaceChildren(
    header.el,
    h('div', { class: 'layout' }, sidebar.el, h('main', { class: 'main' }, song.el, editor.el, bottom.el)),
  );

  const updateAll = () => {
    header.update();
    sidebar.update();
    song.update();
    editor.update();
    bottom.update();
  };
  updateAll();

  // Render at most once per frame no matter how many changes arrive.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      updateAll();
    });
  };

  let saveTimer: number | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      kvSet('autosave', { project: store.project, ui: store.ui }).catch((err) => console.warn('Autosave failed', err));
    }, 400);
  };

  store.subscribe(() => {
    schedule();
    save();
  });
  app.transport.onChange(() => {
    if (!app.transport.playing) {
      playhead.patternId = null;
      playhead.songIndex = -1;
      playhead.step = -1;
    }
    schedule();
  });

  // Playhead animation, synced to the audio clock.
  const frame = () => {
    const ev = app.transport.consumeVisual(app.ctx.currentTime);
    if (ev && app.transport.playing) {
      const patternChanged = ev.patternId !== playhead.patternId || ev.songIndex !== playhead.songIndex;
      playhead.patternId = ev.patternId;
      playhead.songIndex = ev.songIndex;
      playhead.step = ev.step;
      if (
        patternChanged &&
        store.ui.mode === 'song' &&
        store.ui.follow &&
        !app.transport.preview &&
        ev.patternId !== store.ui.selectedPatternId
      ) {
        store.setUi({ selectedPatternId: ev.patternId });
      }
      if (patternChanged) schedule();
      editor.updatePlayhead();
      song.updatePlayhead();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  installShortcuts(app);

  // Drop a project file anywhere to import it.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    if (f.name.endsWith('.json')) void app.importJson(f);
    else toast('Drop audio files on a track name to use them as samples');
  });
}

function installShortcuts(app: App) {
  const { store } = app;
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input:not([type=range]):not([type=checkbox]), select, textarea, [contenteditable]');
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      if (typing) return;
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      app.exportJson();
      return;
    }
    if (typing || mod || e.altKey) return;

    const patterns = store.project.patterns;
    const idx = patterns.findIndex((p) => p.id === store.ui.selectedPatternId);
    switch (e.key) {
      case ' ':
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        app.togglePlay();
        break;
      case 'm':
      case 'M':
        app.setMode(store.ui.mode === 'pattern' ? 'song' : 'pattern');
        break;
      case 't':
      case 'T':
        app.tapTempo();
        break;
      case 'n':
      case 'N':
        app.addPattern();
        break;
      case 'd':
      case 'D':
        app.duplicatePattern();
        break;
      case 'a':
      case 'A':
        app.songAppend(store.ui.selectedPatternId);
        toast(`Added ${store.selectedPattern.name} to the song`);
        break;
      case '[':
        if (idx > 0) app.selectPattern(patterns[idx - 1].id);
        break;
      case ']':
        if (idx < patterns.length - 1) app.selectPattern(patterns[idx + 1].id);
        break;
      case '?':
        openHelp();
        break;
      default:
        if (/^[1-9]$/.test(e.key)) {
          const p = patterns[Number(e.key) - 1];
          if (p) app.selectPattern(p.id);
        }
    }
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('app')!.textContent = `Failed to start: ${(err as Error).message}`;
});
