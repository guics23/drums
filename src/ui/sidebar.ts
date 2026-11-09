import { PRESETS } from '../model/presets';
import type { App } from './app';
import { h } from './dom';

/** Kit browser (select + preview) and preset grooves (preview + add). */
export function buildSidebar(app: App): { el: HTMLElement; update(): void } {
  const kitList = h('div', { class: 'list' });
  const presetList = h('div', { class: 'list' });
  let kitKey = '';

  const renderKits = () => {
    kitList.replaceChildren(
      ...app.kits.kits.map((k) =>
        h(
          'div',
          { class: 'list-item kit', dataset: { id: k.id }, title: k.description, onclick: () => app.selectKit(k.id) },
          h(
            'button',
            {
              class: 'icon-btn preview',
              title: 'Preview this kit with the current pattern (or a demo groove if the pattern is empty)',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                void app.previewKit(k.id);
              },
            },
            '▶',
          ),
          h('div', { class: 'item-text' }, h('div', { class: 'item-name' }, k.name), h('div', { class: 'item-desc' }, k.description)),
          h('span', { class: `badge ${k.source}` }, k.source === 'sample' ? 'WAV' : 'SYN'),
        ),
      ),
    );
  };

  presetList.replaceChildren(
    ...PRESETS.map((p) =>
      h(
        'div',
        { class: 'list-item preset', dataset: { id: p.id } },
        h(
          'button',
          {
            class: 'icon-btn preview',
            title: 'Preview this groove with the current kit',
            onclick: () => void app.previewPreset(p.id),
          },
          '▶',
        ),
        h(
          'div',
          { class: 'item-text' },
          h('div', { class: 'item-name' }, p.name),
          h('div', { class: 'item-desc' }, `${p.bpm} BPM · ${p.beats} beats × ${p.subdivision}`),
        ),
        h('button', { class: 'icon-btn', title: 'Add as a new pattern', onclick: () => app.addPresetPattern(p.id) }, '+'),
      ),
    ),
  );

  const update = () => {
    const key = app.kits.kits.map((k) => k.id).join();
    if (key !== kitKey) {
      kitKey = key;
      renderKits();
    }
    const pv = app.transport.preview?.tag ?? '';
    for (const el of kitList.querySelectorAll<HTMLElement>('.kit')) {
      const id = el.dataset.id!;
      el.classList.toggle('selected', id === app.project.kitId);
      el.classList.toggle('loading', id === app.kitLoading);
      const playing = pv === `kit:${id}`;
      el.classList.toggle('previewing', playing);
      el.querySelector('.preview')!.textContent = playing ? '■' : '▶';
    }
    for (const el of presetList.querySelectorAll<HTMLElement>('.preset')) {
      const playing = pv === `preset:${el.dataset.id}`;
      el.classList.toggle('previewing', playing);
      el.querySelector('.preview')!.textContent = playing ? '■' : '▶';
    }
  };

  const el = h(
    'aside',
    { class: 'sidebar' },
    h('section', null, h('h3', null, 'Kits'), kitList),
    h('section', null, h('h3', null, 'Grooves'), presetList),
  );
  return { el, update };
}
