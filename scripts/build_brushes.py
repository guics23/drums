"""Build the Brushes kit from Karoryfer Swirly Drums (CC0) dry samples.

usage: python3 -I build_brushes.py <Samples dir> <output dir>
"""
import json, math, os, re, subprocess, sys, tempfile

SRC, OUT = sys.argv[1], sys.argv[2]
LAYER_FRACTIONS = (0.4, 0.6, 0.8, 1.0)  # which source layers to keep, as fractions of the layer count
RR = 4

# track -> (folder, file prefix, number of layers in source, mics {suffix: weight} or None, max seconds, fade out s,
#           target peak of the 3rd layer (the app's 'normal' velocity), label)
PIECES = {
    'kick':    ('marching_kick', 'marching_kick', 22, {'_beater': 1.0, '_reso': 1.0}, 0, 0, 0.40, None),
    'snare':   ('snare_main', 'snare_hit', 12, {'_top': 1.0, '_btm': 0.6}, 0, 0, 0.35, None),
    'rim':     ('snare_edge', 'snare_edge', 10, {'_top': 1.0, '_btm': 0.6}, 0, 0, 0.30, 'Snare Edge'),
    'chh':     ('hat_closed', 'hh_closed', 12, None, 0, 0, 0.22, None),
    'ohh':     ('hat_open', 'hh_open', 14, None, 3.0, 1.0, 0.25, None),
    'ltom':    ('tom_floor', 'tom_floor', 12, None, 0, 0, 0.32, None),
    'mtom':    ('tom_mlow', 'tom_mlow', 12, None, 0, 0, 0.32, None),
    'htom':    ('tom_mhi', 'tom_mhi', 10, None, 0, 0, 0.32, None),
    'crash':   ('crash', 'crash', 12, None, 4.0, 1.5, 0.30, None),
    'ride':    ('ride', 'ride', 15, None, 4.5, 1.5, 0.22, None),
    'cowbell': ('cowbell', 'cowbell', 9, None, 0, 0, 0.20, None),
}


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def peak_db(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'max_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else -90.0


def render(inputs, out, max_s, fade_s, start_s=0.0, fade_in_s=0.0):
    """Mix weighted mono inputs to one float WAV, trimming and fading."""
    args = ['ffmpeg', '-y', '-v', 'error']
    for path, _ in inputs:
        args += ['-i', path]
    parts = [f'[{i}:a]volume={w}[a{i}]' for i, (_, w) in enumerate(inputs)]
    chain = ''.join(f'[a{i}]' for i in range(len(inputs)))
    filt = ';'.join(parts) + f';{chain}amix=inputs={len(inputs)}:normalize=0'
    if start_s:
        filt += f',atrim=start={start_s},asetpts=PTS-STARTPTS'
    if max_s:
        filt += f',atrim=duration={max_s}'
        if fade_s:
            filt += f',afade=t=out:st={max_s - fade_s}:d={fade_s}'
    if fade_in_s:
        filt += f',afade=t=in:d={fade_in_s}'
    run(args + ['-filter_complex', filt, '-c:a', 'pcm_f32le', out])


MAX_PEAK = 0.95


def balance_gain(layer_peaks_db, target_normal):
    """Gain (dB) putting the 3rd layer's peak at target_normal, without the loudest layer exceeding MAX_PEAK."""
    normal = 10 ** (layer_peaks_db[2] / 20)
    loudest = 10 ** (max(layer_peaks_db) / 20)
    return 20 * math.log10(min(target_normal / normal, MAX_PEAK / loudest))


def finalize(tmp_files, gain_db):
    for tmp, final in tmp_files:
        run(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-af', f'volume={gain_db}dB', '-c:a', 'pcm_s16le', final])


os.makedirs(OUT, exist_ok=True)
manifest = {}
labels = {}
with tempfile.TemporaryDirectory() as tmpdir:
    for track, (folder, prefix, nvl, mics, max_s, fade_s, target, label) in PIECES.items():
        # Spread over the upper 60% of the source range: the lowest layers are near-silent ghost strokes.
        chosen = [math.ceil(nvl * f) for f in LAYER_FRACTIONS]
        layers, tmp_files, layer_peaks = [], [], []
        for vl in chosen:
            rr_files, peaks = [], []
            for rr in range(1, RR + 1):
                if mics:
                    inputs = [(os.path.join(SRC, folder, f'{prefix}_vl{vl}_rr{rr}{s}.wav'), w) for s, w in mics.items()]
                else:
                    inputs = [(os.path.join(SRC, folder, f'{prefix}_vl{vl}_rr{rr}.wav'), 1.0)]
                name = f'{track}_v{len(layers) + 1}_rr{rr}.wav'
                tmp = os.path.join(tmpdir, name)
                render(inputs, tmp, max_s, fade_s)
                peaks.append(peak_db(tmp))
                tmp_files.append((tmp, os.path.join(OUT, name)))
                rr_files.append(name)
            layers.append(rr_files)
            layer_peaks.append(max(peaks))
        gain = balance_gain(layer_peaks, target)
        finalize(tmp_files, gain)
        manifest[track] = layers
        if label:
            labels[track] = label
        print(f'{track:8} layers {chosen} gain {gain:+.1f} dB')

    # Brush stir on the clap track: dynamic levels dl1..dl4, main + skin mic, 3 s strokes.
    # stir_dl4_rr1 duplicates its skin-mic file in the source, so it is skipped.
    layers, tmp_files, layer_peaks = [], [], []
    for dl in range(1, 5):
        rr_files, peaks = [], []
        for rr in range(1, 5):
            if dl == 4 and rr == 1:
                continue
            inputs = [(os.path.join(SRC, 'snare_stir', f'stir_dl{dl}_rr{rr}.wav'), 1.0),
                      (os.path.join(SRC, 'snare_stir', f'stir_dl{dl}_skin_rr{rr}.wav'), 0.7)]
            name = f'stir_v{dl}_rr{rr}.wav'
            tmp = os.path.join(tmpdir, name)
            render(inputs, tmp, 3.0, 0.8, start_s=0.5, fade_in_s=0.15)
            peaks.append(peak_db(tmp))
            tmp_files.append((tmp, os.path.join(OUT, name)))
            rr_files.append(name)
        layers.append(rr_files)
        layer_peaks.append(max(peaks))
    gain = balance_gain(layer_peaks, 0.25)
    finalize(tmp_files, gain)
    manifest['clap'] = layers
    labels['clap'] = 'Brush Stir'
    print(f'stir     gain {gain:+.1f} dB')

order = ['kick', 'snare', 'clap', 'rim', 'chh', 'ohh', 'ltom', 'mtom', 'htom', 'crash', 'ride', 'cowbell']
print(json.dumps({'sounds': {t: manifest[t] for t in order}, 'labels': labels}))
