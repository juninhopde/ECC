import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LineSupply } from '../src/core/LineSupply';
import { KiteAI } from '../src/entities/KiteAI';
import { GhostRig, POST_CUT_SECONDS, REPLAY_CAPACITY, REPLAY_SECONDS, ReplayPlayer, ReplayRecorder } from '../src/game/Replay';
import { CombatWorld } from '../src/physics/CombatWorld';
import { BICO_MEDIO } from '../src/physics/KitePhysics';
import { KiteRig, type RigEnvironment } from '../src/physics/KiteRig';
import { LINE_SPECS } from '../src/physics/LineSpec';
import type { CombatEvent } from '../src/physics/ReloSystem';
import { WindField } from '../src/physics/WindField';
import { labelText } from '../src/ui/KiteLabels';

/** Duelo de bots gravado quadro a quadro; devolve o recorder, os rigs e o instante do corte (ou -1). */
function recordedDuel(seconds: number, capacity?: number): { rec: ReplayRecorder; a: KiteRig; b: KiteRig; cutAt: number; cutPoint: Vector3 | null; now: number } {
  const wind = new WindField({ baseSpeed: 6.7, dirX: 0.99, dirZ: -0.14, turbulence: 1, verticalGusts: 0.6 }, 1);
  const world = new CombatWorld();
  const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
  const mk = (id: string, z: number, line: 'cerol' | 'linha10') => {
    const rig = new KiteRig(id, new LineSupply(250, 1), BICO_MEDIO, LINE_SPECS[line]);
    world.add(rig);
    return { rig, anchor: new Vector3(0, 1.4, z) };
  };
  const A = mk('a', -7, 'cerol');
  const B = mk('b', 7, 'linha10');
  const aiA = new KiteAI(A.rig, 'mestre-do-relo', 3);
  const aiB = new KiteAI(B.rig, 'iniciante', 4);
  const rec = new ReplayRecorder(capacity);
  let cutAt = -1;
  let cutPoint: Vector3 | null = null;
  let t = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const ctx = { rigs: world.rigs, relo: world.relo, wind: wind.sample, groundHeight: () => 0, time: t };
    const ia = aiA.update(1 / 60, ctx);
    const ib = aiB.update(1 / 60, ctx);
    env.time = t;
    const events: CombatEvent[] = world.step(1 / 60, (r) => (r === A.rig ? { input: ia, anchor: A.anchor } : { input: ib, anchor: B.anchor }), env);
    t += 1 / 60;
    rec.record(t, world.rigs);
    for (const e of events) {
      if ((e.type === 'cut' || e.type === 'bridle-cut') && cutAt < 0 && e.point) {
        cutAt = t;
        cutPoint = e.point.clone();
        rec.markCut(e.point, true, t);
      }
    }
  }
  return { rec, a: A.rig, b: B.rig, cutAt, cutPoint, now: t };
}

describe('ReplayRecorder', () => {
  it('buffer circular: guarda so os ultimos 5 s, em ordem cronologica', () => {
    expect(REPLAY_CAPACITY).toBe(REPLAY_SECONDS * 60);
    const { rec, a, now } = recordedDuel(8, 30); // capacidade pequena para o teste
    expect(rec.length).toBe(30);
    const clip = rec.freeze(new Vector3(), false);
    expect(clip.frames).toHaveLength(30);
    for (let i = 1; i < clip.frames.length; i++) expect(clip.frames[i]!.t).toBeGreaterThan(clip.frames[i - 1]!.t);
    expect(clip.frames[clip.frames.length - 1]!.t).toBeCloseTo(now, 9);
    expect(clip.duration).toBeCloseTo(29 / 60, 6);
    // o ultimo quadro bate com o estado real da pipa
    const last = clip.frames[clip.frames.length - 1]!.rigs.find((r) => r.id === 'a')!;
    expect(last.pos[0]).toBeCloseTo(a.kite.pos.x, 3);
    expect(last.pos[1]).toBeCloseTo(a.kite.pos.y, 3);
    expect(last.pos[2]).toBeCloseTo(a.kite.pos.z, 3);
    expect(last.state).toBe(a.state);
    expect(last.lineN).toBe(a.line!.n);
  }, 60000);

  it('grava os nos da linha e da rabiola', () => {
    const { rec, a } = recordedDuel(12, 20);
    const f = rec.freeze(new Vector3(), false).frames.at(-1)!.rigs[0]!;
    expect(f.lineN).toBe(36);
    expect(f.tailAttached).toBe(true);
    expect(f.tailN).toBe(BICO_MEDIO.tailRibbons + 1);
    expect(f.line[3 * 10 + 1]).toBeCloseTo(a.line!.pos[3 * 10 + 1]!, 3);
  }, 60000);

  it('o clipe de um corte e congelado 1 s depois, com 4 s antes, e e independente da simulacao', () => {
    const { rec, cutAt, cutPoint, now } = recordedDuel(120);
    expect(cutAt).toBeGreaterThan(0); // o Mestre corta o Iniciante com esta semente
    const clip = rec.clip();
    expect(clip).not.toBeNull();
    expect(clip!.point.distanceTo(cutPoint!)).toBeLessThan(1e-9);
    expect(clip!.involvesPlayer).toBe(true);
    expect(clip!.frames.length).toBe(REPLAY_CAPACITY);
    const lastT = clip!.frames.at(-1)!.t;
    expect(lastT).toBeGreaterThanOrEqual(cutAt + POST_CUT_SECONDS - 1e-6);
    expect(lastT).toBeLessThan(cutAt + POST_CUT_SECONDS + 0.05);
    expect(clip!.frames[0]!.t).toBeGreaterThanOrEqual(cutAt - (REPLAY_SECONDS - POST_CUT_SECONDS) - 0.05);
    expect(now).toBeGreaterThan(lastT); // a simulacao seguiu depois do congelamento
    // clipe independente: alterar o buffer vivo nao muda o que foi congelado
    const before = clip!.frames[10]!.rigs[0]!.pos[0];
    rec.record(now + 1, []);
    expect(clip!.frames[10]!.rigs[0]!.pos[0]).toBe(before);
  }, 60000);

  it('o clipe de corte que envolve o jogador tem prioridade sobre cortes de terceiros', () => {
    const rec = new ReplayRecorder(60);
    const rig = new KiteRig('x', new LineSupply(250, 1));
    for (let i = 0; i < 60; i++) rec.record(i / 60, [rig]);
    expect(rec.clip()).toBeNull();
    rec.markCut(new Vector3(1, 2, 3), true, 1);
    for (let i = 60; i < 130; i++) rec.record(i / 60, [rig]);
    expect(rec.clip()!.point.toArray()).toEqual([1, 2, 3]);
    rec.markCut(new Vector3(9, 9, 9), false, 130 / 60);
    for (let i = 130; i < 200; i++) rec.record(i / 60, [rig]);
    expect(rec.clip()!.point.toArray()).toEqual([1, 2, 3]); // continua o do jogador
    rec.reset();
    expect(rec.clip()).toBeNull();
    expect(rec.length).toBe(0);
  });

  it('sem corte, liveClip congela os ultimos quadros em torno do foco; sem quadros nao ha clipe', () => {
    const rec = new ReplayRecorder(20);
    expect(rec.liveClip(new Vector3())).toBeNull();
    const rig = new KiteRig('x', new LineSupply(250, 1));
    for (let i = 0; i < 25; i++) rec.record(i / 60, [rig]);
    const clip = rec.liveClip(new Vector3(5, 5, 5))!;
    expect(clip.frames).toHaveLength(20);
    expect(clip.point.toArray()).toEqual([5, 5, 5]);
  });
});

describe('ReplayPlayer', () => {
  function clipOf(): ReturnType<ReplayRecorder['freeze']> {
    const { rec } = recordedDuel(60, 90);
    return rec.freeze(new Vector3(30, 15, 0), true);
  }

  it('amostra o primeiro quadro em t=0 e interpola entre quadros', () => {
    const clip = clipOf();
    const p = new ReplayPlayer(clip);
    const at0 = p.sample().find((g) => g.id === 'a')!;
    const f0 = clip.frames[0]!.rigs.find((r) => r.id === 'a')!;
    expect(at0.kite.pos.x).toBeCloseTo(f0.pos[0]!, 4);
    expect(at0.state).toBe(f0.state);
    // a meio caminho entre dois quadros, a posicao fica entre os dois (interpolacao linear)
    p.time = (clip.frames[1]!.t - clip.frames[0]!.t) * 0.5;
    const mid = p.sample().find((g) => g.id === 'a')!;
    const f1 = clip.frames[1]!.rigs.find((r) => r.id === 'a')!;
    expect(mid.kite.pos.y).toBeCloseTo((f0.pos[1]! + f1.pos[1]!) / 2, 4);
    expect(mid.kite.quat.length()).toBeCloseTo(1, 6);
  }, 60000);

  it('avanca em tempo real vezes a velocidade e recomeca ao chegar ao fim', () => {
    const clip = clipOf();
    const p = new ReplayPlayer(clip);
    p.setSpeed(0.25);
    p.advance(2);
    expect(p.time).toBeCloseTo(0.5, 9);
    p.setSpeed(1);
    p.time = 0;
    p.advance(clip.duration + 0.3);
    expect(p.time).toBeCloseTo(0.3, 6);
    expect(p.time).toBeLessThan(clip.duration);
  }, 60000);

  it('camera orbital: fica a 16 m do ponto do corte, olha para ele e gira em tempo real', () => {
    const clip = clipOf();
    const p = new ReplayPlayer(clip);
    const pos = new Vector3();
    const target = new Vector3();
    p.orbit(pos, target);
    expect(target.distanceTo(clip.point)).toBe(0);
    const flat = Math.hypot(pos.x - clip.point.x, pos.z - clip.point.z);
    expect(flat).toBeCloseTo(16, 9);
    expect(pos.y).toBeGreaterThan(clip.point.y);
    const first = pos.clone();
    p.setSpeed(0.25); // camera lenta nao para a orbita
    p.advance(1);
    p.orbit(pos, target);
    expect(pos.distanceTo(first)).toBeGreaterThan(1);
    expect(Math.hypot(pos.x - clip.point.x, pos.z - clip.point.z)).toBeCloseTo(16, 9);
  }, 60000);

  it('o fantasma expoe o que o visual le: linha, resto da linha, rabiola e estado', () => {
    const clip = clipOf();
    const p = new ReplayPlayer(clip);
    const g = p.sample().find((x) => x.id === 'a')!;
    expect(g.line).not.toBeNull();
    expect(g.line!.n).toBe(36);
    expect(g.line!.node(35, new Vector3()).distanceTo(g.kite.pos)).toBeLessThan(2); // a linha termina na pipa
    expect(g.kite.tail).not.toBeNull();
    expect(g.kite.tailNode(0, new Vector3())).not.toBeNull();
    expect(g.kite.tailNode(99, new Vector3())).toBeNull();
    expect(g.handLine).toBeNull();
  }, 60000);

  it('atravessar o corte (numero de nos muda) nao quebra a amostragem e mostra o resto da linha', () => {
    const { rec, cutAt } = recordedDuel(120);
    expect(cutAt).toBeGreaterThan(0);
    const clip = rec.clip()!;
    const p = new ReplayPlayer(clip);
    const seen = { whole: false, split: false };
    for (let step = 0; step <= clip.frames.length; step++) {
      p.time = Math.min(clip.duration, (step / clip.frames.length) * clip.duration);
      for (const g of p.sample()) {
        for (const v of g.kite.pos.toArray()) expect(Number.isFinite(v)).toBe(true);
        if (g.line) for (let i = 0; i < g.line.n; i++) expect(Number.isFinite(g.line.node(i, new Vector3()).x)).toBe(true);
        if (g.id === 'b' && g.state === 'FLYING' && g.line?.n === 36) seen.whole = true;
        if (g.id === 'b' && g.state === 'AVOADA') seen.split = true;
      }
    }
    expect(seen.whole).toBe(true); // antes do corte
    expect(seen.split).toBe(true); // depois do corte
  }, 60000);
});

describe('rotulos das pipas', () => {
  it('texto por estado, com a distancia arredondada em metros', () => {
    expect(labelText({ state: 'FLYING' }, true, 'Você', 37.6)).toBe('sua pipa 38m');
    expect(labelText({ state: 'FLYING' }, false, 'Bot_SP', 12.2)).toBe('Bot_SP 12m');
    expect(labelText({ state: 'AVOADA' }, false, 'Bot_SP', 46.5)).toBe('avoada 47m');
    expect(labelText({ state: 'GROUNDED' }, false, 'Bot_SP', 35)).toBe('pipa no chão 35m');
    expect(labelText({ state: 'HAND' }, true, 'Você', 0)).toBeNull();
    expect(labelText({ state: 'CAPTURED' }, false, 'x', 5)).toBeNull();
  });
});

describe('GhostRig', () => {
  it('sem dados de linha, line e handLine sao null', () => {
    const g = new GhostRig('z');
    expect(g.line).toBeNull();
    expect(g.handLine).toBeNull();
    g.hasLine = true;
    expect(g.line).not.toBeNull();
  });
});
