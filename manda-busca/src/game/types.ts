/**
 * Contratos da camada de jogo: o que um modo precisa do anfitriao (Simulation) e o que expoe.
 * Os modos nao conhecem Three.js, DOM nem o Game: so fisica, bots e perfil.
 */
import type { Profile } from '../data/Profile';
import type { KiteModelId, SkinId } from '../data/Catalog';
import type { Difficulty, KiteAI } from '../entities/KiteAI';
import type { CombatWorld } from '../physics/CombatWorld';
import type { KiteRig } from '../physics/KiteRig';
import type { LineId } from '../physics/LineSpec';
import type { CombatEvent } from '../physics/ReloSystem';
import type { Vector3 } from 'three';

export type ModeId = 'bairro' | 'duelo' | 'matamata' | 'ranqueado';

export const MODE_LABELS: Record<ModeId, string> = {
  bairro: 'Bairro Livre',
  duelo: 'Duelo 1x1',
  matamata: 'Mata-Mata',
  ranqueado: 'Ranqueado 1x1',
};

export const MODE_ORDER: ModeId[] = ['bairro', 'duelo', 'matamata', 'ranqueado'];

export interface Bot {
  id: string;
  name: string;
  rig: KiteRig;
  ai: KiteAI;
  anchor: Vector3;
  team: number;
  skin: SkinId;
  /** Instante (tempo de simulacao) em que a pipa perdida volta para a mao; -1 = nao agendado. */
  respawnAt: number;
}

export interface BotSpec {
  name: string;
  difficulty: Difficulty;
  /** Equipe (-1 = todos contra todos). */
  team: number;
  kite: KiteModelId;
  line: LineId;
  skin: SkinId;
  /** Ponto da mao do bot. */
  anchor: Vector3;
}

export interface Point2 {
  x: number;
  z: number;
}

export interface ModeHost {
  readonly world: CombatWorld;
  readonly profile: Profile;
  readonly player: KiteRig;
  /** Direcao horizontal para onde o vento sopra (vetor unitario). */
  readonly windDir: Point2;
  readonly spawn: Point2 & { yaw: number };
  /** Ponto de interacao da loja Valdir Pipas, se o mapa tiver. */
  readonly shop: (Point2 & { radius: number }) | null;
  readonly bots: readonly Bot[];
  /** Segundos de simulacao (passo fixo). */
  now(): number;
  groundAt(x: number, z: number): number;
  canStand(x: number, z: number): boolean;
  addBot(spec: BotSpec): Bot;
  removeBot(bot: Bot): void;
  /** Posiciona o jogador (e a mao da linha) em (x, z), olhando para `yaw`. */
  placePlayer(x: number, z: number, yaw: number): void;
  banner(text: string, seconds: number): void;
  feed(text: string): void;
  /** Linhas do painel de status do modo; null apaga. */
  status(lines: string[] | null): void;
  /** Linha divisoria pintada no chao (null apaga). */
  divider(line: { cx: number; cz: number; dirX: number; dirZ: number; length: number } | null): void;
}

export interface GameMode {
  readonly id: ModeId;
  start(): void;
  /** Um passo fixo, depois do combate, com os eventos do passo. */
  update(dt: number, events: readonly CombatEvent[]): void;
  /** O jogador pediu uma pipa nova (N com a pipa perdida). Devolve true se foi atendido. */
  requestRespawn(): boolean;
  /** Acrescenta um bot, se o modo permitir (tecla T). */
  addBot(): boolean;
  dispose(): void;
}

/** Pipa perdida: cortada e solta, caida sem ligacao com a mao, ou ja apanhada. */
export function isLost(rig: KiteRig): boolean {
  return rig.state === 'AVOADA' || rig.state === 'CAPTURED' || (rig.state === 'GROUNDED' && !rig.connected);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
