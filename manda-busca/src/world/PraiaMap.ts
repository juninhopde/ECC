/**
 * Mapa "Praia": faixa de areia com dunas suaves, calcadao de pedra portuguesa,
 * oceano animado (ondas de Gerstner + espuma na arrebentacao + reflexo do sol
 * via PBR), coqueiros, guarda-sois, quiosques, torre de salva-vidas e predios.
 * Vento laminar e mais forte, soprando da terra para o mar.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { SimplexNoise3D, mulberry32, smoothstep } from '../core/noise';
import { GeometryBatch } from './Batch';
import { WalkWorld, type SurfaceBox } from './Collision';
import { disposeObject3D, type GameMap } from './GameMap';
import {
  asphaltTextures,
  buildingFacadeTextures,
  cachedTextures,
  concreteTextures,
  grassTextures,
  portuguesePavementTextures,
  radialGlowTexture,
  rockTextures,
  sandTextures,
  woodTextures,
  type PbrTextureSet,
} from './ProceduralTextures';
import { HeightGrid, buildTerrainMesh } from './Terrain';
import { addPalm, addUmbrella } from './Vegetation';

export const WATER_LEVEL = -0.3;
const PROMENADE_Z0 = 26;
const PROMENADE_TOP = 0.4;

const WATER_COMMON = /* glsl */ `
uniform float uTime;
attribute float aDepth;
varying float vDepth;
varying vec2 vWaterXZ;
void gerstner(vec2 p, float depth, out vec3 disp, out vec3 nrm) {
  float damp = 0.22 + 0.78 * smoothstep(0.0, 3.0, depth);
  vec4 waves[4];
  waves[0] = vec4(0.12, -0.99, 24.0, 0.30);
  waves[1] = vec4(-0.35, -0.94, 11.0, 0.16);
  waves[2] = vec4(0.62, -0.78, 6.0, 0.08);
  waves[3] = vec4(-0.18, -0.98, 3.2, 0.04);
  disp = vec3(0.0);
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = normalize(waves[i].xy);
    float k = 6.2831853 / waves[i].z;
    float c = sqrt(9.81 / k);
    float a = waves[i].w * damp;
    float q = 0.5 / (k * waves[i].w * 4.0);
    float f = k * (dot(d, p) - c * uTime);
    disp.x += q * a * d.x * cos(f);
    disp.z += q * a * d.y * cos(f);
    disp.y += a * sin(f);
    n.x -= d.x * k * a * cos(f);
    n.z -= d.y * k * a * cos(f);
    n.y -= q * k * a * sin(f);
  }
  nrm = normalize(vec3(n.x, 1.0 + n.y, n.z));
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

function buildWater(heightAt: (x: number, z: number) => number): { mesh: Mesh; uniforms: { uTime: { value: number } } } {
  const N = 220;
  const R = 3000;
  const Z = 2980;
  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const idx: number[] = [];
  for (let j = 0; j <= N; j++) {
    const u = j / N;
    const z = -20 - Z * (u * (0.05 + 0.95 * u * u));
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 2 - 1;
      const x = R * t * (0.05 + 0.95 * t * t);
      const k = j * (N + 1) + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = WATER_LEVEL;
      pos[k * 3 + 2] = z;
      depth[k] = Math.max(0, WATER_LEVEL - heightAt(x, z));
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      // Sentido anti-horario visto de cima (normal +y); o inverso seria descartado pelo culling.
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  // normais e uv nao sao usados; o shader calcula tudo.
  geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array(count * 3).fill(0), 3));
  geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2));
  geo.computeBoundingSphere();
  geo.boundingSphere!.radius = 1e5;

  const uniforms = { uTime: { value: 0 } };
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.13, metalness: 0, transparent: true, envMapIntensity: 1.25 });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_COMMON}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 gDisp; vec3 gNrm;
         gerstner(position.xz, aDepth, gDisp, gNrm);
         vec3 objectNormal = gNrm;
         vDepth = aDepth;
         vWaterXZ = position.xz;`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = position + gDisp;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying float vDepth;
         varying vec2 vWaterXZ;
         float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
         float vnoise(vec2 p) {
           vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
           return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 shallowC = vec3(0.13, 0.60, 0.58);
         vec3 midC = vec3(0.04, 0.36, 0.50);
         vec3 deepC = vec3(0.012, 0.10, 0.24);
         vec3 wc = mix(shallowC, midC, smoothstep(0.1, 1.3, vDepth));
         wc = mix(wc, deepC, smoothstep(1.0, 6.0, vDepth));
         diffuseColor.rgb = wc;
         diffuseColor.a = mix(0.42, 0.95, smoothstep(0.0, 1.5, vDepth));
         float swash = 0.14 * sin(uTime * 1.1 + vWaterXZ.x * 0.35);
         float foamBand = 1.0 - smoothstep(0.0, 0.42, vDepth + swash);
         float foamTex = vnoise(vWaterXZ * 1.4 + uTime * 0.3) * 0.6 + vnoise(vWaterXZ * 4.5 - uTime * 0.5) * 0.4;
         float foam = foamBand * smoothstep(0.32, 0.78, foamTex);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96), foam);
         diffuseColor.a = max(diffuseColor.a, foam);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         vec2 rip = vec2(vnoise(vWaterXZ * 0.9 + uTime * 0.4) - 0.5, vnoise(vWaterXZ * 0.9 + 31.7 - uTime * 0.35) - 0.5);
         normal = normalize(normal + (viewMatrix * vec4(rip.x, 0.0, rip.y, 0.0)).xyz * 0.2);`,
      );
  };
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.name = 'ocean';
  return { mesh, uniforms };
}

export function createPraiaMap(): GameMap {
  const rand = mulberry32(4321);
  const simplex = new SimplexNoise3D(31);
  const root = new Group();
  root.name = 'map:praia';
  const batch = new GeometryBatch();
  const boxes: SurfaceBox[] = [];
  const solid = (minX: number, maxX: number, minZ: number, maxZ: number, top: number): void => {
    boxes.push({ minX, maxX, minZ, maxZ, top });
  };

  const sand = cachedTextures('sand', () => sandTextures(1024));
  const grass = cachedTextures('grass', () => grassTextures(1024));
  const rock = cachedTextures('rock512', () => rockTextures(512));
  const asphalt = cachedTextures('asphalt', () => asphaltTextures(512));
  const concrete = cachedTextures('concrete', () => concreteTextures(512, true));
  const pavement = cachedTextures('portuguese', () => portuguesePavementTextures(512));
  const wood = cachedTextures('woodpole', () => woodTextures(512, [128, 92, 58]));

  const pbr = (set: PbrTextureSet, bump = 1): MeshStandardMaterial =>
    new MeshStandardMaterial({ map: set.map, roughnessMap: set.roughnessMap, bumpMap: set.bumpMap, bumpScale: bump, roughness: 1, vertexColors: true });

  const lampMat = new MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffc66e, emissiveIntensity: 0, roughness: 0.4, vertexColors: true });
  const materials: Record<string, Material> = {
    pavement: pbr(pavement, 0.8),
    asphalt: pbr(asphalt, 0.8),
    concrete: pbr(concrete, 0.9),
    wood: pbr(wood, 0.8),
    bark: pbr(wood, 1.2),
    paint: new MeshStandardMaterial({ roughness: 0.55, vertexColors: true }),
    metal: new MeshStandardMaterial({ roughness: 0.4, metalness: 0.75, vertexColors: true }),
    pole: new MeshStandardMaterial({ roughness: 0.4, metalness: 0.6, vertexColors: true }),
    umbrella: new MeshStandardMaterial({ roughness: 0.7, vertexColors: true, side: DoubleSide }),
    frond: new MeshStandardMaterial({ roughness: 0.7, vertexColors: true, side: DoubleSide }),
    leaf: new MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    rock: pbr(rock, 1.6),
    lamp: lampMat,
  };
  for (const key of ['wood']) {
    const m = materials[key] as MeshStandardMaterial;
    for (const tex of [m.map, m.roughnessMap, m.bumpMap]) tex?.repeat.set(1, 4);
  }

  // ---------- Terreno: areia, dunas e linha d'agua ----------
  const heightFn = (x: number, z: number): number => {
    if (z >= PROMENADE_Z0) return 0.38;
    const dune = 0.32 * smoothstep(-8, 24, z) * simplex.fbm2(x * 0.02, z * 0.03, 3);
    const shoreWave = 1.6 * simplex.noise2(x * 0.018, 3.7);
    const zz = z - shoreWave;
    const profile = zz >= -31 ? 0.3 + 0.0105 * (zz - 26) : -0.3 + 0.045 * (zz + 31);
    return Math.max(-4, profile + dune + 0.03 * simplex.noise2(x * 0.4, z * 0.4));
  };
  const grid = new HeightGrid(1200, 300, heightFn);
  const terrain = buildTerrainMesh(grid, {
    layers: { a: sand, b: grass, c: rock, tileB: 1, tileC: 1 },
    tileMeters: 7,
    bumpScale: 1.0,
    splat: (_x, z, _h, _slope, w) => {
      const lawn = smoothstep(44, 52, z);
      w[1] = lawn;
      w[2] = 0;
      w[0] = 1 - lawn;
    },
    tint: (x, z, h, out) => {
      // Faixa molhada estreita junto a linha d'agua (marrom mais escuro), nao a praia inteira.
      const wet = 1 - smoothstep(-0.32, -0.14, h);
      const under = 1 - smoothstep(-1.4, -0.3, h);
      const k = (0.94 + 0.12 * (simplex.fbm2(x * 0.05, z * 0.05, 2) * 0.5 + 0.5)) * (1 - 0.32 * wet) * (1 - 0.3 * under);
      out[0] = k;
      out[1] = k * (1 - 0.03 * wet);
      out[2] = k * (1 - 0.1 * wet);
    },
  });
  root.add(terrain);

  const ocean = buildWater((x, z) => grid.sample(x, z));
  root.add(ocean.mesh);

  // ---------- Calcadao, avenida e calcada ----------
  const white = new Color(0xffffff);
  batch.addBoxMinMax('pavement', -170, 0, PROMENADE_Z0, 170, PROMENADE_TOP, 40, white, 0.18);
  solid(-170, 170, PROMENADE_Z0, 40, PROMENADE_TOP);
  batch.addBoxMinMax('asphalt', -170, 0, 40, 170, PROMENADE_TOP, 50, white, 0.28);
  solid(-170, 170, 40, 50, PROMENADE_TOP);
  batch.addBoxMinMax('concrete', -170, 0, 50, 170, PROMENADE_TOP, 58, new Color(0xe2dfd8), 0.4);
  solid(-170, 170, 50, 58, PROMENADE_TOP);
  batch.addBoxMinMax('concrete', -170, 0, PROMENADE_Z0 - 0.4, 170, 0.34, PROMENADE_Z0, new Color(0xd6d3cc), 0.4);
  const lanePaint = new Color(0xf2f0e8);
  for (let x = -165; x < 165; x += 8) batch.addBoxMinMax('paint', x, PROMENADE_TOP, 44.92, x + 3.5, PROMENADE_TOP + 0.006, 45.08, lanePaint, 1);

  // ---------- Coqueiros, guarda-sois, toalhas ----------
  for (let x = -150; x <= 150; x += 11 + rand() * 4) {
    addPalm(batch, x, 0.34, 24 + rand() * 1.4, 0.9 + rand() * 0.4, rand);
    solid(x - 0.22, x + 0.22, 23.8, 24.6, 4);
  }
  const umbrellaColors: Array<[number, number]> = [[0xe53935, 0xffffff], [0x1e88e5, 0xffffff], [0xfdd835, 0xffffff], [0x43a047, 0xffffff], [0xff7043, 0xfff3e0]];
  for (let i = 0; i < 26; i++) {
    const ux = (rand() - 0.5) * 220;
    const uz = -6 + rand() * 24;
    const [c1, c2] = umbrellaColors[i % umbrellaColors.length]!;
    addUmbrella(batch, ux, grid.sample(ux, uz), uz, c1, c2, (rand() - 0.5) * 0.3);
    if (rand() < 0.7) {
      const th = grid.sample(ux + 1.6, uz + 0.4);
      batch.addBox('paint', ux + 1.6, th + 0.02, uz + 0.4, 1.0, 0.04, 2.0, [0xe53935, 0x1e88e5, 0xffd54f, 0x66bb6a][Math.floor(rand() * 4)]!, (rand() - 0.5) * 0.6, 1);
    }
  }

  // ---------- Quiosques ----------
  for (const kx of [-70, 5, 80]) {
    const kz = 15;
    const gy = grid.sample(kx, kz);
    const wallColor = new Color([0xf2d9a6, 0xb5dcc0, 0xe9a58a][Math.abs(kx) % 3]!);
    batch.addBoxMinMax('wood', kx - 2.2, gy, kz - 1.6, kx - 2.0, gy + 2.3, kz + 1.6, wallColor, 0.5);
    batch.addBoxMinMax('wood', kx + 2.0, gy, kz - 1.6, kx + 2.2, gy + 2.3, kz + 1.6, wallColor, 0.5);
    batch.addBoxMinMax('wood', kx - 2.0, gy, kz - 1.6, kx + 2.0, gy + 2.3, kz - 1.4, wallColor, 0.5);
    batch.addBoxMinMax('wood', kx - 2.2, gy, kz + 1.4, kx + 2.2, gy + 1.05, kz + 1.7, 0xd9b26f, 0.5);
    const roof = new CylinderGeometry(0.05, 3.5, 1.3, 4, 1);
    roof.rotateY(Math.PI / 4);
    batch.add('paint', roof, new Matrix4().makeTranslation(kx, gy + 2.95, kz), 0xb4572f);
    roof.dispose();
    solid(kx - 2.2, kx + 2.2, kz - 1.6, kz + 1.7, 2.4 + gy);
  }

  // ---------- Torre de salva-vidas (escada acessivel) ----------
  {
    const tx = 30;
    const tz = 0;
    const base = grid.sample(tx, tz);
    const platY = base + 2.6;
    for (const [px, pz] of [[28.2, 0.3], [31.8, 0.3], [28.2, 3.1], [31.8, 3.1]] as const) {
      const post = new CylinderGeometry(0.1, 0.1, 2.6, 8);
      batch.add('wood', post, new Matrix4().makeTranslation(px, base + 1.3, pz), 0xffffff);
      post.dispose();
    }
    batch.addBoxMinMax('wood', 28, platY - 0.2, 0.1, 32, platY, 3.3, 0xffffff, 0.5);
    solid(28, 32, 0.1, 3.3, platY);
    batch.addBoxMinMax('paint', 29.0, platY, 1.2, 31.0, platY + 2.3, 3.2, 0xffffff, 0.5);
    for (let s = 0; s < 4; s++) {
      batch.addBoxMinMax('paint', 29.0, platY + 0.2 + s * 0.55, 1.19, 31.0, platY + 0.5 + s * 0.55, 3.21, 0xd7261e, 0.5);
    }
    batch.addBoxMinMax('paint', 28.8, platY + 2.3, 1.0, 31.2, platY + 2.5, 3.4, 0xd7261e, 0.5);
    solid(28.8, 31.2, 1.0, 3.4, platY + 2.5);
    const steps = 13;
    for (let i = 1; i <= steps; i++) {
      const x1 = 32 + (steps - i + 1) * 0.28;
      const x0 = 32 + (steps - i) * 0.28;
      batch.addBoxMinMax('wood', x0, base, 0.4, x1, base + i * 0.2, 1.5, 0xffffff, 0.5);
      solid(x0, x1, 0.4, 1.5, base + i * 0.2);
    }
    for (const rz of [0.1, 3.2]) {
      batch.addBoxMinMax('paint', 28, platY, rz, 32, platY + 0.9, rz + 0.1, 0xe9e9e9, 0.5);
      solid(28, 32, rz, rz + 0.1, platY + 0.9);
    }
    batch.addBoxMinMax('paint', 28, platY, 0.1, 28.1, platY + 0.9, 3.3, 0xe9e9e9, 0.5);
    solid(28, 28.1, 0.1, 3.3, platY + 0.9);
  }

  // ---------- Postes do calcadao ----------
  const lights: Array<{ point: PointLight; base: number }> = [];
  const halos: Sprite[] = [];
  const haloTex = radialGlowTexture(128, 2.0);
  for (let x = -144; x <= 144; x += 24) {
    const pole = new CylinderGeometry(0.06, 0.09, 5.4, 8);
    batch.add('metal', pole, new Matrix4().makeTranslation(x, PROMENADE_TOP + 2.7, 38), 0x4b5258);
    pole.dispose();
    batch.addBox('metal', x, PROMENADE_TOP + 5.45, 37.6, 0.08, 0.08, 0.9, 0x4b5258, 0, 1);
    batch.addBox('lamp', x, PROMENADE_TOP + 5.35, 37.2, 0.5, 0.14, 0.3, 0xffffff, 0, 1);
    solid(x - 0.15, x + 0.15, 37.85, 38.15, 5.8);
    const halo = new Sprite(new SpriteMaterial({ map: haloTex, color: 0xffc66e, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false }));
    halo.scale.setScalar(4.2);
    halo.position.set(x, PROMENADE_TOP + 5.25, 37.2);
    root.add(halo);
    halos.push(halo);
    if (Math.abs(x) <= 72) {
      const light = new PointLight(0xffc66e, 0, 34, 2);
      light.position.set(x, PROMENADE_TOP + 5.1, 37.2);
      root.add(light);
      lights.push({ point: light, base: 160 });
    }
  }

  batch.build(materials, root);

  // ---------- Predios ao fundo (fachadas com janelas que acendem a noite) ----------
  const facadeMats: MeshStandardMaterial[] = [];
  const roofMat = new MeshStandardMaterial({ color: 0x8c8c88, roughness: 0.9 });
  for (let v = 0; v < 4; v++) {
    const tex = buildingFacadeTextures(100 + v);
    facadeMats.push(new MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7 }));
  }
  let bx = -170;
  let bi = 0;
  while (bx < 170) {
    const bw = 20 + rand() * 12;
    const bh = 28 + rand() * 46;
    const bd = 24;
    const geo = new BoxGeometry(bw, bh, bd);
    const uv = geo.getAttribute('uv');
    const dims: Array<[number, number]> = [[bd, bh], [bd, bh], [bw, bd], [bw, bd], [bw, bh], [bw, bh]];
    for (let face = 0; face < 6; face++) {
      const [du, dv] = dims[face]!;
      for (let i = 0; i < 4; i++) {
        const k = face * 4 + i;
        uv.setXY(k, (uv.getX(k) * du) / 22.4, (uv.getY(k) * dv) / 48);
      }
    }
    uv.needsUpdate = true;
    const f = facadeMats[bi % 4]!;
    const mesh = new Mesh(geo, [f, f, roofMat, roofMat, f, f]);
    mesh.position.set(bx + bw / 2, bh / 2, 72 + bd / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    bx += bw + 3 + rand() * 4;
    bi++;
  }

  for (const m of root.children) {
    if (m instanceof Mesh && m.name === 'batch:lamp') m.castShadow = false;
  }

  const walk = new WalkWorld({
    terrainHeight: (x, z) => grid.sample(x, z),
    boxes,
    ramps: [],
    bounds: { minX: -150, maxX: 150, minZ: -60, maxZ: 56 },
    isBlocked: (x, z) => z < PROMENADE_Z0 && grid.sample(x, z) < WATER_LEVEL - 0.12,
  });

  return {
    id: 'praia',
    name: 'Praia',
    root,
    spawn: { x: 0, z: -12, yaw: 0 },
    wind: { baseSpeed: 8.6, dirX: 0, dirZ: -1, turbulence: 0.35, verticalGusts: 0.25 },
    walk,
    wires: [],
    update: (_dt: number, time: number) => {
      ocean.uniforms.uTime.value = time;
    },
    setNight: (f: number) => {
      lampMat.emissiveIntensity = f * 4;
      for (const l of lights) l.point.intensity = l.base * f;
      for (const h of halos) (h.material as SpriteMaterial).opacity = f * 0.9;
      for (const m of facadeMats) m.emissiveIntensity = f * 1.5;
    },
    dispose: () => {
      disposeObject3D(root);
      for (const m of Object.values(materials)) m.dispose();
      for (const m of facadeMats) {
        m.map?.dispose();
        m.emissiveMap?.dispose();
        m.dispose();
      }
      roofMat.dispose();
      haloTex.dispose();
      void Quaternion;
      void Vector3;
    },
  };
}
