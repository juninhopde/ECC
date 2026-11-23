/**
 * Vegetacao e pedras procedurais. Tudo vai para um GeometryBatch (poucas malhas).
 * Chaves de material: bark, leaf, frond, pine, rock, umbrella, pole.
 */
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise3D } from '../core/noise';
import type { GeometryBatch } from './Batch';

const UP = new Vector3(0, 1, 0);
const noise = new SimplexNoise3D(2024);

function matrixFrom(pos: Vector3, quat: Quaternion, scale: Vector3): Matrix4 {
  return new Matrix4().compose(pos, quat, scale);
}

function yawQuat(yaw: number): Quaternion {
  return new Quaternion().setFromAxisAngle(UP, yaw);
}

/** Desloca vertices por ruido 3D (continuo entre vertices duplicados). */
export function displaceByNoise(geo: BufferGeometry, amp: number, freq: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const d = noise.noise3(v.x * freq, v.y * freq, v.z * freq) * amp;
    v.multiplyScalar(1 + d / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

let blobGeo: BufferGeometry | null = null;
let rockGeo: BufferGeometry | null = null;

function getBlob(): BufferGeometry {
  if (!blobGeo) {
    // Funde vertices para normais suaves (copa organica em vez de facetas planas).
    const base = new IcosahedronGeometry(1, 3);
    base.deleteAttribute('normal');
    base.deleteAttribute('uv');
    blobGeo = displaceByNoise(mergeVertices(base), 0.34, 1.5);
  }
  return blobGeo;
}

function getRock(): BufferGeometry {
  if (!rockGeo) rockGeo = displaceByNoise(new IcosahedronGeometry(1, 2), 0.34, 1.1);
  return rockGeo;
}

function jitter(base: number, rand: () => number, amount: number): Color {
  const c = new Color(base);
  const k = 1 + (rand() - 0.5) * amount;
  c.multiplyScalar(k);
  return c;
}

/** Arvore de copa arredondada (mangueira, ficus). */
export function addTree(batch: GeometryBatch, x: number, y: number, z: number, s: number, rand: () => number): void {
  const trunk = new CylinderGeometry(0.11 * s, 0.18 * s, 2.5 * s, 7);
  batch.add('bark', trunk, matrixFrom(new Vector3(x, y + 1.25 * s, z), yawQuat(rand() * 6.28), new Vector3(1, 1, 1)), jitter(0x6b4a2f, rand, 0.3));
  trunk.dispose();
  const blobs = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < blobs; i++) {
    const ox = (rand() - 0.5) * 1.5 * s;
    const oz = (rand() - 0.5) * 1.5 * s;
    const oy = (2.7 + rand() * 1.4) * s;
    const r = (1.1 + rand() * 0.7) * s;
    batch.add(
      'leaf',
      getBlob(),
      matrixFrom(new Vector3(x + ox, y + oy, z + oz), yawQuat(rand() * 6.28), new Vector3(r, r * 0.82, r)),
      jitter(0x2c5f22, rand, 0.5),
    );
  }
}

/** Pinheiro em cones empilhados (montanha). */
export function addPine(batch: GeometryBatch, x: number, y: number, z: number, s: number, rand: () => number): void {
  const trunk = new CylinderGeometry(0.12 * s, 0.2 * s, 1.8 * s, 6);
  batch.add('bark', trunk, matrixFrom(new Vector3(x, y + 0.9 * s, z), yawQuat(0), new Vector3(1, 1, 1)), jitter(0x5a3d28, rand, 0.25));
  trunk.dispose();
  for (let k = 0; k < 4; k++) {
    const cone = new ConeGeometry((1.6 - k * 0.32) * s, 1.9 * s, 9);
    batch.add(
      'pine',
      cone,
      matrixFrom(new Vector3(x, y + (2.1 + k * 1.15) * s, z), yawQuat(rand() * 6.28), new Vector3(1, 1, 1)),
      jitter(0x1f4d2a, rand, 0.4),
    );
    cone.dispose();
  }
}

function makeFrondGeometry(): BufferGeometry {
  const g = new PlaneGeometry(1, 3.4, 2, 10);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const w = pos.getX(i);
    const l = pos.getY(i) + 1.7; // 0..3.4 ao longo da folha
    const taper = 1 - (l / 3.4) * 0.85;
    const droop = l * l * 0.095;
    // comprimento ao longo de +x, largura ao longo de z, queda em -y
    pos.setXYZ(i, l, -droop + Math.abs(w) * 0.12, w * 0.9 * taper);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

let frondGeo: BufferGeometry | null = null;

/** Coqueiro com tronco curvo e folhas arqueadas. */
export function addPalm(batch: GeometryBatch, x: number, y: number, z: number, s: number, rand: () => number): void {
  const yaw = rand() * Math.PI * 2;
  const bend = (0.5 + rand() * 0.9) * s;
  const height = (5.6 + rand() * 1.8) * s;
  const segs = 9;
  const dirBend = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const at = (t: number): Vector3 => new Vector3(x, y, z).addScaledVector(dirBend, bend * t * t).addScaledVector(UP, height * t);
  let top = at(1);
  for (let i = 0; i < segs; i++) {
    const p0 = at(i / segs);
    const p1 = at((i + 1) / segs);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const dir = p1.clone().sub(p0);
    const len = dir.length();
    dir.normalize();
    const r1 = (0.17 - (i / segs) * 0.07) * s;
    const geo = new CylinderGeometry(r1 * 0.92, r1, len * 1.02, 7);
    const q = new Quaternion().setFromUnitVectors(UP, dir);
    batch.add('bark', geo, matrixFrom(mid, q, new Vector3(1, 1, 1)), jitter(0x8b7355, rand, 0.2));
    geo.dispose();
  }
  top = at(1);
  if (!frondGeo) frondGeo = makeFrondGeometry();
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rand() * 0.3;
    const lift = 0.1 + rand() * 0.35;
    const q = yawQuat(-a).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), lift));
    batch.add('frond', frondGeo, matrixFrom(top.clone().addScaledVector(UP, 0.1 * s), q, new Vector3(s, s, s)), jitter(0x2f6a26, rand, 0.4));
  }
}

/** Pedra/rocha facetada e assentada no chao. */
export function addRock(batch: GeometryBatch, x: number, y: number, z: number, size: number, rand: () => number): void {
  const sx = size * (0.8 + rand() * 0.6);
  const sy = size * (0.5 + rand() * 0.5);
  const sz = size * (0.8 + rand() * 0.6);
  const q = yawQuat(rand() * 6.28);
  batch.add('rock', getRock(), matrixFrom(new Vector3(x, y + sy * 0.35, z), q, new Vector3(sx, sy, sz)), jitter(0x8a8278, rand, 0.4));
}

/** Guarda-sol de praia com gomos alternados. */
export function addUmbrella(batch: GeometryBatch, x: number, y: number, z: number, c1: number, c2: number, tilt: number): void {
  const pole = new CylinderGeometry(0.025, 0.025, 2.4, 6);
  const tiltQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tilt);
  const poleCenter = new Vector3(0, 1.2, 0).applyQuaternion(tiltQ).add(new Vector3(x, y, z));
  batch.add('pole', pole, matrixFrom(poleCenter, tiltQ, new Vector3(1, 1, 1)), 0xdddddd);
  pole.dispose();
  const topPos = new Vector3(0, 2.4, 0).applyQuaternion(tiltQ).add(new Vector3(x, y, z));
  const wedges = 8;
  for (let k = 0; k < wedges; k++) {
    const g = new ConeGeometry(1.2, 0.42, 1, 1, true, (k / wedges) * Math.PI * 2, (Math.PI * 2) / wedges);
    batch.add('umbrella', g, matrixFrom(topPos, tiltQ, new Vector3(1, 1, 1)), k % 2 === 0 ? c1 : c2);
    g.dispose();
  }
}

/** Arbusto baixo para a montanha. */
export function addShrub(batch: GeometryBatch, x: number, y: number, z: number, s: number, rand: () => number): void {
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = s * (0.45 + rand() * 0.35);
    batch.add(
      'leaf',
      getBlob(),
      matrixFrom(new Vector3(x + (rand() - 0.5) * s, y + r * 0.55, z + (rand() - 0.5) * s), yawQuat(rand() * 6.28), new Vector3(r, r * 0.7, r)),
      jitter(0x3f5424, rand, 0.5),
    );
  }
}

export function disposeVegetationCaches(): void {
  blobGeo?.dispose();
  rockGeo?.dispose();
  frondGeo?.dispose();
  blobGeo = null;
  rockGeo = null;
  frondGeo = null;
}

/** Utilitario para tubos finos a partir de uma polilinha (cabos, fios). */
export function tubeAlong(points: Vector3[], radius: number, radial = 5): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const tangent = next.clone().sub(prev).normalize();
    let side = new Vector3().crossVectors(tangent, up);
    if (side.lengthSq() < 1e-6) side = new Vector3(1, 0, 0);
    side.normalize();
    const binormal = new Vector3().crossVectors(side, tangent).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      positions.push(p.x + n.x * radius, p.y + n.y * radius, p.z + n.z * radius);
      normals.push(n.x, n.y, n.z);
      uvs.push(i / (points.length - 1), j / radial);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}
