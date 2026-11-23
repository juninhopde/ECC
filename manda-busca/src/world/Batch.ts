/**
 * Agrupa muitas geometrias pequenas em poucas malhas (uma por material),
 * mantendo cor por vertice. Reduz draw calls de cenarios com centenas de caixas.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = new Set(['position', 'normal', 'uv']);

/** Caixa com UV em escala de mundo: `texelsPerMeter` repeticoes de textura por metro. */
export function makeBoxGeometry(sx: number, sy: number, sz: number, texelsPerMeter: number, uvOffset = 0): BoxGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv');
  const dims: Array<[number, number]> = [
    [sz, sy], [sz, sy], // +x, -x
    [sx, sz], [sx, sz], // +y, -y
    [sx, sy], [sx, sy], // +z, -z
  ];
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face]!;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * du * texelsPerMeter + uvOffset, uv.getY(idx) * dv * texelsPerMeter + uvOffset * 0.7);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export class GeometryBatch {
  private readonly buckets = new Map<string, BufferGeometry[]>();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  /** Adiciona uma geometria ja pronta, transformada por `matrix` e tingida por `color`. */
  add(key: string, geometry: BufferGeometry, matrix: Matrix4, color: Color | number = 0xffffff): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!KEEP.has(name)) g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count;
      g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    const c = color instanceof Color ? color : new Color(color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.applyMatrix4(matrix);
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    list.push(g);
  }

  /** Caixa centrada em (cx, cy, cz), girada `rotY` radianos em torno de Y. */
  addBox(
    key: string,
    cx: number, cy: number, cz: number,
    sx: number, sy: number, sz: number,
    color: Color | number = 0xffffff,
    rotY = 0,
    texelsPerMeter = 0.5,
  ): void {
    const off = ((cx * 0.173 + cz * 0.311) % 1 + 1) % 1;
    const geo = makeBoxGeometry(sx, sy, sz, texelsPerMeter, off);
    this.tmpQuat.setFromAxisAngle(this.up, rotY);
    this.tmpMatrix.compose(new Vector3(cx, cy, cz), this.tmpQuat, new Vector3(1, 1, 1));
    this.add(key, geo, this.tmpMatrix, color);
    geo.dispose();
  }

  /** Caixa com orientacao arbitraria (quaternion), por exemplo rampas inclinadas. */
  addBoxTransform(
    key: string,
    center: Vector3,
    quat: Quaternion,
    sx: number, sy: number, sz: number,
    color: Color | number = 0xffffff,
    texelsPerMeter = 0.5,
  ): void {
    const geo = makeBoxGeometry(sx, sy, sz, texelsPerMeter, 0);
    this.tmpMatrix.compose(center, quat, new Vector3(1, 1, 1));
    this.add(key, geo, this.tmpMatrix, color);
    geo.dispose();
  }

  /** Caixa definida por cantos minimos e maximos. */
  addBoxMinMax(
    key: string,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    color: Color | number = 0xffffff,
    texelsPerMeter = 0.5,
  ): void {
    this.addBox(
      key,
      (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2,
      maxX - minX, maxY - minY, maxZ - minZ,
      color, 0, texelsPerMeter,
    );
  }

  /** Cria as malhas (uma por material) dentro de `parent`. */
  build(materials: Record<string, Material>, parent: Group, cast = true, receive = true): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [key, list] of this.buckets) {
      const material = materials[key];
      if (!material) throw new Error(`GeometryBatch: material ausente para "${key}"`);
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) throw new Error(`GeometryBatch: falha ao mesclar "${key}"`);
      const mesh = new Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.name = `batch:${key}`;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
