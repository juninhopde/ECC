/** Lista de bots de um modo e a reposicao de pipas perdidas (a IA solta a nova sozinha). */
import { DIFFICULTY_ORDER, type Difficulty } from '../entities/KiteAI';
import type { KiteModelId, SkinId } from '../data/Catalog';
import type { LineId } from '../physics/LineSpec';
import { isLost, type Bot, type BotSpec, type ModeHost } from './types';

export const BOT_NAMES = ['Bot_SP', 'Bot_RJ', 'Bot_MG', 'Bot_BA', 'Bot_PE', 'Bot_RS', 'Bot_PR', 'Bot_CE'];

interface Loadout {
  kite: KiteModelId;
  line: LineId;
  skin: SkinId;
}

const LOADOUTS: Record<Difficulty, Loadout[]> = {
  iniciante: [
    { kite: 'bico-medio', line: 'linha10', skin: 'padrao' },
    { kite: 'paulista', line: 'linha10', skin: 'padrao' },
  ],
  'criado-na-laje': [
    { kite: 'carioquinha', line: 'cerol', skin: 'samurai' },
    { kite: 'bico-pequeno', line: 'cerol', skin: 'padrao' },
    { kite: 'paulista', line: 'cerol', skin: 'halloween' },
  ],
  'mestre-do-relo': [
    { kite: 'raia', line: 'chilena', skin: 'dourada' },
    { kite: 'peixinho', line: 'chilena', skin: 'samurai' },
    { kite: 'carioquinha', line: 'chilena', skin: 'padrao' },
  ],
};

export function loadoutFor(difficulty: Difficulty, index: number): Loadout {
  const list = LOADOUTS[difficulty];
  return list[index % list.length]!;
}

/** Um nivel abaixo do escolhido (minimo Iniciante): da variedade ao Bairro Livre. */
export function easierThan(d: Difficulty): Difficulty {
  return DIFFICULTY_ORDER[Math.max(0, DIFFICULTY_ORDER.indexOf(d) - 1)]!;
}

export class BotManager {
  readonly bots: Bot[] = [];
  private counter = 0;

  constructor(private readonly host: ModeHost) {}

  /** Cria um bot com o equipamento tipico da dificuldade. `anchor` define onde ele fica. */
  spawn(partial: Pick<BotSpec, 'difficulty' | 'team' | 'anchor'> & { name?: string }): Bot {
    const i = this.counter++;
    const load = loadoutFor(partial.difficulty, i);
    const bot = this.host.addBot({
      name: partial.name ?? BOT_NAMES[i % BOT_NAMES.length]!,
      difficulty: partial.difficulty,
      team: partial.team,
      anchor: partial.anchor,
      ...load,
    });
    this.bots.push(bot);
    return bot;
  }

  clear(): void {
    for (const b of this.bots) this.host.removeBot(b);
    this.bots.length = 0;
  }

  /** Pipa perdida volta para a mao depois de `delay` s (a IA solta de novo). */
  tickRespawn(now: number, delay: number): void {
    for (const bot of this.bots) {
      if (isLost(bot.rig)) {
        if (bot.respawnAt < 0) bot.respawnAt = now + delay;
        else if (now >= bot.respawnAt) {
          bot.rig.resetToHand();
          bot.respawnAt = -1;
        }
      } else bot.respawnAt = -1;
    }
  }
}
