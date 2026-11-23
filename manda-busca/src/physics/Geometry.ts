/**
 * Geometria de segmentos em numeros puros (sem alocacao), usada pela linha
 * (engate em cabos) e pelo sistema de combate no relo (fase 3).
 */

export interface SegSegResult {
  /** Parametro [0, 1] do ponto mais proximo no segmento 1. */
  s: number;
  /** Parametro [0, 1] do ponto mais proximo no segmento 2. */
  t: number;
  /** Distancia ao quadrado entre os dois pontos mais proximos. */
  distSq: number;
}

const EPS = 1e-12;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Ponto mais proximo entre os segmentos P1->Q1 e P2->Q2 (algoritmo de Ericson).
 * Cobre segmentos degenerados (ponto) e paralelos. Escreve em `out`.
 */
export function closestPointSegmentSegment(
  p1x: number, p1y: number, p1z: number,
  q1x: number, q1y: number, q1z: number,
  p2x: number, p2y: number, p2z: number,
  q2x: number, q2y: number, q2z: number,
  out: SegSegResult,
): SegSegResult {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d1z = q1z - p1z;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const d2z = q2z - p2z;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const c1x = p1x + d1x * s;
  const c1y = p1y + d1y * s;
  const c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t;
  const c2y = p2y + d2y * t;
  const c2z = p2z + d2z * t;
  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dz = c1z - c2z;
  out.s = s;
  out.t = t;
  out.distSq = dx * dx + dy * dy + dz * dz;
  return out;
}

export function newSegSegResult(): SegSegResult {
  return { s: 0, t: 0, distSq: 0 };
}
