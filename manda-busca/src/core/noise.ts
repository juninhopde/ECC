/**
 * Geradores de ruido deterministicos (sem Math.random) usados por texturas,
 * terreno, vento e vegetacao. Mesma semente produz sempre o mesmo resultado.
 */

/** PRNG de 32 bits (mulberry32). Retorna valores em [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/** Ruido Simplex 3D (Gustavson). Saida em aproximadamente [-1, 1]. */
export class SimplexNoise3D {
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  constructor(seed = 1) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]!;
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      const v = p[i & 255]!;
      this.perm[i] = v;
      this.permMod12[i] = v % 12;
    }
  }

  noise3(xin: number, yin: number, zin: number): number {
    const perm = this.perm;
    const pm12 = this.permMod12;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;

    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const gi = pm12[ii + perm[jj + perm[kk]!]!]! * 3;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi]! * x0 + GRAD3[gi + 1]! * y0 + GRAD3[gi + 2]! * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const gi = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]! * 3;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi]! * x1 + GRAD3[gi + 1]! * y1 + GRAD3[gi + 2]! * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const gi = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]! * 3;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi]! * x2 + GRAD3[gi + 1]! * y2 + GRAD3[gi + 2]! * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const gi = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]! * 3;
      t3 *= t3;
      n3 = t3 * t3 * (GRAD3[gi]! * x3 + GRAD3[gi + 1]! * y3 + GRAD3[gi + 2]! * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  noise2(x: number, y: number): number {
    return this.noise3(x, y, 0.5);
  }

  /** Fractal Brownian motion 2D normalizado para aproximadamente [-1, 1]. */
  fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, 0.5 + o * 17.3);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Fractal Brownian motion 3D normalizado para aproximadamente [-1, 1]. */
  fbm3(x: number, y: number, z: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/**
 * Ruido de valor periodico: o resultado repete exatamente a cada `period`
 * celulas, o que permite gerar texturas que ladrilham sem emenda.
 */
export class TileableNoise {
  private readonly table = new Float32Array(256 * 256);
  private readonly seed: number;

  constructor(seed = 7) {
    this.seed = seed;
    const rand = mulberry32(seed);
    for (let i = 0; i < this.table.length; i++) this.table[i] = rand();
  }

  private lattice(ix: number, iy: number, px: number, py: number): number {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    return this.table[((y * 73 + x * 31 + this.seed) & 255) * 256 + ((x * 17 + y * 101) & 255)]!;
  }

  /**
   * Ruido em [0, 1]; u e v em [0, 1) cobrem exatamente um periodo.
   * `periodY` permite periodos diferentes por eixo (ruido alongado, ex.: veios).
   */
  value(u: number, v: number, period: number, periodY: number = period): number {
    const x = u * period;
    const y = v * periodY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.lattice(x0, y0, period, periodY);
    const b = this.lattice(x0 + 1, y0, period, periodY);
    const c = this.lattice(x0, y0 + 1, period, periodY);
    const d = this.lattice(x0 + 1, y0 + 1, period, periodY);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** fBm periodico em [0, 1]. */
  fbm(u: number, v: number, basePeriod: number, octaves = 5, gain = 0.5): number {
    return this.fbmXY(u, v, basePeriod, basePeriod, octaves, gain);
  }

  /** fBm periodico com periodos independentes por eixo. */
  fbmXY(u: number, v: number, periodX: number, periodY: number, octaves = 5, gain = 0.5): number {
    let amp = 1;
    let px = periodX;
    let py = periodY;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(u, v, px, py);
      norm += amp;
      amp *= gain;
      px *= 2;
      py *= 2;
    }
    return sum / norm;
  }

  /**
   * Ruido celular periodico (Worley). Retorna [F1, F2] em unidades de celula.
   * F2 - F1 pequeno marca as bordas das celulas (usado para rachaduras).
   */
  worley(u: number, v: number, cells: number): [number, number] {
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        const gy = cy + oy;
        const wx = ((gx % cells) + cells) % cells;
        const wy = ((gy % cells) + cells) % cells;
        const h = (wy * 7919 + wx * 104729 + this.seed * 31) >>> 0;
        const rx = mulberry32(h)();
        const ry = mulberry32(h ^ 0x9e3779b9)();
        const dx = gx + rx - x;
        const dy = gy + ry - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return [f1, f2];
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
