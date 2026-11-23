/**
 * Mundo caminhavel: chao (terreno), caixas solidas (casas, muros, degraus),
 * rampas e limites. O jogador e um cilindro; degraus de ate STEP_HEIGHT sao
 * subidos automaticamente, paredes mais altas bloqueiam.
 */

export const PLAYER_RADIUS = 0.3;
export const STEP_HEIGHT = 0.5;
export const EYE_HEIGHT = 1.65;
export const GRAVITY = 9.81;

/** Caixa solida do chao ate `top`. Pode ser pisada se `top` estiver ao alcance do degrau. */
export interface SurfaceBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

/** Rampa retangular que sobe ao longo de (dirX, dirZ) (vetor unitario). */
export interface Ramp {
  cx: number;
  cz: number;
  dirX: number;
  dirZ: number;
  length: number;
  width: number;
  baseY: number;
  topY: number;
}

export interface WalkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WalkWorldConfig {
  terrainHeight: (x: number, z: number) => number;
  boxes: SurfaceBox[];
  ramps: Ramp[];
  bounds: WalkBounds;
  /** Bloqueio extra (por exemplo, agua profunda). */
  isBlocked?: (x: number, z: number) => boolean;
}

export interface PlayerBody {
  x: number;
  y: number;
  z: number;
  vy: number;
  onGround: boolean;
}

export function createPlayerBody(x: number, z: number, y = 0): PlayerBody {
  return { x, y, z, vy: 0, onGround: true };
}

export class WalkWorld {
  readonly boxes: SurfaceBox[];
  readonly ramps: Ramp[];
  readonly bounds: WalkBounds;
  private readonly terrainHeight: (x: number, z: number) => number;
  private readonly extraBlocked: ((x: number, z: number) => boolean) | undefined;

  constructor(config: WalkWorldConfig) {
    this.boxes = config.boxes;
    this.ramps = config.ramps;
    this.bounds = config.bounds;
    this.terrainHeight = config.terrainHeight;
    this.extraBlocked = config.isBlocked;
  }

  terrainAt(x: number, z: number): number {
    return this.terrainHeight(x, z);
  }

  /** Altura da rampa em (x, z) ou null se fora da pegada da rampa. */
  rampHeightAt(ramp: Ramp, x: number, z: number): number | null {
    const rx = x - ramp.cx;
    const rz = z - ramp.cz;
    const u = rx * ramp.dirX + rz * ramp.dirZ;
    const v = -rx * ramp.dirZ + rz * ramp.dirX;
    if (u < -ramp.length / 2 || u > ramp.length / 2 || Math.abs(v) > ramp.width / 2) return null;
    const t = (u + ramp.length / 2) / ramp.length;
    return ramp.baseY + (ramp.topY - ramp.baseY) * t;
  }

  /** Maior superficie em (x, z) que esteja em ou abaixo de `maxY` (terreno sempre conta). */
  surfaceHeightAt(x: number, z: number, maxY: number): number {
    let h = this.terrainHeight(x, z);
    for (const b of this.boxes) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.top <= maxY && b.top > h) h = b.top;
    }
    for (const r of this.ramps) {
      const rh = this.rampHeightAt(r, x, z);
      if (rh !== null && rh <= maxY && rh > h) h = rh;
    }
    return h;
  }

  private blockedAt(x: number, z: number, y: number, moveDist: number): boolean {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
    if (this.extraBlocked && this.extraBlocked(x, z)) return true;
    const slopeAllowance = Math.max(0.06, moveDist * 1.3);
    if (this.terrainHeight(x, z) - y > slopeAllowance) return true;
    const limit = y + STEP_HEIGHT;
    for (const box of this.boxes) {
      if (box.top <= limit) continue;
      const cx = x < box.minX ? box.minX : x > box.maxX ? box.maxX : x;
      const cz = z < box.minZ ? box.minZ : z > box.maxZ ? box.maxZ : z;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    for (const r of this.ramps) {
      const rh = this.rampHeightAt(r, x, z);
      if (rh !== null && rh > limit) return true;
    }
    return false;
  }

  /** Move o corpo por (dx, dz) deslizando nas paredes e aplica gravidade por dt. */
  move(body: PlayerBody, dx: number, dz: number, dt: number): void {
    const dist = Math.hypot(dx, dz);
    if (dist > 0) {
      const nx = body.x + dx;
      if (!this.blockedAt(nx, body.z, body.y, Math.abs(dx))) body.x = nx;
      const nz = body.z + dz;
      if (!this.blockedAt(body.x, nz, body.y, Math.abs(dz))) body.z = nz;
    }
    const ground = this.surfaceHeightAt(body.x, body.z, body.y + STEP_HEIGHT);
    if (body.onGround) {
      if (ground >= body.y || body.y - ground <= STEP_HEIGHT) {
        body.y = ground;
        body.vy = 0;
        return;
      }
      body.onGround = false;
    }
    body.vy -= GRAVITY * dt;
    body.y += body.vy * dt;
    if (body.y <= ground) {
      body.y = ground;
      body.vy = 0;
      body.onGround = true;
    }
  }
}
