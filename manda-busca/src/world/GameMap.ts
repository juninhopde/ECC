import { Group, Material, Mesh, type BufferGeometry, type Object3D, type Texture } from 'three';
import type { WireSegment } from './Catenary';
import type { WalkWorld } from './Collision';

export type MapId = 'bairro' | 'praia' | 'montanha';

export const MAP_LABELS: Record<MapId, string> = {
  bairro: 'Bairro',
  praia: 'Praia',
  montanha: 'Montanha',
};

/** Perfil de vento do mapa: velocidade base (m/s), direcao no plano XZ e intensidade das variacoes. */
export interface WindProfile {
  baseSpeed: number;
  dirX: number;
  dirZ: number;
  /** Multiplicador das rajadas horizontais (1 = padrao). */
  turbulence: number;
  /** Amplitude (m/s) das rajadas verticais. */
  verticalGusts: number;
}

export interface MapSpawn {
  x: number;
  z: number;
  /** Rotacao em Y (radianos); a camera olha para (-sin(yaw), 0, -cos(yaw)). */
  yaw: number;
}

export interface GameMap {
  readonly id: MapId;
  readonly name: string;
  readonly root: Group;
  readonly spawn: MapSpawn;
  readonly wind: WindProfile;
  readonly walk: WalkWorld;
  /** Cabos de poste (fase 2: colisao e atrito com a linha). */
  readonly wires: WireSegment[];
  /** Ponto de interacao da loja Valdir Pipas (E abre a loja a ate `radius` metros). */
  readonly shop?: { x: number; z: number; radius: number };
  /** Atualiza animacoes do cenario (ondas, neblina). */
  update(dt: number, time: number): void;
  /** 0 = dia, 1 = noite completa; acende postes e janelas. */
  setNight(factor: number): void;
  dispose(): void;
}

/** Libera geometrias, materiais e texturas de uma arvore de objetos. */
export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mat = mesh.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
      else materials.add(mat);
    }
  });
  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value && (value as Texture).isTexture) textures.add(value as Texture);
    }
    const uniforms = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (uniforms) {
      for (const u of Object.values(uniforms)) {
        if (u.value && (u.value as Texture).isTexture) textures.add(u.value as Texture);
      }
    }
    m.dispose();
  }
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => t.dispose());
}
