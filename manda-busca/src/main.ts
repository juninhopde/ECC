import { Game } from './Game';
import { DIFFICULTY_ORDER, type Difficulty } from './entities/KiteAI';
import { MODE_ORDER, type ModeId } from './game/types';
import type { MapId } from './world/GameMap';
import type { SkyPresetId } from './world/SkyAtmosphere';

const MAPS: MapId[] = ['bairro', 'praia', 'montanha'];
const SKIES: SkyPresetId[] = ['manha', 'tarde', 'noite'];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

const params = new URLSearchParams(window.location.search);
const container = document.getElementById('app');
if (!container) throw new Error('Elemento #app ausente');

/** ?champ=primeiro,intervalo,preparacao,corrida (s): encurta o Campeonato do Bairro para depuracao. */
function parseChampionship(value: string | null): ConstructorParameters<typeof Game>[1]['championship'] {
  if (!value) return undefined;
  const n = value.split(',').map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v) || v <= 0)) return undefined;
  return { first: n[0]!, timings: { everySeconds: n[1]!, prepSeconds: n[2]!, runSeconds: n[3]! } };
}

const bots = Number(params.get('bots'));
const game = new Game(container, {
  map: pick(params.get('map'), MAPS, 'bairro'),
  sky: pick(params.get('sky'), SKIES, 'manha'),
  mode: pick<ModeId>(params.get('mode'), MODE_ORDER, 'bairro'),
  difficulty: pick<Difficulty>(params.get('diff'), DIFFICULTY_ORDER, 'criado-na-laje'),
  bots: Number.isFinite(bots) && bots > 0 ? Math.min(8, Math.floor(bots)) : undefined,
  championship: parseChampionship(params.get('champ')),
  autostart: params.get('autostart') === '1',
});

if (params.get('debug') === '1') {
  (window as unknown as { __game: Game }).__game = game;
}

void game.start();
