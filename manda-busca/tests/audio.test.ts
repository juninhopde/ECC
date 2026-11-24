import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/noise';
import {
  AudioEngine, CRACKLE_SECONDS, HUM_FULL_TENSION, HUM_MAX_HZ, HUM_MIN_HZ, RATCHET_MAX_RATE, RATCHET_TEETH,
  distanceGain, humFrequency, humGain, pinkNoise, ratchetRate, windFilter, type AudioState,
} from '../src/core/AudioEngine';

class FakeParam {
  value = 0;
  readonly setValues: number[] = [];
  readonly targets: number[] = [];
  setTargetAtTime(v: number): void { this.value = v; this.targets.push(v); }
  setValueAtTime(v: number): void { this.value = v; this.setValues.push(v); }
  exponentialRampToValueAtTime(v: number): void { this.value = v; }
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly playbackRate = new FakeParam();
  type = '';
  buffer: { length: number } | null = null;
  loop = false;
  starts: Array<{ when?: number; offset?: number; duration?: number }> = [];
  stopped = false;
  connect<T>(n: T): T { return n; }
  start(when?: number, offset?: number, duration?: number): void { this.starts.push({ when, offset, duration }); }
  stop(): void { this.stopped = true; }
}

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  readonly gains: FakeNode[] = [];
  readonly sources: FakeNode[] = [];
  readonly oscillators: FakeNode[] = [];
  readonly filters: FakeNode[] = [];
  closed = false;
  createGain(): FakeNode { const n = new FakeNode(); this.gains.push(n); return n; }
  createBiquadFilter(): FakeNode { const n = new FakeNode(); this.filters.push(n); return n; }
  createOscillator(): FakeNode { const n = new FakeNode(); this.oscillators.push(n); return n; }
  createBufferSource(): FakeNode { const n = new FakeNode(); this.sources.push(n); return n; }
  createBuffer(_ch: number, length: number): { length: number; getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; return Promise.resolve(); }
}

function engine(): { audio: AudioEngine; ctx: FakeContext } {
  const ctx = new FakeContext();
  return { audio: new AudioEngine(() => ctx as unknown as AudioContext), ctx };
}

const STATE: AudioState = { windSpeed: 6.7, tension: 0, lineSpeed: 0, connected: true, paused: false };

describe('mapeamentos de audio', () => {
  it('zumbido: 180 Hz sem tensao, 520 Hz na tensao cheia, crescente entre os dois', () => {
    expect(humFrequency(0)).toBe(HUM_MIN_HZ);
    expect(humFrequency(HUM_FULL_TENSION)).toBe(HUM_MAX_HZ);
    expect(humFrequency(1000)).toBe(HUM_MAX_HZ);
    expect(humFrequency(-5)).toBe(HUM_MIN_HZ);
    expect(humFrequency(HUM_FULL_TENSION / 2)).toBeCloseTo((HUM_MIN_HZ + HUM_MAX_HZ) / 2, 9);
    let prev = 0;
    for (let t = 0; t <= 14; t += 1) {
      expect(humFrequency(t)).toBeGreaterThanOrEqual(prev);
      prev = humFrequency(t);
    }
  });

  it('ganho do zumbido: mudo com linha frouxa ou solta e sutil (<= 0,05) com a linha esticada', () => {
    expect(humGain(10, false)).toBe(0);
    expect(humGain(0.2, true)).toBe(0);
    expect(humGain(3, true)).toBeGreaterThan(0);
    expect(humGain(100, true)).toBeCloseTo(0.05, 12);
    expect(humGain(6.5, true)).toBeGreaterThan(humGain(3, true));
  });

  it('vento: passa-banda sobe com a velocidade e o ganho tem teto', () => {
    const a = windFilter(3);
    const b = windFilter(6.7);
    const c = windFilter(12);
    expect(b.freq).toBeGreaterThan(a.freq);
    expect(c.freq).toBeGreaterThan(b.freq);
    expect(b.gain).toBeGreaterThan(a.gain);
    expect(windFilter(999).gain).toBeLessThanOrEqual(0.28);
    expect(windFilter(-4)).toEqual(windFilter(0));
    expect(b.freq).toBeCloseTo(260 + 85 * 6.7, 9);
  });

  it('catraca: taxa proporcional a velocidade angular, com teto e sem depender do sinal', () => {
    expect(ratchetRate(0)).toBe(0);
    const rev = 0.5 / (2 * Math.PI * 0.05); // 0,5 m/s num carretel de 5 cm de raio (abaixo do teto)
    expect(ratchetRate(0.5)).toBeCloseTo(rev * RATCHET_TEETH, 9);
    expect(ratchetRate(-0.5)).toBeCloseTo(ratchetRate(0.5), 12);
    expect(ratchetRate(0.25)).toBeCloseTo(ratchetRate(0.5) / 2, 9);
    expect(ratchetRate(0.5, 0.1)).toBeCloseTo(ratchetRate(0.5, 0.05) / 2, 9); // raio maior, menos voltas
    expect(ratchetRate(2)).toBe(RATCHET_MAX_RATE); // 63,7 cliques/s teoricos: limitado ao teto
    expect(ratchetRate(500)).toBe(RATCHET_MAX_RATE);
  });

  it('atenuacao por distancia: 1 de perto, 0,5 a 35 m, sempre decrescente', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(35)).toBeCloseTo(0.5, 12);
    expect(distanceGain(70)).toBeLessThan(distanceGain(35));
    expect(distanceGain(-3)).toBe(1);
  });

  it('ruido rosa: normalizado, deterministico e com mais energia nas baixas que nas altas', () => {
    const a = pinkNoise(20000, mulberry32(7));
    const b = pinkNoise(20000, mulberry32(7));
    expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)));
    let peak = 0;
    let e = 0;
    let ed = 0;
    for (let i = 1; i < a.length; i++) {
      peak = Math.max(peak, Math.abs(a[i]!));
      e += a[i]! * a[i]!;
      ed += (a[i]! - a[i - 1]!) ** 2;
    }
    expect(peak).toBeCloseTo(1, 9);
    // Para ruido branco, E[(x_i - x_{i-1})^2] / E[x^2] = 2. Em ruido rosa fica bem abaixo disso.
    const white = Float32Array.from({ length: 20000 }, ((r) => () => r() * 2 - 1)(mulberry32(7)));
    let ew = 0;
    let ewd = 0;
    for (let i = 1; i < white.length; i++) {
      ew += white[i]! * white[i]!;
      ewd += (white[i]! - white[i - 1]!) ** 2;
    }
    expect(ewd / ew).toBeGreaterThan(1.8);
    expect(ed / e).toBeLessThan(0.6);
  });
});

describe('AudioEngine', () => {
  it('nao cria contexto antes do gesto do usuario e ignora chamadas ate la', () => {
    const { audio, ctx } = engine();
    expect(audio.active).toBe(false);
    expect(audio.state).toBe('none');
    audio.update(1 / 60, STATE);
    audio.cut(5);
    audio.paperCrackle();
    expect(ctx.sources).toHaveLength(0);
    audio.resume();
    expect(audio.active).toBe(true);
    expect(audio.state).toBe('running');
  });

  it('se o navegador nao tiver Web Audio, o motor fica mudo sem lancar', () => {
    const audio = new AudioEngine(() => { throw new Error('sem audio'); });
    expect(() => { audio.resume(); audio.update(1 / 60, STATE); audio.cut(1); audio.dispose(); }).not.toThrow();
    expect(audio.active).toBe(false);
  });

  it('vento e zumbido acompanham o estado: mais tensao, zumbido mais agudo e mais forte', () => {
    const { audio, ctx } = engine();
    audio.resume();
    audio.update(1 / 60, { ...STATE, tension: 1 });
    const lowHz = audio.last.humHz;
    const lowGain = audio.last.humGain;
    audio.update(1 / 60, { ...STATE, tension: 12 });
    expect(audio.last.humHz).toBeGreaterThan(lowHz);
    expect(audio.last.humGain).toBeGreaterThan(lowGain);
    expect(audio.last.humHz).toBeGreaterThanOrEqual(HUM_MIN_HZ);
    expect(audio.last.humHz).toBeLessThanOrEqual(HUM_MAX_HZ);
    // o vento fica dentro da faixa prevista (rajadas de +-20% em cima da velocidade media)
    const lo = windFilter(6.7 * 0.8).freq;
    const hi = windFilter(6.7 * 1.2).freq;
    expect(audio.last.windFreq).toBeGreaterThanOrEqual(lo);
    expect(audio.last.windFreq).toBeLessThanOrEqual(hi);
    expect(ctx.oscillators.some((o) => o.type === 'triangle')).toBe(true);
    expect(ctx.filters.some((f) => f.type === 'bandpass')).toBe(true);
  });

  it('pausado ou com a linha solta, os loops calam e a catraca nao clica', () => {
    const { audio } = engine();
    audio.resume();
    audio.update(1 / 60, { ...STATE, tension: 10, lineSpeed: 4 });
    expect(audio.last.humGain).toBeGreaterThan(0);
    audio.update(1 / 60, { ...STATE, tension: 10, lineSpeed: 4, paused: true });
    expect(audio.last.humGain).toBe(0);
    expect(audio.last.windGain).toBe(0);
    expect(audio.last.clicksPerSecond).toBe(0);
    audio.update(1 / 60, { ...STATE, tension: 10, lineSpeed: 4, connected: false });
    expect(audio.last.humGain).toBe(0);
    expect(audio.last.clicksPerSecond).toBe(0);
  });

  it('catraca: 1 s de linha saindo a 4 m/s dispara cliques na taxa (com teto), e parada nao clica', () => {
    const { audio } = engine();
    audio.resume();
    for (let i = 0; i < 60; i++) audio.update(1 / 60, { ...STATE, lineSpeed: 4 });
    expect(audio.fired.clicks).toBeGreaterThanOrEqual(RATCHET_MAX_RATE - 6);
    expect(audio.fired.clicks).toBeLessThanOrEqual(RATCHET_MAX_RATE + 6);
    const before = audio.fired.clicks;
    for (let i = 0; i < 60; i++) audio.update(1 / 60, { ...STATE, lineSpeed: 0 });
    expect(audio.fired.clicks).toBe(before);
    // mais devagar, menos cliques
    const slow = engine();
    slow.audio.resume();
    for (let i = 0; i < 60; i++) slow.audio.update(1 / 60, { ...STATE, lineSpeed: 0.3 });
    expect(slow.audio.fired.clicks).toBeGreaterThan(0);
    expect(slow.audio.fired.clicks).toBeLessThan(before);
  });

  it('estalo do papel dura ~40 ms e passa por filtro passa-banda', () => {
    const { audio, ctx } = engine();
    audio.resume();
    audio.paperCrackle();
    expect(audio.fired.crackles).toBe(1);
    const crackle = ctx.sources.find((s) => s.buffer && s.buffer.length === Math.floor(48000 * CRACKLE_SECONDS));
    expect(crackle).toBeDefined();
    expect(ctx.filters.filter((f) => f.type === 'bandpass').length).toBeGreaterThanOrEqual(2); // vento + estalo
  });

  it('corte: som agudo + impacto grave, mais baixo quanto mais longe', () => {
    const near = engine();
    near.audio.resume();
    near.audio.cut(0);
    const far = engine();
    far.audio.resume();
    far.audio.cut(70);
    expect(near.audio.fired.cuts).toBe(1);
    // ruptura (ruido filtrado), varredura serrilhada e impacto senoidal
    expect(near.ctx.oscillators.some((o) => o.type === 'sawtooth')).toBe(true);
    expect(near.ctx.oscillators.some((o) => o.type === 'sine')).toBe(true);
    const peak = (c: FakeContext): number => Math.max(...c.gains.flatMap((g) => g.gain.setValues));
    expect(peak(far.ctx)).toBeLessThan(peak(near.ctx));
    expect(peak(far.ctx)).toBeCloseTo(peak(near.ctx) * distanceGain(70), 9);
  });

  it('mudo zera a saida e dispose fecha o contexto', () => {
    const { audio, ctx } = engine();
    audio.resume();
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
    const master = ctx.gains[0]!;
    expect(master.gain.value).toBe(0);
    audio.setMuted(false);
    expect(master.gain.value).toBeGreaterThan(0);
    audio.dispose();
    expect(ctx.closed).toBe(true);
    expect(audio.active).toBe(false);
  });
});
