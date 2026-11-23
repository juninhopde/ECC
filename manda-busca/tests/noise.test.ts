import { describe, expect, it } from 'vitest';
import { SimplexNoise3D, TileableNoise, mulberry32 } from '../src/core/noise';

describe('noise', () => {
  it('mulberry32 e deterministico e fica em [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('Simplex 3D e deterministico por semente e limitado', () => {
    const n1 = new SimplexNoise3D(5);
    const n2 = new SimplexNoise3D(5);
    const n3 = new SimplexNoise3D(6);
    let differs = false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const x = i * 0.137;
      const y = i * 0.071;
      const z = i * 0.053;
      const v = n1.noise3(x, y, z);
      expect(v).toBe(n2.noise3(x, y, z));
      if (v !== n3.noise3(x, y, z)) differs = true;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(differs).toBe(true);
    expect(lo).toBeGreaterThanOrEqual(-1.05);
    expect(hi).toBeLessThanOrEqual(1.05);
    expect(hi - lo).toBeGreaterThan(1);
  });

  it('TileableNoise repete exatamente a cada periodo', () => {
    const t = new TileableNoise(3);
    for (const [u, v] of [[0.1, 0.2], [0.37, 0.81], [0.5, 0.5]] as const) {
      expect(t.value(u, v, 8)).toBeCloseTo(t.value(u + 1, v, 8), 9);
      expect(t.value(u, v, 8)).toBeCloseTo(t.value(u, v + 1, 8), 9);
      expect(t.fbm(u, v, 4, 4)).toBeCloseTo(t.fbm(u + 1, v + 1, 4, 4), 9);
    }
  });

  it('TileableNoise.fbm fica em [0, 1]', () => {
    const t = new TileableNoise(9);
    for (let i = 0; i < 500; i++) {
      const v = t.fbm((i * 0.013) % 1, (i * 0.029) % 1, 4, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('Worley devolve F1 <= F2', () => {
    const t = new TileableNoise(4);
    for (let i = 0; i < 200; i++) {
      const [f1, f2] = t.worley((i * 0.0371) % 1, (i * 0.0613) % 1, 6);
      expect(f1).toBeLessThanOrEqual(f2);
    }
  });
});
