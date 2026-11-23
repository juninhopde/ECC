/**
 * Duelo 1x1 e Ranqueado 1x1: arena dividida ao meio por uma linha no chao; melhor de 5 cortes
 * (vence quem chega a 3). No Ranqueado a dificuldade do bot acompanha a patente e o resultado
 * vale pontos de ranking.
 */
import { patenteFor } from '../../data/Profile';
import type { Difficulty } from '../../entities/KiteAI';
import type { CombatEvent } from '../../physics/ReloSystem';
import { anchorAt, yawDownwind } from '../Arena';
import { BotManager } from '../BotManager';
import { formatClock, isLost, type Bot, type GameMode, type ModeHost } from '../types';

export const WINS_NEEDED = 3;
export const COUNTDOWN_SECONDS = 5;
export const BETWEEN_SECONDS = 5;
export const ROUND_TIMEOUT_SECONDS = 240;
export const END_SECONDS = 10;
/** Distancia de cada mao ate a linha divisoria (m). */
export const HALF_WIDTH = 8;
export const DUEL_WIN_COINS = 100;
export const DUEL_LOSS_COINS = 30;
export const RANKED_WIN_COINS = 150;
export const RANKED_LOSS_COINS = 40;

export type DuelPhase = 'countdown' | 'live' | 'between' | 'over';

export interface DuelOptions {
  difficulty: Difficulty;
  ranked: boolean;
  winsNeeded?: number;
}

/** Dificuldade do bot no Ranqueado, pela patente do jogador. */
export function rankedDifficulty(rp: number): Difficulty {
  const idx = patenteFor(rp).index;
  return idx <= 1 ? 'iniciante' : idx <= 3 ? 'criado-na-laje' : 'mestre-do-relo';
}

export class DuelMode implements GameMode {
  readonly id: 'duelo' | 'ranqueado';
  readonly roster: BotManager;
  phase: DuelPhase = 'countdown';
  readonly score = { player: 0, bot: 0 };
  round = 1;
  private phaseEnd = 0;
  private liveSince = 0;
  private bot: Bot | null = null;
  private difficulty: Difficulty;
  private readonly winsNeeded: number;
  /** Quem cortou a pipa que acabou com a rodada (para o aviso). */
  private lastCutBy: 'player' | 'bot' | null = null;
  private lastStatus = '';
  lastResult: { won: boolean; rpDelta: number; promoted: boolean; coins: number } | null = null;

  constructor(private readonly host: ModeHost, private readonly opts: DuelOptions) {
    this.id = opts.ranked ? 'ranqueado' : 'duelo';
    this.roster = new BotManager(host);
    this.winsNeeded = opts.winsNeeded ?? WINS_NEEDED;
    this.difficulty = opts.difficulty;
  }

  start(): void {
    const h = this.host;
    if (this.opts.ranked) this.difficulty = rankedDifficulty(h.profile.data.rp);
    this.score.player = 0;
    this.score.bot = 0;
    this.round = 1;
    this.lastResult = null;
    h.player.team = -1;
    // O jogador fica a esquerda da linha divisoria e o bot a direita (de quem olha a favor do vento).
    const mine = anchorAt(h.spawn, h.windDir, HALF_WIDTH, h);
    h.placePlayer(mine.x, mine.z, yawDownwind(h.windDir));
    h.divider({ cx: h.spawn.x, cz: h.spawn.z, dirX: h.windDir.x, dirZ: h.windDir.z, length: 70 });
    if (!this.bot) {
      const anchor = anchorAt(h.spawn, h.windDir, -HALF_WIDTH, h);
      this.bot = this.roster.spawn({ difficulty: this.difficulty, team: -1, anchor, name: this.opts.ranked ? 'Rival Ranqueado' : 'Bot_Duelo' });
    }
    this.startRound();
  }

  private startRound(): void {
    const h = this.host;
    const now = h.now();
    h.player.resetToHand();
    this.bot!.rig.resetToHand();
    this.bot!.respawnAt = -1;
    this.phase = 'countdown';
    this.phaseEnd = now + COUNTDOWN_SECONDS;
    h.world.relo.enabled = false;
    h.banner(`Rodada ${this.round} — prepare-se`, COUNTDOWN_SECONDS);
  }

  requestRespawn(): boolean {
    return false; // as pipas voltam a cada rodada
  }

  addBot(): boolean {
    return false;
  }

  update(_dt: number, events: readonly CombatEvent[]): void {
    const h = this.host;
    const now = h.now();
    const bot = this.bot!;
    for (const e of events) {
      if (e.type !== 'cut' && e.type !== 'bridle-cut') continue;
      if (e.attacker === h.player) this.lastCutBy = 'player';
      else if (e.attacker === bot.rig) this.lastCutBy = 'bot';
    }
    switch (this.phase) {
      case 'countdown':
        if (now >= this.phaseEnd) {
          this.phase = 'live';
          this.liveSince = now;
          this.lastCutBy = null;
          h.world.relo.enabled = true;
          h.banner('VALENDO! Solte a pipa (N) e corte a do rival.', 3);
        }
        break;
      case 'live':
        this.checkRound(now);
        break;
      case 'between':
        if (now >= this.phaseEnd) {
          this.round++;
          this.startRound();
        }
        break;
      case 'over':
        if (now >= this.phaseEnd) this.start(); // nova partida
        break;
    }
    this.publishStatus(now);
  }

  private checkRound(now: number): void {
    const h = this.host;
    const playerLost = isLost(h.player);
    const botLost = isLost(this.bot!.rig);
    if (!playerLost && !botLost) {
      if (now - this.liveSince > ROUND_TIMEOUT_SECONDS) {
        h.banner('Tempo esgotado: rodada anulada.', 3);
        this.endRound(null);
      }
      return;
    }
    if (playerLost && botLost) {
      h.banner('As duas pipas cairam: rodada anulada.', 3);
      this.endRound(null);
      return;
    }
    // Quem perdeu a pipa (por corte, estirante ou cabo de poste) da o ponto ao outro.
    this.endRound(botLost ? 'player' : 'bot');
  }

  private endRound(winner: 'player' | 'bot' | null): void {
    const h = this.host;
    const now = h.now();
    if (winner) {
      this.score[winner]++;
      const how = this.lastCutBy === winner ? 'cortou' : 'ficou com a rodada';
      h.banner(winner === 'player' ? `Você ${how}! ${this.score.player} x ${this.score.bot}` : `O rival ${how}. ${this.score.player} x ${this.score.bot}`, BETWEEN_SECONDS);
      h.feed(`Rodada ${this.round}: ${winner === 'player' ? 'ponto seu' : 'ponto do rival'} (${this.score.player} x ${this.score.bot})`);
    }
    if (this.score.player >= this.winsNeeded || this.score.bot >= this.winsNeeded) {
      this.finishMatch(this.score.player > this.score.bot);
      return;
    }
    this.phase = 'between';
    this.phaseEnd = now + BETWEEN_SECONDS;
    h.world.relo.enabled = false;
    if (!winner) this.round--; // rodada anulada nao conta
  }

  private finishMatch(won: boolean): void {
    const h = this.host;
    const now = h.now();
    this.phase = 'over';
    this.phaseEnd = now + END_SECONDS;
    h.world.relo.enabled = false;
    let rpDelta = 0;
    let promoted = false;
    let coins: number;
    if (this.opts.ranked) {
      const r = h.profile.recordRanked(won);
      rpDelta = r.delta;
      promoted = r.promoted;
      coins = won ? RANKED_WIN_COINS : RANKED_LOSS_COINS;
    } else coins = won ? DUEL_WIN_COINS : DUEL_LOSS_COINS;
    h.profile.addCoins(coins);
    if (won) h.profile.record('duelWins', 1);
    this.lastResult = { won, rpDelta, promoted, coins };
    const rank = this.opts.ranked ? ` ${rpDelta > 0 ? '+' : ''}${rpDelta} RP · ${h.profile.patente.name}${promoted ? ' (PROMOÇÃO!)' : ''}` : '';
    h.banner(`${won ? 'VITÓRIA' : 'DERROTA'}! ${this.score.player} x ${this.score.bot} · +${coins} moedas${rank}`, END_SECONDS);
  }

  private publishStatus(now: number): void {
    const rank = this.opts.ranked ? ` · ${this.host.profile.patente.name} (${this.host.profile.data.rp} RP)` : '';
    const lines = [`${this.opts.ranked ? 'Ranqueado' : 'Duelo'} 1x1${rank}`, `Você ${this.score.player} x ${this.score.bot} Rival · melhor de 5 cortes (vence com ${this.winsNeeded})`];
    if (this.phase === 'countdown') lines.push(`Rodada ${this.round} em ${formatClock(this.phaseEnd - now)}`);
    else if (this.phase === 'live') lines.push(`Rodada ${this.round} valendo`);
    else if (this.phase === 'between') lines.push(`Próxima rodada em ${formatClock(this.phaseEnd - now)}`);
    const key = lines.join('|');
    if (key !== this.lastStatus) {
      this.lastStatus = key;
      this.host.status(lines);
    }
  }

  dispose(): void {
    this.host.world.relo.enabled = true;
    this.roster.clear();
    this.bot = null;
    this.host.divider(null);
    this.host.status(null);
  }
}
