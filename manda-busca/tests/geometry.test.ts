import { describe, expect, it } from 'vitest';
import { closestPointSegmentSegment, newSegSegResult } from '../src/physics/Geometry';

const run = (a: number[], b: number[]) => closestPointSegmentSegment(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, newSegSegResult());

describe('closestPointSegmentSegment', () => {
  it('segmentos que se cruzam em X: distancia zero no ponto medio', () => {
    const r = run([-1, 0, 0, 1, 0, 0], [0, -1, 0, 0, 1, 0]);
    expect(r.distSq).toBeCloseTo(0, 12);
    expect(r.s).toBeCloseTo(0.5, 9);
    expect(r.t).toBeCloseTo(0.5, 9);
  });

  it('retas reversas em 3D: distancia e o afastamento em z', () => {
    const r = run([-1, 0, 0, 1, 0, 0], [0, -1, 0.3, 0, 1, 0.3]);
    expect(Math.sqrt(r.distSq)).toBeCloseTo(0.3, 9);
  });

  it('paralelos: distancia entre as retas', () => {
    const r = run([0, 0, 0, 4, 0, 0], [0, 2, 0, 4, 2, 0]);
    expect(Math.sqrt(r.distSq)).toBeCloseTo(2, 9);
  });

  it('colineares sem sobreposicao: distancia entre as pontas', () => {
    const r = run([0, 0, 0, 1, 0, 0], [3, 0, 0, 5, 0, 0]);
    expect(Math.sqrt(r.distSq)).toBeCloseTo(2, 9);
    expect(r.s).toBeCloseTo(1, 9);
    expect(r.t).toBeCloseTo(0, 9);
  });

  it('segmento degenerado (ponto) funciona', () => {
    const r = run([1, 1, 0, 1, 1, 0], [0, 0, 0, 2, 0, 0]);
    expect(Math.sqrt(r.distSq)).toBeCloseTo(1, 9);
  });

  it('os parametros ficam sempre em [0, 1] (extremos)', () => {
    const r = run([0, 0, 0, 1, 0, 0], [5, 5, 5, 6, 6, 6]);
    expect(r.s).toBeGreaterThanOrEqual(0);
    expect(r.s).toBeLessThanOrEqual(1);
    expect(r.t).toBeGreaterThanOrEqual(0);
    expect(r.t).toBeLessThanOrEqual(1);
  });
});
