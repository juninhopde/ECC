import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LineSupply } from '../src/core/LineSupply';
import { AI_PROFILES, DIFFICULTY_ORDER, KiteAI, type Difficulty } from '../src/entities/KiteAI';
import { CombatWorld } from '../src/physics/CombatWorld';
import { BICO_MEDIO } from '../src/physics/KitePhysics';
import { EMPTY_INPUT, KiteRig, type PilotInput, type RigEnvironment } from '../src/physics/KiteRig';
import { LINE_SPECS } from '../src/physics/LineSpec';
import { WindField } from '../src/physics/WindField';

const WIND = { baseSpeed: 6.7, dirX: 0.99, dirZ: -0.14, turbulence: 1, verticalGusts: 0.6 };

interface DuelResult {
  firstRelo: number;
  winner: 'left' | 'right' | 'none';
  finite: boolean;
}

/** Duelo entre dois bots lado a lado (ancoras a 14 m na direcao transversal ao vento). */
function duel(left: Difficulty, right: Difficulty, seed: number, seconds = 150): DuelResult {
  const wind = new WindField(WIND, seed);
  const world = new CombatWorld();
  const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
  const mk = (id: string, z: number) => {
    const rig = new KiteRig(id, new LineSupply(250, 1), BICO_MEDIO, LINE_SPECS.cerol);
    world.add(rig);
    return { rig, anchor: new Vector3(0, 1.4, z) };
  };
  const L = mk('L', -7);
  const R = mk('R', 7);
  const aiL = new KiteAI(L.rig, left, seed * 2 + 1);
  const aiR = new KiteAI(R.rig, right, seed * 2 + 2);
  const res: DuelResult = { firstRelo: -1, winner: 'none', finite: true };
  for (let i = 0; i < 60 * seconds && res.winner === 'none'; i++) {
    const ctx = { rigs: world.rigs, relo: world.relo, wind: wind.sample, groundHeight: () => 0, time: env.time };
    const il = aiL.update(1 / 60, ctx);
    const ir = aiR.update(1 / 60, ctx);
    const events = world.step(1 / 60, (r) => (r === L.rig ? { input: il, anchor: L.anchor } : { input: ir, anchor: R.anchor }), env);
    env.time += 1 / 60;
    for (const e of events) {
      if (e.type === 'relo-start' && res.firstRelo < 0) res.firstRelo = env.time;
      if (e.type === 'cut' || e.type === 'bridle-cut') res.winner = e.attacker === L.rig ? 'left' : 'right';
    }
    for (const p of [L, R]) {
      const k = p.rig.kite;
      if (!Number.isFinite(k.pos.x + k.pos.y + k.pos.z + k.vel.x + k.omega.x)) res.finite = false;
    }
  }
  return res;
}

describe('perfis de dificuldade', () => {
  it('tres niveis em ordem crescente de habilidade', () => {
    expect(DIFFICULTY_ORDER).toEqual(['iniciante', 'criado-na-laje', 'mestre-do-relo']);
    const [a, b, c] = DIFFICULTY_ORDER.map((d) => AI_PROFILES[d]) as [typeof AI_PROFILES.iniciante, typeof AI_PROFILES.iniciante, typeof AI_PROFILES.iniciante];
    expect(a.reaction).toBeGreaterThan(b.reaction);
    expect(b.reaction).toBeGreaterThan(c.reaction);
    expect(a.aimNoise).toBeGreaterThan(b.aimNoise);
    expect(b.aimNoise).toBeGreaterThan(c.aimNoise);
    expect(a.sawEffort).toBeLessThan(b.sawEffort);
    expect(b.sawEffort).toBeLessThanOrEqual(c.sawEffort);
    expect(a.altitude).toBeLessThan(c.altitude);
  });
});

describe('KiteAI', () => {
  it('Q positivo leva a pipa para a esquerda do piloto e E para a direita', () => {
    // Calibra o sinal que a IA assume: esquerda de quem olha a favor do vento (+x) e -z.
    const wind = new WindField({ ...WIND, turbulence: 0 }, 5);
    const world = new CombatWorld();
    const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
    const rig = new KiteRig('p', new LineSupply(250, 1), BICO_MEDIO, LINE_SPECS.linha10);
    world.add(rig);
    const input: PilotInput = { ...EMPTY_INPUT };
    const anchor = new Vector3(0, 1.4, 0);
    const step = (): void => {
      world.step(1 / 60, () => ({ input, anchor }), env);
      env.time += 1 / 60;
      input.launch = false;
    };
    input.launch = true;
    for (let i = 0; i < 60 * 40; i++) step();
    const p0 = rig.kite.pos.clone();
    input.qe = 1;
    for (let i = 0; i < 60 * 5; i++) step();
    const p1 = rig.kite.pos.clone();
    expect(-(p1.z - p0.z)).toBeGreaterThan(3);
    input.qe = -1;
    for (let i = 0; i < 60 * 8; i++) step();
    expect(p1.z - rig.kite.pos.z).toBeLessThan(-3);
  }, 60000);

  it('solta a pipa sozinho e a mantem voando, com valores finitos, por 70 s', () => {
    const wind = new WindField(WIND, 3);
    const world = new CombatWorld();
    const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
    const rig = new KiteRig('bot', new LineSupply(250, 1), BICO_MEDIO, LINE_SPECS.cerol);
    world.add(rig);
    const anchor = new Vector3(0, 1.4, 0);
    const ai = new KiteAI(rig, 'mestre-do-relo', 11);
    expect(rig.state).toBe('HAND');
    for (let i = 0; i < 60 * 70; i++) {
      const ctx = { rigs: world.rigs, relo: world.relo, wind: wind.sample, groundHeight: () => 0, time: env.time };
      world.step(1 / 60, () => ({ input: ai.update(1 / 60, ctx), anchor }), env);
      env.time += 1 / 60;
    }
    expect(rig.state).toBe('FLYING');
    expect(rig.kite.pos.y).toBeGreaterThan(8);
    expect(Number.isFinite(rig.kite.pos.x + rig.kite.pos.y + rig.kite.pos.z)).toBe(true);
  }, 60000);

  it('o Mestre do Relo vence o Iniciante nos dois lados e com varias sementes', () => {
    const results: boolean[] = [];
    for (const seed of [1, 2, 3]) {
      const a = duel('mestre-do-relo', 'iniciante', seed);
      expect(a.finite).toBe(true);
      expect(a.winner).not.toBe('none');
      results.push(a.winner === 'left');
      const b = duel('iniciante', 'mestre-do-relo', seed);
      expect(b.finite).toBe(true);
      expect(b.winner).not.toBe('none');
      results.push(b.winner === 'right');
    }
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(5); // 5 de 6, no minimo
  }, 120000);

  it('o Criado na Laje vence o Iniciante na maioria dos duelos', () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      if (duel('criado-na-laje', 'iniciante', seed).winner === 'left') wins++;
      if (duel('iniciante', 'criado-na-laje', seed).winner === 'right') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  }, 120000);

  it('e deterministico: a mesma semente repete o mesmo duelo', () => {
    const a = duel('criado-na-laje', 'mestre-do-relo', 5, 100);
    const b = duel('criado-na-laje', 'mestre-do-relo', 5, 100);
    expect(b).toEqual(a);
  }, 60000);

  it('em Mestre x Mestre nenhum lado leva vantagem fixa (sem vies de posicao)', () => {
    let left = 0;
    let decided = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = duel('mestre-do-relo', 'mestre-do-relo', seed);
      if (r.winner !== 'none') {
        decided++;
        if (r.winner === 'left') left++;
      }
    }
    expect(decided).toBeGreaterThanOrEqual(6);
    expect(left).toBeGreaterThanOrEqual(1);
    expect(decided - left).toBeGreaterThanOrEqual(1);
  }, 120000);
});
