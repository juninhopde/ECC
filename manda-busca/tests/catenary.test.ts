import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { catenaryPoints, polylineToSegments, solveCatenaryParam } from '../src/world/Catenary';

describe('catenaria', () => {
  it('a flecha no meio do vao e a pedida', () => {
    for (const [span, sag] of [[18, 0.5], [12, 0.35], [40, 1.8], [6, 0.05]] as const) {
      const a = solveCatenaryParam(span, sag);
      const mid = a * (Math.cosh(span / (2 * a)) - 1);
      expect(mid).toBeCloseTo(sag, 6);
    }
  });

  it('preserva as extremidades e e simetrica', () => {
    const A = new Vector3(0, 7, 0);
    const B = new Vector3(18, 7, 0);
    const pts = catenaryPoints(A, B, 0.5, 20);
    expect(pts[0]!.distanceTo(A)).toBeLessThan(1e-9);
    expect(pts[20]!.distanceTo(B)).toBeLessThan(1e-9);
    expect(pts[10]!.y).toBeCloseTo(6.5, 6);
    for (let i = 0; i <= 10; i++) expect(pts[i]!.y).toBeCloseTo(pts[20 - i]!.y, 9);
  });

  it('o cabo nunca sobe acima da reta entre os postes', () => {
    const A = new Vector3(0, 8, 0);
    const B = new Vector3(10, 6, 5);
    for (const p of catenaryPoints(A, B, 0.4, 16)) {
      const t = Math.hypot(p.x - A.x, p.z - A.z) / Math.hypot(B.x - A.x, B.z - A.z);
      expect(p.y).toBeLessThanOrEqual(A.y + (B.y - A.y) * t + 1e-9);
    }
  });

  it('sem flecha vira reta e gera N segmentos', () => {
    const pts = catenaryPoints(new Vector3(0, 5, 0), new Vector3(10, 5, 0), 0, 8);
    expect(pts).toHaveLength(9);
    expect(polylineToSegments(pts, 0.01)).toHaveLength(8);
    expect(() => solveCatenaryParam(0, 1)).toThrow();
  });
});
