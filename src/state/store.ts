import type { Project } from '../types';

export interface UiState {
  selectedPatternId: string;
  mode: 'pattern' | 'song';
  /** In song mode, show the pattern that is playing. */
  follow: boolean;
  bottomTab: 'mixer' | 'effects';
}

export interface UpdateOptions {
  /** Consecutive updates with the same key within a short window share one undo step. */
  coalesce?: string;
  /** Don't record this change in the undo history. */
  noHistory?: boolean;
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;

type Snapshot = string;

export class Store {
  project: Project;
  ui: UiState;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;
  private listeners = new Set<(projectChanged: boolean) => void>();

  constructor(project: Project, ui?: Partial<UiState>) {
    this.project = project;
    this.ui = {
      selectedPatternId: project.patterns[0].id,
      mode: 'pattern',
      follow: true,
      bottomTab: 'mixer',
      ...ui,
    };
    this.fixSelection();
  }

  subscribe(fn: (projectChanged: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(projectChanged: boolean) {
    for (const fn of this.listeners) fn(projectChanged);
  }

  /** Project snapshot without the (large, append-only) sample data. */
  private snapshot(): Snapshot {
    return JSON.stringify({ ...this.project, samples: undefined });
  }

  private restore(s: Snapshot) {
    const samples = this.project.samples;
    this.project = { ...(JSON.parse(s) as Project), samples };
    this.fixSelection();
  }

  private fixSelection() {
    if (!this.project.patterns.some((p) => p.id === this.ui.selectedPatternId)) {
      this.ui.selectedPatternId = this.project.patterns[0]?.id ?? '';
    }
  }

  update(fn: (p: Project) => void, opts: UpdateOptions = {}) {
    if (!opts.noHistory) {
      const now = performance.now();
      const merge = opts.coalesce && opts.coalesce === this.lastKey && now - this.lastTime < COALESCE_MS;
      if (!merge) {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      }
      this.redoStack = [];
      this.lastKey = opts.coalesce ?? null;
      this.lastTime = now;
    }
    fn(this.project);
    this.fixSelection();
    this.emit(true);
  }

  setUi(partial: Partial<UiState>) {
    Object.assign(this.ui, partial);
    this.fixSelection();
    this.emit(false);
  }

  replaceProject(project: Project) {
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.lastKey = null;
    this.project = project;
    this.ui.selectedPatternId = project.patterns[0].id;
    this.emit(true);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.lastKey = null;
    this.emit(true);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.lastKey = null;
    this.emit(true);
  }

  get selectedPattern() {
    return this.project.patterns.find((p) => p.id === this.ui.selectedPatternId) ?? this.project.patterns[0];
  }
}
