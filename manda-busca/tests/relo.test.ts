import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LineSupply } from '../src/core/LineSupply';
import { CombatWorld } from '../src/physics/CombatWorld';
import { BICO_MEDIO } from '../src/physics/KitePhysics';
import { EMPTY_INPUT, KiteRig, type PilotInput, type RigEnvironment } from '../src/physics/KiteRig';
import { LINE_SPECS, type LineId } from '../src/physics/LineSpec';
import {
  BASE_RESISTANCE, RELO_DISTANCE, cutPower, lineResistance, minLineDistance, type CombatEvent, type LineContact,
} from '../src/physics/ReloSystem';
import { VerletLine } from '../src/physics/VerletLine';
import { WindField } from '../src/physics/WindField';

interface Pilot { rig: KiteRig; anchor: Vector3; input: PilotInput }

function makeArena() {
  const wind = new WindField({ baseSpeed: 6.7, dirX: 1, dirZ: 0, turbulence: 0, verticalGusts: 0 }, 5);
  const world = new CombatWorld();
  const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
  const pilots = new Map<KiteRig, Pilot>();
  const events: CombatEvent[] = [];
  const add = (id: string, z: number, line: LineId = 'linha10'): Pilot => {
    const rig = new KiteRig(id, new LineSupply(250, 1), BICO_MEDIO, LINE_SPECS[line]);
    const p: Pilot = { rig, anchor: new Vector3(0, 1.4, z), input: { ...EMPTY_INPUT } };
    pilots.set(rig, p);
    world.add(rig);
    return p;
  };
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      events.push(...world.step(1 / 60, (r) => pilots.get(r)!, env));
      env.time += 1 / 60;
      for (const p of pilots.values()) p.input.launch = false;
    }
  };
  return { world, env, pilots, events, add, step };
}

type Arena = ReturnType<typeof makeArena>;

function launchBoth(arena: Arena, a: Pilot, b: Pilot, seconds = 6): void {
  a.input.launch = true;
  b.input.launch = true;
  arena.step(2);
  arena.step(seconds * 60);
}

/** Ajusta o comprimento ativo mantendo o estoque do carretel coerente (o total de linha se conserva). */
function setActiveLength(rig: KiteRig, length: number): void {
  const line = rig.line!;
  const delta = length - line.activeLength;
  if (delta > 0) rig.supply.payOut(delta);
  else rig.supply.takeIn(-delta);
  line.activeLength = length;
}

/** Posiciona as duas pipas e estica as linhas em X: elas se cruzam no meio do vao. */
function forceCross(a: Pilot, b: Pilot): void {
  const place = (p: Pilot, target: Vector3): void => {
    p.rig.kite.place(target, new Vector3(-1, 0, 0), new Vector3(0, 0, 0));
    const knot = p.rig.kite.knotWorld(new Vector3());
    p.rig.line!.layout(p.anchor, knot);
    setActiveLength(p.rig, p.anchor.distanceTo(knot) * 1.004);
  };
  place(a, new Vector3(30, 12, 6));
  place(b, new Vector3(30, 12, -6));
}

describe('desempate do relo', () => {
  it('potencia igual com linhas iguais divide o desgaste entre as duas pipas (sem favorecer a ordem de registro)', () => {
    const arena = makeArena();
    const a = arena.add('a', -6);
    const b = arena.add('b', 6);
    launchBoth(arena, a, b, 8);
    forceCross(a, b);
    a.input.quickPull = true;
    b.input.quickPull = true;
    let maxA = 0;
    let maxB = 0;
    for (let i = 0; i < 60 * 4; i++) {
      arena.step();
      maxA = Math.max(maxA, a.rig.wear);
      maxB = Math.max(maxB, b.rig.wear);
    }
    expect(maxA).toBeGreaterThan(0.1);
    expect(maxB).toBeGreaterThan(0.1);
    // Antes do ajuste, todo o desgaste caia sempre sobre a primeira pipa registrada (b ficava em 0).
    expect(Math.abs(maxA - maxB)).toBeLessThan(0.4 * (maxA + maxB));
  });
});

describe('constantes do corte', () => {
  it('multiplicadores de abrasividade e resistencia seguem a especificacao', () => {
    expect(LINE_SPECS.linha10.abrasion).toBe(1.0);
    expect(LINE_SPECS.linha10.resistance).toBe(1.0);
    expect(LINE_SPECS.cerol.abrasion).toBe(1.45);
    expect(LINE_SPECS.cerol.resistance).toBe(1.15);
    expect(LINE_SPECS.chilena.abrasion).toBe(1.95);
    expect(LINE_SPECS.chilena.resistance).toBe(1.35);
  });

  it('poder de corte = velocidade x abrasividade; resistencia escala com o tipo', () => {
    expect(cutPower(10, LINE_SPECS.linha10)).toBeCloseTo(10, 9);
    expect(cutPower(10, LINE_SPECS.cerol)).toBeCloseTo(14.5, 9);
    expect(cutPower(10, LINE_SPECS.chilena)).toBeCloseTo(19.5, 9);
    expect(lineResistance(LINE_SPECS.chilena)).toBeCloseTo(BASE_RESISTANCE * 1.35, 9);
  });

  it('distancia de relo e 8 cm', () => {
    expect(RELO_DISTANCE).toBe(0.08);
  });
});

describe('deteccao continua (sem tunelamento)', () => {
  function crossingLines(): { a: VerletLine; b: VerletLine } {
    const a = new VerletLine(LINE_SPECS.linha10, 36, 10);
    const b = new VerletLine(LINE_SPECS.linha10, 36, 6);
    for (let i = 0; i < 36; i++) {
      a.pos[i * 3] = (i / 35) * 10;
      a.pos[i * 3 + 1] = 5;
      a.pos[i * 3 + 2] = 0;
      b.pos[i * 3] = 5;
      b.pos[i * 3 + 2] = -3 + (i / 35) * 6;
    }
    return { a, b };
  }

  for (const speed of [5, 15, 25, 35]) {
    it(`uma linha atravessando a outra a ${speed} m/s e sempre detectada em algum sub-passo`, () => {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        const { a, b } = crossingLines();
        const step = speed / 240;
        let y = 5.6 + phase * step;
        const out: LineContact = { distSq: 0, segA: 0, sA: 0, segB: 0, sB: 0, point: new Vector3() };
        let detected = false;
        for (let k = 0; k < 400 && y > 4.4; k++, y -= step) {
          for (let i = 0; i < 36; i++) b.pos[i * 3 + 1] = y;
          const hit = minLineDistance(a, b, out);
          if (hit && hit.distSq < RELO_DISTANCE * RELO_DISTANCE) detected = true;
        }
        expect(detected).toBe(true);
      }
    });
  }

  it('o ponto de contato fica no cruzamento', () => {
    const { a, b } = crossingLines();
    for (let i = 0; i < 36; i++) b.pos[i * 3 + 1] = 5.02;
    const out: LineContact = { distSq: 0, segA: 0, sA: 0, segB: 0, sB: 0, point: new Vector3() };
    const hit = minLineDistance(a, b, out)!;
    expect(hit.point.x).toBeCloseTo(5, 1);
    expect(hit.point.y).toBeCloseTo(5, 6);
    expect(Math.sqrt(hit.distSq)).toBeCloseTo(0.02, 6);
  });
});

describe('relo entre linhas', () => {
  it('linhas paradas que se tocam nao se cortam', () => {
    const arena = makeArena();
    const a = arena.add('A', -2);
    const b = arena.add('B', 2);
    launchBoth(arena, a, b);
    forceCross(a, b);
    arena.step(60 * 5);
    expect(arena.events.some((e) => e.type === 'relo-start')).toBe(true);
    expect(arena.events.some((e) => e.type === 'cut')).toBe(false);
    expect(a.rig.connected && b.rig.connected).toBe(true);
  });

  it('a linha de menor poder sofre o desgaste e rompe exatamente no ponto de contato', () => {
    const arena = makeArena();
    const a = arena.add('A', -2, 'chilena');
    const b = arena.add('B', 2, 'linha10');
    launchBoth(arena, a, b);
    forceCross(a, b);
    a.input.quickPull = true;
    let bWearPeak = 0;
    for (let i = 0; i < 60 * 12 && b.rig.connected; i++) {
      arena.step();
      bWearPeak = Math.max(bWearPeak, b.rig.wear);
    }
    const cut = arena.events.find((e) => e.type === 'cut')!;
    expect(cut).toBeDefined();
    expect(cut.attacker).toBe(a.rig);
    expect(cut.victim).toBe(b.rig);
    expect(b.rig.state).toBe('AVOADA');
    expect(a.rig.connected).toBe(true);
    expect(a.rig.wear).toBe(0);
    expect(bWearPeak).toBeGreaterThan(0.5);
    // A linha do lado do dono termina perto do ponto de contato (no maximo alguns segmentos).
    const end = b.rig.handLine!.node(b.rig.handLine!.n - 1, new Vector3());
    expect(end.distanceTo(cut.point!)).toBeLessThan(b.rig.handLine!.restLen * 3 + 1.5);
  });

  it('o corte em "x" tira a pipa de quem perdeu e ela vira avoada com linha pendurada', () => {
    const arena = makeArena();
    const a = arena.add('A', -2, 'cerol');
    const b = arena.add('B', 2, 'linha10');
    launchBoth(arena, a, b);
    forceCross(a, b);
    a.input.quickPull = true;
    arena.step(60 * 12);
    expect(b.rig.state === 'AVOADA' || b.rig.state === 'GROUNDED').toBe(true);
    expect(b.rig.connected).toBe(false);
    expect(b.rig.line).not.toBeNull();
  });
});

describe('estirante e rabiola', () => {
  it('linha inimiga tocando o estirante corta na hora (em ate 2 passos)', () => {
    const arena = makeArena();
    const a = arena.add('A', -2);
    const b = arena.add('B', 2);
    launchBoth(arena, a, b);
    const knot = a.rig.kite.knotWorld(new Vector3());
    const far = knot.clone().multiplyScalar(2).sub(b.anchor);
    b.rig.line!.layout(b.anchor, far);
    arena.events.length = 0;
    arena.step(2);
    const ev = arena.events.find((e) => e.type === 'bridle-cut');
    expect(ev).toBeDefined();
    expect(ev!.victim).toBe(a.rig);
    expect(a.rig.connected).toBe(false);
    expect(a.rig.state).toBe('AVOADA');
    expect(b.rig.connected).toBe(true);
  });

  it('linha inimiga na rabiola corta so a rabiola: a pipa continua presa', () => {
    const arena = makeArena();
    const a = arena.add('A', -2);
    const b = arena.add('B', 2);
    launchBoth(arena, a, b);
    const tailNode = a.rig.kite.tailNode(8, new Vector3())!;
    const far = tailNode.clone().multiplyScalar(2).sub(b.anchor);
    b.rig.line!.layout(b.anchor, far);
    arena.events.length = 0;
    arena.step(3);
    expect(arena.events.some((e) => e.type === 'tail-cut')).toBe(true);
    expect(a.rig.kite.tailAttached).toBe(false);
    expect(a.rig.connected).toBe(true);
    expect(a.rig.state).toBe('FLYING');
  });

  it('sem rabiola a pipa instabiliza: gira (piao) e perde altitude', () => {
    const arena = makeArena();
    const a = arena.add('A', -2);
    const b = arena.add('B', 2);
    launchBoth(arena, a, b, 25);
    const y0 = a.rig.kite.pos.y;
    a.rig.kite.cutTail();
    arena.step(60 * 10);
    expect(Math.abs(a.rig.kite.spinRate)).toBeGreaterThan(8);
    expect(a.rig.kite.pos.y).toBeLessThan(y0);
  });
});

describe('apara', () => {
  /** P tem a linha cruzando a linha cortada de V; a parte de V com a pipa fica pendurada. */
  function setupApara(pLine: LineId = 'linha10'): { arena: Arena; p: Pilot; v: Pilot } {
    const arena = makeArena();
    const p = arena.add('P', -2, pLine);
    const v = arena.add('V', 2);
    launchBoth(arena, p, v);
    forceCross(p, v);
    // As linhas se cruzam em t = 0,25 (no ~8,75): corta antes, para o cruzamento ficar no trecho pendurado.
    v.rig.breakLine(3, 'externo');
    return { arena, p, v };
  }

  it('encostar a linha na linha solta da avoada engata', () => {
    const { arena, p, v } = setupApara();
    arena.events.length = 0;
    arena.step(5);
    const hook = arena.events.find((e) => e.type === 'hook');
    expect(hook).toBeDefined();
    expect(hook!.attacker).toBe(p.rig);
    expect(hook!.victim).toBe(v.rig);
    expect(arena.world.relo.hookFor(p.rig)).not.toBeNull();
  });

  it('recolher devagar (R) traz a pipa: captura sem cortar a sua linha', () => {
    const { arena, p, v } = setupApara();
    p.input.reel = true;
    let captured = false;
    for (let i = 0; i < 60 * 60 && !captured; i++) {
      arena.step();
      captured = v.rig.state === 'CAPTURED';
    }
    expect(captured).toBe(true);
    expect(p.rig.capturedKites).toBe(1);
    expect(p.rig.connected).toBe(true);
    expect(arena.events.some((e) => e.type === 'hook-saw')).toBe(false);
    expect(arena.events.some((e) => e.type === 'capture')).toBe(true);
  });

  it('puxar rapido demais pela linha da avoada serra e corta a sua propria linha', () => {
    const { arena, p, v } = setupApara();
    p.input.quickPull = true;
    let sawn = false;
    for (let i = 0; i < 60 * 30 && !sawn; i++) {
      arena.step();
      sawn = arena.events.some((e) => e.type === 'hook-saw');
    }
    expect(sawn).toBe(true);
    expect(p.rig.connected).toBe(false);
    expect(v.rig.state).not.toBe('CAPTURED');
  });

  it('pela rabiola o engate e firme: puxar rapido nao corta e a pipa e capturada', () => {
    const arena = makeArena();
    const p = arena.add('P', -2);
    const v = arena.add('V', 2);
    launchBoth(arena, p, v);
    v.rig.breakLine(8, 'externo');
    // P cruza a rabiola da avoada.
    const t = v.rig.kite.tailNode(6, new Vector3())!;
    const far = t.clone().multiplyScalar(2).sub(p.anchor);
    p.rig.kite.place(far, new Vector3(-1, 0, 0), new Vector3(0, 0, 0));
    const knot = p.rig.kite.knotWorld(new Vector3());
    p.rig.line!.layout(p.anchor, knot);
    setActiveLength(p.rig, p.anchor.distanceTo(knot) * 1.004);
    arena.events.length = 0;
    arena.step(4);
    const hook = arena.events.find((e) => e.type === 'hook');
    expect(hook?.hookKind).toBe('rabiola');
    p.input.quickPull = true;
    let captured = false;
    for (let i = 0; i < 60 * 40 && !captured; i++) {
      arena.step();
      captured = v.rig.state === 'CAPTURED';
    }
    expect(arena.events.some((e) => e.type === 'hook-saw')).toBe(false);
    expect(p.rig.connected).toBe(true);
    expect(captured).toBe(true);
  });
});
