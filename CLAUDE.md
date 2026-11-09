# Drums: notes for Claude

A private-use browser drum sequencer. Vite + TypeScript + Web Audio, plain DOM (no framework), no backend.
README.md covers features, the kit manifest format and the code map. This file holds what isn't obvious from it.

## Commands

- `npm run dev` (Vite), `npm test` (vitest, `src/core.test.ts`), `npm run typecheck`, `npm run build`
- TypeScript is 7.x (native port); `tsc --noEmit` is part of `build`.

## Scope agreed with the user

- Desktop only. No mobile work.
- Wanted and built: per-pattern beats (1–16, default 4) and steps per beat (2,3,4,6,8,12,16,32; default 4), velocity/accent
  per step, song = ordered list of pattern ids (repeats allowed), multiple kits with preview, reverb/delay/filter/
  compressor, tap tempo, JSON import/export, WAV export, swing, user samples, keyboard shortcuts.
- Explicitly not wanted: ratchets/rolls, flams, metronome, MIDI in/out.
- New patterns are named P1, P2…; the user found other default names confusing.
- Inspirations: drumbit.app and onemotion.com/drum-machine. Don't copy their code or samples; neither site states a
  license for its sounds. Bundled samples must be clearly licensed (the current ones are GPL, from Hydrogen).

## Architecture decisions

- **Every sound is an AudioBuffer.** Synth kits (`src/audio/synthKits.ts`, data-driven layers) are rendered once per kit with
  an OfflineAudioContext; sampled kits come from `public/kits/kits.json`. The engine never synthesizes live.
- **One mixing graph for live and export**: `MixGraph` (`src/audio/engine.ts`) works on both AudioContext and
  OfflineAudioContext, so a WAV export sounds the same as playback. Keep it that way when adding effects.
- **Scheduler** (`src/audio/transport.ts`): look-ahead (120 ms) driven by a Worker timer, reading the project on every step
  so edits are heard at once. In pattern mode, a pattern change takes effect at the next pattern boundary (shown as "next"
  on the tab). Previews (`transport.preview`) override the kit, pattern or BPM without touching the project.
- **Store** (`src/state/store.ts`): mutate in place via `store.update(fn, {coalesce})`. Undo snapshots are JSON without
  `project.samples` (base64, append-only). Use a `coalesce` key for continuous gestures (sliders, drags, wheel).
- **UI**: each panel builds its DOM once and registers updaters with `Bindings`; structure is rebuilt only when a key
  changes (e.g. grid key = pattern id + beats + subdivision). Don't re-create elements while a slider may be dragged.
  The playhead is updated from a rAF loop, not through the store.
- Resizing a pattern remaps hits by musical time (`resizePattern`); swing applies only to even subdivisions.
- Imported/autosaved data always goes through `normalizeProject` (clamping and repair); add new fields there with defaults.
- Autosave goes to IndexedDB key `autosave`. JSON export embeds only the samples tracks actually use.

## Testing in a browser

- In dev, `window.__app` exposes the `App` instance (store, transport, kits, ctx); handy for driving tests via
  chrome-devtools `evaluate_script`.
- The user can start Chrome with remote debugging (port 9222) on Windows; this runs under WSL. If no browser is
  reachable, a cached headless Chrome exists at `~/.cache/puppeteer/chrome/linux-116.0.5845.96/chrome-linux64/chrome`.
- Audio can't be heard from here: check it by rendering with `renderWav`/OfflineAudioContext and measuring peak/RMS, and
  ask the user to judge the sound by ear.

## Gotchas

- Hydrogen kits ship FLAC in places; convert to WAV with ffmpeg (available) when adding kits.
- Some samples are very quiet (808 cymbal); balance them with the manifest's `gain` map, not by editing the files.
- Reverb "Size" is the RT60 of the generated impulse (`makeImpulse`).
