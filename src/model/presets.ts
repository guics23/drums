import { TRACK_IDS, VELOCITY, type Pattern, type Subdivision, type TrackId } from '../types';
import { createPattern } from './pattern';

export interface PresetDef {
  id: string;
  name: string;
  bpm: number;
  beats: number;
  subdivision: Subdivision;
  /** One string per track: '.' off, 'o' soft, 'x' normal, 'X' accent. Spaces and '|' are ignored. */
  rows: Partial<Record<TrackId, string>>;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'rock', name: 'Rock', bpm: 110, beats: 4, subdivision: 4,
    rows: {
      kick:  'X... .... x.x. ....',
      snare: '.... X... .... X...',
      chh:   'x.x. x.x. x.x. x.x.',
      crash: 'x... .... .... ....',
    },
  },
  {
    id: 'funk', name: 'Funk', bpm: 100, beats: 4, subdivision: 4,
    rows: {
      kick:  'X.x. ...x ..x. .x..',
      snare: '.... X..o .o.o X..o',
      chh:   'xoxo xoxo xoxo xo..',
      ohh:   '.... .... .... ..x.',
    },
  },
  {
    id: 'bossa', name: 'Bossa Nova', bpm: 130, beats: 8, subdivision: 4,
    rows: {
      kick: 'x..x x..x x..x x..x | x..x x..x x..x x..x',
      rim:  'x..x ..x. ..x. .x.. | x..x ..x. ..x. .x..',
      chh:  'xoxo xoxo xoxo xoxo | xoxo xoxo xoxo xoxo',
    },
  },
  {
    id: 'hiphop', name: 'Hip-Hop', bpm: 92, beats: 4, subdivision: 4,
    rows: {
      kick:  'X..x ..x. .xX. ....',
      snare: '.... X... .... X...',
      chh:   'x.x. x.x. x.x. x.xo',
      ohh:   '.... .... .... ..x.',
    },
  },
  {
    id: 'boombap', name: 'Boom Bap', bpm: 88, beats: 4, subdivision: 4,
    rows: {
      kick:  'X... ...x ..X. ....',
      snare: '.... X... .... X..o',
      chh:   'x.x. x.x. x.x. x.x.',
      rim:   '.... .... ...o ....',
    },
  },
  {
    id: 'house', name: 'House', bpm: 124, beats: 4, subdivision: 4,
    rows: {
      kick: 'X... X... X... X...',
      clap: '.... x... .... x...',
      chh:  'o.o. o.o. o.o. o.o.',
      ohh:  '..x. ..x. ..x. ..x.',
    },
  },
  {
    id: 'trap', name: 'Trap', bpm: 140, beats: 4, subdivision: 8,
    rows: {
      kick:  'X....... ......x. ....x... ........',
      snare: '........ ........ X....... ........',
      clap:  '........ ........ x....... ........',
      chh:   'x.x.x.x. x.x.xxxx x.x.x.x. x.xox.xo',
      ohh:   '........ ........ ........ ......x.',
    },
  },
  {
    id: 'electro', name: 'Electro', bpm: 128, beats: 4, subdivision: 4,
    rows: {
      kick:    'X... ..x. ..X. ....',
      snare:   '.... X... .... X...',
      chh:     'xxxx xxxx xxxx xxxx',
      cowbell: '..x. .... x... ..x.',
    },
  },
  {
    id: 'shuffle', name: 'Shuffle', bpm: 96, beats: 4, subdivision: 3,
    rows: {
      kick:  'X.. ..x X.. ...',
      snare: '... X.. ... X.o',
      ride:  'x.x x.x x.x x.x',
    },
  },
  {
    id: 'jazz', name: 'Jazz Brushes', bpm: 132, beats: 4, subdivision: 3,
    rows: {
      ride:  'x.. x.x x.. x.x',
      chh:   '... x.. ... x..',
      kick:  'o.. o.. o.. o..',
      clap:  'x.. ... x.. ...',
      snare: '... ... ... ..o',
    },
  },
  {
    id: 'afro68', name: 'Afro 6/8', bpm: 105, beats: 4, subdivision: 3,
    rows: {
      kick:    'X.. ... x.. ...',
      rim:     '..x .x. ..x .x.',
      cowbell: 'x.x .xx .x. xx.',
      chh:     'o.o o.o o.o o.o',
    },
  },
];

const CHAR_VELOCITY: Record<string, number> = { '.': 0, o: VELOCITY.soft, x: VELOCITY.normal, X: VELOCITY.accent };

export function parseRow(row: string, length: number): number[] {
  const cells = row.replace(/[\s|]/g, '').split('');
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < Math.min(length, cells.length); i++) out[i] = CHAR_VELOCITY[cells[i]] ?? 0;
  return out;
}

export function patternFromPreset(def: PresetDef, name = def.name): Pattern {
  const p = createPattern(name, def.beats, def.subdivision);
  const len = def.beats * def.subdivision;
  for (const id of TRACK_IDS) {
    const row = def.rows[id];
    if (row) p.steps[id] = parseRow(row, len);
  }
  return p;
}

export function findPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}
