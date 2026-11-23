import { PerspectiveCamera, Vector3 } from 'three';
import { EYE_HEIGHT, WalkWorld, createPlayerBody, type PlayerBody } from '../world/Collision';
import type { InputManager } from './InputManager';

export const WALK_SPEED = 3.4;

/** Movimento WASD em primeira pessoa com colisao e interpolacao para o render. */
export class PlayerController {
  body: PlayerBody;
  /** Velocidade horizontal real (m/s), suavizada, usada para o balanco das maos. */
  speed = 0;
  private walk: WalkWorld;
  private readonly prev = new Vector3();
  private readonly curr = new Vector3();

  constructor(walk: WalkWorld, x: number, z: number) {
    this.walk = walk;
    this.body = createPlayerBody(x, z, walk.terrainAt(x, z));
    this.settle();
    this.syncPositions(true);
  }

  teleport(walk: WalkWorld, x: number, z: number): void {
    this.walk = walk;
    this.body = createPlayerBody(x, z, walk.surfaceHeightAt(x, z, walk.terrainAt(x, z) + 0.6));
    this.settle();
    this.syncPositions(true);
    this.speed = 0;
  }

  private settle(): void {
    for (let i = 0; i < 120; i++) this.walk.move(this.body, 0, 0, 1 / 60);
  }

  private syncPositions(both: boolean): void {
    if (both) this.prev.set(this.body.x, this.body.y + EYE_HEIGHT, this.body.z);
    else this.prev.copy(this.curr);
    this.curr.set(this.body.x, this.body.y + EYE_HEIGHT, this.body.z);
    if (both) this.prev.copy(this.curr);
  }

  /** Um passo fixo de simulacao. `yaw` em radianos (rotacao em Y da camera). */
  fixedUpdate(dt: number, input: InputManager, yaw: number): void {
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    let dx = 0;
    let dz = 0;
    if (f !== 0 || r !== 0) {
      const len = Math.hypot(f, r);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // frente = (-sin, -cos); direita = (cos, -sin)
      dx = ((-sin * f + cos * r) / len) * WALK_SPEED * dt;
      dz = ((-cos * f - sin * r) / len) * WALK_SPEED * dt;
    }
    const bx = this.body.x;
    const bz = this.body.z;
    this.walk.move(this.body, dx, dz, dt);
    const moved = Math.hypot(this.body.x - bx, this.body.z - bz) / dt;
    this.speed += (moved - this.speed) * Math.min(1, dt * 10);
    this.syncPositions(false);
  }

  /** Posiciona a camera interpolando entre os dois ultimos passos. */
  applyToCamera(camera: PerspectiveCamera, alpha: number): void {
    camera.position.lerpVectors(this.prev, this.curr, alpha);
  }
}
