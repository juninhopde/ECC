import { describe, expect, it } from 'vitest';
import { KITE_MODELS, LINE_MODELS, REEL_MODELS, SKIN_MODELS } from '../src/data/Catalog';
import { PATENTES, Profile, dayKey, leaderboard, patenteFor, weekKey, type StorageLike } from '../src/data/Profile';

class MemStorage implements StorageLike {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const T0 = new Date(Date.UTC(2026, 10, 23, 12));

describe('catalogo', () => {
  it('tem 7 modelos de pipa, 3 carreteis, 3 linhas e 4 skins', () => {
    expect(KITE_MODELS).toHaveLength(7);
    expect(REEL_MODELS).toHaveLength(3);
    expect(LINE_MODELS).toHaveLength(3);
    expect(SKIN_MODELS.map((s) => s.label)).toEqual(['Padrão', 'Samurai', 'Halloween', 'Pipa Dourada']);
  });

  it('cada modelo tem fisica propria (nenhum par de especificacoes identico)', () => {
    const keys = KITE_MODELS.map((k) => JSON.stringify([k.spec.area, k.spec.mass, k.spec.dartImpulse, k.spec.yawStiffness]));
    expect(new Set(keys).size).toBe(7);
  });

  it('Raia e Peixinho nao tem rabiola nem tapa; os demais tem', () => {
    for (const k of KITE_MODELS) {
      const tailless = k.id === 'raia' || k.id === 'peixinho';
      expect(k.spec.hasTail).toBe(!tailless);
      expect(k.spec.canTapa).toBe(!tailless);
    }
  });

  it('carreteis: capacidades e comportamentos conforme a especificacao', () => {
    const by = Object.fromEntries(REEL_MODELS.map((r) => [r.id, r]));
    expect(by.madeira!.capacityYards).toBe(250);
    expect(by.aluminio!.capacityYards).toBe(350);
    expect(by.lata!.capacityYards).toBe(200);
    expect(by.aluminio!.rates.reel).toBeGreaterThan(by.madeira!.rates.reel);
    expect(by.aluminio!.rates.quick).toBeGreaterThan(by.madeira!.rates.quick);
    expect(by.lata!.rates.payOut).toBeGreaterThan(by.madeira!.rates.payOut);
    expect(by.lata!.rates.reel).toBeLessThan(by.madeira!.rates.reel);
  });
});

describe('patentes', () => {
  it('seis patentes em ordem e progresso ate a proxima', () => {
    expect(PATENTES.map((p) => p.name)).toEqual(['Mirin', 'Rabeiro', 'Chocão III', 'Chocão II', 'Chocão I', 'Lenda do Bairro']);
    expect(patenteFor(0).name).toBe('Mirin');
    expect(patenteFor(99).name).toBe('Mirin');
    expect(patenteFor(100).name).toBe('Rabeiro');
    expect(patenteFor(1000).name).toBe('Lenda do Bairro');
    expect(patenteFor(5000).progress).toBe(1);
    expect(patenteFor(50).progress).toBeCloseTo(0.5, 9);
  });
});

describe('Profile', () => {
  it('comeca com equipamento basico e moedas', () => {
    const p = new Profile(new MemStorage(), () => T0);
    expect(p.data.coins).toBe(200);
    expect(p.data.equipped).toEqual({ kite: 'bico-medio', line: 'linha10', reel: 'madeira', skin: 'padrao' });
  });

  it('compra recusada por falta de moedas nao altera saldo nem inventario', () => {
    const p = new Profile(new MemStorage(), () => T0);
    expect(p.data.coins).toBe(200);
    expect(p.buy('line', 'cerol')).toEqual({ ok: false, reason: 'sem-moedas' });
    expect(p.data.coins).toBe(200);
    expect(p.owns('line', 'cerol')).toBe(false);
    p.addCoins(100);
    expect(p.buy('line', 'cerol')).toEqual({ ok: true });
    expect(p.data.coins).toBe(0);
    expect(p.owns('line', 'cerol')).toBe(true);
  });

  it('compra e equipamento funcionam e so equipa o que e seu', () => {
    const p = new Profile(new MemStorage(), () => T0);
    p.addCoins(1000);
    const before = p.data.coins;
    expect(p.buy('kite', 'raia')).toEqual({ ok: true });
    expect(p.data.coins).toBe(before - 400);
    expect(p.buy('kite', 'raia')).toEqual({ ok: false, reason: 'ja-possui' });
    expect(p.equip('kite', 'raia')).toBe(true);
    expect(p.data.equipped.kite).toBe('raia');
    expect(p.equip('kite', 'peixinho')).toBe(false);
    expect(p.buy('skin', 'dourada')).toEqual({ ok: false, reason: 'sem-moedas' });
    expect(p.buy('kite', 'nao-existe')).toEqual({ ok: false, reason: 'item-invalido' });
  });

  it('persiste e recarrega do armazenamento', () => {
    const store = new MemStorage();
    const a = new Profile(store, () => T0);
    a.addCoins(500);
    a.buy('reel', 'lata');
    a.equip('reel', 'lata');
    const b = new Profile(store, () => T0);
    expect(b.data.coins).toBe(a.data.coins);
    expect(b.data.equipped.reel).toBe('lata');
    expect(b.owns('reel', 'lata')).toBe(true);
  });

  it('dados corrompidos ou editados a mao nao quebram: volta ao equipamento valido', () => {
    const store = new MemStorage();
    store.setItem('manda-busca-perfil-v1', JSON.stringify({ version: 1, coins: 'abc', rp: -5, equipped: { kite: 'inventado', reel: 'lata' }, owned: { kite: ['bico-medio'], reel: ['madeira'] } }));
    const p = new Profile(store, () => T0);
    expect(p.data.equipped.kite).toBe('bico-medio');
    expect(p.data.equipped.reel).toBe('madeira');
    expect(p.data.rp).toBe(0);
    expect(Number.isFinite(p.data.coins)).toBe(true);
    store.setItem('manda-busca-perfil-v1', '{nao e json');
    expect(() => new Profile(store, () => T0)).not.toThrow();
  });

  it('funciona sem armazenamento (modo privado)', () => {
    const p = new Profile(null, () => T0);
    p.addCoins(10);
    expect(p.data.coins).toBe(210);
  });
});

describe('missoes', () => {
  it('progresso, conclusao e resgate pagam uma unica vez', () => {
    const p = new Profile(new MemStorage(), () => T0);
    const coins = p.data.coins;
    expect(p.claim('d-cortes')).toBe(0);
    p.record('cuts', 2);
    expect(p.claim('d-cortes')).toBe(0);
    p.record('cuts', 5);
    expect(p.data.missions.list.find((m) => m.id === 'd-cortes')!.progress).toBe(3);
    expect(p.claim('d-cortes')).toBe(100);
    expect(p.claim('d-cortes')).toBe(0);
    expect(p.data.coins).toBe(coins + 100);
    expect(p.data.missions.list.find((m) => m.id === 'w-cortes')!.progress).toBe(7);
  });

  it('missao diaria renova ao virar o dia e a semanal so ao virar a semana', () => {
    let now = new Date(Date.UTC(2026, 10, 23, 23, 0)); // segunda
    const store = new MemStorage();
    const p = new Profile(store, () => now);
    p.record('cuts', 3);
    p.claim('d-cortes');
    now = new Date(Date.UTC(2026, 10, 24, 1, 0)); // terca
    p.refreshMissions();
    const daily = p.data.missions.list.find((m) => m.id === 'd-cortes')!;
    expect(daily.progress).toBe(0);
    expect(daily.claimed).toBe(false);
    expect(p.data.missions.list.find((m) => m.id === 'w-cortes')!.progress).toBe(3);
    now = new Date(Date.UTC(2026, 10, 30, 10, 0)); // proxima segunda
    p.refreshMissions();
    expect(p.data.missions.list.find((m) => m.id === 'w-cortes')!.progress).toBe(0);
  });

  it('chaves de dia e de semana ISO', () => {
    expect(dayKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    expect(weekKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01');
    expect(weekKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-W53');
    expect(weekKey(new Date(Date.UTC(2026, 10, 23)))).toBe(weekKey(new Date(Date.UTC(2026, 10, 29))));
    expect(weekKey(new Date(Date.UTC(2026, 10, 29)))).not.toBe(weekKey(new Date(Date.UTC(2026, 10, 30))));
  });
});

describe('ranqueado e classificacao', () => {
  it('vitoria +25, derrota -15, nunca abaixo de zero, e promove de patente', () => {
    const p = new Profile(new MemStorage(), () => T0);
    expect(p.recordRanked(false).delta).toBe(-15);
    expect(p.data.rp).toBe(0);
    for (let i = 0; i < 3; i++) p.recordRanked(true);
    expect(p.data.rp).toBe(75);
    const r = p.recordRanked(true);
    expect(r.promoted).toBe(true);
    expect(p.patente.name).toBe('Rabeiro');
  });

  it('tabela de classificacao inclui o jogador, ordenada, e e deterministica', () => {
    const p = new Profile(new MemStorage(), () => T0);
    p.data.rp = 500;
    const a = leaderboard(p);
    const b = leaderboard(p);
    expect(a).toEqual(b);
    expect(a.some((r) => r.isPlayer && r.rp === 500)).toBe(true);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.rp).toBeGreaterThanOrEqual(a[i]!.rp);
  });
});
