import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_WIND_SPEED, WindField } from '../src/physics/WindField';

describe('WindField', () => {
  it('padrao e 6,7 m/s', () => {
    expect(DEFAULT_WIND_SPEED).toBe(6.7);
    expect(new WindField().meanSpeed).toBe(6.7);
  });

  it('e deterministico: mesma entrada, mesma saida', () => {
    const a = new WindField({ turbulence: 1 }, 9);
    const b = new WindField({ turbulence: 1 }, 9);
    const va = new Vector3();
    const vb = new Vector3();
    for (let i = 0; i < 200; i++) {
      a.sample(i * 1.3, 5 + i * 0.4, -i * 0.7, i * 0.05, va);
      b.sample(i * 1.3, 5 + i * 0.4, -i * 0.7, i * 0.05, vb);
      expect(va.equals(vb)).toBe(true);
    }
  });

  it('a velocidade media horizontal fica perto da base e o vento aponta para a direcao do mapa', () => {
    const w = new WindField({ baseSpeed: 6.7, dirX: 1, dirZ: 0, turbulence: 1, verticalGusts: 0.5 }, 3);
    const v = new Vector3();
    let sum = 0;
    let sumX = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      w.sample(i * 0.9, 15, i * 0.3, i * 0.1, v);
      sum += Math.hypot(v.x, v.z);
      sumX += v.x;
    }
    expect(sum / N).toBeGreaterThan(6.7 * 0.8);
    expect(sum / N).toBeLessThan(6.7 * 1.3);
    expect(sumX / N).toBeGreaterThan(0);
  });

  it('o vento aumenta com a altitude (cisalhamento)', () => {
    const w = new WindField({ turbulence: 0, verticalGusts: 0 }, 1);
    const lo = new Vector3();
    const hi = new Vector3();
    w.sample(0, 2, 0, 0, lo);
    w.sample(0, 100, 0, 0, hi);
    expect(hi.length()).toBeGreaterThan(lo.length() * 1.3);
  });

  it('sem turbulencia o vento e uniforme na horizontal e variavel so com a altura', () => {
    const w = new WindField({ turbulence: 0, verticalGusts: 0 }, 1);
    const a = new Vector3();
    const b = new Vector3();
    w.sample(0, 20, 0, 0, a);
    w.sample(300, 20, -200, 50, b);
    expect(a.distanceTo(b)).toBeLessThan(1e-9);
  });

  it('rajadas verticais respeitam a amplitude do perfil', () => {
    const w = new WindField({ turbulence: 1, verticalGusts: 2.2 }, 4);
    const v = new Vector3();
    let maxAbs = 0;
    for (let i = 0; i < 3000; i++) {
      w.sample(i * 0.7, 30, i * 0.2, i * 0.05, v);
      maxAbs = Math.max(maxAbs, Math.abs(v.y));
    }
    expect(maxAbs).toBeGreaterThan(0.5);
    expect(maxAbs).toBeLessThanOrEqual(2.2 * 1.05);
  });

  it('setProfile troca base, direcao e normaliza o vetor', () => {
    const w = new WindField();
    w.setProfile({ baseSpeed: 8.6, dirX: 0, dirZ: -5, turbulence: 0.35, verticalGusts: 0.25 });
    expect(w.meanSpeed).toBe(8.6);
    expect(w.direction.z).toBeCloseTo(-1, 9);
    expect(Math.hypot(w.direction.x, w.direction.z)).toBeCloseTo(1, 9);
  });
});
