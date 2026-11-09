# Drums

A browser drum sequencer for private use: Vite + TypeScript + Web Audio, no backend, desktop only.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
```

## Features

- **Patterns** with their own beat count (1–16, default 4) and steps per beat (2, 3, 4, 6, 8, 12, 16, 32; default 4).
  Changing either keeps the notes at their musical position.
- **Velocity per step**: click/drag to paint, right-click cycles normal → accent → soft, Shift+click toggles accent, mouse wheel fine-tunes.
- **Song**: chain patterns in any order with repeats (e.g. `P1 P1 P1 P2 P3 P1 P1 P4`). Drag blocks to reorder, drag a pattern
  from the "Add" row to insert it, double-click a block to play from there. Loop on/off; "Follow" shows the playing pattern.
- **Kits**: sampled kits (multi-velocity acoustic, 808) and synthesized kits. Press ▶ next to a kit to hear the current
  pattern with it (or its demo groove when the pattern is empty) without switching. The **Grooves** list previews and adds
  preset patterns (rock, funk, bossa, hip-hop, house, trap, shuffle…).
- **Mixer**: volume, pan, pitch, decay, reverb/delay sends, mute/solo per track; load your own sample per track
  (Load… button or drop a file on the track name).
- **Effects**: reverb, tempo-synced delay, master filter (LP/HP/BP), compressor.
- **Swing**, **tap tempo**, undo/redo, keyboard shortcuts (press `?` in the app).
- **Files**: autosaves to the browser (IndexedDB); import/export project JSON (custom samples are embedded); export WAV
  (song or pattern × N, 44.1/48 kHz, 16/24-bit, with a reverb tail).

## Adding sample kits

Put the audio files in `public/kits/<folder>/` and add an entry to `public/kits/kits.json`:

```json
{
  "id": "my-kit",
  "name": "My Kit",
  "description": "Shown under the name",
  "dir": "my-kit",
  "demo": "rock",
  "fallback": "synth-analog",
  "sounds": {
    "kick": "kick.wav",
    "snare": ["snare-soft.wav", "snare-med.wav", "snare-hard.wav"]
  },
  "gain": { "snare": 1.5 }
}
```

- Track ids: `kick snare clap rim chh ohh ltom mtom htom crash ride cowbell`.
- An array gives velocity layers ordered soft → hard; the velocity range is split evenly between them.
- Missing tracks use the `fallback` kit's sound. `gain` (optional) is a linear multiplier to balance quiet samples.
- `demo` is the groove id used when previewing the kit over an empty pattern (see `src/model/presets.ts`).
- Any format the browser decodes works (WAV, MP3, OGG, FLAC).

## Bundled samples

- `public/kits/gm-rock`: GMRockKit by Glen MacArthur / Sebastian Moors
- `public/kits/tr808-emu`: TR808EmulationKit by ArtemioLabs (converted from FLAC to WAV)

Both come from the [Hydrogen](https://github.com/hydrogen-music/hydrogen) drum machine and are licensed under the GPL
(see each folder's `drumkit.xml` / `SOURCE.txt`).

## Code map

- `src/types.ts`: data model (project, patterns, tracks, effects)
- `src/model/`: pure logic: pattern resizing/timing, song timeline, presets, tap tempo
- `src/audio/`: synthesis, kit loading, mixing graph and effects, look-ahead scheduler, WAV render/encode
- `src/state/`: store with undo/redo, JSON validation, IndexedDB autosave
- `src/ui/`: DOM panels (header, kits sidebar, song, pattern editor, mixer/effects, dialogs)
