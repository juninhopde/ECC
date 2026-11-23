/**
 * Conjunto piloto + pipa + linha. Une o corpo rigido, a linha de Verlet e o
 * estoque do carretel, e traduz os comandos (lancar, desbicada, tapa, dar linha,
 * puxada rapida, recolher) em fisica. Vale para o jogador e, na fase 4, para bots.
 * Simulacao em passo fixo de 1/60 s com 4 sub-steps.
 */
import { Vector3 } from 'three';
import { LineSupply } from '../core/LineSupply';
import type { WireSegment } from '../world/Catenary';
import { BICO_MEDIO, KiteBody, type KiteSpec } from './KitePhysics';
import { LINE_SPECS, type LineSpec } from './LineSpec';
import { VerletLine } from './VerletLine';
import type { WindFn } from './WindField';

export type KiteState = 'HAND' | 'FLYING' | 'GROUNDED' | 'AVOADA';

export interface PilotInput {
  /** Borda: soltar a pipa que esta na mao (tecla N ou clique esquerdo). */
  launch: boolean;
  /** Borda: puxao curto na linha. */
  desbicada: boolean;
  /** Borda: clique rapido do tapa (com "dar linha" segurado). */
  tapaClick: boolean;
  /** +1 inclina o nariz para a esquerda (Q), -1 para a direita (E). */
  qe: number;
  /** Segurar: dar linha. */
  payOut: boolean;
  /** Puxada rapida (scroll ou Shift). */
  quickPull: boolean;
  /** Segurar: recolher / encher carretel. */
  reel: boolean;
}

export const EMPTY_INPUT: PilotInput = {
  launch: false, desbicada: false, tapaClick: false, qe: 0, payOut: false, quickPull: false, reel: false,
};

export interface RigEnvironment {
  wind: WindFn;
  /** Tempo de simulacao (s) no inicio do passo. */
  time: number;
  groundHeight: (x: number, z: number) => number;
  wires: readonly WireSegment[];
}

export interface RigEvents {
  onBreak?(cause: 'cabo' | 'externo'): void;
  onLaunch?(): void;
  onCaught?(): void;
}

export const SUBSTEPS = 4;
export const PAY_OUT_RATE = 6;
export const REEL_RATE = 4;
export const QUICK_PULL_RATE = 14;
const MIN_ACTIVE = 2;
const LAUNCH_LENGTH = 4;
const TAPA_ANGLE = (35 * Math.PI) / 180;
const QE_ANGLE = (60 * Math.PI) / 180;
const ASSIST_ALTITUDE = 24;
const ASSIST_DARTS = [0.35, 1.0, 1.65];

export class KiteRig {
  readonly id: string;
  spec: KiteSpec;
  lineSpec: LineSpec;
  kite: KiteBody;
  state: KiteState = 'HAND';
  /** Linha presa a pipa (ate o jogador, ou so o rabicho depois do corte). */
  line: VerletLine | null = null;
  /** Resto da linha do lado do jogador depois de um corte. */
  handLine: VerletLine | null = null;
  supply: LineSupply;
  /** A pipa ainda esta ligada ao jogador pela linha. */
  connected = false;
  readonly events: RigEvents = {};
  /** Auxilio de subida ativo logo apos soltar a pipa. */
  assisting = false;

  private readonly anchor = new Vector3();
  private readonly anchorPrev = new Vector3();
  private anchorReady = false;
  private readonly lineForce = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly windTmp = new Vector3();
  private readonly dirTmp = new Vector3();
  private assistTime = 0;
  private assistDartIndex = 0;
  private reelBurst = 0;
  private tapaSign = 1;
  private tapaPsi = 0;
  private grounded = 0;
  private slackRatio = 0;

  constructor(id: string, supply: LineSupply, spec: KiteSpec = BICO_MEDIO, lineSpec: LineSpec = LINE_SPECS.linha10) {
    this.id = id;
    this.supply = supply;
    this.spec = spec;
    this.lineSpec = lineSpec;
    this.kite = new KiteBody(spec);
  }

  /** Metros de linha para fora do carretel (L_ativo). */
  get activeLength(): number {
    return this.line ? this.line.activeLength : 0;
  }

  /** Tracao atual na linha (N), para as maos e o HUD. */
  get tension(): number {
    if (!this.line || !this.connected) return 0;
    return this.line.endForce.length();
  }

  /** Fracao de folga da linha: 0 = esticada, valores maiores = barriga. */
  get slack(): number {
    return this.slackRatio;
  }

  altitudeOver(groundY: number): number {
    return this.kite.pos.y - groundY;
  }

  /** Distancia (m) da pipa ao jogador. */
  distanceTo(point: Vector3): number {
    return this.kite.pos.distanceTo(point);
  }

  /** Troca o material (fase 4). Valido apenas com a pipa na mao. */
  setEquipment(spec: KiteSpec, lineSpec: LineSpec): void {
    if (this.state !== 'HAND') return;
    this.spec = spec;
    this.lineSpec = lineSpec;
    this.kite = new KiteBody(spec);
  }

  private launch(env: RigEnvironment): void {
    const available = Math.min(LAUNCH_LENGTH, this.supply.remaining);
    if (available < 1) return;
    this.supply.payOut(available);
    env.wind(this.anchor.x, this.anchor.y, this.anchor.z, env.time, this.windTmp);
    const dir = this.dirTmp.set(this.windTmp.x, 0, this.windTmp.z);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const start = this.tmp.copy(this.anchor).addScaledVector(dir, 1.5);
    start.y += 0.5;
    const face = this.tmp2.copy(dir).negate();
    this.kite = new KiteBody(this.spec);
    this.kite.place(start, face, new Vector3(this.windTmp.x * 0.5, 1.2, this.windTmp.z * 0.5));
    this.line = new VerletLine(this.lineSpec, 36, available);
    const knot = this.kite.knotWorld(new Vector3());
    this.line.layout(this.anchor, knot);
    this.connected = true;
    this.state = 'FLYING';
    this.assisting = true;
    this.assistTime = 0;
    this.assistDartIndex = 0;
    this.grounded = 0;
    this.events.onLaunch?.();
  }

  /** Um passo fixo (1/60 s). `anchor` e o ponto onde a linha sai da mao. */
  update(dt: number, input: PilotInput, anchor: Vector3, env: RigEnvironment): void {
    this.anchorPrev.copy(this.anchorReady ? this.anchor : anchor);
    this.anchor.copy(anchor);
    this.anchorReady = true;

    if (this.state === 'HAND') {
      if (input.launch) this.launch(env);
      this.updateHandLine(dt, input, env);
      return;
    }

    this.runControls(dt, input);
    this.simulate(dt, env);
    this.updateHandLine(dt, input, env);
    this.checkCaught();
  }

  private runControls(dt: number, input: PilotInput): void {
    const line = this.line;
    const flying = this.state === 'FLYING' || this.state === 'GROUNDED';
    if (!line || !this.connected || !flying) {
      // Pipa solta: sem comandos de linha; o alvo no plano volta a zero.
      this.kite.psiTarget = 0;
      return;
    }
    let delta = 0;

    // Auxilio de subida: 3 desbicadas automaticas iniciais e, depois, uma a cada 1,2 s ate a
    // altitude estavel; a linha so e liberada enquanto firme (tracao alta).
    if (this.assisting) {
      this.assistTime += dt;
      const nextDart = this.assistDartIndex < ASSIST_DARTS.length
        ? ASSIST_DARTS[this.assistDartIndex]!
        : ASSIST_DARTS[ASSIST_DARTS.length - 1]! + (this.assistDartIndex - ASSIST_DARTS.length + 1) * 1.2;
      if (this.assistTime >= nextDart && this.kite.pos.y < ASSIST_ALTITUDE) {
        this.kite.dart(this.spec.dartImpulse * 1.2);
        this.assistDartIndex++;
      }
      if (this.kite.pos.y < ASSIST_ALTITUDE && line.activeLength < 70 && this.tension > 1.2) {
        delta += 4 * dt;
      }
      if (this.assistTime >= 25 || (this.kite.pos.y >= ASSIST_ALTITUDE && this.assistDartIndex >= ASSIST_DARTS.length)) {
        this.assisting = false;
      }
    }

    if (input.payOut) delta += PAY_OUT_RATE * dt;

    if (input.desbicada) {
      const factor = Math.min(1, Math.max(0.3, 1 - this.slackRatio * 5));
      this.kite.dart(this.spec.dartImpulse * factor);
      this.reelBurst += 0.9;
    }
    if (input.quickPull) delta -= QUICK_PULL_RATE * dt;
    if (this.reelBurst > 0) {
      const burst = Math.min(this.reelBurst, 18 * dt);
      delta -= burst;
      this.reelBurst -= burst;
    }
    if (input.reel && !input.payOut) delta -= REEL_RATE * dt;

    this.applyLineDelta(line, delta);

    // Tapa / tenteio: alterna o nariz entre +35 e -35 graus; a amplitude cresce com a folga.
    if (this.spec.canTapa && input.payOut && input.tapaClick) {
      this.tapaSign = -this.tapaSign;
      const amp = Math.min(1, Math.max(0.25, this.slackRatio / 0.04));
      this.tapaPsi = this.tapaSign * TAPA_ANGLE * amp;
    }
    this.tapaPsi *= Math.exp(-dt * 3.5);
    this.kite.psiTarget = input.qe * QE_ANGLE + this.tapaPsi;
  }

  /** Move linha entre carretel e L_ativo, respeitando limites. delta > 0 libera. */
  private applyLineDelta(line: VerletLine, delta: number): void {
    if (delta > 0) {
      const moved = this.supply.payOut(delta);
      if (moved > 0) line.activeLength = line.activeLength + moved;
    } else if (delta < 0) {
      // Embreagem deslizante: o piloto nao recolhe alem do que a linha suporta. A taxa cai a
      // zero conforme a tracao se aproxima de 75% da ruptura (evita deformacao e tracao absurdas).
      // Mede pela deformacao geometrica (corda / L), que e confiavel, e tambem pela tracao.
      const limit = line.spec.breakTension * 0.75;
      const strain = line.chordLength() / Math.max(line.activeLength, 0.1) - 1;
      const strainMax = limit / line.spec.stiffness;
      const roomStrain = Math.min(1, Math.max(0, (strainMax - strain) / (0.3 * strainMax)));
      const roomTension = Math.min(1, Math.max(0, (limit - this.tension) / (0.3 * limit)));
      const room = Math.min(roomStrain, roomTension);
      const want = Math.min(-delta * room, Math.max(0, line.activeLength - MIN_ACTIVE));
      if (want > 0) {
        const stored = this.supply.takeIn(want);
        line.activeLength = line.activeLength - stored;
      }
    }
  }

  private simulate(dt: number, env: RigEnvironment): void {
    const dtS = dt / SUBSTEPS;
    const line = this.line;
    const knot = this.tmp;
    for (let s = 1; s <= SUBSTEPS; s++) {
      const time = env.time + (s - 1) * dtS;
      const f = line && (this.connected || this.state === 'AVOADA') ? this.lineForce : null;
      this.kite.step(dtS, env.wind, time, f);
      this.collideKite(env);
      if (line) {
        this.kite.knotWorld(knot);
        line.endAnchor.copy(knot);
        if (this.connected) {
          line.startAnchor.copy(this.anchorPrev).lerp(this.anchor, s / SUBSTEPS);
        }
        line.step(dtS, { wind: env.wind, time, groundHeight: env.groundHeight, wires: env.wires });
        this.couple(line);
        if (line.pendingBreak) {
          this.breakLine(line.pendingBreak.node, line.pendingBreak.cause);
          break;
        }
      }
    }
    if (line && this.connected) {
      const chord = line.chordLength();
      this.slackRatio = Math.max(0, 1 - chord / Math.max(line.activeLength, 0.1));
    }
  }

  /** Forca da linha no no do estirante, com amortecimento axial para estabilidade. */
  private couple(line: VerletLine): void {
    const force = this.lineForce.copy(line.endForce);
    const t = force.length();
    if (t > 1e-4) {
      const k = line.spec.stiffness / Math.max(line.activeLength, 0.3);
      const c = 2 * 0.35 * Math.sqrt(k * this.kite.totalMass());
      const u = this.tmp2.copy(force).multiplyScalar(-1 / t); // de dentro da linha para a pipa
      const vAlong = this.kite.vel.dot(u);
      force.addScaledVector(u, -c * vAlong);
      if (force.dot(u) > 0) force.set(0, 0, 0); // a linha nunca empurra
    }
  }

  private collideKite(env: RigEnvironment): void {
    const kite = this.kite;
    const ground = env.groundHeight(kite.pos.x, kite.pos.z) + 0.15;
    if (kite.pos.y < ground) {
      kite.pos.y = ground;
      if (kite.vel.y < 0) kite.vel.y *= -0.05;
      kite.vel.x *= 0.7;
      kite.vel.z *= 0.7;
      kite.omega.multiplyScalar(0.85);
      this.grounded++;
      if (this.grounded > 40 && kite.vel.length() < 1.5) {
        if (this.state === 'AVOADA') this.state = 'GROUNDED';
        else if (this.state === 'FLYING') this.state = 'GROUNDED';
      }
    } else {
      this.grounded = 0;
      if (this.state === 'GROUNDED' && kite.pos.y > ground + 0.6 && this.connected) this.state = 'FLYING';
    }
  }

  /** Rompe a linha no no `node` (cabo de poste ou corte externo). */
  breakLine(node: number, cause: 'cabo' | 'externo'): void {
    if (!this.line || !this.connected) return;
    const trailing = this.line.splitAt(node);
    this.handLine = this.line;
    this.handLine.startPinned = true;
    this.handLine.endPinned = false;
    this.line = trailing;
    this.connected = false;
    this.state = 'AVOADA';
    this.assisting = false;
    this.slackRatio = 0;
    this.events.onBreak?.(cause);
  }

  /** O resto da linha do lado da mao e recolhido com R / puxada rapida. */
  private updateHandLine(dt: number, input: PilotInput, env: RigEnvironment): void {
    const hl = this.handLine;
    if (!hl) return;
    hl.startAnchor.copy(this.anchor);
    const reeling = input.reel || input.quickPull;
    if (reeling) {
      const rate = input.quickPull ? QUICK_PULL_RATE : REEL_RATE;
      const give = Math.min(rate * dt, Math.max(0, hl.activeLength - 0.4));
      if (give > 0) {
        const stored = this.supply.takeIn(give);
        hl.activeLength = hl.activeLength - stored;
      }
    }
    const dtS = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      hl.step(dtS, { wind: env.wind, time: env.time + s * dtS, groundHeight: env.groundHeight });
    }
    if (hl.activeLength <= 0.5) this.handLine = null;
  }

  /** Quando a linha foi toda recolhida e a pipa chegou perto, ela volta para a mao. */
  private checkCaught(): void {
    if (!this.connected || !this.line) return;
    if (this.line.activeLength <= MIN_ACTIVE + 0.05 && this.kite.pos.distanceTo(this.anchor) < 3.2) {
      this.supply.takeIn(this.line.activeLength);
      this.line = null;
      this.connected = false;
      this.state = 'HAND';
      this.assisting = false;
      this.events.onCaught?.();
    }
  }

  /** Descarta a pipa solta e devolve o jogador a "pipa na mao" (nova pipa). */
  takeNewKite(): void {
    if (this.state === 'FLYING' || this.state === 'HAND') return;
    if (!this.connected) {
      this.line = null;
      this.state = 'HAND';
      this.kite = new KiteBody(this.spec);
    }
  }
}
