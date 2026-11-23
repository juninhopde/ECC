import { Vector3 } from 'three';

/** Segmento de cabo com raio, usado para colisao com a linha de pipa. */
export interface WireSegment {
  a: Vector3;
  b: Vector3;
  radius: number;
}

/**
 * Resolve o parametro `a` da catenaria y = a*cosh(x/a) tal que um vao horizontal
 * `span` apresente flecha vertical `sag` no meio. Bissecao: f(a) decresce com a.
 */
export function solveCatenaryParam(span: number, sag: number): number {
  if (span <= 0) throw new Error('span deve ser positivo');
  if (sag <= 0) throw new Error('sag deve ser positivo');
  const f = (a: number): number => a * (Math.cosh(span / (2 * a)) - 1) - sag;
  let lo = span / 1000;
  let hi = (span * span) / (8 * sag) * 10 + span;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Pontos de uma catenaria real entre A e B. A flecha e medida na vertical em
 * relacao a reta que une as extremidades.
 */
export function catenaryPoints(a: Vector3, b: Vector3, sag: number, segments: number): Vector3[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = Math.hypot(dx, dz);
  const pts: Vector3[] = [];
  if (span < 1e-6 || sag <= 1e-6) {
    for (let i = 0; i <= segments; i++) pts.push(a.clone().lerp(b, i / segments));
    return pts;
  }
  const param = solveCatenaryParam(span, sag);
  const edge = Math.cosh(span / (2 * param));
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * span;
    const dip = param * (Math.cosh(x / param) - edge);
    const p = a.clone().lerp(b, t);
    p.y += dip;
    pts.push(p);
  }
  return pts;
}

export function polylineToSegments(points: Vector3[], radius: number): WireSegment[] {
  const out: WireSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push({ a: points[i]!.clone(), b: points[i + 1]!.clone(), radius });
  }
  return out;
}
