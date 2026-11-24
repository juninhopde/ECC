import { describe, expect, it } from 'vitest';
import { FIXED_DT, FixedTimestep } from '../src/core/GameLoop';

function totalSteps(frameTimes: number[]): number {
  const ts = new FixedTimestep();
  let steps = 0;
  for (const f of frameTimes) steps += ts.advance(f);
  return steps;
}

describe('FixedTimestep', () => {
  it('usa dt fixo de 1/60', () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
  });

  it('roda ~600 passos em 10 s, independente da taxa de quadros', () => {
    const rates = [30, 60, 75, 120, 144, 240];
    for (const hz of rates) {
      const frames = Array.from({ length: hz * 10 }, () => 1 / hz);
      expect(Math.abs(totalSteps(frames) - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('quadros irregulares geram o mesmo total de passos que quadros regulares', () => {
    const irregular: number[] = [];
    let remaining = 10;
    let i = 0;
    while (remaining > 0) {
      const f = Math.min(remaining, [0.004, 0.016, 0.033, 0.007, 0.05][i++ % 5]!);
      irregular.push(f);
      remaining -= f;
    }
    expect(Math.abs(totalSteps(irregular) - 600)).toBeLessThanOrEqual(1);
  });

  it('limita quadros longos (anti espiral da morte)', () => {
    const ts = new FixedTimestep();
    expect(ts.advance(5)).toBeLessThanOrEqual(15);
  });

  it('alpha fica sempre em [0, 1]', () => {
    const ts = new FixedTimestep();
    for (let i = 0; i < 500; i++) {
      ts.advance(0.011);
      expect(ts.alpha).toBeGreaterThanOrEqual(0);
      expect(ts.alpha).toBeLessThanOrEqual(1);
    }
  });
});
