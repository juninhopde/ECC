/**
 * Mapa "Montanha": relevo montanhoso com platô de saida, vegetacao esparsa,
 * rochas, camadas de neblina nos vales e vento com rajadas verticais fortes
 * (correntes ascendentes ao longo das encostas).
 */
import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
} from 'three';
import { SimplexNoise3D, mulberry32, smoothstep, lerp } from '../core/noise';
import { GeometryBatch } from './Batch';
import { WalkWorld, type SurfaceBox } from './Collision';
import { disposeObject3D, type GameMap } from './GameMap';
import {
  cachedTextures,
  dirtTextures,
  fogLayerTexture,
  grassTextures,
  rockTextures,
  woodTextures,
  type PbrTextureSet,
} from './ProceduralTextures';
import { HeightGrid, buildTerrainMesh } from './Terrain';
import { addPine, addRock, addShrub } from './Vegetation';

const PLATEAU_H = 52;
const PLATEAU_R = 32;

export function createMontanhaMap(): GameMap {
  const rand = mulberry32(777);
  const simplex = new SimplexNoise3D(55);
  const root = new Group();
  root.name = 'map:montanha';
  const batch = new GeometryBatch();
  const boxes: SurfaceBox[] = [];

  const grass = cachedTextures('grass', () => grassTextures(1024));
  const rock = cachedTextures('rock1024', () => rockTextures(1024));
  const dirt = cachedTextures('dirt', () => dirtTextures(1024));
  const wood = cachedTextures('woodpole', () => woodTextures(512, [128, 92, 58]));

  const pbr = (set: PbrTextureSet, bump = 1): MeshStandardMaterial =>
    new MeshStandardMaterial({ map: set.map, roughnessMap: set.roughnessMap, bumpMap: set.bumpMap, bumpScale: bump, roughness: 1, vertexColors: true });
  const materials: Record<string, Material> = {
    bark: pbr(wood, 1.2),
    leaf: new MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    pine: new MeshStandardMaterial({ roughness: 0.9, vertexColors: true }),
    rock: pbr(rock, 1.8),
  };
  const barkMat = materials.bark as MeshStandardMaterial;
  for (const tex of [barkMat.map, barkMat.roughnessMap, barkMat.bumpMap]) tex?.repeat.set(1, 4);

  // ---------- Relevo ----------
  const heightFn = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const n1 = simplex.fbm2(x * 0.0018 + 3, z * 0.0018 - 7, 5);
    const ridge = 1 - Math.abs(simplex.fbm2(x * 0.003 - 11, z * 0.003 + 5, 4));
    const target = 60 + 85 * n1 + 95 * ridge * ridge - 40;
    const t = smoothstep(PLATEAU_R, 230, r);
    // Variacao relativa ao platô: gradual perto do ponto de saida, montanhosa ao longe.
    const h = PLATEAU_H + (target - PLATEAU_H) * t * 0.9;
    return h + 2.2 * simplex.noise2(x * 0.05, z * 0.05) * smoothstep(PLATEAU_R, 90, r) + lerp(0, 0, t);
  };
  const grid = new HeightGrid(1600, 320, heightFn);
  const terrain = buildTerrainMesh(grid, {
    layers: { a: grass, b: rock, c: dirt, tileB: 1, tileC: 1.2 },
    tileMeters: 7,
    bumpScale: 1.4,
    splat: (x, z, h, slope, w) => {
      const r = Math.hypot(x, z);
      const rocky = Math.min(1, smoothstep(0.42, 0.95, slope) + 0.85 * smoothstep(105, 135, h));
      const dirtAmt = (1 - smoothstep(PLATEAU_R - 6, PLATEAU_R + 4, r)) * 0.75;
      w[1] = rocky;
      w[2] = dirtAmt * (1 - rocky);
      w[0] = Math.max(0, 1 - w[1] - w[2]);
    },
    tint: (x, z, h, out) => {
      const n = simplex.fbm2(x * 0.01, z * 0.01, 3) * 0.5 + 0.5;
      const alt = smoothstep(80, 140, h);
      const k = 0.78 + n * 0.34;
      out[0] = k * (1 + 0.1 * alt);
      out[1] = k * (1 - 0.04 * alt);
      out[2] = k * (1 + 0.12 * alt);
    },
  });
  root.add(terrain);

  // ---------- Vegetacao esparsa e rochas ----------
  const boundsHalf = 96;
  let placed = 0;
  for (let attempt = 0; attempt < 2400 && placed < 520; attempt++) {
    const x = (rand() - 0.5) * 900;
    const z = (rand() - 0.5) * 900;
    const r = Math.hypot(x, z);
    if (r < 17) continue;
    const h = grid.sample(x, z);
    const slope = grid.slope(x, z);
    if (slope > 0.62 || h < 2 || h > 112) continue;
    const forest = simplex.fbm2(x * 0.006 + 20, z * 0.006, 3);
    if (forest < -0.05 && rand() < 0.85) continue;
    const kind = rand();
    if (kind < 0.62) addPine(batch, x, h - 0.1, z, 0.8 + rand() * 0.9, rand);
    else addShrub(batch, x, h, z, 0.9 + rand() * 0.7, rand);
    if (Math.abs(x) < boundsHalf && Math.abs(z) < boundsHalf && kind < 0.62) {
      boxes.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, top: h + 6 });
    }
    placed++;
  }
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const rr = PLATEAU_R - 3 + rand() * 7;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const size = 0.8 + rand() * 1.5;
    addRock(batch, x, grid.sample(x, z), z, size, rand);
    boxes.push({ minX: x - size * 0.7, maxX: x + size * 0.7, minZ: z - size * 0.7, maxZ: z + size * 0.7, top: grid.sample(x, z) + size * 0.9 });
  }
  for (let i = 0; i < 140; i++) {
    const x = (rand() - 0.5) * 700;
    const z = (rand() - 0.5) * 700;
    if (Math.hypot(x, z) < 26) continue;
    addRock(batch, x, grid.sample(x, z), z, 1.2 + rand() * 4.2, rand);
  }
  batch.build(materials, root);

  // ---------- Neblina nos vales (camadas escrolando devagar) ----------
  const fogTex = fogLayerTexture(512);
  const fogMats: MeshBasicMaterial[] = [];
  const layerDefs: Array<[number, number, number]> = [[16, 0.5, 0.0035], [28, 0.34, -0.0025], [40, 0.2, 0.0018]];
  for (const [y, opacity, speed] of layerDefs) {
    const tex = fogTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(7, 7);
    const mat = new MeshBasicMaterial({ map: tex, color: 0xdfe8f2, transparent: true, opacity, depthWrite: false, side: DoubleSide, fog: false });
    mat.userData.speed = speed;
    fogMats.push(mat);
    const plane = new Mesh(new PlaneGeometry(4200, 4200), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.renderOrder = 3;
    root.add(plane);
  }

  const walk = new WalkWorld({
    terrainHeight: (x, z) => grid.sample(x, z),
    boxes,
    ramps: [],
    bounds: { minX: -boundsHalf, maxX: boundsHalf, minZ: -boundsHalf, maxZ: boundsHalf },
  });

  const windDir = { x: 0.86, z: -0.51 };
  const dayColor = new Color(0xdfe8f2);
  const nightColor = new Color(0x1a2236);
  const tmp = new Color();
  const map: GameMap = {
    id: 'montanha',
    name: 'Montanha',
    root,
    spawn: { x: 0, z: 0, yaw: Math.atan2(-windDir.x, -windDir.z) },
    wind: { baseSpeed: 7.5, dirX: windDir.x, dirZ: windDir.z, turbulence: 1.6, verticalGusts: 2.2 },
    walk,
    wires: [],
    update: (dt: number) => {
      for (const m of fogMats) {
        if (m.map) m.map.offset.x += dt * (m.userData.speed as number);
      }
    },
    setNight: (f: number) => {
      tmp.copy(dayColor).lerp(nightColor, f);
      for (const m of fogMats) m.color.copy(tmp);
    },
    dispose: () => {
      disposeObject3D(root);
      for (const m of Object.values(materials)) m.dispose();
      fogTex.dispose();
    },
  };
  return map;
}
