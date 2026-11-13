// Minecraft mode scene sounds, all made on the spot with the Web Audio API: no sound files, nothing from the
// internet, nothing from any game. A grunt is a buzzy voice (sawtooth) pushed through a nasal "mm" filter with a
// pitch curve; "hrrm" adds a rolled r (a fast wobble on the volume); a clink is three bell-like partials that die
// fast; a zap is crackling filtered noise.
//
// The scene (Scene.tsx) only calls these while mcRunState().audio is true. Between sounds the context is
// suspended, so an idle scene costs no audio thread.

export type GruntKind = "hmm" | "hrrm" | "huh" | "oof" | "grr" | "yay" | "zzz";

/** Each worker has his own voice. */
export const VOICES: Record<string, { f0: number; formant: number }> = {
  gus: { f0: 98, formant: 520 },
  bram: { f0: 132, formant: 640 },
  pip: { f0: 168, formant: 760 },
};

type Ctx = AudioContext;
const AC = (): (new () => AudioContext) | null =>
  typeof window === "undefined" ? null : ((window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext || null);

export class McAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private idle = 0;
  private live = 0;
  private closed = false;

  /** Make (or wake) the context. Returns null where Web Audio is missing. */
  private ready(): Ctx | null {
    if (this.closed) return null;
    if (!this.ctx) {
      const C = AC();
      if (!C) return null;
      try { this.ctx = new C(); } catch { return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    window.clearTimeout(this.idle);
    return this.ctx;
  }

  /** Called after each sound: once nothing has played for a while, suspend so the audio thread sleeps. */
  private rest(ms: number) {
    this.live++;
    window.setTimeout(() => {
      this.live--;
      if (this.live > 0) return;
      window.clearTimeout(this.idle);
      this.idle = window.setTimeout(() => { if (this.ctx && this.ctx.state === "running") void this.ctx.suspend().catch(() => {}); }, 600);
    }, ms);
  }

  private noise(ctx: Ctx): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    return (this.noiseBuf = b);
  }

  /** The browser only lets sound start after a click: the scene calls this on any pointer down. */
  unlock() { const c = this.ready(); if (c) this.rest(50); }

  /** A worker's grunt. */
  grunt(who: string, kind: GruntKind, vol = 1) {
    const ctx = this.ready(); if (!ctx || !this.master) return;
    if (kind === "zzz") return this.snore(vol);
    const v = VOICES[who] || VOICES.gus;
    const t = ctx.currentTime + 0.02;
    const dur = kind === "hmm" ? 0.55 : kind === "hrrm" ? 0.7 : kind === "huh" ? 0.32 : kind === "grr" ? 0.42 : kind === "yay" ? 0.38 : 0.26;
    const f = v.f0 * (0.94 + Math.random() * 0.12);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const fq = osc.frequency;
    fq.setValueAtTime(f, t);
    if (kind === "hmm") { fq.linearRampToValueAtTime(f * 1.18, t + dur * 0.45); fq.linearRampToValueAtTime(f * 0.92, t + dur); }
    else if (kind === "hrrm") { fq.setValueAtTime(f * 0.95, t); fq.linearRampToValueAtTime(f * 0.78, t + dur); }
    else if (kind === "huh") { fq.setValueAtTime(f * 0.9, t); fq.exponentialRampToValueAtTime(f * 1.45, t + dur); }
    else if (kind === "grr") { fq.setValueAtTime(f * 0.85, t); fq.linearRampToValueAtTime(f * 1.05, t + dur * 0.3); fq.linearRampToValueAtTime(f * 0.7, t + dur); } // annoyed
    else if (kind === "yay") { fq.setValueAtTime(f * 1.2, t); fq.exponentialRampToValueAtTime(f * 1.9, t + dur * 0.6); fq.exponentialRampToValueAtTime(f * 1.6, t + dur); } // happy
    else { fq.setValueAtTime(f * 1.3, t); fq.exponentialRampToValueAtTime(f * 0.7, t + dur); }

    // A closed mouth "mm": a low resonance and very little top end.
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = v.formant * (kind === "huh" || kind === "oof" ? 1.9 : kind === "yay" ? 2.6 : kind === "grr" ? 1.3 : 1); lp.Q.value = 2.2;
    const body = ctx.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 260; body.gain.value = 8; body.Q.value = 1.2;
    const env = ctx.createGain();
    const peak = 0.32 * vol;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    env.gain.setValueAtTime(peak, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(body).connect(env).connect(this.master);

    if (kind === "hrrm" || kind === "grr") {
      // The rolled r: the volume wobbles 26 times a second (faster and harder when annoyed).
      const trem = ctx.createOscillator(); trem.frequency.value = kind === "grr" ? 34 : 26;
      const depth = ctx.createGain(); depth.gain.setValueAtTime(peak * 0.7, t); depth.gain.linearRampToValueAtTime(0, t + dur * 0.55);
      trem.connect(depth).connect(env.gain);
      trem.start(t); trem.stop(t + dur);
    }
    if (kind !== "oof") {
      // A breathy "h" in front.
      const n = ctx.createBufferSource(); n.buffer = this.noise(ctx);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t - 0.01); ng.gain.exponentialRampToValueAtTime(0.06 * vol, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(bp).connect(ng).connect(this.master);
      n.start(t - 0.01); n.stop(t + 0.1);
    }
    osc.start(t); osc.stop(t + dur + 0.02);
    this.rest((dur + 0.2) * 1000);
  }

  /** A sleepy snore: breathy low noise that swells and fades. */
  private snore(vol = 1) {
    const ctx = this.ready(); if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.02, dur = 1.0;
    const n = ctx.createBufferSource(); n.buffer = this.noise(ctx); n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 4;
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.09 * vol, t + dur * 0.45); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flutter = ctx.createOscillator(); flutter.frequency.value = 18;
    const fd = ctx.createGain(); fd.gain.value = 0.04 * vol;
    flutter.connect(fd).connect(e.gain);
    n.connect(lp).connect(e).connect(this.master);
    n.start(t); n.stop(t + dur + 0.02); flutter.start(t); flutter.stop(t + dur);
    this.rest((dur + 0.2) * 1000);
  }

  /** Something heavy lands (the pole). */
  thud(vol = 1) {
    const ctx = this.ready(); if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const e = ctx.createGain(); e.gain.setValueAtTime(0.4 * vol, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const n = ctx.createBufferSource(); n.buffer = this.noise(ctx);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.2 * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(e).connect(this.master); n.connect(lp).connect(ng).connect(this.master);
    o.start(t); o.stop(t + 0.42); n.start(t); n.stop(t + 0.3);
    this.rest(600);
  }

  /** Metal on metal: the pickaxe or the wrench hits the fuse box. */
  clink(vol = 1, pitch = 1) {
    const ctx = this.ready(); if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.01;
    const base = 1650 * pitch * (0.96 + Math.random() * 0.08);
    for (const [mul, dec, g] of [[1, 0.28, 0.12], [2.76, 0.14, 0.07], [5.4, 0.07, 0.04]] as const) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = base * mul;
      const e = ctx.createGain(); e.gain.setValueAtTime(g * vol, t); e.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(e).connect(this.master); o.start(t); o.stop(t + dec + 0.02);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noise(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.09 * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    n.connect(hp).connect(ng).connect(this.master); n.start(t); n.stop(t + 0.04);
    this.rest(450);
  }

  /** The fuse box crackles. */
  zap(vol = 1) {
    const ctx = this.ready(); if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.01, dur = 0.34;
    const n = ctx.createBufferSource(); n.buffer = this.noise(ctx); n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
    bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    const gate = ctx.createGain(); gate.gain.value = 0;
    // Crackle: the volume snaps on and off at random.
    let at = t;
    while (at < t + dur) { gate.gain.setValueAtTime(Math.random() < 0.55 ? 0.11 * vol : 0, at); at += 0.008 + Math.random() * 0.02; }
    gate.gain.setValueAtTime(0, t + dur);
    const hum = ctx.createOscillator(); hum.type = "square"; hum.frequency.value = 100;
    const hg = ctx.createGain(); hg.gain.setValueAtTime(0.025 * vol, t); hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(gate).connect(this.master);
    hum.connect(hg).connect(this.master);
    n.start(t); n.stop(t + dur + 0.02); hum.start(t); hum.stop(t + dur + 0.02);
    this.rest((dur + 0.15) * 1000);
  }

  /** Silence now (hidden, muted, DND, a meeting): cut anything still ringing and let the thread sleep. */
  hush() {
    if (!this.ctx) return;
    window.clearTimeout(this.idle);
    // Cut what is still ringing: a fresh master, the old one (and every sound hanging off it) goes nowhere.
    try { this.master?.disconnect(); } catch { /* already gone */ }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === "running") void this.ctx.suspend().catch(() => {});
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.idle);
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null; this.master = null;
  }
}
