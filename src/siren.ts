// Synthesized wake siren: two detuned oscillators swept by an LFO. No audio files.

type Ctx = AudioContext;

export class Siren {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private stopTimer = 0;
  private nodes: AudioNode[] = [];
  private volume = 0.6;
  onChange: (ringing: boolean) => void = () => {};

  get ringing(): boolean {
    return this.nodes.length > 0;
  }

  /** Create or resume the context. Call from a user gesture so browsers allow playback. */
  unlock(): boolean {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return true;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume * 0.35, this.ctx.currentTime, 0.02);
  }

  /** Play for `seconds`. Returns false when Web Audio is unavailable or still locked. */
  play(seconds = 4): boolean {
    if (!this.unlock() || !this.ctx || !this.master) return false;
    this.stop();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.05);
    env.gain.setValueAtTime(1, t + seconds - 0.15);
    env.gain.linearRampToValueAtTime(0, t + seconds);
    env.connect(this.master);

    const lfo = ctx.createOscillator();
    lfo.type = "triangle";
    lfo.frequency.value = 1.6;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 260;
    lfo.connect(lfoDepth);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.connect(env);

    const oscs = [0, 7].map((detune) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 760;
      o.detune.value = detune;
      lfoDepth.connect(o.frequency);
      o.connect(filter);
      return o;
    });

    // A short square chirp on top so the alarm cuts through speech on a stream.
    const chirp = ctx.createOscillator();
    const chirpGain = ctx.createGain();
    chirp.type = "square";
    chirp.frequency.value = 1320;
    chirpGain.gain.value = 0;
    for (let s = 0; s < seconds; s += 0.625) {
      chirpGain.gain.setValueAtTime(0.18, t + s);
      chirpGain.gain.setValueAtTime(0, t + s + 0.08);
    }
    chirp.connect(chirpGain).connect(env);

    const sources = [lfo, chirp, ...oscs];
    sources.forEach((s) => {
      s.start(t);
      s.stop(t + seconds + 0.05);
    });
    this.nodes = [...sources, env, filter, lfoDepth, chirpGain];
    this.onChange(true);
    this.stopTimer = window.setTimeout(() => this.cleanup(), seconds * 1000 + 100);
    return true;
  }

  stop(): void {
    if (!this.nodes.length) return;
    for (const n of this.nodes) {
      if (n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    window.clearTimeout(this.stopTimer);
    for (const n of this.nodes) n.disconnect();
    const was = this.nodes.length > 0;
    this.nodes = [];
    if (was) this.onChange(false);
  }
}
