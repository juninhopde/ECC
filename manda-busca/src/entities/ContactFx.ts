/**
 * Faiscas e brilho no ponto do relo, mais rajadas de faiscas nos cortes.
 * Particulas aditivas em um unico Points; o brilho e um sprite por contato.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { mulberry32 } from '../core/noise';
import type { ReloContact } from '../physics/ReloSystem';
import { radialGlowTexture } from '../world/ProceduralTextures';

const MAX = 160;
const MAX_GLOWS = 4;

export class ContactFx {
  readonly group = new Group();
  private readonly positions = new Float32Array(MAX * 3);
  private readonly colors = new Float32Array(MAX * 3);
  private readonly velocity = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly points: Points;
  private readonly glows: Sprite[] = [];
  private readonly glowTex = radialGlowTexture(128, 2.4);
  private readonly rand = mulberry32(555);
  private cursor = 0;
  private emitCarry = 0;

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    for (let i = 0; i < MAX; i++) this.positions[i * 3 + 1] = -1000;
    this.points = new Points(
      geo,
      new PointsMaterial({
        size: 0.07, vertexColors: true, transparent: true, depthWrite: false,
        blending: AdditiveBlending, sizeAttenuation: true, fog: false, toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);
    for (let i = 0; i < MAX_GLOWS; i++) {
      const g = new Sprite(
        new SpriteMaterial({
          map: this.glowTex, color: 0xffa94d, transparent: true, opacity: 0, depthWrite: false,
          blending: AdditiveBlending, fog: false, toneMapped: false,
        }),
      );
      g.visible = false;
      this.glows.push(g);
      this.group.add(g);
    }
  }

  /** Solta `count` faiscas a partir de `point` (rajada de corte, engate, serrada). */
  burst(point: Vector3, count: number, speed = 4): void {
    for (let n = 0; n < count; n++) this.spawn(point, speed);
  }

  private spawn(point: Vector3, speed: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const r = this.rand;
    const a = r() * Math.PI * 2;
    const e = (r() - 0.3) * Math.PI * 0.8;
    const s = speed * (0.4 + r() * 0.9);
    this.positions[i * 3] = point.x + (r() - 0.5) * 0.04;
    this.positions[i * 3 + 1] = point.y + (r() - 0.5) * 0.04;
    this.positions[i * 3 + 2] = point.z + (r() - 0.5) * 0.04;
    this.velocity[i * 3] = Math.cos(a) * Math.cos(e) * s;
    this.velocity[i * 3 + 1] = Math.sin(e) * s + 1.2;
    this.velocity[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
    this.life[i] = this.maxLife[i] = 0.3 + r() * 0.45;
    const warm = r();
    this.colors[i * 3] = 1;
    this.colors[i * 3 + 1] = 0.55 + warm * 0.4;
    this.colors[i * 3 + 2] = 0.15 + warm * 0.35;
  }

  /** `power` (0..1) normaliza a intensidade das faiscas de cada contato ativo. */
  update(dt: number, contacts: Iterable<ReloContact>, powerOf: (c: ReloContact) => number, now: number): void {
    let glowIndex = 0;
    for (const c of contacts) {
      const p = Math.min(1, powerOf(c));
      this.emitCarry += dt * (30 + 160 * p);
      while (this.emitCarry >= 1) {
        this.emitCarry -= 1;
        this.spawn(c.point, 2 + 5 * p);
      }
      if (glowIndex < MAX_GLOWS) {
        const g = this.glows[glowIndex++]!;
        g.visible = true;
        g.position.copy(c.point);
        const flicker = 0.75 + 0.25 * Math.sin(now * 55) * Math.sin(now * 23);
        g.scale.setScalar(0.5 + 1.4 * p * flicker);
        (g.material as SpriteMaterial).opacity = 0.35 + 0.55 * p;
      }
    }
    for (let k = glowIndex; k < MAX_GLOWS; k++) {
      this.glows[k]!.visible = false;
    }
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.velocity[i * 3 + 1] = this.velocity[i * 3 + 1]! - 9.8 * 0.5 * dt;
      this.positions[i * 3] = this.positions[i * 3]! + this.velocity[i * 3]! * dt;
      this.positions[i * 3 + 1] = this.positions[i * 3 + 1]! + this.velocity[i * 3 + 1]! * dt;
      this.positions[i * 3 + 2] = this.positions[i * 3 + 2]! + this.velocity[i * 3 + 2]! * dt;
      const fade = this.life[i]! / this.maxLife[i]!;
      this.colors[i * 3] = fade;
      this.colors[i * 3 + 1] = Math.min(this.colors[i * 3 + 1]!, fade * 0.9);
      this.colors[i * 3 + 2] = Math.min(this.colors[i * 3 + 2]!, fade * 0.5);
    }
    (this.points.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
    for (const g of this.glows) (g.material as SpriteMaterial).dispose();
    this.glowTex.dispose();
  }
}
