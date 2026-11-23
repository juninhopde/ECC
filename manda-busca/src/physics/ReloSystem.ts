/**
 * Combate entre linhas. Tres mecanicas, todas avaliadas a cada sub-passo (240 Hz):
 *  - Relo: duas linhas se tocam (distancia < 8 cm). A cada 0,05 s de contato o atrito
 *    desgasta a linha de MENOR poder de corte (velocidade da linha x abrasividade);
 *    quando o desgaste chega a resistencia, a linha rompe exatamente no ponto do contato.
 *  - Estirante: linha inimiga tocando o cabresto corta na hora; tocando a rabiola, so
 *    a rabiola e cortada (a pipa continua presa, mas perde a estabilidade).
 *  - Apara: a linha do jogador toca a linha ou a rabiola de uma pipa avoada e engata;
 *    recolher devagar traz a pipa; pela linha, puxar rapido demais serra a sua propria
 *    linha; pela rabiola o engate e firme.
 * Sem tunelamento: a zona de contato tem 16 cm de largura, entao ate ~38 m/s de
 * velocidade relativa nenhum passo de 1/240 s a atravessa sem tocar.
 */
import { Vector3 } from 'three';
import { closestPointSegmentSegment, newSegSegResult, type SegSegResult } from './Geometry';
import type { KiteRig } from './KiteRig';
import type { LineSpec } from './LineSpec';
import type { VerletLine } from './VerletLine';

export const RELO_DISTANCE = 0.08;
/** O contato ja iniciado (linhas atadas) so se desfaz se as linhas se afastarem alem disto. */
export const KEEP_DISTANCE = 0.5;
export const CONTACT_TICK = 0.05;
export const DAMAGE_PER_POWER = 0.025;
export const MIN_POWER = 0.5;
export const MIN_POWER_DIFF = 1.0;
export const BASE_RESISTANCE = 3.0;
export const BRIDLE_CUT_DISTANCE = 0.06;
export const HOOK_SAFE_SPEED = 5;
export const HOOK_WEAR_RATE = 0.8;
export const CAPTURE_DISTANCE = 3.2;
const GUIDE_SLACK = 1.5;
const GUIDE_STIFFNESS = 140;
const GUIDE_DAMPING = 9;
const GUIDE_HOLD_RANGE = 6;
export const WEAR_RECOVERY = 1.0;
/** Tempo parado (sem poder de corte) apos o qual as linhas se soltam, e duracao maxima do relo. */
export const RELO_IDLE_RELEASE = 1.0;
export const RELO_MAX_TIME = 6;
export const RELO_COOLDOWN = 0.6;

/** Poder de corte: velocidade de deslocamento da linha vezes a abrasividade do tipo. */
export function cutPower(slideSpeed: number, spec: LineSpec): number {
  return slideSpeed * spec.abrasion;
}

/** Resistencia ao desgaste por atrito. */
export function lineResistance(spec: LineSpec): number {
  return BASE_RESISTANCE * spec.resistance;
}

export type CombatEventType =
  | 'relo-start' | 'relo-end' | 'cut' | 'tail-cut' | 'bridle-cut'
  | 'hook' | 'unhook' | 'capture' | 'hook-saw';

export interface CombatEvent {
  type: CombatEventType;
  /** Quem causou (o vencedor do relo, o dono da linha que engatou). */
  attacker?: KiteRig;
  /** Quem sofreu (linha cortada, pipa avoada capturada). */
  victim?: KiteRig;
  point?: Vector3;
  hookKind?: 'linha' | 'rabiola';
}

export interface ReloContact {
  a: KiteRig;
  b: KiteRig;
  point: Vector3;
  time: number;
  tickAcc: number;
  lostFor: number;
  seenThisStep: boolean;
  /** Nos que se cruzam (um em cada linha) e tempo parado sem poder de corte. */
  nodeA: number;
  nodeB: number;
  idle: number;
  /** Linha que acompanha a outra (a de menor poder de corte) e o no dela que esta preso. */
  follower: 'a' | 'b';
}

export interface Hook {
  owner: KiteRig;
  target: KiteRig;
  kind: 'linha' | 'rabiola';
  /** No da linha do dono mais proximo do ponto de engate. */
  node: number;
  point: Vector3;
  lostFor: number;
  seenThisStep: boolean;
  /** Estresse normalizado: <= 1 e a zona verde. */
  stress: number;
  /** No da linha da avoada preso ao da linha do dono (-1 = nenhum). */
  pinned: number;
}

export interface LineContact {
  distSq: number;
  /** Indice do segmento em cada linha e parametro [0,1] do ponto mais proximo. */
  segA: number;
  sA: number;
  segB: number;
  sB: number;
  point: Vector3;
}

const seg = newSegSegResult();

/** Menor distancia entre duas linhas (todos os pares de segmentos), com rejeicao por caixa. */
export function minLineDistance(la: VerletLine, lb: VerletLine, out: LineContact, margin = 0.5): LineContact | null {
  const A = la.pos;
  const B = lb.pos;
  const na = la.n;
  const nb = lb.n;
  let aMinX = Infinity, aMinY = Infinity, aMinZ = Infinity, aMaxX = -Infinity, aMaxY = -Infinity, aMaxZ = -Infinity;
  for (let i = 0; i < na; i++) {
    const x = A[i * 3]!, y = A[i * 3 + 1]!, z = A[i * 3 + 2]!;
    if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
    if (y < aMinY) aMinY = y; if (y > aMaxY) aMaxY = y;
    if (z < aMinZ) aMinZ = z; if (z > aMaxZ) aMaxZ = z;
  }
  let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity, bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
  for (let i = 0; i < nb; i++) {
    const x = B[i * 3]!, y = B[i * 3 + 1]!, z = B[i * 3 + 2]!;
    if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
    if (z < bMinZ) bMinZ = z; if (z > bMaxZ) bMaxZ = z;
  }
  if (aMaxX + margin < bMinX || bMaxX + margin < aMinX || aMaxY + margin < bMinY || bMaxY + margin < aMinY ||
      aMaxZ + margin < bMinZ || bMaxZ + margin < aMinZ) return null;
  let best = Infinity;
  let found = false;
  const r: SegSegResult = seg;
  for (let i = 0; i < na - 1; i++) {
    const i3 = i * 3;
    for (let j = 0; j < nb - 1; j++) {
      const j3 = j * 3;
      closestPointSegmentSegment(
        A[i3]!, A[i3 + 1]!, A[i3 + 2]!, A[i3 + 3]!, A[i3 + 4]!, A[i3 + 5]!,
        B[j3]!, B[j3 + 1]!, B[j3 + 2]!, B[j3 + 3]!, B[j3 + 4]!, B[j3 + 5]!, r,
      );
      if (r.distSq < best) {
        best = r.distSq;
        found = true;
        out.distSq = r.distSq;
        out.segA = i;
        out.sA = r.s;
        out.segB = j;
        out.sB = r.t;
      }
    }
  }
  if (!found) return null;
  const i3 = out.segA * 3;
  out.point.set(
    A[i3]! + (A[i3 + 3]! - A[i3]!) * out.sA,
    A[i3 + 1]! + (A[i3 + 4]! - A[i3 + 1]!) * out.sA,
    A[i3 + 2]! + (A[i3 + 5]! - A[i3 + 2]!) * out.sA,
  );
  return out;
}

/** Pipas da mesma equipe nao se cortam (sem fogo amigo). */
export function sameTeam(a: KiteRig, b: KiteRig): boolean {
  return a.team >= 0 && a.team === b.team;
}

const key = (a: KiteRig, b: KiteRig): string => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

/** Pipa solta: avoada no ar, ou caida no chao sem linha ligada ao piloto (ainda apanhavel). */
function isLoose(r: KiteRig): boolean {
  return r.state === 'AVOADA' || (r.state === 'GROUNDED' && !r.connected);
}

/** Dono com a linha ligada ao jogador: a pipa pode ate estar no chao (recolher forte derruba), e ele ainda apara. */
function hasLiveLine(r: KiteRig): boolean {
  return (r.state === 'FLYING' || r.state === 'GROUNDED') && r.connected && r.line !== null;
}

function flyingConnected(r: KiteRig): boolean {
  return r.state === 'FLYING' && r.connected && r.line !== null;
}

export class ReloSystem {
  readonly contacts = new Map<string, ReloContact>();
  readonly hooks = new Map<KiteRig, Hook>();
  readonly events: CombatEvent[] = [];
  /** Combate ligado. Desligado na preparacao do campeonato ("ainda nao corta"). */
  enabled = true;
  private readonly cooldown = new Map<string, number>();
  private readonly scratch: LineContact = { distSq: 0, segA: 0, sA: 0, segB: 0, sB: 0, point: new Vector3() };
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly legs: Array<[Vector3, Vector3]> = [];

  drainEvents(): CombatEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Contato de relo ativo que envolve `rig`, se houver. */
  contactFor(rig: KiteRig): ReloContact | null {
    for (const c of this.contacts.values()) if (c.a === rig || c.b === rig) return c;
    return null;
  }

  hookFor(rig: KiteRig): Hook | null {
    return this.hooks.get(rig) ?? null;
  }

  /** Avalia um sub-passo de duracao dtS para todos os pilotos. */
  detect(rigs: readonly KiteRig[], dtS: number): void {
    if (!this.enabled) return;
    for (const c of this.contacts.values()) c.seenThisStep = false;
    for (const h of this.hooks.values()) h.seenThisStep = false;
    const combat = rigs.filter(flyingConnected);

    for (let i = 0; i < combat.length; i++) {
      for (let j = i + 1; j < combat.length; j++) {
        if (sameTeam(combat[i]!, combat[j]!)) continue;
        this.detectRelo(combat[i]!, combat[j]!, dtS);
      }
    }
    for (const enemy of combat) {
      for (const victim of rigs) {
        if (victim === enemy || sameTeam(enemy, victim)) continue;
        this.detectBridleAndTail(enemy, victim);
      }
    }
    for (const owner of rigs.filter(hasLiveLine)) {
      for (const target of rigs) {
        if (target !== owner && isLoose(target) && target.line) this.detectHook(owner, target);
      }
    }
  }

  private detectRelo(a: KiteRig, b: KiteRig, dtS: number): void {
    const k = key(a, b);
    if ((this.cooldown.get(k) ?? 0) > 0) return;
    const hit = minLineDistance(a.line!, b.line!, this.scratch);
    let c = this.contacts.get(k);
    const reach = c ? KEEP_DISTANCE : RELO_DISTANCE;
    const touching = hit !== null && hit.distSq < reach * reach;
    if (touching && hit) {
      if (!c) {
        c = { a, b, point: new Vector3(), time: 0, tickAcc: 0, lostFor: 0, seenThisStep: true, nodeA: 1, nodeB: 1, idle: 0, follower: 'b' };
        this.contacts.set(k, c);
        this.events.push({ type: 'relo-start', attacker: a, victim: b, point: hit.point.clone() });
      }
      c.point.copy(hit.point);
      c.seenThisStep = true;
      c.lostFor = 0;
      c.time += dtS;
      c.tickAcc += dtS;
      this.tie(c, hit);
      while (c.tickAcc >= CONTACT_TICK) {
        c.tickAcc -= CONTACT_TICK;
        if (this.applyFriction(c, hit)) return;
      }
    }
  }

  /** As linhas se enroscam: o no do cruzamento da linha mais fraca fica preso ao da mais forte. */
  private tie(c: ReloContact, hit: LineContact): void {
    const la = c.a.line!;
    const lb = c.b.line!;
    const nodeA = Math.min(Math.max(hit.segA + (hit.sA < 0.5 ? 0 : 1), 1), la.n - 2);
    const nodeB = Math.min(Math.max(hit.segB + (hit.sB < 0.5 ? 0 : 1), 1), lb.n - 2);
    const follower: 'a' | 'b' = c.a.cutPower >= c.b.cutPower ? 'b' : 'a';
    if (c.time > 0.02 && (c.follower !== follower || (follower === 'a' ? c.nodeA !== nodeA : c.nodeB !== nodeB))) {
      this.untie(c);
    }
    c.nodeA = nodeA;
    c.nodeB = nodeB;
    c.follower = follower;
    if (follower === 'b') {
      lb.pinNode(nodeB, la.pos[nodeA * 3]!, la.pos[nodeA * 3 + 1]!, la.pos[nodeA * 3 + 2]!);
    } else {
      la.pinNode(nodeA, lb.pos[nodeB * 3]!, lb.pos[nodeB * 3 + 1]!, lb.pos[nodeB * 3 + 2]!);
    }
  }

  private untie(c: ReloContact): void {
    const line = c.follower === 'b' ? c.b.line : c.a.line;
    const node = c.follower === 'b' ? c.nodeB : c.nodeA;
    line?.unpinNode(node);
  }

  /** Um intervalo de 0,05 s de atrito. Devolve true se uma linha rompeu. */
  private applyFriction(c: ReloContact, hit: LineContact): boolean {
    const pa = cutPower(Math.max(c.a.pullSpeed, c.a.reelRequest * 0.7) + c.a.payOutSpeed, c.a.lineSpec);
    const pb = cutPower(Math.max(c.b.pullSpeed, c.b.reelRequest * 0.7) + c.b.payOutSpeed, c.b.lineSpec);
    if (Math.max(pa, pb) < MIN_POWER) return false;
    const loser = pa < pb ? c.a : pa > pb ? c.b : this.tieLoser(c);
    const winner = loser === c.a ? c.b : c.a;
    const diff = Math.max(Math.abs(pa - pb), MIN_POWER_DIFF);
    loser.wear += diff * DAMAGE_PER_POWER;
    if (loser.wear >= lineResistance(loser.lineSpec)) {
      const line = loser.line!;
      const seg = loser === c.a ? hit.segA : hit.segB;
      const s = loser === c.a ? hit.sA : hit.sB;
      const node = Math.min(Math.max(seg + (s < 0.5 ? 0 : 1), 1), line.n - 2);
      this.untie(c);
      loser.wear = 0;
      loser.breakLine(node, 'externo');
      this.events.push({ type: 'cut', attacker: winner, victim: loser, point: hit.point.clone() });
      this.contacts.delete(key(c.a, c.b));
      this.cooldown.set(key(c.a, c.b), RELO_COOLDOWN);
      this.events.push({ type: 'relo-end', attacker: c.a, victim: c.b, point: c.point.clone() });
      return true;
    }
    return false;
  }

  /**
   * Empate de potencia: perde a linha de menor resistencia; com linhas iguais, alterna a cada
   * intervalo, para que a ordem em que as pipas foram registradas nao favoreca ninguem.
   */
  private tieLoser(c: ReloContact): KiteRig {
    const ra = c.a.lineSpec.resistance;
    const rb = c.b.lineSpec.resistance;
    if (ra !== rb) return ra < rb ? c.a : c.b;
    return Math.floor(c.time / CONTACT_TICK) % 2 === 0 ? c.a : c.b;
  }

  private endContact(c: ReloContact): void {
    this.untie(c);
    this.contacts.delete(key(c.a, c.b));
    this.cooldown.set(key(c.a, c.b), RELO_COOLDOWN);
    this.events.push({ type: 'relo-end', attacker: c.a, victim: c.b, point: c.point.clone() });
  }

  /** Linha inimiga tocando o cabresto corta na hora; tocando a rabiola corta so a rabiola. */
  private detectBridleAndTail(enemy: KiteRig, victim: KiteRig): void {
    const el = enemy.line!;
    const E = el.pos;
    if (victim.state !== 'FLYING') return;
    const kp = victim.kite.pos;
    // Rejeicao rapida: a linha inimiga precisa passar a menos de ~2 m da pipa.
    let near = false;
    for (let i = 0; i < el.n; i++) {
      const dx = E[i * 3]! - kp.x, dy = E[i * 3 + 1]! - kp.y, dz = E[i * 3 + 2]! - kp.z;
      if (dx * dx + dy * dy + dz * dz < 4) { near = true; break; }
    }
    if (!near) return;
    const r = seg;
    if (victim.connected && victim.line) {
      const count = victim.bridleLegs(this.legs);
      for (let l = 0; l < count; l++) {
        const [p, q] = this.legs[l]!;
        for (let i = 0; i < el.n - 1; i++) {
          const i3 = i * 3;
          closestPointSegmentSegment(E[i3]!, E[i3 + 1]!, E[i3 + 2]!, E[i3 + 3]!, E[i3 + 4]!, E[i3 + 5]!, p.x, p.y, p.z, q.x, q.y, q.z, r);
          if (r.distSq < BRIDLE_CUT_DISTANCE * BRIDLE_CUT_DISTANCE) {
            victim.breakLine(victim.line.n - 2, 'externo');
            this.events.push({ type: 'bridle-cut', attacker: enemy, victim, point: p.clone().lerp(q, r.t) });
            return;
          }
        }
      }
    }
    const tail = victim.kite.tail;
    if (tail && victim.kite.tailAttached) {
      const T = tail.pos;
      for (let k = 0; k < tail.n - 1; k++) {
        const k3 = k * 3;
        for (let i = 0; i < el.n - 1; i++) {
          const i3 = i * 3;
          closestPointSegmentSegment(E[i3]!, E[i3 + 1]!, E[i3 + 2]!, E[i3 + 3]!, E[i3 + 4]!, E[i3 + 5]!, T[k3]!, T[k3 + 1]!, T[k3 + 2]!, T[k3 + 3]!, T[k3 + 4]!, T[k3 + 5]!, r);
          if (r.distSq < BRIDLE_CUT_DISTANCE * BRIDLE_CUT_DISTANCE) {
            victim.kite.cutTail();
            this.events.push({ type: 'tail-cut', attacker: enemy, victim, point: new Vector3(T[k3]!, T[k3 + 1]!, T[k3 + 2]!) });
            return;
          }
        }
      }
    }
  }

  private detectHook(owner: KiteRig, target: KiteRig): void {
    const existing = this.hooks.get(owner);
    if (existing && existing.target !== target) return;
    const ol = owner.line!;
    const O = ol.pos;
    const r = seg;
    const reach = existing ? KEEP_DISTANCE : RELO_DISTANCE;
    let kind: 'linha' | 'rabiola' | null = null;
    let node = 0;
    const point = this.tmpA;
    // Rabiola primeiro (engate firme).
    const tail = target.kite.tail;
    if (tail && target.kite.tailAttached) {
      const T = tail.pos;
      outer: for (let k = 0; k < tail.n - 1; k++) {
        const k3 = k * 3;
        for (let i = 0; i < ol.n - 1; i++) {
          const i3 = i * 3;
          closestPointSegmentSegment(O[i3]!, O[i3 + 1]!, O[i3 + 2]!, O[i3 + 3]!, O[i3 + 4]!, O[i3 + 5]!, T[k3]!, T[k3 + 1]!, T[k3 + 2]!, T[k3 + 3]!, T[k3 + 4]!, T[k3 + 5]!, r);
          if (r.distSq < reach * reach) {
            kind = 'rabiola';
            node = i + (r.s < 0.5 ? 0 : 1);
            point.set(O[i3]! + (O[i3 + 3]! - O[i3]!) * r.s, O[i3 + 1]! + (O[i3 + 4]! - O[i3 + 1]!) * r.s, O[i3 + 2]! + (O[i3 + 5]! - O[i3 + 2]!) * r.s);
            break outer;
          }
        }
      }
    }
    if (!kind && target.line) {
      const hit = minLineDistance(ol, target.line, this.scratch, 0.3);
      if (hit && hit.distSq < reach * reach) {
        kind = 'linha';
        node = hit.segA + (hit.sA < 0.5 ? 0 : 1);
        point.copy(hit.point);
      }
    }
    if (!kind) return;
    node = Math.min(Math.max(node, 1), ol.n - 2);
    if (existing) {
      existing.seenThisStep = true;
      existing.node = node;
      existing.point.copy(point);
      if (existing.kind === 'linha' && target.line) this.tieHook(existing, target.line, point);
      return;
    }
    const hook: Hook = { owner, target, kind, node, point: point.clone(), lostFor: 0, seenThisStep: true, stress: 0, pinned: -1 };
    this.hooks.set(owner, hook);
    if (kind === 'linha' && target.line) this.tieHook(hook, target.line, point);
    this.events.push({ type: 'hook', attacker: owner, victim: target, point: point.clone(), hookKind: kind });
  }

  /** Pela linha, o no da linha solta da avoada fica preso ao da linha do dono: recolher traciona de verdade. */
  private tieHook(h: Hook, targetLine: VerletLine, point: Vector3): void {
    const ol = h.owner.line!;
    let best = 1;
    let bestD = Infinity;
    for (let i = 1; i < targetLine.n - 1; i++) {
      const dx = targetLine.pos[i * 3]! - point.x;
      const dy = targetLine.pos[i * 3 + 1]! - point.y;
      const dz = targetLine.pos[i * 3 + 2]! - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (h.pinned >= 0 && h.pinned !== best) targetLine.unpinNode(h.pinned);
    h.pinned = best;
    const o = Math.min(Math.max(h.node, 1), ol.n - 2) * 3;
    targetLine.pinNode(best, ol.pos[o]!, ol.pos[o + 1]!, ol.pos[o + 2]!);
  }

  /** Fim de passo fixo: encerra contatos perdidos, move pipas engatadas e recupera desgaste. */
  tick(dt: number, rigs: readonly KiteRig[]): void {
    for (const [k, v] of [...this.cooldown]) {
      if (v - dt <= 0) this.cooldown.delete(k);
      else this.cooldown.set(k, v - dt);
    }
    for (const c of [...this.contacts.values()]) {
      if (!c.seenThisStep) {
        c.lostFor += dt;
        if (c.lostFor > 0.15) {
          this.endContact(c);
          continue;
        }
      }
      const power = Math.max(c.a.cutPower, c.b.cutPower);
      c.idle = power < MIN_POWER ? c.idle + dt : 0;
      if (c.idle > RELO_IDLE_RELEASE || c.time > RELO_MAX_TIME) this.endContact(c);
    }
    for (const [owner, h] of [...this.hooks]) this.updateHook(owner, h, dt);
    for (const r of rigs) {
      const inContact = this.contactFor(r) !== null || this.hooks.has(r);
      if (!inContact && r.wear > 0) r.wear = Math.max(0, r.wear - WEAR_RECOVERY * dt);
    }
  }

  private updateHook(owner: KiteRig, h: Hook, dt: number): void {
    const target = h.target;
    if (!hasLiveLine(owner) || !isLoose(target)) {
      this.release(owner, h);
      return;
    }
    h.lostFor = h.seenThisStep ? 0 : h.lostFor + dt;
    if (h.lostFor > 0.8) {
      this.release(owner, h);
      return;
    }
    const line = owner.line!;
    const node = Math.min(Math.max(h.node, 1), line.n - 2);
    const hookPos = line.node(node, this.tmpB);
    const toHook = hookPos.sub(target.kite.pos);
    const dist = toHook.length();
    if (dist > 1e-6) toHook.multiplyScalar(1 / dist);
    // Guia: mola amortecida entre a pipa solta e o ponto de engate (folga de 1,5 m). Sem ela o vento
    // levaria a pipa embora; com ela, recolher a linha do dono realmente a traz.
    if (dist > GUIDE_SLACK) {
      target.kite.vel.addScaledVector(toHook, (dist - GUIDE_SLACK) * GUIDE_STIFFNESS * dt);
      target.kite.vel.multiplyScalar(1 - Math.min(0.9, GUIDE_DAMPING * dt));
    }
    // A pipa presa pela guia conta como em contato (a rabiola nao tem no atado).
    if (dist < GUIDE_HOLD_RANGE) h.lostFor = 0;
    const pull = owner.pullSpeed;
    if (pull > 0.2) target.kite.vel.lerp(toHook.clone().multiplyScalar(Math.min(pull * 1.3, 16)), 0.35);

    if (h.kind === 'linha') {
      h.stress = owner.reelRequest / HOOK_SAFE_SPEED;
      if (owner.reelRequest > HOOK_SAFE_SPEED) {
        owner.wear += (owner.reelRequest - HOOK_SAFE_SPEED) * HOOK_WEAR_RATE * dt;
        if (owner.wear >= lineResistance(owner.lineSpec)) {
          owner.wear = 0;
          owner.breakLine(node, 'externo');
          this.events.push({ type: 'hook-saw', attacker: target, victim: owner, point: h.point.clone(), hookKind: 'linha' });
          this.release(owner, h);
          return;
        }
      }
    } else {
      h.stress = 0.3;
    }

    if (target.kite.pos.distanceTo(owner.anchorPoint) < CAPTURE_DISTANCE) {
      if (h.pinned >= 0) target.line?.unpinNode(h.pinned);
      target.capture();
      owner.capturedKites++;
      this.events.push({ type: 'capture', attacker: owner, victim: target, point: target.kite.pos.clone(), hookKind: h.kind });
      this.hooks.delete(owner);
    }
  }

  private release(owner: KiteRig, h: Hook): void {
    if (h.pinned >= 0) h.target.line?.unpinNode(h.pinned);
    this.hooks.delete(owner);
    this.events.push({ type: 'unhook', attacker: owner, victim: h.target, point: h.point.clone(), hookKind: h.kind });
  }
}
