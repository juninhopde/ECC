import { Game } from './Game';
import type { ReelKind } from './world/FirstPersonHands';
import type { MapId } from './world/GameMap';
import type { SkyPresetId } from './world/SkyAtmosphere';

const MAPS: MapId[] = ['bairro', 'praia', 'montanha'];
const SKIES: SkyPresetId[] = ['manha', 'tarde', 'noite'];
const REELS: ReelKind[] = ['madeira', 'aluminio', 'lata'];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

const params = new URLSearchParams(window.location.search);
const container = document.getElementById('app');
if (!container) throw new Error('Elemento #app ausente');

const game = new Game(container, {
  map: pick(params.get('map'), MAPS, 'bairro'),
  sky: pick(params.get('sky'), SKIES, 'manha'),
  reel: pick(params.get('reel'), REELS, 'madeira'),
  autostart: params.get('autostart') === '1',
});

if (params.get('debug') === '1') {
  (window as unknown as { __game: Game }).__game = game;
}

void game.start();
