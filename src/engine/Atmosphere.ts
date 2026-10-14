// Ambiance sonore synthétisée (aucun fichier audio) : rumeur de foule, sifflet, clameur de but.
// Muette par défaut ; ne démarre qu'après un geste de l'utilisateur.
export class Atmosphere {
  private ctx: AudioContext | null = null;
  private murmur: GainNode | null = null;
  private pan: StereoPannerNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = false;
  energy = 1;
  /** Volume : 0,5 = discret (public), 1 = plein (présentation). */
  volume = 0.5;

  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.4; }
    }
    this.noise = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
    this.murmur = ctx.createGain(); this.murmur.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    src.connect(bp).connect(this.murmur).connect(this.pan).connect(ctx.destination);
    src.start();
    this.ctx = ctx;
    return ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on && !this.ctx) return;
    const ctx = this.ensure();
    if (on) void ctx.resume();
    this.level(on ? 1 : 0);
  }

  level(k: number) {
    if (!this.ctx || !this.murmur) return;
    const g = this.enabled ? k * (0.035 + this.energy * 0.018) * this.volume * 2 : 0;
    this.murmur.gain.cancelScheduledValues(this.ctx.currentTime);
    this.murmur.gain.linearRampToValueAtTime(g, this.ctx.currentTime + 1.2);
  }

  /** Direction approximative de la foule la plus bruyante (-1 gauche, 1 droite). */
  setPan(p: number) { if (this.pan) this.pan.pan.value = Math.max(-0.8, Math.min(0.8, p)); }

  whistle() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 2900; o.type = 'square';
    const w = 0.03 * this.volume * 2;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(w, t + 0.02); g.gain.setValueAtTime(w, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.42);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.5);
  }

  roar() {
    if (!this.enabled || !this.ctx || !this.noise) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * this.volume * 2, t + 0.4); g.gain.exponentialRampToValueAtTime(0.01, t + 5);
    src.connect(bp).connect(g).connect(ctx.destination); src.start(t); src.stop(t + 5.2);
  }
}
