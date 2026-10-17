// Procedural sound: every effect is synthesised with the WebAudio API (no audio files).
import { getSettings, onSettings } from './settings';

export type Sfx =
  | 'click' | 'dice' | 'step' | 'coin' | 'swing' | 'whoosh' | 'hit' | 'heavy' | 'clash' | 'block'
  | 'growl' | 'death' | 'victory' | 'defeat' | 'sting' | 'chime' | 'tick' | 'heal' | 'buy';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientOn = false;

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = 0.35;
    this.ambBus.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
    onSettings(() => this.applyVolume());
    if (this.ambientOn) this.startAmbient();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const s = getSettings();
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- building blocks

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(freq: number, type: OscillatorType, t: number, peak: number, attack: number, decay: number, slideTo?: number, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(bus ?? this.sfxBus!);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private noise(t: number, peak: number, attack: number, decay: number, filter: BiquadFilterType, f0: number, f1?: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = filter;
    bp.frequency.setValueAtTime(f0, t);
    if (f1) bp.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    bp.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    src.connect(bp).connect(g).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------- effects

  play(name: Sfx, intensity = 1): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime + 0.005;
    const k = Math.max(0.2, Math.min(1.5, intensity));
    switch (name) {
      case 'click':
        this.tone(900, 'triangle', t, 0.12, 0.002, 0.05);
        break;
      case 'dice':
        for (let i = 0; i < 5; i++) this.noise(t + i * 0.06 + Math.random() * 0.03, 0.25, 0.002, 0.04, 'bandpass', 2400 + Math.random() * 1600, undefined, 4);
        break;
      case 'step':
        this.noise(t, 0.15, 0.003, 0.06, 'lowpass', 600);
        break;
      case 'coin':
        this.tone(1320, 'sine', t, 0.18, 0.002, 0.18);
        this.tone(1760, 'sine', t + 0.07, 0.15, 0.002, 0.25);
        break;
      case 'buy':
        this.tone(988, 'square', t, 0.06, 0.002, 0.08);
        this.tone(1480, 'sine', t + 0.05, 0.14, 0.002, 0.3);
        break;
      case 'heal':
        for (let i = 0; i < 4; i++) this.tone(523 * Math.pow(1.26, i), 'sine', t + i * 0.07, 0.1, 0.01, 0.35);
        break;
      case 'swing':
        this.noise(t, 0.35 * k, 0.02, 0.16, 'bandpass', 400, 2600, 2);
        break;
      case 'whoosh':
        this.noise(t, 0.22, 0.04, 0.2, 'bandpass', 1800, 500, 1.5);
        break;
      case 'hit':
        this.tone(140, 'sine', t, 0.6 * k, 0.003, 0.18, 50);
        this.noise(t, 0.4 * k, 0.002, 0.1, 'lowpass', 2200);
        break;
      case 'heavy':
        this.tone(110, 'sine', t, 0.9, 0.003, 0.32, 38);
        this.tone(60, 'triangle', t, 0.5, 0.003, 0.4, 30);
        this.noise(t, 0.6, 0.002, 0.22, 'lowpass', 3000, 300);
        break;
      case 'clash':
        for (const f of [1870, 2490, 3150, 4210]) this.tone(f * (0.98 + Math.random() * 0.04), 'square', t, 0.05, 0.001, 0.35 + Math.random() * 0.2);
        this.noise(t, 0.3, 0.001, 0.08, 'highpass', 3000);
        break;
      case 'block':
        this.tone(220, 'square', t, 0.12, 0.002, 0.12, 120);
        for (const f of [1300, 1950]) this.tone(f, 'sine', t, 0.08, 0.001, 0.4);
        break;
      case 'growl': {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(70, t);
        o.frequency.linearRampToValueAtTime(52, t + 0.6);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 22;
        const lg = ctx.createGain();
        lg.gain.value = 12;
        lfo.connect(lg).connect(o.frequency);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const g = ctx.createGain();
        this.env(g, t, 0.35, 0.08, 0.6);
        o.connect(lp).connect(g).connect(this.sfxBus);
        o.start(t);
        lfo.start(t);
        o.stop(t + 0.75);
        lfo.stop(t + 0.75);
        break;
      }
      case 'death':
        this.tone(330, 'sawtooth', t, 0.18, 0.01, 1.1, 60);
        this.noise(t, 0.3, 0.01, 0.9, 'lowpass', 1200, 120);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => {
          this.tone(f, 'triangle', t + i * 0.12, 0.2, 0.01, 0.5);
          this.tone(f / 2, 'sine', t + i * 0.12, 0.1, 0.01, 0.5);
        });
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.18, 0.18, 0.01, 0.6));
        break;
      case 'chime':
        this.tone(880, 'sine', t, 0.12, 0.01, 1.2);
        this.tone(1318, 'sine', t + 0.12, 0.08, 0.01, 1.4);
        break;
      case 'tick':
        this.tone(1600, 'square', t, 0.03, 0.001, 0.03);
        break;
      case 'sting': {
        // Sanctum opens: low drone swell, a detuned "choir" chord, and a deep bell
        const ctx = this.ctx;
        for (const f of [55, 82.4, 110, 164.8, 220, 277.2]) {
          for (const det of [-6, 6]) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = f;
            o.detune.value = det;
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(300, t);
            lp.frequency.linearRampToValueAtTime(1800, t + 2);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.035, t + 1.2);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
            o.connect(lp).connect(g).connect(this.sfxBus);
            o.start(t);
            o.stop(t + 4.1);
          }
        }
        for (const [f, p] of [[98, 0.4], [196, 0.18], [293, 0.1], [523, 0.06]] as const) this.tone(f, 'sine', t + 0.9, p, 0.005, 3.2);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- ambience

  setAmbient(on: boolean): void {
    this.ambientOn = on;
    if (!this.ctx) return;
    if (on && this.ambientNodes.length === 0) this.startAmbient();
    if (!on) this.stopAmbient();
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    const bus = this.ambBus!;
    // wind: looping noise through a slowly wandering band-pass
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 300;
    lfo.connect(lg).connect(bp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.25;
    src.connect(bp).connect(wg).connect(bus);
    src.start();
    lfo.start();
    // drone: two detuned low sines with a breathing amplitude
    const nodes: AudioNode[] = [src, lfo];
    for (const f of [55, 82.5, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const amp = ctx.createOscillator();
      amp.frequency.value = 0.05 + f / 4000;
      const ag = ctx.createGain();
      ag.gain.value = 0.03;
      amp.connect(ag).connect(g.gain);
      o.connect(g).connect(bus);
      o.start();
      amp.start();
      nodes.push(o, amp);
    }
    this.ambientNodes = nodes;
  }

  private stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop();
      } catch {
        // already stopped
      }
    }
    this.ambientNodes = [];
  }
}

export const audio = new AudioEngine();
