import type { Difficulty } from '../../entities/KiteAI';
import type { ChampionshipTimings } from '../Championship';
import type { GameMode, ModeHost, ModeId } from '../types';
import { BairroLivreMode } from './BairroLivre';
import { DuelMode } from './Duel';
import { TeamMatchMode } from './TeamMatch';

export interface ModeConfig {
  id: ModeId;
  difficulty: Difficulty;
  /** Jogadores por time no Mata-Mata. */
  teamSize: 3 | 4;
  /** Bots do Bairro Livre (padrao 6, maximo 8). */
  bots?: number;
  /** Cortes para vencer o Mata-Mata (padrao 50). */
  targetCuts?: number;
  timings?: ChampionshipTimings;
  firstChampionshipAt?: number;
}

export function createMode(host: ModeHost, cfg: ModeConfig): GameMode {
  switch (cfg.id) {
    case 'bairro':
      return new BairroLivreMode(host, { difficulty: cfg.difficulty, bots: cfg.bots, timings: cfg.timings, firstChampionshipAt: cfg.firstChampionshipAt });
    case 'duelo':
      return new DuelMode(host, { difficulty: cfg.difficulty, ranked: false });
    case 'ranqueado':
      return new DuelMode(host, { difficulty: cfg.difficulty, ranked: true });
    case 'matamata':
      return new TeamMatchMode(host, { size: cfg.teamSize, difficulty: cfg.difficulty, targetCuts: cfg.targetCuts });
  }
}
