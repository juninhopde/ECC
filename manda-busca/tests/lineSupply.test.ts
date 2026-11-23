import { describe, expect, it } from 'vitest';
import { LineSupply, YARD_TO_M } from '../src/core/LineSupply';

describe('LineSupply', () => {
  it('converte jardas para metros', () => {
    const s = new LineSupply(250, 1);
    expect(s.capacity).toBeCloseTo(250 * YARD_TO_M, 9);
    expect(s.capacityYards).toBeCloseTo(250, 9);
    expect(s.remainingYards).toBeCloseTo(250, 9);
  });

  it('nunca fica negativo nem acima da capacidade', () => {
    const s = new LineSupply(100, 0.5);
    expect(s.payOut(1e9)).toBeCloseTo(50 * YARD_TO_M, 9);
    expect(s.remaining).toBe(0);
    expect(s.payOut(5)).toBe(0);
    expect(s.takeIn(1e9)).toBeCloseTo(100 * YARD_TO_M, 9);
    expect(s.fill).toBe(1);
    expect(s.takeIn(5)).toBe(0);
  });

  it('ignora valores negativos', () => {
    const s = new LineSupply(100, 0.5);
    const before = s.remaining;
    expect(s.payOut(-3)).toBe(0);
    expect(s.takeIn(-3)).toBe(0);
    expect(s.remaining).toBe(before);
  });

  it('conserva a linha: o que sai e depois volta restaura o total', () => {
    const s = new LineSupply(250, 0.8);
    const start = s.remaining;
    const out = s.payOut(37.5);
    s.takeIn(out);
    expect(s.remaining).toBeCloseTo(start, 9);
  });

  it('limita a fracao inicial a [0, 1]', () => {
    expect(new LineSupply(100, 5).fill).toBe(1);
    expect(new LineSupply(100, -2).fill).toBe(0);
  });

  it('troca de capacidade preserva a fracao', () => {
    const s = new LineSupply(250, 0.4).setCapacityYards(350);
    expect(s.capacityYards).toBeCloseTo(350, 9);
    expect(s.fill).toBeCloseTo(0.4, 9);
  });
});
