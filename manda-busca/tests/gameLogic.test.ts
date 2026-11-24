import { describe, expect, it } from 'vitest';
import { LineSupply } from '../src/core/LineSupply';
import { Profile, type StorageLike } from '../src/data/Profile';
import { KiteRig } from '../src/physics/KiteRig';
import { ReloSystem, type CombatEvent } from '../src/physics/ReloSystem';
import { alternatingOffsets, anchorAt, leftOf, yawDownwind } from '../src/game/Arena';
import { Championship } from '../src/game/Championship';
import { AirTime, COINS_PER_APARA, COINS_PER_CUT, applyRewards } from '../src/game/Rewards';
import { formatClock, isLost } from '../src/game/types';

class MemStorage implements StorageLike {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const T0 = new Date(Date.UTC(2026, 10, 23, 12));
const newProfile = (): Profile => new Profile(new MemStorage(), () => T0);
const newRig = (id: string): KiteRig => new KiteRig(id, new LineSupply(250, 1));

describe('Arena', () => {
  it('esquerda de quem olha a favor do vento: vento em +x => -z; vento em +z => +x', () => {
    expect(leftOf({ x: 1, z: 0 })).toEqual({ x: 0, z: -1 });
    expect(leftOf({ x: 0, z: 1 })).toEqual({ x: 1, z: -0 });
    // perpendicular e unitaria para qualquer direcao
    const w = { x: 0.99, z: -0.14 };
    const n = Math.hypot(w.x, w.z);
    const l = leftOf({ x: w.x / n, z: w.z / n });
    expect(l.x * w.x + l.z * w.z).toBeCloseTo(0, 12);
    expect(Math.hypot(l.x, l.z)).toBeCloseTo(1, 12);
  });

  it('yaw da camera para olhar a favor do vento', () => {
    expect(yawDownwind({ x: 1, z: 0 })).toBeCloseTo(-Math.PI / 2, 12); // igual ao spawn do Bairro
    const yaw = yawDownwind({ x: 0, z: 1 });
    // a camera olha para (-sin(yaw), 0, -cos(yaw)): deve coincidir com o vento
    expect(-Math.sin(yaw)).toBeCloseTo(0, 12);
    expect(-Math.cos(yaw)).toBeCloseTo(1, 12);
  });

  it('deslocamentos alternam os lados do centro', () => {
    expect(alternatingOffsets(5, 6)).toEqual([6, -6, 12, -12, 18]);
    expect(alternatingOffsets(5, 6, false)).toEqual([0, 6, -6, 12, -12]);
    expect(alternatingOffsets(0, 6)).toEqual([]);
  });

  it('a mao fica na altura do chao + 1,3 m e recua contra o vento se o ponto estiver bloqueado', () => {
    const open = { canStand: () => true, groundAt: (_x: number, _z: number) => 2 };
    const a = anchorAt({ x: 10, z: 20 }, { x: 1, z: 0 }, 6, open);
    expect(a.x).toBeCloseTo(10, 12);
    expect(a.z).toBeCloseTo(14, 12); // esquerda de quem olha +x e -z
    expect(a.y).toBeCloseTo(3.3, 12);
    const wall = { canStand: (x: number) => x < 8, groundAt: () => 0 }; // bloqueado a partir de x = 8
    const b = anchorAt({ x: 10, z: 0 }, { x: 1, z: 0 }, 0, wall);
    expect(b.x).toBeLessThan(8);
  });
});

describe('Rewards', () => {
  const ev = (type: CombatEvent['type'], attacker?: KiteRig, victim?: KiteRig): CombatEvent => ({ type, attacker, victim } as CombatEvent);

  it('corte e estirante pagam e contam missao; rabiola e eventos alheios nao', () => {
    const profile = newProfile();
    const me = newRig('me');
    const other = newRig('other');
    const coins = profile.data.coins;
    const r = applyRewards([ev('cut', me, other), ev('bridle-cut', me, other), ev('tail-cut', me, other), ev('cut', other, me), ev('capture', me, other)], me, profile);
    expect(r).toEqual({ cuts: 2, aparas: 1, coins: 2 * COINS_PER_CUT + COINS_PER_APARA });
    expect(profile.data.coins).toBe(coins + r.coins);
    expect(profile.data.missions.list.find((m) => m.id === 'd-cortes')!.progress).toBe(2);
    expect(profile.data.missions.list.find((m) => m.id === 'd-apara')!.progress).toBe(1);
    expect(profile.data.stats.cuts).toBe(2);
  });

  it('sem eventos do jogador nada muda', () => {
    const profile = newProfile();
    const before = JSON.stringify(profile.data);
    applyRewards([], newRig('me'), profile);
    expect(JSON.stringify(profile.data)).toBe(before);
  });

  it('tempo no ar so conta com a pipa voando e ligada, em blocos de 1 s', () => {
    const profile = newProfile();
    const rig = newRig('me');
    const air = new AirTime();
    for (let i = 0; i < 120; i++) air.update(1 / 60, rig, profile); // na mao: nao conta
    expect(profile.data.missions.list.find((m) => m.id === 'd-ar')!.progress).toBe(0);
    rig.state = 'FLYING';
    rig.connected = true;
    for (let i = 0; i < 60 * 5 + 5; i++) air.update(1 / 60, rig, profile);
    expect(profile.data.missions.list.find((m) => m.id === 'd-ar')!.progress).toBe(5);
    rig.connected = false; // cortada: para de contar
    for (let i = 0; i < 120; i++) air.update(1 / 60, rig, profile);
    expect(profile.data.missions.list.find((m) => m.id === 'd-ar')!.progress).toBe(5);
  });
});

describe('estado da pipa', () => {
  it('perdida = avoada, capturada ou caida sem ligacao; voando ou na mao nao', () => {
    const r = newRig('a');
    expect(isLost(r)).toBe(false);
    r.state = 'FLYING';
    expect(isLost(r)).toBe(false);
    r.state = 'AVOADA';
    expect(isLost(r)).toBe(true);
    r.state = 'CAPTURED';
    expect(isLost(r)).toBe(true);
    r.state = 'GROUNDED';
    r.connected = true;
    expect(isLost(r)).toBe(false);
    r.connected = false;
    expect(isLost(r)).toBe(true);
  });

  it('relogio mm:ss arredonda para cima', () => {
    expect(formatClock(59.2)).toBe('1:00');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('Championship', () => {
  it('preparacao sem corte, 60 s valendo e premio so para quem nao foi cortado; repete a cada 180 s', () => {
    const relo = new ReloSystem();
    const log: string[] = [];
    const a = newRig('a');
    const b = newRig('b');
    const c = newRig('c');
    for (const r of [a, b]) { r.state = 'FLYING'; r.connected = true; }
    const champ = new Championship(
      relo,
      {
        onPrep: () => log.push('prep'),
        onRun: (p) => log.push(`run:${p.map((r) => r.id).join(',')}`),
        onEnd: (s, p) => log.push(`end:${s.map((r) => r.id).join(',')}/${p.map((r) => r.id).join(',')}`),
      },
      { everySeconds: 180, prepSeconds: 20, runSeconds: 60 },
    );
    const rigs = [a, b, c]; // c nunca voa
    champ.update(179, rigs);
    expect(champ.phase).toBe('idle');
    expect(champ.remaining(179)).toBe(1);
    champ.update(180, rigs);
    expect(champ.phase).toBe('prep');
    expect(relo.enabled).toBe(false);
    expect(champ.remaining(190)).toBe(10);
    champ.update(199, rigs);
    expect(champ.phase).toBe('prep');
    champ.update(200, rigs);
    expect(champ.phase).toBe('run');
    expect(relo.enabled).toBe(true);
    expect(champ.entered.map((r) => r.id)).toEqual(['a', 'b']);
    b.connected = false; b.state = 'AVOADA'; // b cortada
    expect(champ.alive().map((r) => r.id)).toEqual(['a']);
    champ.update(259, rigs);
    expect(champ.phase).toBe('run');
    champ.update(260, rigs);
    expect(champ.phase).toBe('idle');
    expect(log).toEqual(['prep', 'run:a,b', 'end:a/a,b']);
    // proximo inicio: 180 s depois do INICIO do anterior (360), nao do fim
    champ.update(359, rigs);
    expect(champ.phase).toBe('idle');
    champ.update(360, rigs);
    expect(champ.phase).toBe('prep');
  });

  it('dispose religa o relo', () => {
    const relo = new ReloSystem();
    const champ = new Championship(relo, { onPrep: () => undefined, onRun: () => undefined, onEnd: () => undefined }, { everySeconds: 10, prepSeconds: 2, runSeconds: 3 });
    champ.update(10, []);
    expect(relo.enabled).toBe(false);
    champ.dispose();
    expect(relo.enabled).toBe(true);
  });
});
