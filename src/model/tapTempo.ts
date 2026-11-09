/** Averages the intervals between recent taps. Resets after a pause. */
export class TapTempo {
  private taps: number[] = [];
  constructor(
    private maxTaps = 6,
    private resetAfterMs = 2000,
  ) {}

  /** Register a tap at `now` (ms). Returns the BPM once at least two taps exist. */
  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > this.resetAfterMs) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return (60000 * (this.taps.length - 1)) / span;
  }

  get count() {
    return this.taps.length;
  }
}
