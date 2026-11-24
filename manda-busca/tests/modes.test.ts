import { describe, expect, it } from 'vitest';
import { Profile, type StorageLike } from '../src/data/Profile';
import { KiteAI, type Difficulty } from '../src/entities/KiteAI';
import { EMPTY_INPUT, type PilotInput, type RigEnvironment } from '../src/physics/KiteRig';
import type { CombatEvent } from '../src/physics/ReloSystem';
import { WindField } from '../src/physics/WindField';
import { Simulation } from '../src/game/Simulation';
import { BOT_NAMES } from '../src/game/BotManager';
import { MAX_BOTS, PREP_MESSAGE, type BairroLivreMode } from '../src/game/modes/BairroLivre';
import { DUEL_LOSS_COINS, DUEL_WIN_COINS, RANKED_WIN_COINS, rankedDifficulty, WINS_NEEDED, type DuelMode } from '../src/game/modes/Duel';
import type { TeamMatchMode } from '../src/game/modes/TeamMatch';
import type { ModeConfig } from '../src/game/modes';

class MemStorage implements StorageLike {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const WIND = { baseSpeed: 6.7, dirX: 0.99, dirZ: -0.14, turbulence: 1, verticalGusts: 0.6 };

interface Harness {
  sim: Simulation;
  profile: Profile;
  banners: string[];
  feed: string[];
  status: Array<string[] | null>;
  dividers: Array<unknown>;
  events: CombatEvent[];
  /** Roda `seconds` de simulacao com o jogador conduzido pela IA (ou parado, se `playerAi` for null). */
  run(seconds: number, playerAi: KiteAI | null, until?: () => boolean): number;
  playerAi(d: Difficulty, seed?: number): KiteAI;
}

function makeHarness(seed = 1): Harness {
  const wind = new WindField(WIND, seed);
  const env: RigEnvironment = { wind: wind.sample, time: 0, groundHeight: () => 0, wires: [] };
  const profile = new Profile(new MemStorage(), () => new Date(Date.UTC(2026, 10, 23, 12)));
  const banners: string[] = [];
  const feed: string[] = [];
  const status: Array<string[] | null> = [];
  const dividers: unknown[] = [];
  const events: CombatEvent[] = [];
  let sim!: Simulation;
  sim = new Simulation(
    env,
    wind,
    profile,
    { spawn: { x: 0, z: 0, yaw: -Math.PI / 2 }, shop: null, groundAt: () => 0, canStand: () => true },
    {
      banner: (t) => banners.push(t),
      feed: (t) => feed.push(t),
      status: (l) => status.push(l),
      divider: (d) => dividers.push(d),
      placePlayer: (x, z) => sim.playerAnchor.set(x, 1.3, z),
    },
  );
  const h: Harness = {
    sim, profile, banners, feed, status, dividers, events,
    run(seconds, playerAi, until) {
      const dt = 1 / 60;
      const steps = Math.round(seconds * 60);
      let i = 0;
      for (; i < steps; i++) {
        const ctx = { rigs: sim.world.rigs, relo: sim.world.relo, wind: env.wind, groundHeight: env.groundHeight, time: sim.now() };
        const input: PilotInput = playerAi ? playerAi.update(dt, ctx) : { ...EMPTY_INPUT };
        events.push(...sim.step(dt, input));
        if (until?.()) { i++; break; }
      }
      return i / 60;
    },
    playerAi: (d, s = 99) => new KiteAI(sim.player, d, s),
  };
  return h;
}

const cfg = (over: Partial<ModeConfig> = {}): ModeConfig => ({ id: 'bairro', difficulty: 'criado-na-laje', teamSize: 3, ...over });

describe('Simulation', () => {
  it('troca de modo remove os bots, religa o relo e devolve a pipa para a mao', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 3 }));
    expect(h.sim.bots).toHaveLength(3);
    h.sim.world.relo.enabled = false;
    h.sim.setMode(cfg({ id: 'duelo' }));
    expect(h.sim.bots).toHaveLength(1);
    expect(h.sim.player.state).toBe('HAND');
    h.sim.setMode(cfg({ id: 'bairro', bots: 0 }));
    expect(h.sim.bots).toHaveLength(0);
    expect(h.sim.world.relo.enabled).toBe(true);
  });

  it('o equipamento do perfil vale para o jogador so com a pipa na mao', () => {
    const h = makeHarness();
    h.profile.addCoins(2000);
    expect(h.profile.buy('kite', 'raia').ok).toBe(true);
    expect(h.profile.buy('reel', 'aluminio').ok).toBe(true);
    expect(h.profile.buy('line', 'chilena').ok).toBe(true);
    h.profile.equip('kite', 'raia');
    h.profile.equip('reel', 'aluminio');
    h.profile.equip('line', 'chilena');
    expect(h.sim.equipPlayer()).toBe(true);
    expect(h.sim.player.spec.id).toBe('raia');
    expect(h.sim.player.lineSpec.id).toBe('chilena');
    expect(h.sim.player.supply.capacityYards).toBe(350);
    expect(h.sim.player.rates.quick).toBe(18);
    h.sim.setMode(cfg({ bots: 0 }));
    h.run(1, null);
    const flying = { ...EMPTY_INPUT, launch: true };
    h.sim.step(1 / 60, flying);
    expect(h.sim.player.state).toBe('FLYING');
    h.profile.equip('kite', 'bico-medio');
    expect(h.sim.equipPlayer()).toBe(false); // no ar: nao troca
    expect(h.sim.player.spec.id).toBe('raia');
  });
});

describe('Bairro Livre', () => {
  it('comeca com 6 bots em posicoes distintas, aceita ate 8 e nomeia como na especificacao', () => {
    const h = makeHarness();
    h.sim.setMode(cfg());
    const mode = h.sim.mode as BairroLivreMode;
    expect(h.sim.bots).toHaveLength(6);
    const keys = new Set(h.sim.bots.map((b) => `${b.anchor.x.toFixed(1)},${b.anchor.z.toFixed(1)}`));
    expect(keys.size).toBe(6);
    expect(mode.addBot()).toBe(true);
    expect(mode.addBot()).toBe(true);
    expect(mode.addBot()).toBe(false);
    expect(h.sim.bots).toHaveLength(MAX_BOTS);
    expect(h.sim.bots[0]!.name).toBe(BOT_NAMES[0]);
    // nenhum bot nasce em cima do jogador
    for (const b of h.sim.bots) expect(Math.hypot(b.anchor.x - h.sim.playerAnchor.x, b.anchor.z - h.sim.playerAnchor.z)).toBeGreaterThan(4);
  });

  it('bots soltam a pipa sozinhos e a pipa cortada volta a mao depois da espera', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 2 }));
    h.run(8, null);
    for (const b of h.sim.bots) expect(b.rig.state).toBe('FLYING');
    const victim = h.sim.bots[0]!;
    victim.rig.breakLine(10, 'externo'); // simula um corte
    expect(victim.rig.state).toBe('AVOADA');
    h.run(5, null);
    expect(victim.rig.state).toBe('AVOADA'); // ainda esperando (8 s)
    h.run(5, null);
    expect(['HAND', 'FLYING']).toContain(victim.rig.state); // voltou a mao e a IA ja soltou de novo
  });

  it('o jogador cortado so recebe pipa nova depois de ~2 s e so com N (requestRespawn)', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 0 }));
    h.sim.step(1 / 60, { ...EMPTY_INPUT, launch: true });
    h.run(2, null);
    expect(h.sim.requestRespawn()).toBe(false); // pipa ainda voando
    h.sim.player.breakLine(10, 'externo');
    h.run(0.5, null);
    expect(h.sim.requestRespawn()).toBe(false); // cedo demais
    h.run(2, null);
    expect(h.sim.requestRespawn()).toBe(true);
    expect(h.sim.player.state).toBe('HAND');
  });

  it('Campeonato: preparacao avisa "Ainda nao corta", relo desligado, e quem sobrevive ganha moedas', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 0, firstChampionshipAt: 6, timings: { everySeconds: 20, prepSeconds: 4, runSeconds: 8 } }));
    h.sim.step(1 / 60, { ...EMPTY_INPUT, launch: true }); // pipa no ar antes do evento
    const coins = h.profile.data.coins;
    h.run(5, null);
    expect(h.sim.world.relo.enabled).toBe(true);
    h.run(2, null); // t ~ 7: preparacao
    expect(h.sim.world.relo.enabled).toBe(false);
    expect(h.banners.some((b) => b.includes(PREP_MESSAGE))).toBe(true);
    h.run(4, null); // t ~ 11: valendo
    expect(h.sim.world.relo.enabled).toBe(true);
    expect(h.status.flat().some((l) => l?.includes('sobreviva'))).toBe(true);
    h.run(9, null); // fim
    expect(h.profile.data.coins).toBe(coins + 300);
    expect(h.profile.data.stats.championships).toBe(1);
    expect(h.banners.some((b) => b.includes('VENCEU O CAMPEONATO'))).toBe(true);
  });

  it('Campeonato: quem nao estava com a pipa no ar nao disputa e nao ganha', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 0, firstChampionshipAt: 3, timings: { everySeconds: 20, prepSeconds: 3, runSeconds: 5 } }));
    const coins = h.profile.data.coins;
    h.run(14, null); // o jogador nunca solta a pipa
    expect(h.profile.data.coins).toBe(coins);
    expect(h.profile.data.stats.championships).toBe(0);
  });

  it('Campeonato: ser cortado durante a corrida elimina; a cada 3 vitorias uma skin nova', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ bots: 0, firstChampionshipAt: 4, timings: { everySeconds: 14, prepSeconds: 2, runSeconds: 5 } }));
    h.sim.step(1 / 60, { ...EMPTY_INPUT, launch: true });
    // 3 campeonatos em ~42 s: o jogador sobrevive a todos (sem rivais para corta-lo)
    h.run(48, null);
    expect(h.profile.data.stats.championships).toBeGreaterThanOrEqual(3);
    expect(h.profile.owns('skin', 'samurai')).toBe(true);
    // e agora um cortado no meio da corrida nao ganha
    const before = h.profile.data.stats.championships;
    h.sim.player.resetToHand();
    h.sim.step(1 / 60, { ...EMPTY_INPUT, launch: true });
    const champ = (h.sim.mode as BairroLivreMode).championship;
    h.run(40, null, () => champ.phase === 'run');
    expect(champ.phase).toBe('run');
    h.sim.player.breakLine(10, 'externo');
    h.run(10, null);
    expect(h.profile.data.stats.championships).toBe(before);
  });
});

describe('Duelo 1x1', () => {
  it('arena dividida: maos em lados opostos da linha, 8 m de cada lado, e linha pintada', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ id: 'duelo' }));
    expect(h.sim.bots).toHaveLength(1);
    const bot = h.sim.bots[0]!;
    // vento ~ +x: a esquerda de quem olha a favor do vento e -z. O jogador fica ali; o bot do outro lado.
    expect(h.sim.playerAnchor.z).toBeLessThan(-7);
    expect(bot.anchor.z).toBeGreaterThan(7);
    expect(Math.abs(bot.anchor.z - h.sim.playerAnchor.z)).toBeGreaterThan(14);
    expect(h.dividers.length).toBeGreaterThan(0);
    expect(h.sim.world.relo.enabled).toBe(false); // contagem regressiva
  });

  it('vence quem chega a 3 cortes (melhor de 5) e a vitoria paga moedas e conta missao', () => {
    const h = makeHarness(2);
    h.sim.setMode(cfg({ id: 'duelo', difficulty: 'iniciante' }));
    const mode = h.sim.mode as DuelMode;
    const coins = h.profile.data.coins;
    h.run(900, h.playerAi('mestre-do-relo'), () => mode.phase === 'over');
    expect(mode.phase).toBe('over');
    expect(mode.score.player).toBe(WINS_NEEDED);
    expect(mode.score.bot).toBeLessThan(WINS_NEEDED);
    expect(mode.lastResult?.won).toBe(true);
    expect(h.profile.data.coins).toBeGreaterThanOrEqual(coins + DUEL_WIN_COINS);
    expect(h.profile.data.missions.list.find((m) => m.id === 'w-duelos')!.progress).toBe(1);
    expect(h.banners.some((b) => b.startsWith('VIT'))).toBe(true);
  }, 120000);

  it('e derrotado quando o rival chega a 3: sem vitoria registrada e com moedas de consolacao', () => {
    const h = makeHarness(3);
    h.sim.setMode(cfg({ id: 'duelo', difficulty: 'mestre-do-relo' }));
    const mode = h.sim.mode as DuelMode;
    const coins = h.profile.data.coins;
    h.run(900, h.playerAi('iniciante'), () => mode.phase === 'over');
    expect(mode.phase).toBe('over');
    expect(mode.lastResult?.won).toBe(false);
    expect(mode.score.bot).toBe(WINS_NEEDED);
    expect(mode.score.player).toBeLessThan(WINS_NEEDED);
    expect(h.profile.data.coins).toBeGreaterThanOrEqual(coins + DUEL_LOSS_COINS);
    expect(h.profile.data.missions.list.find((m) => m.id === 'w-duelos')!.progress).toBe(0);
    expect(h.banners.some((b) => b.startsWith('DERROTA'))).toBe(true);
  }, 120000);

  it('derrota no Ranqueado tira 15 RP; o rival de uma patente alta e Mestre do Relo', () => {
    const h = makeHarness(3);
    h.profile.data.rp = 700; // Chocao I
    h.sim.setMode(cfg({ id: 'ranqueado', difficulty: 'iniciante' }));
    const mode = h.sim.mode as DuelMode;
    h.run(900, h.playerAi('iniciante'), () => mode.phase === 'over');
    expect(mode.phase).toBe('over');
    expect(mode.lastResult?.won).toBe(false);
    expect(mode.lastResult?.rpDelta).toBe(-15);
    expect(h.profile.data.rp).toBe(685);
    expect(h.profile.data.matches).toBe(1);
  }, 120000);

  it('Ranqueado: vitoria da +25 RP, +150 moedas e a dificuldade acompanha a patente', () => {
    expect(rankedDifficulty(0)).toBe('iniciante');
    expect(rankedDifficulty(99)).toBe('iniciante');
    expect(rankedDifficulty(100)).toBe('iniciante');
    expect(rankedDifficulty(250)).toBe('criado-na-laje');
    expect(rankedDifficulty(450)).toBe('criado-na-laje');
    expect(rankedDifficulty(700)).toBe('mestre-do-relo');
    expect(rankedDifficulty(1000)).toBe('mestre-do-relo');
    const h = makeHarness(2);
    h.sim.setMode(cfg({ id: 'ranqueado' }));
    const mode = h.sim.mode as DuelMode;
    const coins = h.profile.data.coins;
    h.run(900, h.playerAi('mestre-do-relo'), () => mode.phase === 'over');
    expect(mode.lastResult?.won).toBe(true);
    expect(h.profile.data.rp).toBe(25);
    expect(h.profile.data.matches).toBe(1);
    expect(h.profile.data.coins).toBeGreaterThanOrEqual(coins + RANKED_WIN_COINS);
  }, 120000);
});

describe('Mata-Mata', () => {
  it('3v3: times em lados opostos, so o jogador na equipe 0 com 2 parceiros, e rig.team definido', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ id: 'matamata', teamSize: 3 }));
    expect(h.sim.player.team).toBe(0);
    const mates = h.sim.bots.filter((b) => b.team === 0);
    const foes = h.sim.bots.filter((b) => b.team === 1);
    expect(mates).toHaveLength(2);
    expect(foes).toHaveLength(3);
    for (const b of h.sim.bots) expect(b.rig.team).toBe(b.team);
    // vento ~ +x: o time do jogador fica na esquerda (-z) e o rival na direita (+z)
    for (const m of mates) expect(m.anchor.z).toBeLessThan(0);
    for (const f of foes) expect(f.anchor.z).toBeGreaterThan(0);
  });

  it('4v4 tem 3 parceiros e 4 rivais', () => {
    const h = makeHarness();
    h.sim.setMode(cfg({ id: 'matamata', teamSize: 4 }));
    expect(h.sim.bots.filter((b) => b.team === 0)).toHaveLength(3);
    expect(h.sim.bots.filter((b) => b.team === 1)).toHaveLength(4);
  });

  it('sem fogo amigo, estoque infinito e vitoria ao atingir a meta de cortes', () => {
    const h = makeHarness(4);
    h.sim.setMode(cfg({ id: 'matamata', teamSize: 3, difficulty: 'mestre-do-relo', targetCuts: 3 }));
    const mode = h.sim.mode as TeamMatchMode;
    const coins = h.profile.data.coins;
    const ai = h.playerAi('mestre-do-relo');
    h.run(900, ai, () => mode.lastWon !== null);
    expect(mode.lastWon).not.toBeNull();
    expect(Math.max(mode.score[0]!, mode.score[1]!)).toBeGreaterThanOrEqual(3);
    // nenhum corte entre pipas do mesmo time
    const cuts = h.events.filter((e) => (e.type === 'cut' || e.type === 'bridle-cut') && e.attacker && e.victim);
    expect(cuts.length).toBeGreaterThanOrEqual(3);
    for (const e of cuts) expect(e.attacker!.team === e.victim!.team && e.attacker!.team >= 0).toBe(false);
    expect(h.profile.data.coins).toBeGreaterThan(coins);
    // estoque infinito: pipa perdida do jogador volta na hora (sem esperar)
    h.sim.player.resetToHand();
    h.sim.step(1 / 60, { ...EMPTY_INPUT, launch: true });
    h.sim.player.breakLine(10, 'externo');
    expect(h.sim.player.state).toBe('AVOADA');
    expect(h.sim.requestRespawn()).toBe(true);
    expect(h.sim.player.state).toBe('HAND');
  }, 180000);
});
