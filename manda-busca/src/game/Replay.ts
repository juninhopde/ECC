/**
 * Replay instantaneo: buffer circular com as ultimas 5 s de posicao e rotacao das pipas, nos das
 * linhas e das rabiolas. Depois de um corte, a gravacao e congelada (4 s antes + 1 s depois) e a
 * tecla C a exibe com camera orbital centrada no ponto em que as linhas se cruzaram, em 0,25x,
 * 0,5x ou 1x. A reproducao usa "fantasmas" (so dados), sem tocar na simulacao.
 */
import { Quaternion, Vector3 } from 'three';
import type { KiteRig, KiteState } from '../physics/KiteRig';

export const REPLAY_SECONDS = 5;
export const REPLAY_FPS = 60;
export const REPLAY_CAPACITY = REPLAY_SECONDS * REPLAY_FPS;
/** Quanto depois do corte a gravacao continua antes de ser congelada (s). */
export const POST_CUT_SECONDS = 1;
export const REPLAY_SPEEDS = [0.25, 0.5, 1] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

const MAX_LINE_NODES = 36;
const MAX_TAIL_NODES = 24;

interface RigFrame {
  id: string;
  state: KiteState;
  connected: boolean;
  pos: Float32Array;
  quat: Float32Array;
  tailAttached: boolean;
  tailN: number;
  tail: Float32Array;
  lineN: number;
  line: Float32Array;
  handN: number;
  hand: Float32Array;
}

export interface ReplayFrame {
  t: number;
  count: number;
  rigs: RigFrame[];
}

export interface ReplayClip {
  frames: ReplayFrame[];
  /** Ponto em que as linhas se cruzaram (centro da camera orbital). */
  point: Vector3;
  duration: number;
  involvesPlayer: boolean;
}

function newRigFrame(): RigFrame {
  return {
    id: '', state: 'HAND', connected: false, pos: new Float32Array(3), quat: new Float32Array(4), tailAttached: false, tailN: 0,
    tail: new Float32Array(MAX_TAIL_NODES * 3), lineN: 0, line: new Float32Array(MAX_LINE_NODES * 3), handN: 0, hand: new Float32Array(MAX_LINE_NODES * 3),
  };
}

function copyNodes(src: ArrayLike<number> | undefined, n: number, dst: Float32Array, cap: number): number {
  if (!src) return 0;
  const m = Math.min(n, cap);
  for (let i = 0; i < m * 3; i++) dst[i] = src[i]!;
  return m;
}

function cloneRigFrame(r: RigFrame): RigFrame {
  return {
    ...r, pos: r.pos.slice(), quat: r.quat.slice(), tail: r.tail.slice(), line: r.line.slice(), hand: r.hand.slice(),
  };
}

interface PendingCut {
  point: Vector3;
  involvesPlayer: boolean;
  freezeAt: number;
}

export class ReplayRecorder {
  private readonly ring: ReplayFrame[] = [];
  private head = 0;
  private size = 0;
  private pending: PendingCut[] = [];
  private playerClip: ReplayClip | null = null;
  private anyClip: ReplayClip | null = null;

  constructor(readonly capacity = REPLAY_CAPACITY) {}

  get length(): number {
    return this.size;
  }

  /** Grava um quadro (chame a cada passo fixo). */
  record(t: number, rigs: readonly KiteRig[]): void {
    let frame = this.ring[this.head];
    if (!frame) {
      frame = { t: 0, count: 0, rigs: [] };
      this.ring[this.head] = frame;
    }
    frame.t = t;
    frame.count = rigs.length;
    for (let i = 0; i < rigs.length; i++) {
      const r = rigs[i]!;
      const f = (frame.rigs[i] ??= newRigFrame());
      f.id = r.id;
      f.state = r.state;
      f.connected = r.connected;
      f.pos[0] = r.kite.pos.x;
      f.pos[1] = r.kite.pos.y;
      f.pos[2] = r.kite.pos.z;
      f.quat[0] = r.kite.quat.x;
      f.quat[1] = r.kite.quat.y;
      f.quat[2] = r.kite.quat.z;
      f.quat[3] = r.kite.quat.w;
      const tail = r.kite.tail;
      f.tailAttached = r.kite.tailAttached && tail !== null;
      f.tailN = f.tailAttached ? copyNodes(tail!.pos, tail!.n, f.tail, MAX_TAIL_NODES) : 0;
      f.lineN = copyNodes(r.line?.pos, r.line?.n ?? 0, f.line, MAX_LINE_NODES);
      f.handN = copyNodes(r.handLine?.pos, r.handLine?.n ?? 0, f.hand, MAX_LINE_NODES);
    }
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.poll(t);
  }

  /** Um corte aconteceu: congela o clipe daqui a POST_CUT_SECONDS. */
  markCut(point: Vector3, involvesPlayer: boolean, t: number): void {
    this.pending.push({ point: point.clone(), involvesPlayer, freezeAt: t + POST_CUT_SECONDS });
  }

  private poll(t: number): void {
    if (this.pending.length === 0) return;
    const due = this.pending.filter((p) => t >= p.freezeAt);
    if (due.length === 0) return;
    this.pending = this.pending.filter((p) => t < p.freezeAt);
    // Varios cortes no mesmo instante: vale o ultimo que envolve o jogador, senao o ultimo.
    for (const p of due) {
      const clip = this.freeze(p.point, p.involvesPlayer);
      this.anyClip = clip;
      if (p.involvesPlayer) this.playerClip = clip;
    }
  }

  /** Copia o buffer (do mais antigo ao mais novo) para um clipe independente. */
  freeze(point: Vector3, involvesPlayer: boolean): ReplayClip {
    const frames: ReplayFrame[] = [];
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      const f = this.ring[(start + i) % this.capacity]!;
      frames.push({ t: f.t, count: f.count, rigs: f.rigs.slice(0, f.count).map(cloneRigFrame) });
    }
    const duration = frames.length > 1 ? frames[frames.length - 1]!.t - frames[0]!.t : 0;
    return { frames, point: point.clone(), duration, involvesPlayer };
  }

  /** Clipe de corte mais relevante: o ultimo que envolveu o jogador; senao o ultimo qualquer. */
  clip(): ReplayClip | null {
    return this.playerClip ?? this.anyClip;
  }

  /** Sem corte gravado: os ultimos 5 s, centrados em `focus`. */
  liveClip(focus: Vector3): ReplayClip | null {
    return this.size > 1 ? this.freeze(focus, true) : null;
  }

  reset(): void {
    this.head = 0;
    this.size = 0;
    this.pending = [];
    this.playerClip = null;
    this.anyClip = null;
  }
}

/** Linha e corpo "fantasmas": expõem so o que KiteView e LineView leem. */
export class GhostLine {
  n = 0;
  readonly pos = new Float64Array(MAX_LINE_NODES * 3);

  node(i: number, out: Vector3): Vector3 {
    return out.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }
}

export class GhostBody {
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  tailAttached = false;
  /** Nao nulo quando ha rabiola (o KiteView so testa isso). */
  tail: object | null = null;
  readonly tailPos = new Float64Array(MAX_TAIL_NODES * 3);
  tailN = 0;

  tailNode(i: number, out: Vector3): Vector3 | null {
    if (!this.tailAttached || i >= this.tailN) return null;
    return out.set(this.tailPos[i * 3]!, this.tailPos[i * 3 + 1]!, this.tailPos[i * 3 + 2]!);
  }
}

export class GhostRig {
  state: KiteState = 'HAND';
  connected = false;
  readonly kite = new GhostBody();
  readonly lineData = new GhostLine();
  readonly handData = new GhostLine();
  hasLine = false;
  hasHandLine = false;

  constructor(readonly id: string) {}

  /** Linha ligada a pipa (null depois de nao haver nos), no formato que o visual le. */
  get line(): GhostLine | null {
    return this.hasLine ? this.lineData : null;
  }

  /** Resto da linha do lado da mao, apos um corte. */
  get handLine(): GhostLine | null {
    return this.hasHandLine ? this.handData : null;
  }
}

export class ReplayPlayer {
  speed: ReplaySpeed = 0.5;
  /** Tempo dentro do clipe (s). */
  time = 0;
  private realTime = 0;
  readonly ghosts = new Map<string, GhostRig>();
  private readonly tmpQ = new Quaternion();
  private readonly tmpQ2 = new Quaternion();

  constructor(readonly clip: ReplayClip, private readonly orbitRadius = 16) {}

  setSpeed(s: ReplaySpeed): void {
    this.speed = s;
  }

  /** Avanca em tempo real; o clipe reinicia ao chegar ao fim. */
  advance(realDt: number): void {
    this.realTime += realDt;
    if (this.clip.duration <= 0) return;
    this.time += realDt * this.speed;
    while (this.time > this.clip.duration) this.time -= this.clip.duration;
  }

  /** Posicoes dos fantasmas no instante atual, interpoladas entre dois quadros. */
  sample(): GhostRig[] {
    const frames = this.clip.frames;
    if (frames.length === 0) return [];
    const t0 = frames[0]!.t;
    const target = t0 + this.time;
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1]!.t <= target) i++;
    const a = frames[i]!;
    const b = frames[Math.min(i + 1, frames.length - 1)]!;
    const span = b.t - a.t;
    const k = span > 1e-9 ? Math.min(1, Math.max(0, (target - a.t) / span)) : 0;
    const out: GhostRig[] = [];
    for (const ra of a.rigs) {
      const rb = b.rigs.find((r) => r.id === ra.id) ?? ra;
      let g = this.ghosts.get(ra.id);
      if (!g) {
        g = new GhostRig(ra.id);
        this.ghosts.set(ra.id, g);
      }
      g.state = ra.state;
      g.connected = ra.connected;
      g.kite.pos.set(
        ra.pos[0]! + (rb.pos[0]! - ra.pos[0]!) * k,
        ra.pos[1]! + (rb.pos[1]! - ra.pos[1]!) * k,
        ra.pos[2]! + (rb.pos[2]! - ra.pos[2]!) * k,
      );
      this.tmpQ.set(ra.quat[0]!, ra.quat[1]!, ra.quat[2]!, ra.quat[3]!);
      this.tmpQ2.set(rb.quat[0]!, rb.quat[1]!, rb.quat[2]!, rb.quat[3]!);
      g.kite.quat.slerpQuaternions(this.tmpQ, this.tmpQ2, k);
      g.kite.tailAttached = ra.tailAttached;
      g.kite.tail = ra.tailAttached ? g.kite : null;
      g.kite.tailN = ra.tailN;
      this.lerpNodes(ra.tail, rb.tail, ra.tailN, rb.tailN, k, g.kite.tailPos);
      g.hasLine = ra.lineN > 0;
      g.lineData.n = ra.lineN;
      this.lerpNodes(ra.line, rb.line, ra.lineN, rb.lineN, k, g.lineData.pos);
      g.hasHandLine = ra.handN > 0;
      g.handData.n = ra.handN;
      this.lerpNodes(ra.hand, rb.hand, ra.handN, rb.handN, k, g.handData.pos);
      out.push(g);
    }
    return out;
  }

  /** Interpola nos so quando os dois quadros tem o mesmo numero deles (depois de um corte o numero muda). */
  private lerpNodes(a: Float32Array, b: Float32Array, na: number, nb: number, k: number, out: Float64Array): void {
    const blend = na === nb ? k : 0;
    for (let i = 0; i < na * 3; i++) out[i] = a[i]! + (b[i]! - a[i]!) * blend;
  }

  /** Camera orbital em volta do ponto do corte: gira em tempo real, mesmo em camera lenta. */
  orbit(position: Vector3, target: Vector3): void {
    const angle = 0.6 + this.realTime * 0.35;
    const p = this.clip.point;
    position.set(p.x + Math.cos(angle) * this.orbitRadius, p.y + 4.5, p.z + Math.sin(angle) * this.orbitRadius);
    target.copy(p);
  }
}
