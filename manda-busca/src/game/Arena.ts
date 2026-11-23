/**
 * Posicionamento dos pilotos. As pipas voam a favor do vento a partir da mao, entao pilotos lado
 * a lado na direcao transversal ao vento soltam pipas em "raias" paralelas, que e onde as linhas
 * se cruzam. Os deslocamentos sao medidos a partir do ponto central, positivos para a esquerda de
 * quem olha a favor do vento.
 */
import { Vector3 } from 'three';
import type { Point2 } from './types';

/**
 * Vetor transversal ao vento que aponta para a esquerda de quem olha a favor do vento:
 * esquerda = cima x frente = (dz, 0, -dx). Com vento em +x, a esquerda e -z.
 */
export function leftOf(windDir: Point2): Point2 {
  return { x: windDir.z, z: -windDir.x };
}

export interface AnchorProbe {
  canStand(x: number, z: number): boolean;
  groundAt(x: number, z: number): number;
}

export const HAND_HEIGHT = 1.3;

/** Posicao da mao a `offset` metros do centro, na direcao transversal; recua contra o vento se bloqueado. */
export function anchorAt(center: Point2, windDir: Point2, offset: number, probe: AnchorProbe): Vector3 {
  const left = leftOf(windDir);
  let x = center.x + left.x * offset;
  let z = center.z + left.z * offset;
  for (let back = 0; back <= 12 && !probe.canStand(x, z); back += 2) {
    x = center.x + left.x * offset - windDir.x * back;
    z = center.z + left.z * offset - windDir.z * back;
  }
  return new Vector3(x, probe.groundAt(x, z) + HAND_HEIGHT, z);
}

/** Deslocamentos 0, +s, -s, +2s, -2s... (alternando os lados do centro). */
export function alternatingOffsets(count: number, spacing: number, skipCenter = true): number[] {
  const out: number[] = [];
  let k = skipCenter ? 1 : 0;
  while (out.length < count) {
    if (k === 0) out.push(0);
    else {
      out.push(k * spacing);
      if (out.length < count) out.push(-k * spacing);
    }
    k++;
  }
  return out;
}

/** Yaw da camera para olhar a favor do vento (a camera olha para (-sin(yaw), 0, -cos(yaw))). */
export function yawDownwind(windDir: Point2): number {
  return Math.atan2(-windDir.x, -windDir.z);
}
