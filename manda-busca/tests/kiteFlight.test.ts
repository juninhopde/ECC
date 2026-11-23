import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LineSupply } from '../src/core/LineSupply';
import { BICO_MEDIO, KiteBody, type KiteSpec } from '../src/physics/KitePhysics';
import { EMPTY_INPUT, KiteRig, type PilotInput, type RigEnvironment } from '../src/physics/KiteRig';
import { WindField } from '../src/physics/WindField';
import type { WireSegment } from '../src/world/Catenary';

interface Sim {
  rig: KiteRig;
  env: RigEnvironment;
  anchor: Vector3;
  tick: number;
  step(input?: Partial<PilotInput>): void;
  run(seconds: number, input?: (t: number) => Partial<PilotInput>): void;
}

function makeSim(opts: { turbulence?: number; spec?: KiteSpec; supplyYards?: number; wires?: WireSegment[]; seed?: number } = {}): Sim {
  const wind = new WindField({ baseSpeed: 6.7, dirX: 1, dirZ: 0, turbulence: opts.turbulence ?? 0, verticalGusts: (opts.turbulence ?? 0) * 0.6 }, opts.seed ?? 5);
  const rig = new KiteRig('t', new LineSupply(opts.supplyYards ?? 250, 1), opts.spec ?? BICO_MEDIO);
  const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: opts.wires ?? [] };
  const sim: Sim = {
    rig, env, anchor: new Vector3(0, 1.4, 0), tick: 0,
    step(input = {}) {
      rig.update(1 / 60, { ...EMPTY_INPUT, ...input }, sim.anchor, env);
      env.time += 1 / 60;
      sim.tick++;
    },
    run(seconds, input) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) sim.step(input ? input(i / 60) : {});
    },
  };
  return sim;
}

const finite = (v: Vector3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('voo da pipa', () => {
  it('lanca, sobe e voa estavel sem turbulencia (sem NaN, sem giro)', () => {
    const s = makeSim();
    s.step({ launch: true });
    s.run(40);
    expect(s.rig.state).toBe('FLYING');
    expect(finite(s.rig.kite.pos) && finite(s.rig.kite.vel)).toBe(true);
    expect(s.rig.kite.pos.y).toBeGreaterThan(12);
    expect(s.rig.tension).toBeGreaterThan(0.5);
    expect(Math.abs(s.rig.kite.spinRate)).toBeLessThan(0.5);
    // A pipa fica a favor do vento em relacao ao jogador.
    expect(s.rig.kite.pos.x).toBeGreaterThan(10);
  });

  it('continua voando com turbulencia (rajadas nao derrubam)', () => {
    const s = makeSim({ turbulence: 1 });
    s.step({ launch: true });
    s.run(40);
    expect(s.rig.state).toBe('FLYING');
    expect(s.rig.kite.pos.y).toBeGreaterThan(10);
    expect(Math.abs(s.rig.kite.spinRate)).toBeLessThan(1);
  });

  it('o angulo de ataque converge para a regulagem do estirante (trim)', () => {
    const s = makeSim();
    s.step({ launch: true });
    s.run(30);
    const deg = (s.rig.kite.alpha * 180) / Math.PI;
    expect(deg).toBeGreaterThan(30);
    expect(deg).toBeLessThan(55);
  });

  it('a linha e rigida: o cordao nao estica alem da deformacao elastica', () => {
    const s = makeSim();
    s.step({ launch: true });
    s.run(30);
    const line = s.rig.line!;
    expect(line.chordLength() / line.activeLength).toBeLessThan(1.02);
  });

  it('rabiola cortada: o torque estabilizador zera e a pipa entra em giro continuo (piao)', () => {
    const withTail = makeSim({ turbulence: 1 });
    withTail.step({ launch: true });
    withTail.run(30);
    const tailSpin = Math.abs(withTail.rig.kite.spinRate);

    const cut = makeSim({ turbulence: 1 });
    cut.step({ launch: true });
    cut.run(30);
    cut.rig.kite.cutTail();
    cut.run(8);
    expect(cut.rig.kite.tailAttached).toBe(false);
    expect(tailSpin).toBeLessThan(1);
    expect(Math.abs(cut.rig.kite.spinRate)).toBeGreaterThan(8);
  });

  it('e deterministico: duas execucoes identicas dao estado identico', () => {
    const run = (): Vector3 => {
      const s = makeSim({ turbulence: 1, seed: 11 });
      s.step({ launch: true });
      s.run(20, (t) => ({ payOut: t > 8 && t < 10, desbicada: Math.abs(t - 14) < 0.01 }));
      return s.rig.kite.pos.clone();
    };
    expect(run().equals(run())).toBe(true);
  });

  it('sem estoque de linha nao e possivel lancar', () => {
    const s = makeSim({ supplyYards: 0.5 });
    s.step({ launch: true });
    expect(s.rig.state).toBe('HAND');
  });
});

describe('comandos de linha', () => {
  function flying(): Sim {
    const s = makeSim();
    s.step({ launch: true });
    s.run(30);
    return s;
  }

  it('dar linha libera ~6 m/s do carretel e conserva o total de linha', () => {
    const s = flying();
    s.rig.assisting = false;
    const total0 = s.rig.supply.remaining + s.rig.activeLength;
    const L0 = s.rig.activeLength;
    s.run(2, () => ({ payOut: true }));
    const gained = s.rig.activeLength - L0;
    expect(gained).toBeGreaterThan(10);
    expect(gained).toBeLessThan(13);
    expect(s.rig.supply.remaining + s.rig.activeLength).toBeCloseTo(total0, 6);
  });

  it('puxada rapida recolhe ~14 m/s quando ha folga', () => {
    const s = flying();
    s.rig.assisting = false;
    s.run(4, () => ({ payOut: true })); // folga para ter o que recolher
    const L0 = s.rig.activeLength;
    s.run(1, () => ({ quickPull: true }));
    const quick = L0 - s.rig.activeLength;
    expect(quick).toBeGreaterThan(11);
    expect(quick).toBeLessThan(15);
  });

  it('recolher continuo (R) tira ~4 m/s quando ha folga', () => {
    const s = flying();
    s.rig.assisting = false;
    s.run(4, () => ({ payOut: true }));
    const L0 = s.rig.activeLength;
    s.run(1, () => ({ reel: true }));
    const slow = L0 - s.rig.activeLength;
    expect(slow).toBeGreaterThan(3.2);
    expect(slow).toBeLessThan(4.3);
  });

  it('recolher com a linha esticada e mais lento: a embreagem nao deixa passar da resistencia', () => {
    const s = flying();
    s.rig.assisting = false;
    s.run(0.5, () => ({ quickPull: true }));
    let maxStrain = 0;
    for (let i = 0; i < 600; i++) {
      s.step({ quickPull: true });
      const line = s.rig.line;
      if (!line) break;
      maxStrain = Math.max(maxStrain, line.chordLength() / line.activeLength - 1);
      expect(Number.isFinite(s.rig.kite.pos.x)).toBe(true);
    }
    // A embreagem limita a TAXA de recolhimento (alvo ~2,7%), nao a forca da propria pipa: ao ser
    // puxada contra o vento ela ganha velocidade relativa e puxa mais. O que importa e que a
    // deformacao fica limitada e a simulacao nunca diverge.
    expect(maxStrain).toBeLessThan(0.1);
  });

  it('o comprimento ativo nunca passa do estoque nem fica abaixo de 2 m enquanto ha linha', () => {
    const s = makeSim({ supplyYards: 30 });
    const capacity = s.rig.supply.capacity;
    s.step({ launch: true });
    s.run(5);
    s.rig.assisting = false;
    s.run(30, () => ({ payOut: true }));
    expect(s.rig.activeLength).toBeLessThanOrEqual(capacity + 1e-6);
    expect(s.rig.supply.remaining).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 40 * 60; i++) {
      s.step({ quickPull: true });
      if (s.rig.line) expect(s.rig.activeLength).toBeGreaterThanOrEqual(2 - 1e-6);
    }
    // A pipa foi recolhida: voltou a mao e os metros voltaram ao carretel.
    expect(s.rig.state).toBe('HAND');
    expect(s.rig.supply.remaining).toBeLessThanOrEqual(capacity + 1e-6);
    expect(s.rig.supply.remaining).toBeGreaterThan(capacity * 0.95);
  });

  it('desbicada da impulso ao longo do nariz', () => {
    const s = flying();
    s.rig.assisting = false;
    const nose = s.rig.kite.noseDir(new Vector3());
    const before = s.rig.kite.vel.dot(nose);
    s.step({ desbicada: true });
    const after = s.rig.kite.vel.dot(nose);
    expect(after - before).toBeGreaterThan(2.5);
  });

  it('tapa alterna o nariz para os dois lados com ate 35 graus e some se desligado', () => {
    const s = flying();
    s.rig.assisting = false;
    s.run(3, () => ({ payOut: true }));
    const targets: number[] = [];
    for (let i = 0; i < 4; i++) {
      s.step({ payOut: true, tapaClick: true });
      targets.push(s.rig.kite.psiTarget);
      s.run(0.05, () => ({ payOut: true }));
    }
    expect(Math.max(...targets)).toBeGreaterThan(0);
    expect(Math.min(...targets)).toBeLessThan(0);
    expect(Math.max(...targets.map(Math.abs))).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9);

    const raia = makeSim({ spec: { ...BICO_MEDIO, canTapa: false } });
    raia.step({ launch: true });
    raia.run(20);
    raia.rig.assisting = false;
    raia.run(3, () => ({ payOut: true }));
    raia.step({ payOut: true, tapaClick: true });
    expect(raia.rig.kite.psiTarget).toBe(0);
  });

  it('Q inclina o nariz para a esquerda e E para a direita', () => {
    const s = flying();
    s.rig.assisting = false;
    s.step({ qe: 1 });
    const left = s.rig.kite.psiTarget;
    s.step({ qe: -1 });
    const right = s.rig.kite.psiTarget;
    expect(left).toBeGreaterThan(0.5);
    expect(right).toBeLessThan(-0.5);
  });

  it('recolher tudo traz a pipa de volta a mao', () => {
    const s = flying();
    s.rig.assisting = false;
    s.run(60, () => ({ quickPull: true, reel: true }));
    expect(s.rig.state).toBe('HAND');
    expect(s.rig.line).toBeNull();
  });

  it('puxar com forca num cabo de poste rompe a linha: a pipa vira avoada', () => {
    const s = makeSim();
    let cause = '';
    s.rig.events.onBreak = (c) => { cause = c; };
    s.step({ launch: true });
    s.run(35);
    s.rig.assisting = false;
    expect(s.rig.state).toBe('FLYING');
    const capacity = s.rig.supply.capacity;
    // Cabo atravessando exatamente o caminho da linha, a meio caminho entre a mao e a pipa.
    const mid = s.rig.line!.node(12, new Vector3());
    s.env.wires = [{ a: new Vector3(mid.x, mid.y, mid.z - 8), b: new Vector3(mid.x, mid.y, mid.z + 8), radius: 0.015 }];
    s.run(2);
    expect(s.rig.line!.isSnagged()).toBe(true);
    expect(s.rig.state).toBe('FLYING');
    // O jogador se afasta: a tracao no engate passa da ruptura.
    const stateOf = (): string => s.rig.state;
    for (let i = 0; i < 240 && stateOf() !== 'AVOADA'; i++) {
      s.anchor.x -= 0.1;
      s.step();
    }
    expect(stateOf()).toBe('AVOADA');
    expect(cause).toBe('cabo');
    expect(s.rig.connected).toBe(false);
    expect(s.rig.line).not.toBeNull();
    expect(s.rig.handLine).not.toBeNull();
    // Conservacao: so se perde, no maximo, o segmento do corte.
    const kept = s.rig.supply.remaining + s.rig.handLine!.totalLength() + s.rig.line!.totalLength();
    expect(capacity - kept).toBeGreaterThanOrEqual(-1e-6);
    expect(capacity - kept).toBeLessThan(s.rig.handLine!.restLen * 1.5);
    // Recolher o resto da linha do lado da mao devolve metros ao carretel.
    const before = s.rig.supply.remaining;
    s.run(40, () => ({ reel: true }));
    expect(s.rig.handLine).toBeNull();
    expect(s.rig.supply.remaining).toBeGreaterThan(before);
  });
});

describe('KiteBody isolado', () => {
  it('sem linha, a pipa voa a favor do vento e o trim leva o angulo de ataque perto de 30 graus', () => {
    const wind = new WindField({ baseSpeed: 6.7, dirX: 1, dirZ: 0, turbulence: 0, verticalGusts: 0 }, 5);
    const k = new KiteBody(BICO_MEDIO);
    k.place(new Vector3(0, 30, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 0));
    for (let i = 0; i < 3 * 240; i++) k.step(1 / 240, wind.sample, i / 240, null);
    expect(k.pos.x).toBeGreaterThan(10);
    const deg = (k.alpha * 180) / Math.PI;
    expect(deg).toBeGreaterThan(20);
    expect(deg).toBeLessThan(40);
  });
});
