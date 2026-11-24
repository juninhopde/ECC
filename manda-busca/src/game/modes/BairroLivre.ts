/**
 * Bairro Livre: cenario aberto com ate 8 bots, loja Valdir Pipas (E perto da porta), missoes e o
 * Campeonato do Bairro a cada 3 minutos.
 */
import { SKIN_MODELS } from '../../data/Catalog';
import type { Difficulty } from '../../entities/KiteAI';
import type { KiteRig } from '../../physics/KiteRig';
import type { CombatEvent } from '../../physics/ReloSystem';
import { alternatingOffsets, anchorAt, yawDownwind } from '../Arena';
import { BotManager, easierThan } from '../BotManager';
import { Championship, DEFAULT_TIMINGS, type ChampionshipTimings } from '../Championship';
import { formatClock, isLost, type GameMode, type ModeHost } from '../types';

export const MAX_BOTS = 8;
export const DEFAULT_BOTS = 6;
export const BOT_RESPAWN_SECONDS = 8;
export const PLAYER_RESPAWN_SECONDS = 2;
export const CHAMPIONSHIP_COINS = 300;
export const PREP_MESSAGE = 'Coloque a pipa no alto (N). Ainda não corta.';

export interface BairroOptions {
  difficulty: Difficulty;
  bots?: number;
  timings?: ChampionshipTimings;
  /** Instante (s) do primeiro campeonato; padrao = o intervalo. */
  firstChampionshipAt?: number;
}

export class BairroLivreMode implements GameMode {
  readonly id = 'bairro' as const;
  readonly roster: BotManager;
  readonly championship: Championship;
  private playerLostAt = -1;
  private cuts = 0;
  private lastStatus = '';

  constructor(private readonly host: ModeHost, private readonly opts: BairroOptions) {
    this.roster = new BotManager(host);
    this.championship = new Championship(
      host.world.relo,
      {
        onPrep: () => this.onPrep(),
        onRun: (p) => host.banner(`CAMPEONATO VALENDO! Sobreviva sem ser cortado (${p.length} pipas no ar)`, 4),
        onEnd: (survivors) => this.onEnd(survivors),
      },
      opts.timings ?? DEFAULT_TIMINGS,
      opts.firstChampionshipAt ?? host.now() + (opts.timings ?? DEFAULT_TIMINGS).everySeconds,
    );
  }

  start(): void {
    const h = this.host;
    h.placePlayer(h.spawn.x, h.spawn.z, yawDownwind(h.windDir));
    h.player.team = -1;
    const count = Math.min(this.opts.bots ?? DEFAULT_BOTS, MAX_BOTS);
    for (let i = 0; i < count; i++) this.addBot();
    h.banner('Bairro Livre: corte as pipas dos outros e apare as avoadas.', 5);
  }

  /** Proximo bot na fila de posicoes ao redor do jogador (alternando esquerda e direita). */
  addBot(): boolean {
    if (this.roster.bots.length >= MAX_BOTS) return false;
    const i = this.roster.bots.length;
    const offset = alternatingOffsets(MAX_BOTS, 6)[i]!;
    const anchor = anchorAt(this.host.spawn, this.host.windDir, offset, this.host);
    const difficulty = i % 3 === 0 ? easierThan(this.opts.difficulty) : this.opts.difficulty;
    this.roster.spawn({ difficulty, team: -1, anchor });
    return true;
  }

  requestRespawn(): boolean {
    const p = this.host.player;
    if (!isLost(p) || this.host.now() - this.playerLostAt < PLAYER_RESPAWN_SECONDS) return false;
    p.resetToHand();
    return true;
  }

  update(_dt: number, events: readonly CombatEvent[]): void {
    const now = this.host.now();
    const p = this.host.player;
    if (isLost(p)) {
      if (this.playerLostAt < 0) this.playerLostAt = now;
    } else this.playerLostAt = -1;
    for (const e of events) if (e.attacker === p && (e.type === 'cut' || e.type === 'bridle-cut')) this.cuts++;
    this.roster.tickRespawn(now, BOT_RESPAWN_SECONDS);
    this.championship.update(now, this.host.world.rigs);
    this.publishStatus(now);
  }

  private onPrep(): void {
    this.host.banner(`CAMPEONATO DO BAIRRO — ${PREP_MESSAGE}`, 6);
    // Bots que nao estao voando recebem pipa nova: a IA solta em seguida.
    for (const b of this.roster.bots) if (b.rig.state !== 'FLYING' && b.rig.state !== 'HAND') b.rig.resetToHand();
  }

  private onEnd(survivors: readonly KiteRig[]): void {
    const h = this.host;
    const won = survivors.includes(h.player);
    if (won) {
      h.profile.data.stats.championships += 1;
      let prize = `${CHAMPIONSHIP_COINS} moedas`;
      h.profile.addCoins(CHAMPIONSHIP_COINS);
      // A cada 3 campeonatos vencidos, uma skin ainda nao comprada.
      if (h.profile.data.stats.championships % 3 === 0) {
        const skin = SKIN_MODELS.find((s) => !h.profile.owns('skin', s.id));
        if (skin) {
          h.profile.data.owned.skin.push(skin.id);
          prize += ` e a skin ${skin.label}`;
        }
      }
      h.profile.save();
      h.banner(`VOCÊ VENCEU O CAMPEONATO! Prêmio: ${prize}`, 7);
      h.feed(`Campeonato: você sobreviveu (+${prize})`);
    } else {
      h.banner(`Campeonato encerrado: ${survivors.length} sobrevivente(s). Você não levou desta vez.`, 6);
    }
  }

  private publishStatus(now: number): void {
    const c = this.championship;
    const lines = [`Bairro Livre · cortes: ${this.cuts}`];
    if (c.phase === 'idle') lines.push(`Próximo campeonato em ${formatClock(c.remaining(now))}`);
    else if (c.phase === 'prep') lines.push(`CAMPEONATO — preparação ${formatClock(c.remaining(now))}`, PREP_MESSAGE);
    else lines.push(`CAMPEONATO — sobreviva: ${formatClock(c.remaining(now))} · vivos: ${c.alive().length}`);
    const key = lines.join('|');
    if (key !== this.lastStatus) {
      this.lastStatus = key;
      this.host.status(lines);
    }
  }

  dispose(): void {
    this.championship.dispose();
    this.roster.clear();
    this.host.status(null);
  }
}
