type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
};

/** Tiny hyperscript helper. `on*` props become event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/**
 * Collects "updater" callbacks for a panel. Panels build their DOM once and
 * register updaters that sync values from state, so controls being dragged are
 * never recreated.
 */
export class Bindings {
  private fns: (() => void)[] = [];
  add(fn: () => void) {
    this.fns.push(fn);
    fn();
  }
  run() {
    for (const fn of this.fns) fn();
  }
  clear() {
    this.fns = [];
  }
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number, done: boolean): void;
  format?(v: number): string;
  /** Value restored on double-click. */
  reset?: number;
  title?: string;
  /** Map slider position to value logarithmically (for frequencies). */
  log?: boolean;
  class?: string;
}

/** Labelled range input with a live value read-out. */
export function slider(b: Bindings, o: SliderOpts): HTMLElement {
  const toPos = (v: number) => (o.log ? (Math.log(v / o.min) / Math.log(o.max / o.min)) * 1000 : v);
  const fromPos = (p: number) => (o.log ? o.min * Math.pow(o.max / o.min, p / 1000) : p);
  const input = h('input', {
    type: 'range',
    min: o.log ? 0 : o.min,
    max: o.log ? 1000 : o.max,
    step: o.log ? 1 : o.step,
    title: o.title ?? `${o.label} (double-click to reset)`,
  });
  const out = h('span', { class: 'slider-value' });
  const fmt = o.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  input.addEventListener('input', () => {
    const v = fromPos(Number(input.value));
    out.textContent = fmt(v);
    o.set(v, false);
  });
  input.addEventListener('change', () => o.set(fromPos(Number(input.value)), true));
  input.addEventListener('dblclick', () => {
    if (o.reset === undefined) return;
    o.set(o.reset, true);
  });
  b.add(() => {
    const v = o.get();
    if (!input.matches(':active')) input.value = String(toPos(v));
    out.textContent = fmt(v);
  });
  return h('label', { class: `slider ${o.class ?? ''}` }, h('span', { class: 'slider-label' }, o.label), input, out);
}

export function iconButton(label: string, title: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`, title, onclick: onClick }, label);
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 3200);
}

export function safeFilename(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'drums';
}
