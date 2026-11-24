/**
 * Corpo rigido da pipa. Eixos locais: x = direita, y = nariz (espinha para cima),
 * z = normal da face, apontando para o jogador (a face leva o vento).
 *
 * Forcas: placa plana (sustentacao e arrasto derivam da forca normal e crescem
 * com area, densidade do ar, angulo de ataque e |V_rel|^2), gravidade, tracao da
 * linha no no do estirante (o torque nasce do braco ate o no) e arrasto da
 * rabiola. A rabiola e uma cadeia fisica de fitas presa na base: o arrasto dela
 * alinha o nariz contra o vento. Sem rabiola o torque estabilizador zera e a
 * pipa entra em giro continuo ("piao").
 *
 * Modelo de jogo: o ganho de trim (regulagem do estirante) e a estabilidade no
 * plano sao coeficientes calibrados, nao uma simulacao CFD.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { WindFn } from './WindField';

export const AIR_DENSITY = 1.2;
export const GRAVITY_ACC = 9.81;

export interface KiteSpec {
  id: string;
  name: string;
  /** Largura e altura da folha (m). */
  width: number;
  height: number;
  /** Area efetiva (m^2) e massa (kg). */
  area: number;
  mass: number;
  /** Coeficiente de forca normal a 90 graus e arrasto parasita. */
  cnMax: number;
  cd0: number;
  /** Deslocamento do centro de pressao ao longo de y (m). */
  cpY: number;
  /** Angulo de ataque de equilibrio da regulagem do estirante (rad) e rigidez de trim. */
  trimAlpha: number;
  pitchStiffness: number;
  /** Rigidez de guinada: gira a folha para encarar o vento (efeito biruta). */
  yawStiffness: number;
  /** No do estirante e pontos de amarracao na espinha (locais). */
  knot: [number, number, number];
  anchors: Array<[number, number, number]>;
  hasTail: boolean;
  tailRibbons: number;
  tailLength: number;
  /** Area de arrasto de cada fita (m^2) e massa por fita (kg). */
  tailRibbonArea: number;
  tailRibbonMass: number;
  /** Restauracao no plano: fita/quilha (adimensional). */
  inPlaneStability: number;
  /** Ganho do giro quando a rabiola e cortada. */
  spinGain: number;
  /** Impulso da desbicada (m/s) ao longo do nariz. */
  dartImpulse: number;
  /** Tapa/tenteio habilitado (desligado em Raia e Peixinho). */
  canTapa: boolean;
}

export const BICO_MEDIO: KiteSpec = {
  id: 'bico-medio',
  name: 'Bico Médio',
  width: 0.5,
  height: 0.55,
  area: 0.22,
  mass: 0.035,
  cnMax: 1.2,
  cd0: 0.08,
  cpY: 0.03,
  trimAlpha: 0.62,
  pitchStiffness: 0.6,
  yawStiffness: 0.8,
  knot: [0, 0.02, 0.2],
  anchors: [[0, 0.2, 0], [0, -0.12, 0], [0.12, 0.04, 0]],
  hasTail: true,
  tailRibbons: 16,
  tailLength: 1.6,
  tailRibbonArea: 0.0016,
  tailRibbonMass: 0.0007,
  inPlaneStability: 0.15,
  spinGain: 0.6,
  dartImpulse: 4.2,
  canTapa: true,
};

const CD_RIBBON = 1.1;
const UP = new Vector3(0, 1, 0);

/** Cadeia fisica de fitas. Quase-estatica na forca que devolve a pipa. */
class TailChain {
  readonly n: number;
  readonly pos: Float64Array;
  private readonly prev: Float64Array;
  private readonly spacing: number;
  private readonly nodeMass: number;
  private readonly dragArea: number;
  private ready = false;

  constructor(spec: KiteSpec) {
    this.n = spec.tailRibbons + 1;
    this.pos = new Float64Array(this.n * 3);
    this.prev = new Float64Array(this.n * 3);
    this.spacing = spec.tailLength / spec.tailRibbons;
    this.nodeMass = spec.tailRibbonMass;
    this.dragArea = spec.tailRibbonArea;
  }

  /** Descarta as posicoes: na proxima chamada a cadeia pende de novo a partir da base da pipa. */
  reset(): void {
    this.ready = false;
  }

  /** Avanca um sub-step; `outForce` recebe a soma das cargas nas fitas (puxa a pipa). */
  step(dt: number, attach: Vector3, windAt: WindFn, time: number, outForce: Vector3, down: Vector3): void {
    const n = this.n;
    const P = this.pos;
    const V = this.prev;
    if (!this.ready) {
      for (let i = 0; i < n; i++) {
        P[i * 3] = V[i * 3] = attach.x + down.x * this.spacing * i;
        P[i * 3 + 1] = V[i * 3 + 1] = attach.y + down.y * this.spacing * i;
        P[i * 3 + 2] = V[i * 3 + 2] = attach.z + down.z * this.spacing * i;
      }
      this.ready = true;
    }
    P[0] = V[0] = attach.x;
    P[1] = V[1] = attach.y;
    P[2] = V[2] = attach.z;
    const wind = new Vector3();
    const dt2 = dt * dt;
    outForce.set(0, 0, 0);
    for (let i = 1; i < n; i++) {
      const i3 = i * 3;
      const x = P[i3]!;
      const y = P[i3 + 1]!;
      const z = P[i3 + 2]!;
      const vx = (x - V[i3]!) / dt;
      const vy = (y - V[i3 + 1]!) / dt;
      const vz = (z - V[i3 + 2]!) / dt;
      windAt(x, y, z, time, wind);
      const rx = wind.x - vx;
      const ry = wind.y - vy;
      const rz = wind.z - vz;
      const sp = Math.hypot(rx, ry, rz);
      const k = 0.5 * AIR_DENSITY * CD_RIBBON * this.dragArea * sp;
      const fx = k * rx;
      const fy = k * ry - this.nodeMass * GRAVITY_ACC;
      const fz = k * rz;
      outForce.x += fx;
      outForce.y += fy;
      outForce.z += fz;
      V[i3] = x;
      V[i3 + 1] = y;
      V[i3 + 2] = z;
      P[i3] = x + vx * dt * 0.996 + (fx / this.nodeMass) * dt2;
      P[i3 + 1] = y + vy * dt * 0.996 + (fy / this.nodeMass) * dt2;
      P[i3 + 2] = z + vz * dt * 0.996 + (fz / this.nodeMass) * dt2;
    }
    for (let it = 0; it < 5; it++) {
      for (let k = 0; k < n - 1; k++) {
        const i = k * 3;
        const j = i + 3;
        const dx = P[j]! - P[i]!;
        const dy = P[j + 1]! - P[i + 1]!;
        const dz = P[j + 2]! - P[i + 2]!;
        const len = Math.hypot(dx, dy, dz) || 1e-9;
        const diff = (len - this.spacing) / len;
        const wi = k === 0 ? 0 : 0.5;
        const wj = k === 0 ? 1 : 0.5;
        P[i] = P[i]! + dx * diff * wi;
        P[i + 1] = P[i + 1]! + dy * diff * wi;
        P[i + 2] = P[i + 2]! + dz * diff * wi;
        P[j] = P[j]! - dx * diff * wj;
        P[j + 1] = P[j + 1]! - dy * diff * wj;
        P[j + 2] = P[j + 2]! - dz * diff * wj;
      }
    }
  }
}

export class KiteBody {
  readonly spec: KiteSpec;
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  /** Velocidade angular no referencial do corpo (rad/s). */
  readonly omega = new Vector3();
  /**
   * Fracao da aerodinamica que vale (1 = pipa inteira em voo). Pipa avoada perde sustentacao
   * e pipa no chao fica amassada: sem isto ela deslizaria para sempre sob o vento.
   */
  aeroScale = 1;
  /** Alvo do angulo no plano (rad): positivo inclina o nariz para a esquerda do jogador. */
  psiTarget = 0;
  tailAttached: boolean;
  readonly tail: TailChain | null;
  /** Ultimos valores calculados (HUD, testes). */
  alpha = 0;
  airspeed = 0;
  psi = 0;
  private readonly inertia: Vector3;
  private readonly windV = new Vector3();
  private readonly rel = new Vector3();
  private readonly wh = new Vector3();
  private readonly n = new Vector3();
  private readonly nose = new Vector3();
  private readonly f = new Vector3();
  private readonly t = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tailForce = new Vector3();
  private readonly qInv = new Quaternion();
  private readonly dq = new Quaternion();

  constructor(spec: KiteSpec) {
    this.spec = spec;
    this.tailAttached = spec.hasTail;
    this.tail = spec.hasTail ? new TailChain(spec) : null;
    const m = spec.mass;
    const ix = (m * spec.height * spec.height) / 12;
    const iy = (m * spec.width * spec.width) / 12;
    this.inertia = new Vector3(ix, iy, ix + iy);
    this.quat.identity();
  }

  totalMass(): number {
    return this.spec.mass + (this.tailAttached ? this.spec.tailRibbons * this.spec.tailRibbonMass : 0);
  }

  /** Posiciona a pipa com o nariz para cima e a face voltada para `faceDir`. */
  place(position: Vector3, faceDir: Vector3, velocity: Vector3): void {
    this.pos.copy(position);
    this.vel.copy(velocity);
    // z local -> faceDir (horizontal), y local -> cima.
    const z = this.tmp.copy(faceDir);
    z.y = 0;
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
    z.normalize();
    const x = new Vector3().crossVectors(UP, z).normalize();
    const y = new Vector3().crossVectors(z, x);
    this.quat.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    this.omega.set(0, 0, 0);
    this.psiTarget = 0;
    // Teletransportar a pipa deixaria a rabiola longe da base: ela recomeca pendurada.
    this.tail?.reset();
  }

  /**
   * Inclina o nariz para o lado do jogador ate o angulo de ataque da regulagem (alpha = 90 - theta).
   * Quem solta a pipa ja a entrega inclinada; sem isto as pesadas estolam antes do trim girar a folha.
   */
  pitchToTrim(): void {
    const theta = Math.PI / 2 - this.spec.trimAlpha;
    this.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), theta));
    this.tail?.reset();
  }

  knotWorld(out: Vector3): Vector3 {
    const k = this.spec.knot;
    return out.set(k[0], k[1], k[2]).applyQuaternion(this.quat).add(this.pos);
  }

  anchorWorld(i: number, out: Vector3): Vector3 {
    const a = this.spec.anchors[i]!;
    return out.set(a[0], a[1], a[2]).applyQuaternion(this.quat).add(this.pos);
  }

  /** Ponto de amarracao da rabiola (base da espinha) em coordenadas de mundo. */
  tailAttachWorld(out: Vector3): Vector3 {
    return out.set(0, -this.spec.height / 2, 0).applyQuaternion(this.quat).add(this.pos);
  }

  noseDir(out: Vector3): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  normalDir(out: Vector3): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.quat);
  }

  /** Giro em torno da normal da face (rad/s): indica o "piao". */
  get spinRate(): number {
    return this.omega.z;
  }

  /** Corta a rabiola: some o torque estabilizador (a pipa pode virar piao). */
  cutTail(): void {
    this.tailAttached = false;
  }

  /** Posicao do no `i` da rabiola em coordenadas de mundo (visual). */
  tailNode(i: number, out: Vector3): Vector3 | null {
    if (!this.tail || !this.tailAttached) return null;
    return out.set(this.tail.pos[i * 3]!, this.tail.pos[i * 3 + 1]!, this.tail.pos[i * 3 + 2]!);
  }

  /** Impulso de velocidade ao longo do nariz (desbicada). */
  dart(deltaV: number): void {
    this.noseDir(this.tmp);
    this.vel.addScaledVector(this.tmp, deltaV);
  }

  /**
   * Um sub-step. `lineForce` e a forca da linha aplicada no no do estirante (ou
   * null se a pipa esta solta).
   */
  step(dt: number, windAt: WindFn, time: number, lineForce: Vector3 | null): void {
    const spec = this.spec;
    const q = this.quat;
    const n = this.normalDir(this.n);
    this.noseDir(this.nose);
    windAt(this.pos.x, this.pos.y, this.pos.z, time, this.windV);
    this.rel.copy(this.windV).sub(this.vel);
    const speed = this.rel.length();
    this.airspeed = speed;
    const F = this.f.set(0, 0, 0);
    const T = this.t.set(0, 0, 0);
    let dyn = 0;
    let yawLateral = 0;
    let yawFront = 0;
    if (speed > 0.05) {
      const wh = this.wh.copy(this.rel).multiplyScalar(1 / speed);
      const d = wh.dot(n);
      const sgn = d >= 0 ? 1 : -1;
      const sinA = Math.abs(d);
      this.alpha = Math.asin(Math.min(1, sinA));
      dyn = 0.5 * AIR_DENSITY * speed * speed * this.aeroScale;
      const fn = dyn * spec.area * spec.cnMax * sinA;
      const aero = this.tmp.copy(n).multiplyScalar(sgn * fn).addScaledVector(wh, dyn * spec.area * spec.cd0);
      F.add(aero);
      const rcp = this.tmp2.set(0, spec.cpY, 0).applyQuaternion(q);
      T.add(rcp.cross(aero));
      // Torque de trim: leva o angulo de ataque ao valor da regulagem do estirante.
      const axis = this.tmp.copy(n).multiplyScalar(sgn).cross(wh);
      const len = axis.length();
      if (len > 1e-4) {
        T.addScaledVector(axis, (spec.pitchStiffness * dyn * spec.area * spec.height * (spec.trimAlpha - this.alpha)) / len);
      }
      // Biruta: a componente lateral do vento relativo (eixo x do corpo) gira a folha em y.
      const wbx = this.tmp.copy(wh).applyQuaternion(this.qInv.copy(q).invert());
      yawLateral = wbx.x;
      yawFront = wbx.z;
    } else {
      this.alpha = 0;
    }
    F.y -= spec.mass * GRAVITY_ACC;

    if (this.tail && this.tailAttached) {
      const attach = this.tailAttachWorld(this.tmp2);
      const down = this.tmp.set(0, -1, 0).applyQuaternion(q);
      this.tail.step(dt, attach, windAt, time, this.tailForce, down);
      F.add(this.tailForce);
      T.add(this.tmp.copy(attach).sub(this.pos).cross(this.tailForce));
    }
    if (lineForce) {
      F.add(lineForce);
      const knot = this.knotWorld(this.tmp2);
      T.add(this.tmp.copy(knot).sub(this.pos).cross(lineForce));
    }

    // Translacao (Euler semi-implicito) com trava de sanidade na velocidade.
    this.vel.addScaledVector(F, dt / this.totalMass());
    const vmax = 60;
    const vlen = this.vel.length();
    if (vlen > vmax) this.vel.multiplyScalar(vmax / vlen);
    this.pos.addScaledVector(this.vel, dt);

    // Rotacao no referencial do corpo.
    this.qInv.copy(q).invert();
    const tb = T.applyQuaternion(this.qInv);
    // Restauracao e controle do angulo no plano.
    this.psi = this.inPlaneAngle(n);
    const stab = this.tailAttached || !spec.hasTail ? spec.inPlaneStability : 0;
    tb.z += stab * dyn * spec.area * spec.height * (this.psiTarget - this.psi);
    const front = Math.min(1, Math.abs(yawFront) / 0.3) * (yawFront >= 0 ? 1 : -1);
    tb.y += spec.yawStiffness * dyn * spec.area * spec.height * yawLateral * front;
    if (spec.hasTail && !this.tailAttached && speed > 2) {
      tb.z += spec.spinGain * dyn * spec.area * spec.height * (this.omega.z >= 0 ? 1 : -1);
    }
    // Giroscopico simplificado e amortecimento aerodinamico implicito.
    const I = this.inertia;
    const w = this.omega;
    const gx = ((I.y - I.z) * w.y * w.z) / I.x;
    const gy = ((I.z - I.x) * w.z * w.x) / I.y;
    const gz = ((I.x - I.y) * w.x * w.y) / I.z;
    const base = AIR_DENSITY * Math.max(speed, 3) * spec.area * spec.height * spec.height;
    const cx = 0.25 * base;
    const cy = 0.25 * base;
    const cz = 0.2 * base;
    w.x = (w.x + dt * (tb.x / I.x + gx)) / (1 + (dt * cx) / I.x);
    w.y = (w.y + dt * (tb.y / I.y + gy)) / (1 + (dt * cy) / I.y);
    w.z = (w.z + dt * (tb.z / I.z + gz)) / (1 + (dt * cz) / I.z);
    const wmax = 80;
    const mag0 = w.length();
    if (mag0 > wmax) w.multiplyScalar(wmax / mag0);
    const mag = w.length();
    if (mag > 1e-9) {
      this.dq.setFromAxisAngle(this.tmp.copy(w).multiplyScalar(1 / mag), mag * dt);
      q.multiply(this.dq).normalize();
    }
  }

  /** Angulo do nariz em relacao a "cima" projetado no plano da folha (rad, em torno de n). */
  private inPlaneAngle(n: Vector3): number {
    const u = this.tmp.copy(UP).addScaledVector(n, -UP.dot(n));
    const l = u.length();
    if (l < 0.15) return 0;
    u.multiplyScalar(1 / l);
    const cross = this.tmp2.copy(u).cross(this.nose);
    return Math.atan2(cross.dot(n), u.dot(this.nose));
  }
}
