/**
 * Mata-Mata 3v3 ou 4v4: dois times em lados opostos do campinho, sem fogo amigo (pipas do mesmo
 * time nao se cortam) e estoque infinito de pipas. Vence o primeiro time a somar 50 cortes.
 */
import type { Difficulty } from '../../entities/KiteAI';
import type { CombatEvent } from '../../physics/ReloSystem';
import { anchorAt, yawDownwind } from '../Arena';
import { BotManager, easierThan } from '../BotManager';
import { isLost, type GameMode, type ModeHost } from '../types';

export const TARGET_CUTS = 50;
export const TEAM_BOT_RESPAWN_SECONDS = 3;
export const TEAM_END_SECONDS = 12;
export const TEAM_WIN_COINS = 200;
export const TEAM_LOSS_COINS = 50;
/** Distancia da primeira mao de cada time ao centro e entre maos do mesmo time (m). */
export const TEAM_GAP = 5;
export const TEAM_SPACING = 4.5;

export interface TeamOptions {
  /** Jogadores por time (3 ou 4). */
  size: 3 | 4;
  difficulty: Difficulty;
  targetCuts?: number;
}

export class TeamMatchMode implements GameMode {
  readonly id = 'matamata' as const;
  readonly roster: BotManager;
  /** Cortes de cada time (0 = o do jogador, 1 = rival). */
  readonly score = [0, 0];
  private over = false;
  private overEnd = 0;
  private lastStatus = '';
  private readonly target: number;
  lastWon: boolean | null = null;

  constructor(private readonly host: ModeHost, private readonly opts: TeamOptions) {
    this.roster = new BotManager(host);
    this.target = opts.targetCuts ?? TARGET_CUTS;
  }

  start(): void {
    const h = this.host;
    this.score[0] = 0;
    this.score[1] = 0;
    this.over = false;
    this.lastWon = null;
    h.world.relo.enabled = true;
    h.player.team = 0;
    const mine = anchorAt(h.spawn, h.windDir, TEAM_GAP, h);
    h.placePlayer(mine.x, mine.z, yawDownwind(h.windDir));
    if (this.roster.bots.length === 0) {
      const n = this.opts.size;
      // Time 0 (esquerda): o jogador na primeira posicao e os parceiros atras dele.
      for (let k = 1; k < n; k++) {
        const anchor = anchorAt(h.spawn, h.windDir, TEAM_GAP + k * TEAM_SPACING, h);
        this.roster.spawn({ difficulty: easierThan(this.opts.difficulty), team: 0, anchor, name: `Parceiro ${k}` });
      }
      // Time 1 (direita), do outro lado do campinho.
      for (let k = 0; k < n; k++) {
        const anchor = anchorAt(h.spawn, h.windDir, -(TEAM_GAP + k * TEAM_SPACING), h);
        this.roster.spawn({ difficulty: this.opts.difficulty, team: 1, anchor, name: `Rival ${k + 1}` });
      }
    }
    for (const b of this.roster.bots) b.rig.resetToHand();
    h.player.resetToHand();
    h.banner(`Mata-Mata ${this.opts.size}x${this.opts.size} — primeiro time a ${this.target} cortes`, 5);
  }

  /** Estoque infinito: nova pipa na hora. */
  requestRespawn(): boolean {
    if (!isLost(this.host.player)) return false;
    this.host.player.resetToHand();
    return true;
  }

  addBot(): boolean {
    return false;
  }

  update(_dt: number, events: readonly CombatEvent[]): void {
    const h = this.host;
    const now = h.now();
    if (this.over) {
      if (now >= this.overEnd) this.start();
      return;
    }
    for (const e of events) {
      if ((e.type !== 'cut' && e.type !== 'bridle-cut') || !e.attacker || !e.victim) continue;
      const t = e.attacker.team;
      if (t < 0 || t === e.victim.team) continue; // sem fogo amigo (o relo ja evita)
      this.score[t]!++;
      if (e.attacker === h.player) h.feed(`Time ${this.score[0]} x ${this.score[1]}`);
    }
    this.roster.tickRespawn(now, TEAM_BOT_RESPAWN_SECONDS);
    if (this.score[0]! >= this.target || this.score[1]! >= this.target) this.finish(this.score[0]! > this.score[1]!);
    this.publishStatus();
  }

  private finish(won: boolean): void {
    const h = this.host;
    this.over = true;
    this.overEnd = h.now() + TEAM_END_SECONDS;
    this.lastWon = won;
    const coins = won ? TEAM_WIN_COINS : TEAM_LOSS_COINS;
    h.profile.addCoins(coins);
    h.world.relo.enabled = false;
    h.banner(`${won ? 'SEU TIME VENCEU' : 'O TIME RIVAL VENCEU'}! ${this.score[0]} x ${this.score[1]} · +${coins} moedas`, TEAM_END_SECONDS);
    h.world.relo.enabled = true;
  }

  private publishStatus(): void {
    const n = this.opts.size;
    const lines = [`Mata-Mata ${n}x${n}`, `Seu time ${this.score[0]} x ${this.score[1]} Rival · primeiro a ${this.target} cortes`];
    const key = lines.join('|');
    if (key !== this.lastStatus) {
      this.lastStatus = key;
      this.host.status(lines);
    }
  }

  dispose(): void {
    this.host.player.team = -1;
    this.roster.clear();
    this.host.status(null);
  }
}
