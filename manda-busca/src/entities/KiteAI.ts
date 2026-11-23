/**
 * Piloto automatico (bot tatico). Usa os mesmos comandos do jogador (PilotInput) e a mesma fisica:
 * solta a pipa, a leva ao alto, escolhe um alvo, conduz a PROPRIA LINHA ate cruzar a do inimigo
 * (servo no ponto de maior aproximacao entre as duas linhas), serra alternando dar linha e puxar
 * forte no relo, e tenta aparar pipas avoadas.
 */
import { Vector3 } from 'three';
import { clamp, mulberry32 } from '../core/noise';
import { closestPointSegmentSegment, newSegSegResult } from '../physics/Geometry';
import { QE_ANGLE, type KiteRig, type PilotInput } from '../physics/KiteRig';
import { lineResistance, sameTeam, type ReloContact, type ReloSystem } from '../physics/ReloSystem';
import type { VerletLine } from '../physics/VerletLine';
import type { WindFn } from '../physics/WindField';

export type Difficulty = 'iniciante' | 'criado-na-laje' | 'mestre-do-relo';

export const DIFFICULTY_ORDER: Difficulty[] = ['iniciante', 'criado-na-laje', 'mestre-do-relo'];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  iniciante: 'Iniciante',
  'criado-na-laje': 'Criado na Laje',
  'mestre-do-relo': 'Mestre do Relo',
};

export interface AiProfile {
  /** Tempo medio entre decisoes (s): quanto menor, mais rapida a reacao. */
  reaction: number;
  /** Altitude alvo da pipa (m acima da mao). */
  altitude: number;
  /** Erro de pontaria (m) somado ao destino do servo. */
  aimNoise: number;
  /** Fracao do ciclo em que serra de fato (o resto e descanso). */
  sawEffort: number;
  /** Fracao do esforco gasta puxando forte (a puxada corta mais que dar linha). */
  pullShare: number;
  /** Duracao do ciclo puxar/dar linha (s). */
  sawPeriod: number;
  /** Chance por decisao de partir para cima de um alvo. */
  aggression: number;
  /** Chance por decisao de ir atras de uma pipa avoada. */
  hunts: number;
  /** Usa desbicada no inicio de cada puxada (rajada de corte). */
  darts: boolean;
  /** Deslocamento maximo da pipa por correcao do servo (m). */
  maxMove: number;
}

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  iniciante: { reaction: 1.0, altitude: 24, aimNoise: 3.2, sawEffort: 0.4, pullShare: 0.4, sawPeriod: 1.2, aggression: 0.3, hunts: 0.25, darts: false, maxMove: 5 },
  'criado-na-laje': { reaction: 0.5, altitude: 31, aimNoise: 1.2, sawEffort: 0.8, pullShare: 0.5, sawPeriod: 0.7, aggression: 0.7, hunts: 0.7, darts: true, maxMove: 9 },
  'mestre-do-relo': { reaction: 0.25, altitude: 37, aimNoise: 0.25, sawEffort: 1, pullShare: 0.8, sawPeriod: 0.25, aggression: 1, hunts: 1, darts: true, maxMove: 14 },
};

export interface AiContext {
  rigs: readonly KiteRig[];
  relo: ReloSystem;
  wind: WindFn;
  time: number;
  groundHeight: (x: number, z: number) => number;
}

const UP = new Vector3(0, 1, 0);
/** Trecho da linha (fracao a partir da mao) usado para cruzar a linha inimiga: longe do estirante. */
const FIGHT_S_MIN = 0.3;
const FIGHT_S_MAX = 0.8;
/** Distancia minima da pipa a uma linha inimiga (o estirante corta a 6 cm; folga para a inercia). */
const SAFE_KITE_DISTANCE = 1.3;
/** So vale ir atras de avoada que esteja ao alcance da mao e ainda no ar (no chao a linha dela nao e cruzavel). */
const HUNT_RANGE = 90;
const HUNT_MIN_ALTITUDE = 4;

interface Closest {
  dist: number;
  /** Fracao (0..1) da linha propria onde ocorre a maior aproximacao. */
  frac: number;
  own: Vector3;
  other: Vector3;
}

export class KiteAI {
  readonly input: PilotInput = { launch: false, desbicada: false, tapaClick: false, qe: 0, payOut: false, quickPull: false, reel: false };
  readonly profile: AiProfile;
  /** Alvo atual de ataque e de apara (para a camera, o placar e os testes). */
  target: KiteRig | null = null;
  hunting: KiteRig | null = null;

  private readonly rng: () => number;
  private t = 0;
  private nextThink = 0;
  private launchAt = 0;
  private prevState = '';
  private dartCooldown = 0;
  private sawClock = 0;
  private lastPhase = -1;
  private altitudeJitter = 0;
  private readonly noise = new Vector3();
  private readonly goal = new Vector3();
  private readonly tmp = new Vector3();
  private readonly radial = new Vector3();
  private readonly dir = new Vector3();
  private readonly left = new Vector3();
  private readonly upT = new Vector3();
  private readonly wind = new Vector3();
  private readonly seg = newSegSegResult();
  private readonly closest: Closest = { dist: Infinity, frac: 0, own: new Vector3(), other: new Vector3() };

  constructor(readonly rig: KiteRig, readonly difficulty: Difficulty, seed: number, overrides: Partial<AiProfile> = {}) {
    this.profile = { ...AI_PROFILES[difficulty], ...overrides };
    this.rng = mulberry32(seed);
    this.altitudeJitter = (this.rng() - 0.5) * 8;
    this.launchAt = 0.6 + this.rng() * 2.4;
  }

  update(dt: number, ctx: AiContext): PilotInput {
    const inp = this.input;
    inp.launch = false;
    inp.desbicada = false;
    inp.tapaClick = false;
    inp.qe = 0;
    inp.payOut = false;
    inp.quickPull = false;
    inp.reel = false;
    this.t += dt;
    this.dartCooldown = Math.max(0, this.dartCooldown - dt);
    const rig = this.rig;
    if (rig.state !== this.prevState) {
      if (rig.state === 'HAND') this.launchAt = this.t + this.profile.reaction + this.rng() * 1.5;
      this.target = null;
      this.hunting = null;
      this.prevState = rig.state;
    }
    switch (rig.state) {
      case 'HAND':
        if (this.t >= this.launchAt) inp.launch = true;
        break;
      case 'AVOADA':
        inp.reel = true; // recolhe o resto da linha
        break;
      case 'GROUNDED':
        // Pipa no chao com a linha ligada: desbicada e recolhe para levantar.
        if (rig.connected) {
          inp.reel = true;
          if (this.dartCooldown <= 0) {
            inp.desbicada = true;
            this.dartCooldown = 1.1;
          }
        } else inp.reel = true;
        break;
      case 'FLYING':
        this.fly(dt, ctx);
        break;
      default:
        break;
    }
    return inp;
  }

  private fly(dt: number, ctx: AiContext): void {
    const rig = this.rig;
    const inp = this.input;
    // A subida assistida cuida do lancamento; mexer na linha antes a cancelaria.
    if (rig.assisting) return;

    const contact = ctx.relo.contactFor(rig);
    if (contact) {
      this.saw(dt, contact);
      return;
    }
    if (ctx.relo.hookFor(rig)) {
      inp.reel = true; // recolhe devagar: abaixo do limite que desgasta a linha
      return;
    }
    this.think(ctx);

    // Destino: servo na linha do alvo, na pipa avoada, ou ponto de espera no vento.
    let hasGoal = false;
    if (this.hunting?.line) hasGoal = this.huntGoal(this.hunting.line, this.goal);
    else if (this.target?.line) hasGoal = this.servo(this.target.line, FIGHT_S_MIN, FIGHT_S_MAX, this.goal);
    if (!hasGoal) this.station(ctx, this.goal);
    this.keepClear(ctx, this.goal);
    this.steer(this.goal);
    this.keepFlying(ctx);
  }

  /** Decide, a cada intervalo de reacao, entre cacar avoada, atacar ou so manter a pipa no alto. */
  private think(ctx: AiContext): void {
    if (this.t < this.nextThink) return;
    const p = this.profile;
    this.nextThink = this.t + p.reaction * (0.8 + this.rng() * 0.4);
    this.noise.set((this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2).multiplyScalar(p.aimNoise);
    const rig = this.rig;
    const K = rig.kite.pos;
    let loose: KiteRig | null = null;
    let looseD = HUNT_RANGE;
    let enemy: KiteRig | null = null;
    let enemyD = Infinity;
    for (const r of ctx.rigs) {
      if (r === rig || !r.line) continue;
      const d = r.kite.pos.distanceTo(K);
      if (r.state === 'AVOADA' || (r.state === 'GROUNDED' && !r.connected)) {
        const airborne = r.kite.pos.y - ctx.groundHeight(r.kite.pos.x, r.kite.pos.z) > HUNT_MIN_ALTITUDE;
        if (airborne && r.kite.pos.distanceTo(rig.anchorPoint) < looseD) {
          loose = r;
          looseD = r.kite.pos.distanceTo(rig.anchorPoint);
        }
      } else if (r.state === 'FLYING' && r.connected && !sameTeam(rig, r) && d < enemyD) {
        enemy = r;
        enemyD = d;
      }
    }
    this.hunting = loose && this.rng() < p.hunts ? loose : null;
    if (this.hunting) {
      this.target = null;
      return;
    }
    const keep = this.target && this.target.state === 'FLYING' && this.target.connected && this.target.line && this.rng() > 0.08;
    if (!keep) this.target = enemy && this.rng() < p.aggression ? enemy : null;
  }

  /**
   * Servo visual: acha, entre o trecho [sMin, sMax] da linha propria e a linha `other`, o par de
   * pontos mais proximo e move a pipa de modo a levar o ponto proprio ate o do outro. Mover a
   * pipa em d move o ponto da linha na fracao s em s*d; por isso o destino e K + (outro - proprio)/s.
   */
  private servo(other: VerletLine, sMin: number, sMax: number, out: Vector3): boolean {
    const own = this.rig.line;
    if (!own) return false;
    const c = this.closestBetween(own, other, sMin, sMax);
    if (!c) return false;
    const s = Math.max(c.frac, sMin);
    this.tmp.copy(c.other).sub(c.own).multiplyScalar(1 / s);
    const len = this.tmp.length();
    if (len > this.profile.maxMove) this.tmp.multiplyScalar(this.profile.maxMove / len);
    out.copy(this.rig.kite.pos).add(this.tmp).add(this.noise);
    return true;
  }

  /**
   * Apara: leva o meio da PROPRIA linha (fracao 0,7) ate o meio da linha solta. Perseguir o ponto
   * mais proximo faria a pipa correr atras da ponta da avoada, que e o trecho que mais se move.
   */
  private huntGoal(other: VerletLine, out: Vector3): boolean {
    const own = this.rig.line;
    if (!own) return false;
    const S_OWN = 0.7;
    own.node(Math.round(S_OWN * (own.n - 1)), this.radial);
    other.node(Math.round(0.5 * (other.n - 1)), this.tmp);
    this.tmp.sub(this.radial).multiplyScalar(1 / S_OWN);
    const len = this.tmp.length();
    if (len > this.profile.maxMove) this.tmp.multiplyScalar(this.profile.maxMove / len);
    out.copy(this.rig.kite.pos).add(this.tmp).add(this.noise);
    return true;
  }

  private closestBetween(own: VerletLine, other: VerletLine, sMin: number, sMax: number): Closest | null {
    const a = own.pos;
    const b = other.pos;
    const i0 = Math.max(0, Math.floor(sMin * (own.n - 1)));
    const i1 = Math.min(own.n - 1, Math.ceil(sMax * (own.n - 1)));
    const c = this.closest;
    let best = Infinity;
    let bi = -1;
    let bs = 0;
    let bj = 0;
    let bt = 0;
    for (let i = i0; i < i1; i++) {
      const i3 = i * 3;
      for (let j = 0; j < other.n - 1; j++) {
        const j3 = j * 3;
        closestPointSegmentSegment(a[i3]!, a[i3 + 1]!, a[i3 + 2]!, a[i3 + 3]!, a[i3 + 4]!, a[i3 + 5]!, b[j3]!, b[j3 + 1]!, b[j3 + 2]!, b[j3 + 3]!, b[j3 + 4]!, b[j3 + 5]!, this.seg);
        if (this.seg.distSq < best) {
          best = this.seg.distSq;
          bi = i;
          bs = this.seg.s;
          bj = j;
          bt = this.seg.t;
        }
      }
    }
    if (bi < 0) return null;
    const i3 = bi * 3;
    const j3 = bj * 3;
    c.own.set(a[i3]! + (a[i3 + 3]! - a[i3]!) * bs, a[i3 + 1]! + (a[i3 + 4]! - a[i3 + 1]!) * bs, a[i3 + 2]! + (a[i3 + 5]! - a[i3 + 2]!) * bs);
    c.other.set(b[j3]! + (b[j3 + 3]! - b[j3]!) * bt, b[j3 + 1]! + (b[j3 + 4]! - b[j3 + 1]!) * bt, b[j3 + 2]! + (b[j3 + 5]! - b[j3 + 2]!) * bt);
    c.dist = Math.sqrt(best);
    c.frac = (bi + bs) / (own.n - 1);
    return c;
  }

  /**
   * Ponto de espera: a favor do vento, na altitude do perfil. Na simulacao a pipa assenta em
   * ~30 graus de elevacao, entao a altura h pede ~2h de linha; o destino fica um pouco acima
   * (40 graus) para que o nariz para cima a mantenha subindo.
   */
  private station(ctx: AiContext, out: Vector3): void {
    const rig = this.rig;
    const A = rig.anchorPoint;
    const K = rig.kite.pos;
    ctx.wind(K.x, K.y, K.z, ctx.time, this.wind);
    this.dir.set(this.wind.x, 0, this.wind.z);
    if (this.dir.lengthSq() < 1e-6) this.dir.set(1, 0, 0);
    this.dir.normalize();
    const h = this.profile.altitude + this.altitudeJitter;
    const reach = Math.min(h * 2, rig.supply.capacity * 0.6);
    const elev = (40 * Math.PI) / 180;
    const flat = Math.cos(elev) * reach;
    out.set(A.x + this.dir.x * flat, A.y + Math.sin(elev) * reach, A.z + this.dir.z * flat);
  }

  /** Nunca deixa a pipa chegar perto de uma linha inimiga: o estirante cortaria na hora. */
  private keepClear(ctx: AiContext, goal: Vector3): void {
    const K = this.rig.kite.pos;
    for (const r of ctx.rigs) {
      if (r === this.rig || !r.line || r.state !== 'FLYING' || !r.connected || sameTeam(this.rig, r)) continue;
      const pos = r.line.pos;
      for (let j = 0; j < r.line.n - 1; j++) {
        const j3 = j * 3;
        closestPointSegmentSegment(K.x, K.y, K.z, K.x, K.y, K.z, pos[j3]!, pos[j3 + 1]!, pos[j3 + 2]!, pos[j3 + 3]!, pos[j3 + 4]!, pos[j3 + 5]!, this.seg);
        if (this.seg.distSq < SAFE_KITE_DISTANCE * SAFE_KITE_DISTANCE) {
          const t = this.seg.t;
          this.tmp.set(
            pos[j3]! + (pos[j3 + 3]! - pos[j3]!) * t,
            pos[j3 + 1]! + (pos[j3 + 4]! - pos[j3 + 1]!) * t,
            pos[j3 + 2]! + (pos[j3 + 5]! - pos[j3 + 2]!) * t,
          );
          this.tmp.sub(K).multiplyScalar(-1);
          const l = this.tmp.length() || 1;
          goal.copy(K).addScaledVector(this.tmp, 6 / l);
          return;
        }
      }
    }
  }

  /** Converte o destino em Q/E (inclinar o nariz) e em dar/recolher linha (distancia radial). */
  private steer(goal: Vector3): void {
    const rig = this.rig;
    const inp = this.input;
    const K = rig.kite.pos;
    this.radial.copy(K).sub(rig.anchorPoint);
    const len = this.radial.length();
    if (len < 1) return;
    this.radial.multiplyScalar(1 / len);
    this.dir.copy(goal).sub(K);
    const radialMove = this.dir.dot(this.radial);
    this.dir.addScaledVector(this.radial, -radialMove);
    this.left.crossVectors(UP, this.radial);
    if (this.left.lengthSq() < 1e-6) this.left.set(0, 0, 1);
    this.left.normalize();
    this.upT.crossVectors(this.radial, this.left).normalize();
    const tl = this.dir.dot(this.left);
    const tu = this.dir.dot(this.upT);
    // Comando proporcional: pleno quando longe, suave perto do alvo (senao a pipa orbita em vez de assentar).
    const mag = Math.hypot(tl, tu);
    if (mag > 0.4) inp.qe = clamp(Math.atan2(tl, tu) / QE_ANGLE, -1, 1) * clamp(mag / 3, 0.15, 1);
    if (radialMove > 0.8 && rig.tension > 1.0) inp.payOut = true;
    else if (radialMove < -1.2) inp.reel = true;
  }

  /** Mantem a pipa voando: refaz a tensao quando a linha frouxa e levanta se estiver baixa. */
  private keepFlying(ctx: AiContext): void {
    const rig = this.rig;
    const inp = this.input;
    const K = rig.kite.pos;
    const low = K.y - ctx.groundHeight(K.x, K.z) < 7;
    const want = this.profile.altitude + this.altitudeJitter;
    const climbing = K.y - rig.anchorPoint.y < want - 4 && rig.slack < 0.03 && !this.target && !this.hunting;
    if ((rig.slack > 0.05 || low || climbing) && this.dartCooldown <= 0) {
      inp.desbicada = true;
      this.dartCooldown = 1.2;
    }
    if (rig.slack > 0.08) inp.reel = true;
    if (low) inp.payOut = false;
    // Carretel quase vazio: recolhe para nao ficar sem linha.
    if (rig.supply.remaining < rig.supply.capacity * 0.04) {
      inp.payOut = false;
      inp.reel = true;
    }
  }

  /** No relo: alterna puxar forte (com desbicada) e dar linha; o resto do ciclo e descanso. */
  private saw(dt: number, contact: ReloContact): void {
    const rig = this.rig;
    const inp = this.input;
    const p = this.profile;
    this.sawClock += dt;
    const phase = (this.sawClock % p.sawPeriod) / p.sawPeriod;
    // Quando o desgaste proprio esta alto e o inimigo corta mais, o mestre nao descansa nunca.
    const other = contact.a === rig ? contact.b : contact.a;
    const losing = rig.wear > lineResistance(rig.lineSpec) * 0.5 && other.cutPower > rig.cutPower;
    const effort = losing && p.sawEffort >= 0.8 ? 1 : p.sawEffort;
    const pullEnd = effort * p.pullShare;
    if (phase < pullEnd) {
      inp.quickPull = true;
      if (p.darts && this.lastPhase > phase) inp.desbicada = true; // inicio de um novo ciclo
    } else if (phase < effort) {
      inp.payOut = true;
    }
    this.lastPhase = phase;
    if (rig.supply.remaining < rig.supply.capacity * 0.03) {
      inp.payOut = false;
      inp.quickPull = true;
    }
    if (rig.slack > 0.12 && !inp.payOut) inp.reel = true;
  }
}
