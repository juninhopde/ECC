import { createBairroMap } from './BairroMap';
import type { GameMap, MapId } from './GameMap';
import { createMontanhaMap } from './MontanhaMap';
import { createPraiaMap } from './PraiaMap';

export function createMap(id: MapId): GameMap {
  switch (id) {
    case 'bairro': return createBairroMap();
    case 'praia': return createPraiaMap();
    case 'montanha': return createMontanhaMap();
  }
}
