/**
 * Terreno por grade de alturas. A mesma grade alimenta a malha visual e a
 * colisao do jogador (interpolacao bilinear), entao pe e chao sempre coincidem.
 * O material mistura ate 3 camadas PBR por vertice (splat) e tinge por cor de vertice.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { PbrTextureSet } from './ProceduralTextures';

export class HeightGrid {
  readonly size: number;
  readonly segments: number;
  readonly cell: number;
  private readonly half: number;
  private readonly stride: number;
  readonly data: Float32Array;

  constructor(size: number, segments: number, heightFn: (x: number, z: number) => number) {
    this.size = size;
    this.segments = segments;
    this.cell = size / segments;
    this.half = size / 2;
    this.stride = segments + 1;
    this.data = new Float32Array(this.stride * this.stride);
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        this.data[j * this.stride + i] = heightFn(i * this.cell - this.half, j * this.cell - this.half);
      }
    }
  }

  /** Altura interpolada em (x, z). Fora da grade, usa a borda. */
  sample(x: number, z: number): number {
    const fx = Math.min(Math.max((x + this.half) / this.cell, 0), this.segments - 1e-6);
    const fz = Math.min(Math.max((z + this.half) / this.cell, 0), this.segments - 1e-6);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const s = this.stride;
    const h00 = this.data[j * s + i]!;
    const h10 = this.data[j * s + i + 1]!;
    const h01 = this.data[(j + 1) * s + i]!;
    const h11 = this.data[(j + 1) * s + i + 1]!;
    return h00 + (h10 - h00) * tx + (h01 - h00) * tz + (h00 - h10 - h01 + h11) * tx * tz;
  }

  /** Inclinacao (rise/run) por diferencas centrais. */
  slope(x: number, z: number): number {
    const e = this.cell;
    const dx = (this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e);
    const dz = (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }
}

export interface TerrainLayers {
  a: PbrTextureSet;
  b: PbrTextureSet;
  c: PbrTextureSet;
  tileB: number;
  tileC: number;
}

export interface TerrainOptions {
  layers: TerrainLayers;
  /** Metros que uma repeticao da textura A cobre. */
  tileMeters: number;
  /** Pesos (a, b, c) em [0, 1] que somam 1. */
  splat: (x: number, z: number, h: number, slope: number, out: [number, number, number]) => void;
  /** Cor de vertice multiplicativa (linear 0-1). */
  tint?: (x: number, z: number, h: number, out: [number, number, number]) => void;
  bumpScale?: number;
}

export function buildTerrainMesh(grid: HeightGrid, options: TerrainOptions): Mesh {
  const geo: BufferGeometry = new PlaneGeometry(grid.size, grid.size, grid.segments, grid.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const count = pos.count;
  const splat = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const w: [number, number, number] = [1, 0, 0];
  const t: [number, number, number] = [1, 1, 1];
  for (let k = 0; k < count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    // PlaneGeometry (apos rotateX) tem v crescendo para -z; mapeia pela grade em x,z.
    const gi = Math.round((x + grid.size / 2) / grid.cell);
    const gj = Math.round((z + grid.size / 2) / grid.cell);
    const h = grid.data[gj * (grid.segments + 1) + gi]!;
    pos.setY(k, h);
    w[0] = 1; w[1] = 0; w[2] = 0;
    options.splat(x, z, h, grid.slope(x, z), w);
    const sum = w[0] + w[1] + w[2] || 1;
    splat[k * 3] = w[0] / sum;
    splat[k * 3 + 1] = w[1] / sum;
    splat[k * 3 + 2] = w[2] / sum;
    t[0] = 1; t[1] = 1; t[2] = 1;
    options.tint?.(x, z, h, t);
    colors[k * 3] = t[0];
    colors[k * 3 + 1] = t[1];
    colors[k * 3 + 2] = t[2];
    uvs[k * 2] = x / options.tileMeters;
    uvs[k * 2 + 1] = z / options.tileMeters;
  }
  pos.needsUpdate = true;
  geo.setAttribute('splat', new Float32BufferAttribute(splat, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const { a, b, c, tileB, tileC } = options.layers;
  const material = new MeshStandardMaterial({
    map: a.map,
    roughnessMap: a.roughnessMap,
    bumpMap: a.bumpMap,
    bumpScale: options.bumpScale ?? 1.4,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.mapB = { value: b.map };
    shader.uniforms.mapC = { value: c.map };
    shader.uniforms.roughB = { value: b.roughnessMap };
    shader.uniforms.roughC = { value: c.roughnessMap };
    shader.uniforms.uTileB = { value: tileB };
    shader.uniforms.uTileC = { value: tileC };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSplat;\nuniform sampler2D mapB;\nuniform sampler2D mapC;\nuniform sampler2D roughB;\nuniform sampler2D roughC;\nuniform float uTileB;\nuniform float uTileC;',
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sA = texture2D( map, vMapUv );
          vec4 sB = texture2D( mapB, vMapUv * uTileB );
          vec4 sC = texture2D( mapC, vMapUv * uTileC );
          vec4 sampledDiffuseColor = sA * vSplat.x + sB * vSplat.y + sC * vSplat.z;
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          float rA = texture2D( roughnessMap, vRoughnessMapUv ).g;
          float rB = texture2D( roughB, vRoughnessMapUv * uTileB ).g;
          float rC = texture2D( roughC, vRoughnessMapUv * uTileC ).g;
          roughnessFactor *= rA * vSplat.x + rB * vSplat.y + rC * vSplat.z;
        #endif`,
      );
  };
  const mesh = new Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}
