/**
 * Mapa principal "Bairro": ruas asfaltadas com meio-fio e calcadas rachadas,
 * casas de alvenaria com laje acessivel (escada ou rampa), caixas d'agua azuis,
 * a loja "Valdir Pipas", campinho de terra batida e postes com cabos de
 * catenaria real cruzando as ruas.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three';
import { SimplexNoise3D, mulberry32, smoothstep } from '../core/noise';
import { GeometryBatch } from './Batch';
import { catenaryPoints, polylineToSegments, type WireSegment } from './Catenary';
import { WalkWorld, type Ramp, type SurfaceBox } from './Collision';
import { disposeObject3D, type GameMap } from './GameMap';
import {
  asphaltTextures,
  cachedTextures,
  concreteTextures,
  dirtTextures,
  grassTextures,
  plasterTextures,
  radialGlowTexture,
  rockTextures,
  woodTextures,
  type PbrTextureSet,
} from './ProceduralTextures';
import { HeightGrid, buildTerrainMesh } from './Terrain';
import { addPalm, addTree, tubeAlong } from './Vegetation';

const PALETTE = [0xf1d58a, 0xaed3e8, 0xe9a58a, 0xb5dcc0, 0xf2efe6, 0xd9b26f, 0xe8b8c4, 0xc7dca0, 0xd98b6a, 0xc9bfe0];
const STEP_RISE = 0.2;
const STEP_RUN = 0.28;

/** Quadro local de uma construcao: +z local aponta para a frente (rua). */
class Frame {
  constructor(
    private readonly batch: GeometryBatch,
    private readonly boxes: SurfaceBox[],
    readonly cx: number,
    readonly cz: number,
    /** 0: frente para +z; 1: para +x; 2: para -z; 3: para -x. */
    readonly rot: 0 | 1 | 2 | 3,
  ) {}

  toWorld(lx: number, lz: number): [number, number] {
    switch (this.rot) {
      case 0: return [this.cx + lx, this.cz + lz];
      case 1: return [this.cx + lz, this.cz - lx];
      case 2: return [this.cx - lx, this.cz - lz];
      default: return [this.cx - lz, this.cz + lx];
    }
  }

  dirToWorld(dx: number, dz: number): [number, number] {
    switch (this.rot) {
      case 0: return [dx, dz];
      case 1: return [dz, -dx];
      case 2: return [-dx, -dz];
      default: return [-dz, dx];
    }
  }

  box(
    key: string,
    lx0: number, ly0: number, lz0: number,
    lx1: number, ly1: number, lz1: number,
    color: Color | number,
    solid = false,
    texel = 0.4,
  ): void {
    const [ax, az] = this.toWorld(lx0, lz0);
    const [bx, bz] = this.toWorld(lx1, lz1);
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz);
    const maxZ = Math.max(az, bz);
    this.batch.addBoxMinMax(key, minX, ly0, minZ, maxX, ly1, maxZ, color, texel);
    if (solid) this.boxes.push({ minX, maxX, minZ, maxZ, top: ly1 });
  }
}

function drawKite(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, c1: string, c2: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size);
  ctx.moveTo(-size * 0.7, 0);
  ctx.lineTo(size * 0.7, 0);
  ctx.stroke();
  ctx.strokeStyle = c2;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.bezierCurveTo(size * 0.4, size * 1.4, -size * 0.4, size * 1.7, 0, size * 2);
  ctx.stroke();
  ctx.restore();
}

function shopSignTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 176;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 176);
  g.addColorStop(0, '#d71920');
  g.addColorStop(1, '#a30f15');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 176);
  ctx.strokeStyle = '#ffd21f';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 1004, 156);
  ctx.font = '900 104px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#4a0a0e';
  ctx.strokeText('VALDIR PIPAS', 512, 92);
  ctx.fillStyle = '#ffd21f';
  ctx.fillText('VALDIR PIPAS', 512, 92);
  drawKite(ctx, 92, 74, 44, '#1e88e5', '#ffd21f');
  drawKite(ctx, 932, 74, 44, '#43a047', '#ffffff');
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function shutterTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7d8a96';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, y, 128, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y + 5, 128, 3);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface MapLights {
  point: PointLight;
  base: number;
}

export function createBairroMap(): GameMap {
  const rand = mulberry32(1234);
  const simplex = new SimplexNoise3D(77);
  const root = new Group();
  root.name = 'map:bairro';
  const batch = new GeometryBatch();
  const boxes: SurfaceBox[] = [];
  const ramps: Ramp[] = [];
  const wires: WireSegment[] = [];

  // ---------- Materiais ----------
  const grass = cachedTextures('grass', () => grassTextures(1024));
  const dirt = cachedTextures('dirt', () => dirtTextures(1024));
  const rock = cachedTextures('rock512', () => rockTextures(512));
  const asphalt = cachedTextures('asphalt', () => asphaltTextures(512));
  const concrete = cachedTextures('concrete', () => concreteTextures(512, true));
  const plaster = cachedTextures('plaster', () => plasterTextures(512));
  const wood = cachedTextures('woodpole', () => woodTextures(512, [128, 92, 58]));

  function pbr(set: PbrTextureSet, extra: { bump?: number; roughness?: number; vertexColors?: boolean } = {}): MeshStandardMaterial {
    return new MeshStandardMaterial({
      map: set.map,
      roughnessMap: set.roughnessMap,
      bumpMap: set.bumpMap,
      bumpScale: extra.bump ?? 1,
      roughness: extra.roughness ?? 1,
      vertexColors: extra.vertexColors ?? true,
    });
  }

  const lampMat = new MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffc66e, emissiveIntensity: 0, roughness: 0.4, vertexColors: true });
  const glassLit = new MeshPhysicalMaterial({ color: 0x16222e, roughness: 0.08, emissive: 0xffc27a, emissiveIntensity: 0 });
  const signTex = shopSignTexture();
  const signMat = new MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.6 });
  const shutterTex = shutterTexture();
  const shutterMat = new MeshStandardMaterial({ map: shutterTex, roughness: 0.45, metalness: 0.6 });

  const materials: Record<string, Material> = {
    asphalt: pbr(asphalt, { bump: 0.8 }),
    roadPaint: new MeshStandardMaterial({ roughness: 0.75, vertexColors: true }),
    concrete: pbr(concrete, { bump: 0.9 }),
    plaster: pbr(plaster, { bump: 1.6 }),
    paint: new MeshStandardMaterial({ roughness: 0.55, vertexColors: true }),
    metal: new MeshStandardMaterial({ roughness: 0.4, metalness: 0.75, vertexColors: true }),
    glass: new MeshPhysicalMaterial({ color: 0x16222e, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05 }),
    glassLit,
    tank: new MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, vertexColors: true }),
    wood: pbr(wood, { bump: 0.8 }),
    bark: pbr(wood, { bump: 1.2 }),
    leaf: new MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    frond: new MeshStandardMaterial({ roughness: 0.7, vertexColors: true, side: DoubleSide }),
    rock: pbr(rock, { bump: 1.6 }),
    lamp: lampMat,
    cable: new MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.25 }),
    kiteDeco: new MeshStandardMaterial({ roughness: 0.6, vertexColors: true, side: DoubleSide }),
  };
  for (const key of ['asphalt', 'concrete', 'plaster']) (materials[key] as MeshStandardMaterial).envMapIntensity = 0.55;
  for (const key of ['wood']) {
    const m = materials[key] as MeshStandardMaterial;
    for (const tex of [m.map, m.roughnessMap, m.bumpMap]) tex?.repeat.set(1, 4);
  }

  const solid = (minX: number, maxX: number, minZ: number, maxZ: number, top: number): void => {
    boxes.push({ minX, maxX, minZ, maxZ, top });
  };

  // ---------- Terreno ----------
  const heightFn = (x: number, z: number): number => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const edge = smoothstep(118, 230, d);
    if (edge <= 0) return 0;
    return edge * (4 + 22 * (simplex.fbm2(x * 0.0035 + 10, z * 0.0035, 4) * 0.5 + 0.5));
  };
  const grid = new HeightGrid(1400, 280, heightFn);
  const fieldSd = (x: number, z: number): number =>
    Math.max(Math.abs(x - 48) - 30, Math.abs(z + 50) - 22) + simplex.noise2(x * 0.11, z * 0.11) * 3.2;
  const terrain = buildTerrainMesh(grid, {
    layers: { a: grass, b: dirt, c: rock, tileB: 1.4, tileC: 1.0 },
    tileMeters: 6,
    bumpScale: 1.1,
    splat: (x, z, _h, slope, w) => {
      const dirtAmount = 1 - smoothstep(-3, 3, fieldSd(x, z));
      const rocky = smoothstep(0.35, 0.8, slope);
      w[1] = dirtAmount * (1 - rocky);
      w[2] = rocky;
      w[0] = Math.max(0, 1 - w[1] - w[2]);
    },
    tint: (x, z, _h, out) => {
      const n = simplex.fbm2(x * 0.012, z * 0.012, 4) * 0.5 + 0.5;
      const m = simplex.fbm2(x * 0.045 + 40, z * 0.045, 2) * 0.5 + 0.5;
      const k = 0.62 + n * 0.5 + (m - 0.5) * 0.22;
      out[0] = k * (1 + (m - 0.5) * 0.12);
      out[1] = k;
      out[2] = k * 0.92;
    },
  });
  root.add(terrain);

  // ---------- Ruas ----------
  const GRAY = new Color(0xffffff);
  const ASPH_T = 0.28;
  const T_CURB = 0.15;
  // Rua A (leste-oeste, z = 0) e Rua B (norte-sul, x = -40).
  batch.addBoxMinMax('asphalt', -100, 0, -4, 100, 0.03, 4, GRAY, ASPH_T);
  batch.addBoxMinMax('asphalt', -44, 0, -100, -36, 0.03, -4, GRAY, ASPH_T);
  batch.addBoxMinMax('asphalt', -44, 0, 4, -36, 0.03, 100, GRAY, ASPH_T);
  solid(-100, 100, -4, 4, 0.03);
  solid(-44, -36, -100, -4, 0.03);
  solid(-44, -36, 4, 100, 0.03);

  const curbColor = new Color(0xd6d3cc);
  const walkColor = new Color(0xe2dfd8);
  const addSlab = (minX: number, maxX: number, minZ: number, maxZ: number, color: Color): void => {
    batch.addBoxMinMax('concrete', minX, 0, minZ, maxX, T_CURB, maxZ, color, 0.4);
    solid(minX, maxX, minZ, maxZ, T_CURB);
  };
  // Rua A: meio-fio (z = +-4.0..4.25) e calcadas (+-4.25..6.6), sem cruzar a Rua B.
  for (const [x0, x1] of [[-100, -44.25], [-35.75, 100]] as const) {
    addSlab(x0, x1, -4.25, -4.0, curbColor);
    addSlab(x0, x1, 4.0, 4.25, curbColor);
  }
  for (const [x0, x1] of [[-100, -46.6], [-33.4, 100]] as const) {
    addSlab(x0, x1, -6.6, -4.25, walkColor);
    addSlab(x0, x1, 4.25, 6.6, walkColor);
  }
  // Rua B: meio-fio (x = -44.25..-44 e -36..-35.75) e calcadas, parando no meio-fio da Rua A.
  for (const [z0, z1] of [[-100, -4.25], [4.25, 100]] as const) {
    addSlab(-44.25, -44.0, z0, z1, curbColor);
    addSlab(-36.0, -35.75, z0, z1, curbColor);
    addSlab(-46.6, -44.25, z0, z1, walkColor);
    addSlab(-35.75, -33.4, z0, z1, walkColor);
  }
  // Faixas da rua: tracejado central e faixa de pedestres.
  const paint = new Color(0xf2f0e8);
  for (let x = -97; x < 97; x += 7) {
    if (x > -47 && x < -33) continue;
    batch.addBoxMinMax('roadPaint', x, 0.03, -0.08, x + 3, 0.036, 0.08, paint, 1);
  }
  for (let z = -97; z < 97; z += 7) {
    if (z > -7 && z < 7) continue;
    batch.addBoxMinMax('roadPaint', -40.08, 0.03, z, -39.92, 0.036, z + 3, paint, 1);
  }
  for (let i = 0; i < 8; i++) {
    const z0 = -3.6 + i * 0.95;
    batch.addBoxMinMax('roadPaint', -30.6, 0.03, z0, -27.6, 0.036, z0 + 0.5, paint, 1);
  }

  // ---------- Casas ----------
  const tankColor = new Color(0x1d5db3);
  const concreteTint = new Color(0xcfcfca);
  const glassKeys = ['glass', 'glassLit'] as const;

  interface HouseOptions {
    shop?: boolean;
    index: number;
    slabTop?: number;
  }

  function addHouse(f: Frame, w: number, d: number, opts: HouseOptions): void {
    const slabTop = opts.slabTop ?? 3.2;
    const body = new Color(PALETTE[Math.floor(rand() * PALETTE.length)]!);
    const trim = new Color(0xf5f3ec);
    const hw = w / 2;
    const hd = d / 2;
    // Corpo + laje (um unico solido caminhavel no topo).
    f.box('plaster', -hw, 0, -hd, hw, slabTop - 0.2, hd, body, false, 0.35);
    f.box('concrete', -hw - 0.12, slabTop - 0.2, -hd - 0.12, hw + 0.12, slabTop, hd + 0.12, concreteTint, false, 0.4);
    const [wx0, wz0] = f.toWorld(-hw - 0.12, -hd - 0.12);
    const [wx1, wz1] = f.toWorld(hw + 0.12, hd + 0.12);
    solid(Math.min(wx0, wx1), Math.max(wx0, wx1), Math.min(wz0, wz1), Math.max(wz0, wz1), slabTop);

    // Acesso a laje: padrao por indice (D = direita, E = esquerda, rampa nos fundos).
    const pattern = (['R', 'ramp', 'L', 'R'] as const)[opts.index % 4]!;
    const stairSide = pattern === 'R' ? 1 : pattern === 'L' ? -1 : 0;
    const steps = Math.round(slabTop / STEP_RISE);
    const px0 = -hw - 0.1;
    const px1 = hw + 0.1;
    const pz0 = -hd - 0.1;
    const pz1 = hd + 0.1;
    const t = 0.15;
    const ph = slabTop + 0.9;
    const wallColor = body.clone().lerp(trim, 0.45);

    let openLo = 0;
    let openHi = 0;
    if (stairSide !== 0) {
      const zc = hd - (steps - 0.5) * STEP_RUN;
      openLo = zc - 0.75;
      openHi = zc + 0.75;
      for (let i = 1; i <= steps; i++) {
        const zA = hd - i * STEP_RUN;
        const zB = hd - (i - 1) * STEP_RUN;
        const xa = stairSide === 1 ? hw : -hw - 1.12;
        const xb = stairSide === 1 ? hw + 1.12 : -hw;
        f.box('concrete', xa, 0, zA, xb, i * STEP_RISE, zB, concreteTint, true, 0.5);
      }
    }
    let rampOpenLo = 0;
    let rampOpenHi = 0;
    if (pattern === 'ramp') {
      const rampLen = slabTop / Math.tan((20 * Math.PI) / 180);
      const rx = -1.0;
      const rw = 1.4;
      rampOpenLo = rx - rw / 2 - 0.15;
      rampOpenHi = rx + rw / 2 + 0.15;
      const [sx, sz] = f.toWorld(rx, -hd - 0.12 - rampLen / 2);
      const [dx, dz] = f.dirToWorld(0, 1);
      ramps.push({ cx: sx, cz: sz, dirX: dx, dirZ: dz, length: rampLen, width: rw, baseY: 0, topY: slabTop });
      const slope = Math.atan2(slabTop, rampLen);
      const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dz, dx));
      const qTilt = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), slope);
      const quat = qYaw.multiply(qTilt);
      const len = Math.hypot(rampLen, slabTop);
      batch.addBoxTransform('concrete', new Vector3(sx, slabTop / 2 - 0.075, sz), quat, len, 0.15, rw, concreteTint, 0.5);
      for (const side of [-1, 1]) {
        const [kx, kz] = f.toWorld(rx + side * (rw / 2 + 0.05), -hd - 0.12 - rampLen / 2);
        batch.addBoxTransform('concrete', new Vector3(kx, slabTop / 2 + 0.05, kz), quat, len, 0.12, 0.1, wallColor, 0.5);
      }
    }

    // Platibanda (parapeito) com aberturas nos acessos.
    f.box('plaster', px0, slabTop, pz1 - t, px1, ph, pz1, wallColor, true, 0.4);
    if (pattern === 'ramp') {
      f.box('plaster', px0, slabTop, pz0, rampOpenLo, ph, pz0 + t, wallColor, true, 0.4);
      f.box('plaster', rampOpenHi, slabTop, pz0, px1, ph, pz0 + t, wallColor, true, 0.4);
    } else {
      f.box('plaster', px0, slabTop, pz0, px1, ph, pz0 + t, wallColor, true, 0.4);
    }
    for (const side of [-1, 1] as const) {
      const xa = side === -1 ? px0 : px1 - t;
      const xb = side === -1 ? px0 + t : px1;
      if (side === stairSide) {
        f.box('plaster', xa, slabTop, pz0 + t, xb, ph, openLo, wallColor, true, 0.4);
        f.box('plaster', xa, slabTop, openHi, xb, ph, pz1 - t, wallColor, true, 0.4);
      } else {
        f.box('plaster', xa, slabTop, pz0 + t, xb, ph, pz1 - t, wallColor, true, 0.4);
      }
    }

    // Caixa d'agua azul de polietileno no canto traseiro.
    const tankX = stairSide === 1 ? -hw + 1.2 : hw - 1.2;
    const [tx, tz] = f.toWorld(tankX, -hd + 1.3);
    const tankGeo = new CylinderGeometry(0.62, 0.66, 1.15, 20);
    batch.add('tank', tankGeo, new Matrix4().makeTranslation(tx, slabTop + 0.575, tz), tankColor);
    tankGeo.dispose();
    for (const yy of [0.3, 0.62, 0.92]) {
      const ring = new CylinderGeometry(0.665, 0.665, 0.04, 20);
      batch.add('tank', ring, new Matrix4().makeTranslation(tx, slabTop + yy, tz), tankColor.clone().multiplyScalar(0.8));
      ring.dispose();
    }
    const lid = new CylinderGeometry(0.26, 0.58, 0.14, 20);
    batch.add('tank', lid, new Matrix4().makeTranslation(tx, slabTop + 1.22, tz), tankColor.clone().multiplyScalar(1.12));
    lid.dispose();
    solid(tx - 0.66, tx + 0.66, tz - 0.66, tz + 0.66, slabTop + 1.3);

    // Fachada: porta, janelas com moldura, peitoril e grade.
    const doorX = opts.shop ? 2.6 : 0;
    const doorColor = new Color([0x7b3f1d, 0x2f5d8a, 0x3c7d4a, 0x8a2f2f][opts.index % 4]!);
    if (!opts.shop) {
      f.box('paint', doorX - 0.7, 0, hd, doorX + 0.7, 2.25, hd + 0.05, trim, false, 1);
      f.box('paint', doorX - 0.58, 0, hd + 0.05, doorX + 0.58, 2.15, hd + 0.09, doorColor, false, 1);
      f.box('metal', doorX + 0.38, 1.0, hd + 0.09, doorX + 0.46, 1.1, hd + 0.14, 0xc9c9c9, false, 1);
    }
    const windows: Array<[number, number, number, number]> = opts.shop
      ? [[-2.4, 0.55, 3.0, 1.5]]
      : [[-w * 0.28, 1.0, 1.3, 1.1], [w * 0.28, 1.0, 1.3, 1.1]];
    for (const [wxc, wy, ww, wh] of windows) {
      if (!opts.shop && Math.abs(wxc - doorX) < 1.6) continue;
      f.box('paint', wxc - ww / 2 - 0.08, wy - 0.08, hd, wxc + ww / 2 + 0.08, wy + wh + 0.08, hd + 0.05, trim, false, 1);
      const lit = rand() < 0.4 || opts.shop;
      f.box(glassKeys[lit ? 1 : 0], wxc - ww / 2, wy, hd + 0.05, wxc + ww / 2, wy + wh, hd + 0.07, 0xffffff, false, 1);
      f.box('paint', wxc - ww / 2 - 0.12, wy - 0.16, hd, wxc + ww / 2 + 0.12, wy - 0.08, hd + 0.13, trim, false, 1);
      const bars = Math.max(3, Math.round(ww / 0.3));
      for (let b = 0; b <= bars; b++) {
        const bx = wxc - ww / 2 + (ww * b) / bars;
        f.box('metal', bx - 0.012, wy, hd + 0.08, bx + 0.012, wy + wh, hd + 0.1, 0xe4e4e4, false, 1);
      }
    }

    // Muro frontal chapiscado com portao aberto (metade das casas).
    if (!opts.shop && opts.index % 2 === 0) {
      const wz = hd + 0.62;
      const wallH = 1.45;
      const wc = body.clone().lerp(new Color(0xffffff), 0.25);
      f.box('plaster', -hw, 0, wz, doorX - 0.75, wallH, wz + 0.2, wc, true, 0.4);
      f.box('plaster', doorX + 0.75, 0, wz, hw, wallH, wz + 0.2, wc, true, 0.4);
      f.box('plaster', doorX - 0.9, 0, wz - 0.03, doorX - 0.75, 1.75, wz + 0.23, trim, true, 0.4);
      f.box('plaster', doorX + 0.75, 0, wz - 0.03, doorX + 0.9, 1.75, wz + 0.23, trim, true, 0.4);
    }
  }

  function addShopDetails(f: Frame, w: number, d: number, slabTop: number): void {
    const hd = d / 2;
    const [sx, sz] = f.toWorld(0, hd + 0.06);
    const sign = new Mesh(new PlaneGeometry(6.9, 1.2), signMat);
    sign.position.set(sx, 3.12, sz);
    sign.rotation.y = f.rot === 0 ? 0 : f.rot === 1 ? Math.PI / 2 : f.rot === 2 ? Math.PI : -Math.PI / 2;
    sign.castShadow = false;
    root.add(sign);
    // Porta de enrolar semi-aberta sobre o interior escuro da loja.
    f.box('paint', 1.3, 0, hd, 3.9, 2.45, hd + 0.05, 0xf5f3ec, false, 1);
    f.box('glass', 1.45, 0, hd + 0.05, 3.75, 2.25, hd + 0.07, 0xffffff, false, 1);
    const [rx, rz] = f.toWorld(2.6, hd + 0.09);
    const shutter = new Mesh(new PlaneGeometry(2.3, 0.95), shutterMat);
    shutter.position.set(rx, 1.775, rz);
    shutter.rotation.y = sign.rotation.y;
    root.add(shutter);
    // Pipas penduradas num varal na fachada.
    const diamond = new Shape();
    diamond.moveTo(0, 0.32);
    diamond.lineTo(0.22, 0);
    diamond.lineTo(0, -0.32);
    diamond.lineTo(-0.22, 0);
    diamond.closePath();
    const diamondGeo = new ShapeGeometry(diamond);
    const colors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xab47bc, 0xff7043, 0x26c6da];
    for (let i = 0; i < 9; i++) {
      const lx = -3.6 + i * 0.9;
      const [kx, kz] = f.toWorld(lx, hd + 0.28 + (i % 2) * 0.05);
      const tilt = (rand() - 0.5) * 0.5;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sign.rotation.y).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tilt));
      batch.add('kiteDeco', diamondGeo, new Matrix4().compose(new Vector3(kx, 0.85 + (i % 3) * 0.28, kz), q, new Vector3(1, 1, 1)), colors[i % colors.length]!);
    }
    diamondGeo.dispose();
    // Toldo de lona.
    f.box('paint', 1.2, 2.45, hd, 4.0, 2.55, hd + 0.9, 0xd7261e, false, 1);
    void w;
    void slabTop;
  }

  let houseIndex = 0;
  const addRow = (cx: number, cz: number, rot: 0 | 1 | 2 | 3, shop = false): void => {
    const f = new Frame(batch, boxes, cx, cz, rot);
    const slabTop = shop ? 4.0 : [3.0, 3.2, 3.4][Math.floor(rand() * 3)]!;
    addHouse(f, 10, 9, { index: houseIndex, slabTop, shop });
    if (shop) addShopDetails(f, 10, 9, slabTop);
    houseIndex++;
  };
  for (let i = 0; i < 10; i++) addRow(-26 + 12 * i, -12, 0, i === 0);
  for (let i = 0; i < 10; i++) addRow(-26 + 12 * i, 12, 2);
  for (let k = 0; k < 7; k++) {
    addRow(-53, -90 + 12 * k, 1);
    addRow(-53, 18 + 12 * k, 1);
  }
  for (let k = 0; k < 6; k++) {
    addRow(-28, -90 + 12 * k, 3);
    addRow(-28, 30 + 12 * k, 3);
  }

  // ---------- Postes de energia e cabos catenarios ----------
  const POLE_H = 9;
  const cableSegments = 16;
  const pushCable = (a: Vector3, b: Vector3, sag: number): void => {
    const pts = catenaryPoints(a, b, sag, cableSegments);
    const geo = tubeAlong(pts, 0.014, 5);
    batch.add('cable', geo, new Matrix4(), 0x141414);
    geo.dispose();
    wires.push(...polylineToSegments(pts, 0.014));
  };
  const addPole = (x: number, z: number, alongX: boolean, transformer: boolean): void => {
    const geo = new CylinderGeometry(0.1, 0.15, POLE_H, 9);
    batch.add('wood', geo, new Matrix4().makeTranslation(x, POLE_H / 2 + 0.15, z), 0xffffff);
    geo.dispose();
    if (alongX) batch.addBox('wood', x, 8.4, z, 0.1, 0.1, 1.9, 0xffffff, 0, 1);
    else batch.addBox('wood', x, 8.4, z, 1.9, 0.1, 0.1, 0xffffff, 0, 1);
    if (transformer) {
      const tg = new CylinderGeometry(0.28, 0.28, 0.85, 12);
      batch.add('metal', tg, new Matrix4().makeTranslation(x + (alongX ? 0 : 0.5), 7.3, z + (alongX ? 0.5 : 0)), 0x8a8f94);
      tg.dispose();
    }
    solid(x - 0.2, x + 0.2, z - 0.2, z + 0.2, POLE_H);
  };
  const poleXs = [-30, -10, 10, 30, 50, 70, 90];
  for (const side of [-1, 1] as const) {
    const pz = side * 5.9;
    poleXs.forEach((x, i) => addPole(x + (side === 1 ? 10 : 0), pz, true, (i + (side === 1 ? 1 : 0)) % 3 === 0));
  }
  for (let i = 0; i < poleXs.length - 1; i++) {
    for (const side of [-1, 1] as const) {
      const pz = side * 5.9;
      const xa = poleXs[i]! + (side === 1 ? 10 : 0);
      const xb = poleXs[i + 1]! + (side === 1 ? 10 : 0);
      for (const [dz, hy] of [[-0.7, 8.4], [0.7, 8.4], [0, 7.7]] as const) {
        pushCable(new Vector3(xa, hy, pz + dz), new Vector3(xb, hy, pz + dz), 0.55);
      }
    }
    // Cabos cruzando a rua (norte para sul), entre postes de lados opostos.
    for (const dx of [-0.6, 0.6]) {
      pushCable(new Vector3(poleXs[i]! + dx, 7.4, -5.9), new Vector3(poleXs[i]! + 10 + dx, 7.4, 5.9), 0.45);
    }
  }
  // Rua B: postes nas duas calcadas e cabos que cruzam a rua.
  const bZs = [-80, -60, -40, -20, 20, 40, 60, 80];
  for (const z of bZs) {
    addPole(-45.4, z, false, Math.abs(z) % 40 === 0);
    addPole(-34.6, z, false, false);
    for (const dz of [-0.5, 0.5]) {
      pushCable(new Vector3(-45.4, 7.1, z + dz), new Vector3(-34.6, 7.1, z + dz), 0.4);
    }
  }
  for (let i = 0; i < bZs.length - 1; i++) {
    if (bZs[i]! < 0 && bZs[i + 1]! > 0) continue;
    for (const xs of [-45.4, -34.6]) {
      for (const dx of [-0.7, 0.7]) {
        pushCable(new Vector3(xs + dx, 8.4, bZs[i]!), new Vector3(xs + dx, 8.4, bZs[i + 1]!), 0.5);
      }
    }
  }

  // ---------- Postes de rua (iluminacao publica) ----------
  const lights: MapLights[] = [];
  const halos: Sprite[] = [];
  const haloTex = radialGlowTexture(128, 2.0);
  const lampSpots: Array<[number, number, number, boolean]> = [
    [-15, 5.6, -1, true], [15, 5.6, -1, true], [45, 5.6, -1, false], [75, 5.6, -1, false],
    [0, -5.6, 1, true], [30, -5.6, 1, true], [60, -5.6, 1, false], [90, -5.6, 1, false],
    [20, -29, 0, true], [76, -29, 0, true], [20, -71, 0, true], [76, -71, 0, true],
  ];
  for (const [lx, lz, arm, real] of lampSpots) {
    const pole = new CylinderGeometry(0.06, 0.09, 5.6, 8);
    batch.add('metal', pole, new Matrix4().makeTranslation(lx, 2.9, lz), 0x4b5258);
    pole.dispose();
    const headZ = lz + arm * 0.9;
    batch.addBox('metal', lx, 5.65, lz + arm * 0.45, 0.08, 0.08, Math.abs(arm) * 0.95 + 0.1, 0x4b5258, 0, 1);
    batch.addBox('lamp', lx, 5.55, headZ, 0.55, 0.14, 0.32, 0xffffff, 0, 1);
    solid(lx - 0.15, lx + 0.15, lz - 0.15, lz + 0.15, 5.6);
    const halo = new Sprite(new SpriteMaterial({ map: haloTex, color: 0xffc66e, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false }));
    halo.scale.setScalar(4.2);
    halo.position.set(lx, 5.45, headZ);
    root.add(halo);
    halos.push(halo);
    if (real) {
      const light = new PointLight(0xffc66e, 0, 34, 2);
      light.position.set(lx, 5.3, headZ);
      root.add(light);
      lights.push({ point: light, base: 160 });
    }
  }

  // ---------- Campinho, vegetacao e muros ----------
  const goalColor = new Color(0xf4f4f4);
  for (const gx of [21, 75]) {
    for (const gz of [-53.65, -46.35]) {
      const post = new CylinderGeometry(0.07, 0.07, 2.44, 8);
      batch.add('metal', post, new Matrix4().makeTranslation(gx, 1.22, gz), goalColor);
      post.dispose();
    }
    batch.addBox('metal', gx, 2.44, -50, 0.14, 0.14, 7.5, goalColor, 0, 1);
  }
  const wallColor = new Color(0xd8d0c0);
  batch.addBoxMinMax('plaster', 15.8, 0, -76, 16.0, 1.7, -26, wallColor, 0.35);
  solid(15.8, 16.0, -76, -26, 1.7);
  batch.addBoxMinMax('plaster', 15.8, 0, -76, 82, 1.7, -75.8, wallColor, 0.35);
  solid(15.8, 82, -76, -75.8, 1.7);

  const placeTree = (x: number, z: number, palm: boolean): void => {
    if (palm) addPalm(batch, x, 0, z, 0.9 + rand() * 0.35, rand);
    else addTree(batch, x, 0, z, 0.85 + rand() * 0.55, rand);
    solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 4);
  };
  for (let x = 24; x < 82; x += 7 + rand() * 3) {
    placeTree(x, -25.5 + rand(), rand() < 0.3);
  }
  for (let x = 24; x < 80; x += 8 + rand() * 4) {
    placeTree(x, -78.5 - rand() * 1.5, rand() < 0.2);
  }
  for (let z = -72; z < -30; z += 9 + rand() * 4) {
    placeTree(84 + rand() * 3, z, rand() < 0.3);
  }
  for (const [tx, tz] of [[8, 8.2], [-8, -8.4], [38, 8.3], [62, -8.3], [-62, 30], [-62, -30], [20, 20], [60, 22]] as const) {
    placeTree(tx, tz, false);
  }

  // ---------- Construcao final ----------
  batch.build(materials, root);
  for (const m of root.children) {
    if (m instanceof Mesh && (m.name === 'batch:glass' || m.name === 'batch:glassLit' || m.name === 'batch:cable' || m.name === 'batch:kiteDeco')) {
      m.castShadow = m.name !== 'batch:glass' && m.name !== 'batch:glassLit';
    }
  }

  const walk = new WalkWorld({
    terrainHeight: (x, z) => grid.sample(x, z),
    boxes,
    ramps,
    bounds: { minX: -96, maxX: 96, minZ: -96, maxZ: 96 },
  });

  const map: GameMap = {
    id: 'bairro',
    name: 'Bairro',
    root,
    spawn: { x: 26, z: -50, yaw: -Math.PI / 2 },
    wind: { baseSpeed: 6.7, dirX: 0.99, dirZ: -0.14, turbulence: 1.0, verticalGusts: 0.6 },
    walk,
    wires,
    update: () => undefined,
    setNight: (f: number) => {
      lampMat.emissiveIntensity = f * 4;
      glassLit.emissiveIntensity = f * 1.7;
      signMat.emissiveIntensity = f * 1.25;
      for (const l of lights) l.point.intensity = l.base * f;
      for (const h of halos) (h.material as SpriteMaterial).opacity = f * 0.9;
    },
    dispose: () => {
      disposeObject3D(root);
      for (const m of Object.values(materials)) m.dispose();
      signTex.dispose();
      shutterTex.dispose();
      haloTex.dispose();
    },
  };
  return map;
}
