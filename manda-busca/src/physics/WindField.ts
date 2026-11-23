/**
 * Campo de vento 3D dinamico: vetor base configuravel (padrao 6,7 m/s) somado a
 * turbulencia Simplex 3D que varia com a altitude e com o tempo. As rajadas sao
 * "congeladas" e arrastadas pelo proprio vento medio, como em ar real. Tudo e
 * funcao deterministica de (x, y, z, t): mesma entrada, mesma saida.
 */
import { Vector3 } from 'three';
import { SimplexNoise3D, smoothstep } from '../core/noise';
import type { WindProfile } from '../world/GameMap';

export type WindFn = (x: number, y: number, z: number, t: number, out: Vector3) => Vector3;

export const DEFAULT_WIND_SPEED = 6.7;

export class WindField {
  private readonly noise: SimplexNoise3D;
  private dirX: number;
  private dirZ: number;
  /** Velocidade media base (m/s), ajustavel em tempo de execucao. */
  baseSpeed: number;
  turbulence: number;
  verticalGusts: number;

  constructor(profile?: Partial<WindProfile>, seed = 17) {
    this.noise = new SimplexNoise3D(seed);
    this.baseSpeed = profile?.baseSpeed ?? DEFAULT_WIND_SPEED;
    this.turbulence = profile?.turbulence ?? 1;
    this.verticalGusts = profile?.verticalGusts ?? 0.5;
    this.dirX = profile?.dirX ?? 1;
    this.dirZ = profile?.dirZ ?? 0;
    this.normalizeDir();
  }

  /** Reconfigura a partir do perfil de um mapa. */
  setProfile(profile: WindProfile): void {
    this.baseSpeed = profile.baseSpeed;
    this.turbulence = profile.turbulence;
    this.verticalGusts = profile.verticalGusts;
    this.dirX = profile.dirX;
    this.dirZ = profile.dirZ;
    this.normalizeDir();
  }

  private normalizeDir(): void {
    const len = Math.hypot(this.dirX, this.dirZ) || 1;
    this.dirX /= len;
    this.dirZ /= len;
  }

  /** Direcao horizontal para onde o vento sopra (vetor unitario). */
  get direction(): { x: number; z: number } {
    return { x: this.dirX, z: this.dirZ };
  }

  /** Velocidade media exibida no HUD (m/s). */
  get meanSpeed(): number {
    return this.baseSpeed;
  }

  /** Vento (m/s) no ponto (x, y, z) no instante t (s). */
  sample = (x: number, y: number, z: number, t: number, out: Vector3): Vector3 => {
    const ay = Math.max(y, 0);
    // Cisalhamento: o vento aumenta com a altura.
    const shear = 0.78 + 0.45 * smoothstep(0, 90, ay);
    const adv = this.baseSpeed * t;
    const gx = (x - this.dirX * adv) * 0.018;
    const gz = (z - this.dirZ * adv) * 0.018;
    const gy = ay * 0.02;
    const gust = this.noise.fbm3(gx, gy, gz, 3) * this.turbulence * 0.3 * this.baseSpeed;
    const jitter = this.noise.noise3(gx * 0.7 + 31.4, gy * 0.6, gz * 0.7 - 12.9) * this.turbulence * 0.2;
    const c = Math.cos(jitter);
    const s = Math.sin(jitter);
    const speed = this.baseSpeed * shear + gust;
    const dx = this.dirX * c - this.dirZ * s;
    const dz = this.dirX * s + this.dirZ * c;
    const vertical = this.noise.noise3(gx * 1.3 + 11, ay * 0.015, gz * 1.3 - 7) * this.verticalGusts;
    return out.set(dx * speed, vertical, dz * speed);
  };
}
