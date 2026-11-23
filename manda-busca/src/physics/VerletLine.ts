/**
 * Linha de pipa como cadeia de nos com restricoes de distancia XPBD.
 *  - Restricao unilateral: a linha traciona mas nao empurra (folga vira barriga).
 *  - Cada no recebe gravidade e arrasto lateral do vento, formando a catenaria.
 *  - Colisao com o chao e engate em cabos de poste; puxar com forca rompe no cabo.
 * Roda em passo fixo (o chamador usa sub-steps); mesmo estado e entrada, mesmo resultado.
 */
import { Vector3 } from 'three';
import type { WireSegment } from '../world/Catenary';
import { closestPointSegmentSegment, newSegSegResult } from './Geometry';
import { LINE_SPECS, type LineSpec } from './LineSpec';
import type { WindFn } from './WindField';

export const LINE_NODES = 36;
const AIR_DENSITY = 1.2;
const GRAVITY = 9.81;
const CD_CYLINDER = 1.2;
const SOLVE_PASSES = 3;
const MAX_LINE_SUBSTEPS = 24;
/** Amortecimento de velocidade por sub-step: dissipa a vibracao da corda rigida. */
const LINE_DAMPING = 0.985;
const WIRE_MAX_Y = 10.8;

export interface LineStepContext {
  wind: WindFn;
  time: number;
  /** Altura da superficie mais alta em (x, z) (chao, laje, telhado). */
  groundHeight?: (x: number, z: number) => number;
  /** Cabos de poste para engate. */
  wires?: readonly WireSegment[];
}

interface Snag {
  x: number;
  y: number;
  z: number;
  slackTicks: number;
  /** 'cabo' = engate fisico num fio de poste; 'atado' = preso a outra linha (relo e apara). */
  kind: 'cabo' | 'atado';
}

export interface LineBreak {
  node: number;
  cause: 'cabo' | 'externo';
}

export class VerletLine {
  n: number;
  pos: Float64Array;
  prev: Float64Array;
  invMass: Float64Array;
  lambda: Float64Array;
  /** Tracao (N) em cada segmento apos o ultimo passo. */
  tension: Float64Array;
  restLen: number;
  readonly spec: LineSpec;
  startPinned = true;
  endPinned = true;
  readonly startAnchor = new Vector3();
  readonly endAnchor = new Vector3();
  /** Forca (N) que a linha exerce no ultimo no, ja apontando para o resto da linha. */
  readonly endForce = new Vector3();
  /** Forca (N) que a linha exerce no primeiro no. */
  readonly startForce = new Vector3();
  /** Preenchido quando a linha rompe num cabo; o dono deve chamar splitAt. */
  pendingBreak: LineBreak | null = null;
  private readonly snags = new Map<number, Snag>();
  private readonly seg = newSegSegResult();

  constructor(spec: LineSpec = LINE_SPECS.linha10, nodes = LINE_NODES, activeLength = 4) {
    this.spec = spec;
    this.n = nodes;
    this.pos = new Float64Array(nodes * 3);
    this.prev = new Float64Array(nodes * 3);
    this.invMass = new Float64Array(nodes);
    this.lambda = new Float64Array(nodes - 1);
    this.tension = new Float64Array(nodes - 1);
    this.restLen = activeLength / (nodes - 1);
    this.updateMasses();
  }

  /** Comprimento ativo (L_ativo) da linha em metros. */
  get activeLength(): number {
    return this.restLen * (this.n - 1);
  }

  set activeLength(length: number) {
    this.restLen = Math.max(length, 0.05) / (this.n - 1);
    this.updateMasses();
  }

  private updateMasses(): void {
    const m = this.spec.linearDensity * this.restLen;
    for (let i = 0; i < this.n; i++) {
      const ends = i === 0 || i === this.n - 1 ? 0.5 : 1;
      const snagged = this.snags.has(i);
      const pinned = (i === 0 && this.startPinned) || (i === this.n - 1 && this.endPinned) || snagged;
      this.invMass[i] = pinned ? 0 : 1 / (m * ends);
    }
  }

  /** Dispoe os nos em linha reta entre dois pontos (partida do lancamento). */
  layout(a: Vector3, b: Vector3): void {
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      this.pos[i * 3] = this.prev[i * 3] = x;
      this.pos[i * 3 + 1] = this.prev[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = this.prev[i * 3 + 2] = z;
    }
    this.startAnchor.copy(a);
    this.endAnchor.copy(b);
    this.snags.clear();
    this.lambda.fill(0);
    this.tension.fill(0);
    this.updateMasses();
  }

  node(i: number, out: Vector3): Vector3 {
    return out.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  /** Distancia reta entre os dois extremos. */
  chordLength(): number {
    const e = (this.n - 1) * 3;
    return Math.hypot(this.pos[e]! - this.pos[0]!, this.pos[e + 1]! - this.pos[1]!, this.pos[e + 2]! - this.pos[2]!);
  }

  /** Maior tracao em qualquer segmento. */
  maxTension(): number {
    let m = 0;
    for (let i = 0; i < this.tension.length; i++) m = Math.max(m, this.tension[i]!);
    return m;
  }

  /** Tracao media dos segmentos (estimativa da tracao na linha). */
  meanTension(): number {
    let s = 0;
    for (let i = 0; i < this.tension.length; i++) s += this.tension[i]!;
    return s / this.tension.length;
  }

  isSnagged(): boolean {
    for (const s of this.snags.values()) if (s.kind === 'cabo') return true;
    return false;
  }

  /**
   * Quantos sub-passos internos mantem estavel a vibracao transversal da corda.
   * A restauracao transversal vem da tracao (rigidez geometrica T/l) e o solver a trata
   * de forma explicita: precisa omega*dt < ~1,2 com omega = sqrt(2 T / (m l)).
   */
  private subStepsFor(dt: number): number {
    const m = this.spec.linearDensity * this.restLen;
    const omega = Math.sqrt((2 * this.spec.breakTension) / (m * this.restLen));
    return Math.min(MAX_LINE_SUBSTEPS, Math.max(1, Math.ceil((dt * omega) / 1.2)));
  }

  /** Avanca um passo de duracao dt (sub-divide internamente). As ancoras devem estar atualizadas. */
  step(dt: number, ctx: LineStepContext): void {
    const sub = this.subStepsFor(dt);
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.integrate(h, { ...ctx, time: ctx.time + i * h });
    this.collideGround(ctx);
    this.handleWires(ctx);
    this.updateEndForces();
  }

  /** Um sub-passo: previsao (gravidade e vento) e restricoes XPBD. */
  private integrate(dt: number, ctx: LineStepContext): void {
    const n = this.n;
    const P = this.pos;
    const V = this.prev;
    if (this.startPinned) {
      P[0] = V[0] = this.startAnchor.x;
      P[1] = V[1] = this.startAnchor.y;
      P[2] = V[2] = this.startAnchor.z;
    }
    if (this.endPinned) {
      const e = (n - 1) * 3;
      P[e] = this.endAnchor.x;
      P[e + 1] = this.endAnchor.y;
      P[e + 2] = this.endAnchor.z;
    }
    for (const [i, s] of this.snags) {
      P[i * 3] = V[i * 3] = s.x;
      P[i * 3 + 1] = V[i * 3 + 1] = s.y;
      P[i * 3 + 2] = V[i * 3 + 2] = s.z;
    }

    // Previsao: gravidade e arrasto lateral do vento em cada no livre.
    const dt2 = dt * dt;
    const windV = new Vector3();
    const dragK = 0.5 * AIR_DENSITY * CD_CYLINDER * this.spec.diameter * this.restLen;
    const nodeMass = this.spec.linearDensity * this.restLen;
    for (let i = 0; i < n; i++) {
      if (this.invMass[i] === 0) continue;
      const i3 = i * 3;
      const x = P[i3]!;
      const y = P[i3 + 1]!;
      const z = P[i3 + 2]!;
      const vx = (x - V[i3]!) / dt;
      const vy = (y - V[i3 + 1]!) / dt;
      const vz = (z - V[i3 + 2]!) / dt;
      ctx.wind(x, y, z, ctx.time, windV);
      let rx = windV.x - vx;
      let ry = windV.y - vy;
      let rz = windV.z - vz;
      // Remove a componente ao longo da linha (arrasto so na normal).
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let tx = P[b * 3]! - P[a * 3]!;
      let ty = P[b * 3 + 1]! - P[a * 3 + 1]!;
      let tz = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const dotRT = rx * tx + ry * ty + rz * tz;
      rx -= dotRT * tx;
      ry -= dotRT * ty;
      rz -= dotRT * tz;
      const speed = Math.hypot(rx, ry, rz);
      const ends = i === 0 || i === n - 1 ? 0.5 : 1;
      const k = (dragK * ends * speed) / (nodeMass * ends);
      const ax = rx * k;
      const ay = ry * k - GRAVITY;
      const az = rz * k;
      const damp = LINE_DAMPING;
      V[i3] = x;
      V[i3 + 1] = y;
      V[i3 + 2] = z;
      P[i3] = x + (x - (x - vx * dt)) * damp + ax * dt2;
      P[i3 + 1] = y + vy * dt * damp + ay * dt2;
      P[i3 + 2] = z + vz * dt * damp + az * dt2;
    }

    // Restricoes de distancia XPBD unilaterais, resolvidas de uma vez (sistema tridiagonal).
    this.lambda.fill(0);
    const alphaT = this.restLen / this.spec.stiffness / dt2;
    for (let pass = 0; pass < SOLVE_PASSES; pass++) this.solvePass(alphaT);
    for (let k = 0; k < n - 1; k++) this.tension[k] = -this.lambda[k]! / dt2;
  }

  private scratch: Float64Array = new Float64Array(0);

  /**
   * Um passe de Newton sobre todas as restricoes. Segmentos tracionados (C > 0 ou
   * com lambda < 0) formam trechos contiguos; cada trecho vira um sistema
   * tridiagonal (A = J W J^T + alpha) resolvido por Thomas em O(n).
   */
  private solvePass(alphaT: number): void {
    const m = this.n - 1;
    const need = m * 8;
    if (this.scratch.length < need) this.scratch = new Float64Array(need);
    const sc = this.scratch;
    const P = this.pos;
    const W = this.invMass;
    // Camadas: 0..m-1 nx, ny, nz, C, diag, off, cp, dp
    const NX = 0;
    const NY = m;
    const NZ = 2 * m;
    const CC = 3 * m;
    const DG = 4 * m;
    const OF = 5 * m;
    const CP = 6 * m;
    const DP = 7 * m;
    const active = this.activeFlags(m);
    for (let k = 0; k < m; k++) {
      const i = k * 3;
      const dx = P[i + 3]! - P[i]!;
      const dy = P[i + 4]! - P[i + 1]!;
      const dz = P[i + 5]! - P[i + 2]!;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) {
        sc[NX + k] = 1;
        sc[NY + k] = 0;
        sc[NZ + k] = 0;
        sc[CC + k] = -this.restLen;
      } else {
        sc[NX + k] = dx / len;
        sc[NY + k] = dy / len;
        sc[NZ + k] = dz / len;
        sc[CC + k] = len - this.restLen;
      }
      active[k] = sc[CC + k]! > 0 || this.lambda[k]! < 0 ? 1 : 0;
    }
    let k = 0;
    while (k < m) {
      if (!active[k]) {
        k++;
        continue;
      }
      const s = k;
      while (k < m && active[k]) k++;
      const e = k - 1;
      for (let q = s; q <= e; q++) {
        sc[DG + q] = W[q]! + W[q + 1]! + alphaT;
        sc[OF + q] =
          q > s
            ? -W[q]! * (sc[NX + q - 1]! * sc[NX + q]! + sc[NY + q - 1]! * sc[NY + q]! + sc[NZ + q - 1]! * sc[NZ + q]!)
            : 0;
      }
      // Eliminacao progressiva (Thomas).
      for (let q = s; q <= e; q++) {
        const rhs = -sc[CC + q]! - alphaT * this.lambda[q]!;
        const off = sc[OF + q]!;
        const denom = q === s ? sc[DG + q]! : sc[DG + q]! - off * sc[CP + q - 1]!;
        const next = q < e ? sc[OF + q + 1]! : 0;
        sc[CP + q] = next / denom;
        sc[DP + q] = q === s ? rhs / denom : (rhs - off * sc[DP + q - 1]!) / denom;
      }
      // Substituicao regressiva e projecao lambda <= 0.
      let nextDelta = 0;
      for (let q = e; q >= s; q--) {
        const delta = sc[DP + q]! - (q < e ? sc[CP + q]! * nextDelta : 0);
        nextDelta = delta;
        const lam = this.lambda[q]!;
        const newLam = Math.min(lam + delta, 0);
        sc[OF + q] = newLam - lam; // reaproveita OF como delta aplicado
        this.lambda[q] = newLam;
      }
      // Correcao de posicao dos nos do trecho.
      for (let node = s; node <= e + 1; node++) {
        const w = W[node]!;
        if (w === 0) continue;
        let cx = 0;
        let cy = 0;
        let cz = 0;
        if (node <= e) {
          const d = sc[OF + node]!;
          cx -= sc[NX + node]! * d;
          cy -= sc[NY + node]! * d;
          cz -= sc[NZ + node]! * d;
        }
        if (node - 1 >= s) {
          const d = sc[OF + node - 1]!;
          cx += sc[NX + node - 1]! * d;
          cy += sc[NY + node - 1]! * d;
          cz += sc[NZ + node - 1]! * d;
        }
        P[node * 3] = P[node * 3]! + w * cx;
        P[node * 3 + 1] = P[node * 3 + 1]! + w * cy;
        P[node * 3 + 2] = P[node * 3 + 2]! + w * cz;
      }
    }
  }

  private activeBuf: Uint8Array = new Uint8Array(0);

  private activeFlags(m: number): Uint8Array {
    if (this.activeBuf.length < m) this.activeBuf = new Uint8Array(m);
    return this.activeBuf;
  }

  private collideGround(ctx: LineStepContext): void {
    if (!ctx.groundHeight) return;
    const P = this.pos;
    const V = this.prev;
    for (let i = 0; i < this.n; i++) {
      if (this.invMass[i] === 0) continue;
      const i3 = i * 3;
      const h = ctx.groundHeight(P[i3]!, P[i3 + 2]!) + 0.02;
      if (P[i3 + 1]! < h) {
        P[i3 + 1] = h;
        // Atrito no chao: reduz a velocidade horizontal.
        V[i3] = P[i3]! - (P[i3]! - V[i3]!) * 0.6;
        V[i3 + 2] = P[i3 + 2]! - (P[i3 + 2]! - V[i3 + 2]!) * 0.6;
        V[i3 + 1] = P[i3 + 1]!;
      }
    }
  }

  private handleWires(ctx: LineStepContext): void {
    const wires = ctx.wires;
    if (!wires || wires.length === 0) return;
    const P = this.pos;
    const lineR = this.spec.diameter / 2;
    // Rompe o engate se a tracao ao redor do no passar do limite; solta se frouxo.
    for (const [node, snag] of this.snags) {
      if (snag.kind !== 'cabo') continue;
      const tl = node > 0 ? this.tension[node - 1]! : 0;
      const tr = node < this.n - 1 ? this.tension[node]! : 0;
      const t = Math.max(tl, tr);
      if (t * 1 > this.spec.breakTension) {
        this.pendingBreak = { node, cause: 'cabo' };
        return;
      }
      snag.slackTicks = t < 0.2 ? snag.slackTicks + 1 : 0;
      if (snag.slackTicks > 120) {
        this.snags.delete(node);
        this.updateMasses();
      }
    }
    for (let k = 0; k < this.n - 1; k++) {
      const i = k * 3;
      const j = i + 3;
      if (P[i + 1]! > WIRE_MAX_Y && P[j + 1]! > WIRE_MAX_Y) continue;
      for (const w of wires) {
        if (Math.min(w.a.y, w.b.y) > WIRE_MAX_Y) continue;
        const r = this.seg;
        closestPointSegmentSegment(
          P[i]!, P[i + 1]!, P[i + 2]!, P[j]!, P[j + 1]!, P[j + 2]!,
          w.a.x, w.a.y, w.a.z, w.b.x, w.b.y, w.b.z, r,
        );
        const reach = lineR + w.radius + 0.01;
        if (r.distSq > reach * reach) continue;
        const node = r.s < 0.5 ? k : k + 1;
        if (this.snags.has(node) || node === 0 || node === this.n - 1) continue;
        const cx = w.a.x + (w.b.x - w.a.x) * r.t;
        const cy = w.a.y + (w.b.y - w.a.y) * r.t;
        const cz = w.a.z + (w.b.z - w.a.z) * r.t;
        this.snags.set(node, { x: cx, y: cy + w.radius + lineR, z: cz, slackTicks: 0, kind: 'cabo' });
        this.updateMasses();
      }
    }
  }

  private updateEndForces(): void {
    const n = this.n;
    const P = this.pos;
    {
      const t = this.tension[n - 2]!;
      const i = (n - 2) * 3;
      const e = (n - 1) * 3;
      const dx = P[i]! - P[e]!;
      const dy = P[i + 1]! - P[e + 1]!;
      const dz = P[i + 2]! - P[e + 2]!;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.endForce.set((dx / len) * t, (dy / len) * t, (dz / len) * t);
    }
    {
      const t = this.tension[0]!;
      const dx = P[3]! - P[0]!;
      const dy = P[4]! - P[1]!;
      const dz = P[5]! - P[2]!;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.startForce.set((dx / len) * t, (dy / len) * t, (dz / len) * t);
    }
  }

  /**
   * Corta a linha no no `k`: esta linha fica com os nos 0..k (ponta livre) e a
   * parte restante (k+1..fim) e devolvida como nova linha com a ponta solta.
   */
  splitAt(k: number): VerletLine {
    const cut = Math.min(Math.max(k, 1), this.n - 2);
    const rightCount = this.n - 1 - cut;
    const right = new VerletLine(this.spec, rightCount, this.restLen * (rightCount - 1));
    right.restLen = this.restLen;
    right.startPinned = false;
    right.endPinned = this.endPinned;
    right.endAnchor.copy(this.endAnchor);
    for (let i = 0; i < rightCount; i++) {
      const src = (cut + 1 + i) * 3;
      right.pos[i * 3] = this.pos[src]!;
      right.pos[i * 3 + 1] = this.pos[src + 1]!;
      right.pos[i * 3 + 2] = this.pos[src + 2]!;
      right.prev[i * 3] = this.prev[src]!;
      right.prev[i * 3 + 1] = this.prev[src + 1]!;
      right.prev[i * 3 + 2] = this.prev[src + 2]!;
    }
    right.updateMasses();

    const leftCount = cut + 1;
    this.pos = this.pos.slice(0, leftCount * 3);
    this.prev = this.prev.slice(0, leftCount * 3);
    this.invMass = new Float64Array(leftCount);
    this.lambda = new Float64Array(leftCount - 1);
    this.tension = new Float64Array(leftCount - 1);
    this.n = leftCount;
    this.endPinned = false;
    this.snags.delete(cut);
    for (const key of [...this.snags.keys()]) if (key > cut) this.snags.delete(key);
    this.pendingBreak = null;
    this.updateMasses();
    this.endForce.set(0, 0, 0);
    return right;
  }

  /**
   * Prende o no `i` a um ponto movel, dentro do solver (cinematico): usado para atar esta linha a outra
   * no relo e na apara. Chamar a cada sub-passo com a posicao atual do no lider.
   */
  pinNode(i: number, x: number, y: number, z: number): void {
    const node = Math.min(Math.max(i, 1), this.n - 2);
    const existing = this.snags.get(node);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.z = z;
      return;
    }
    this.snags.set(node, { x, y, z, slackTicks: 0, kind: 'atado' });
    this.updateMasses();
  }

  /** Solta um no preso com pinNode (sem afetar engates em cabos). */
  unpinNode(i: number): void {
    const node = Math.min(Math.max(i, 1), this.n - 2);
    const s = this.snags.get(node);
    if (s && s.kind === 'atado') {
      this.snags.delete(node);
      this.updateMasses();
    }
  }

  /** Total de metros de linha representados (para conservar linha apos cortes). */
  totalLength(): number {
    return this.restLen * (this.n - 1);
  }
}
