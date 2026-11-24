/**
 * Audio 100% procedural (Web Audio API, nenhum arquivo externo):
 *  - vento: ruido rosa em filtro passa-banda cuja frequencia e ganho acompanham a velocidade do vento;
 *  - zumbido da linha esticada: oscilador de 180 a 520 Hz, mais forte e agudo com a tensao;
 *  - catraca da carretilha: cliques curtos cuja taxa acompanha a velocidade angular do carretel;
 *  - estalo do papel de seda: ruido branco filtrado de ~40 ms a cada desbicada ou tapa;
 *  - corte no relo: som agudo de ruptura somado a um impacto grave discreto.
 * As funcoes de mapeamento sao puras (testaveis); o motor so liga as saidas aos nos de audio.
 */
import { clamp } from './noise';

export const HUM_MIN_HZ = 180;
export const HUM_MAX_HZ = 520;
/** Tensao (N) que leva o zumbido ao topo da faixa. */
export const HUM_FULL_TENSION = 14;
/** Dentes da catraca por volta do carretel. */
export const RATCHET_TEETH = 10;
export const RATCHET_MAX_RATE = 40;
export const CRACKLE_SECONDS = 0.04;

/** Frequencia do zumbido (Hz) para uma tensao (N): 180 Hz sem tensao ate 520 Hz na tensao cheia. */
export function humFrequency(tension: number): number {
  return HUM_MIN_HZ + (HUM_MAX_HZ - HUM_MIN_HZ) * clamp(tension / HUM_FULL_TENSION, 0, 1);
}

/** Ganho do zumbido: silencio com a linha frouxa e sutil (max ~0.05) com a linha esticada. */
export function humGain(tension: number, connected: boolean): number {
  if (!connected) return 0;
  return 0.05 * clamp((tension - 0.5) / 6, 0, 1);
}

/** Passa-banda do vento: mais forte e mais agudo conforme a velocidade. */
export function windFilter(windSpeed: number): { freq: number; q: number; gain: number } {
  const v = Math.max(0, windSpeed);
  return { freq: 260 + 85 * v, q: 0.7 + 0.04 * v, gain: Math.min(0.28, 0.04 + 0.022 * v) };
}

/** Cliques por segundo da catraca: a velocidade angular do carretel (v / r) vezes os dentes por volta. */
export function ratchetRate(lineSpeed: number, reelRadius = 0.05): number {
  const revPerSec = Math.abs(lineSpeed) / (2 * Math.PI * Math.max(reelRadius, 0.01));
  return Math.min(RATCHET_MAX_RATE, revPerSec * RATCHET_TEETH);
}

/** Atenuacao por distancia (m) para sons no mundo, como o corte de outra pipa. */
export function distanceGain(distance: number): number {
  return 1 / (1 + Math.max(0, distance) / 35);
}

/** Ruido rosa (filtro de Paul Kellet) com amostras em [-1, 1]; gerador injetavel para ser deterministico. */
export function pinkNoise(length: number, random: () => number = Math.random): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let peak = 1e-9;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < length; i++) out[i]! /= peak;
  return out;
}

/** Estado que o jogo informa ao motor a cada quadro. */
export interface AudioState {
  windSpeed: number;
  tension: number;
  lineSpeed: number;
  /** Linha ligada a mao (zumbido e catraca so soam assim). */
  connected: boolean;
  /** Menu ou garagem abertos: silencia os loops. */
  paused: boolean;
}

export type ContextFactory = () => AudioContext;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windBand: BiquadFilterNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private humNode: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private clickBuf: AudioBuffer | null = null;
  private crackleBuf: AudioBuffer | null = null;
  private clickPhase = 0;
  private clock = 0;
  private muted = false;
  /** Ultimos valores aplicados (diagnostico e testes). */
  readonly last = { windFreq: 0, windGain: 0, humHz: 0, humGain: 0, clicksPerSecond: 0 };
  /** Quantos sons pontuais ja foram disparados (diagnostico e testes). */
  readonly fired = { clicks: 0, crackles: 0, cuts: 0 };

  constructor(private readonly factory: ContextFactory = () => new AudioContext()) {}

  /** O navegador so libera audio depois de um gesto do usuario: chame no clique de JOGAR. */
  resume(): void {
    if (!this.ctx) this.build();
    void this.ctx?.resume();
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  get active(): boolean {
    return this.ctx !== null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private build(): void {
    let ctx: AudioContext;
    try {
      ctx = this.factory();
    } catch {
      return; // sem Web Audio: o jogo segue mudo
    }
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // Vento: ruido rosa em loop -> passa-banda -> ganho.
    this.noiseBuf = ctx.createBuffer(1, Math.floor(sr * 6), sr);
    this.noiseBuf.getChannelData(0).set(pinkNoise(this.noiseBuf.length));
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windBand).connect(this.windGain).connect(this.master);
    wind.start();

    // Zumbido da linha: triangulo sutil.
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'triangle';
    this.humOsc.frequency.value = HUM_MIN_HZ;
    this.humNode = ctx.createGain();
    this.humNode.gain.value = 0;
    this.humOsc.connect(this.humNode).connect(this.master);
    this.humOsc.start();

    // Clique da catraca: ~6 ms de ruido que decai.
    this.clickBuf = ctx.createBuffer(1, Math.floor(sr * 0.006), sr);
    const click = this.clickBuf.getChannelData(0);
    for (let i = 0; i < click.length; i++) click[i] = (Math.random() * 2 - 1) * Math.exp((-i / click.length) * 6);
    // Estalo do papel: 40 ms de ruido branco com envelope curto.
    this.crackleBuf = ctx.createBuffer(1, Math.floor(sr * CRACKLE_SECONDS), sr);
    const crackle = this.crackleBuf.getChannelData(0);
    for (let i = 0; i < crackle.length; i++) {
      const t = i / crackle.length;
      crackle[i] = (Math.random() * 2 - 1) * (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) * 7)) * (0.55 + 0.45 * Math.sin(i * 0.9));
    }
  }

  /** Atualiza os loops (vento, zumbido) e a catraca; chame a cada quadro. */
  update(dt: number, s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || !this.windBand || !this.windGain || !this.humOsc || !this.humNode) return;
    this.clock += dt;
    const t = ctx.currentTime;
    // Rajadas lentas em cima da velocidade media do vento.
    const gust = 1 + 0.12 * Math.sin(this.clock * 0.35) + 0.08 * Math.sin(this.clock * 0.91 + 1.3);
    const wf = windFilter(s.windSpeed * gust);
    const windGain = s.paused ? 0 : wf.gain;
    this.windBand.frequency.setTargetAtTime(wf.freq, t, 0.25);
    this.windBand.Q.setTargetAtTime(wf.q, t, 0.25);
    this.windGain.gain.setTargetAtTime(windGain, t, 0.3);
    const hum = s.paused ? 0 : humGain(s.tension, s.connected);
    const hz = humFrequency(s.tension);
    this.humOsc.frequency.setTargetAtTime(hz, t, 0.08);
    this.humNode.gain.setTargetAtTime(hum, t, 0.1);
    this.last.windFreq = wf.freq;
    this.last.windGain = windGain;
    this.last.humHz = hz;
    this.last.humGain = hum;

    const rate = s.paused || !s.connected ? 0 : ratchetRate(s.lineSpeed);
    this.last.clicksPerSecond = rate;
    this.clickPhase += rate * dt;
    let n = Math.min(Math.floor(this.clickPhase), 6);
    this.clickPhase -= Math.floor(this.clickPhase);
    while (n-- > 0) this.playClick(t + (n / Math.max(rate, 1)) * 0.5);
  }

  private playClick(when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.clickBuf || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(hp).connect(g).connect(this.master);
    src.start(when);
    this.fired.clicks++;
  }

  /** Estalo do papel de seda (desbicada ou tapa). */
  paperCrackle(): void {
    const ctx = this.ctx;
    if (!ctx || !this.crackleBuf || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.crackleBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 + Math.random() * 1800;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    this.fired.crackles++;
  }

  /** Corte no relo: ruptura aguda + impacto grave, atenuados pela distancia (m). */
  cut(distance = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.master) return;
    const vol = distanceGain(distance);
    const t = ctx.currentTime;
    // Ruptura: ruido agudo que decai + varredura descendente.
    const burst = ctx.createBufferSource();
    burst.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.5 * vol, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    burst.connect(hp).connect(bg).connect(this.master);
    burst.start(t, Math.random() * 4, 0.16);
    const snap = ctx.createOscillator();
    snap.type = 'sawtooth';
    snap.frequency.setValueAtTime(2600, t);
    snap.frequency.exponentialRampToValueAtTime(500, t + 0.09);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.16 * vol, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    snap.connect(sg).connect(this.master);
    snap.start(t);
    snap.stop(t + 0.12);
    // Impacto discreto.
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.32 * vol, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    thump.connect(tg).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.2);
    this.fired.cuts++;
  }

  dispose(): void {
    try {
      this.humOsc?.stop();
    } catch {
      /* ja parado */
    }
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
