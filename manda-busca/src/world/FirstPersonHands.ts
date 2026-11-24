/**
 * Viewmodel em primeira pessoa: mao esquerda segurando a carretilha (madeira,
 * aluminio ou lata de achocolatado) e mao direita pincando o fio esticado.
 * Renderizado em segunda passada com camera propria (FOV fixo) e depth limpo,
 * para nunca atravessar paredes. A iluminacao vem do ceu do jogo.
 */
import {
  AmbientLight,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp } from '../core/noise';
import type { LightingInfo } from './SkyAtmosphere';
import { canLabelTexture, skinBumpTexture, threadTexture, woodTextures } from './ProceduralTextures';

export type ReelKind = 'madeira' | 'aluminio' | 'lata';

export interface HandsInput {
  /** Velocidade da linha em m/s: positivo = dando linha, negativo = recolhendo. */
  lineSpeed: number;
  /** Tensao normalizada [0, 1] (0 = linha frouxa). */
  tension: number;
  /** Recolhendo continuamente (tecla R). */
  reeling: boolean;
  /** Fracao da linha que resta no carretel [0, 1]. */
  fill: number;
}

interface HandPose {
  index: [number, number, number];
  middle: [number, number, number];
  ring: [number, number, number];
  pinky: [number, number, number];
  thumb: [number, number];
}

interface HandRig {
  root: Group;
  fingers: Record<'index' | 'middle' | 'ring' | 'pinky', Group[]>;
  thumb: Group[];
  indexTip: Object3D;
  pinch: Object3D;
}

interface ReelRig {
  group: Group;
  spinner: Group;
  linePack: Mesh;
  spoolOut: Object3D;
  axis: 'x' | 'y';
  rCore: number;
  rFull: number;
  setFill(fill: number): void;
  radius(fill: number): number;
}

const VIEW_FOV = 55;
const NAIL_MATERIAL = new MeshPhysicalMaterial({ color: 0xe9bfae, roughness: 0.28, clearcoat: 0.6 });
const LEFT_POSE: HandPose = {
  index: [0.35, 1.2, 0.9], middle: [0.35, 1.25, 0.95], ring: [0.4, 1.2, 0.9], pinky: [0.45, 1.15, 0.85], thumb: [0.3, 0.25],
};
const RIGHT_POSE: HandPose = {
  index: [0.5, 0.9, 0.5], middle: [1.2, 1.5, 1.0], ring: [1.3, 1.55, 1.0], pinky: [1.35, 1.5, 1.0], thumb: [0.35, 0.5],
};

const REEL_POS = new Vector3(-0.2, -0.15, -0.5);
const SKY_DIR = new Vector3(0.18, 0.62, -0.76).normalize();

function capsuleSeg(radius: number, length: number, material: Material): Mesh {
  const overlap = length * 1.08;
  const g = new CapsuleGeometry(radius, Math.max(0.001, overlap - 2 * radius), 5, 14);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -overlap / 2 + length * 0.04);
  const m = new Mesh(g, material);
  return m;
}

function buildFinger(lens: number[], radius: number, material: Material, x: number): { base: Group; joints: Group[]; tip: Object3D } {
  const base = new Group();
  base.position.set(x, 0, -0.09);
  let parent: Object3D = base;
  const joints: Group[] = [];
  lens.forEach((len, i) => {
    const joint = new Group();
    if (i > 0) joint.position.set(0, 0, -lens[i - 1]!);
    joint.add(capsuleSeg(radius * (1 - i * 0.1), len, material));
    parent.add(joint);
    joints.push(joint);
    parent = joint;
  });
  const tip = new Object3D();
  tip.position.set(0, -0.003, -lens[lens.length - 1]!);
  parent.add(tip);
  // Unha: elipsoide levemente rosado sobre o dorso da ultima falange.
  const lastLen = lens[lens.length - 1]!;
  const lastR = radius * (1 - (lens.length - 1) * 0.1);
  const nail = new Mesh(new SphereGeometry(1, 10, 8), NAIL_MATERIAL);
  nail.scale.set(lastR * 0.8, lastR * 0.32, lastLen * 0.34);
  nail.position.set(0, lastR * 0.72, -lastLen * 0.72);
  parent.add(nail);
  return { base, joints, tip };
}

/** Mao com antebraco. `side` = +1 mao direita (polegar em -x), -1 esquerda (polegar em +x). */
function buildHand(side: 1 | -1, skin: Material, band: Material | null): HandRig {
  const root = new Group();
  const palmGeo = new RoundedBoxGeometry(0.088, 0.027, 0.092, 3, 0.011);
  const palm = new Mesh(palmGeo, skin);
  palm.position.set(0, 0, -0.046);
  root.add(palm);
  const foreGeo = new CylinderGeometry(0.03, 0.04, 0.36, 18);
  foreGeo.rotateX(Math.PI / 2);
  foreGeo.translate(0, 0, 0.18 + 0.01);
  root.add(new Mesh(foreGeo, skin));
  const wrist = new Mesh(new SphereGeometry(0.036, 14, 12), skin);
  wrist.scale.set(1, 0.8, 0.8);
  root.add(wrist);
  if (band) {
    const ring = new Mesh(new TorusGeometry(0.039, 0.007, 8, 24), band);
    ring.position.set(0, 0, 0.05);
    root.add(ring);
  }

  const defs: Array<['index' | 'middle' | 'ring' | 'pinky', number[], number, number]> = [
    ['index', [0.041, 0.025, 0.021], 0.0098, -0.031],
    ['middle', [0.046, 0.028, 0.022], 0.01, -0.011],
    ['ring', [0.041, 0.026, 0.021], 0.0095, 0.009],
    ['pinky', [0.032, 0.02, 0.018], 0.0085, 0.027],
  ];
  const fingers = { index: [] as Group[], middle: [] as Group[], ring: [] as Group[], pinky: [] as Group[] };
  let indexTip: Object3D = new Object3D();
  for (const [name, lens, r, x] of defs) {
    const f = buildFinger(lens, r, skin, side * x);
    root.add(f.base);
    fingers[name] = f.joints;
    if (name === 'index') indexTip = f.tip;
  }

  const thumbBase = new Group();
  thumbBase.position.set(side * -0.044, -0.004, -0.03);
  thumbBase.rotation.y = side * 0.62;
  const thumb: Group[] = [];
  let parent: Object3D = thumbBase;
  [0.037, 0.03].forEach((len, i) => {
    const joint = new Group();
    if (i > 0) joint.position.set(0, 0, -0.037);
    joint.add(capsuleSeg(0.0115 - i * 0.001, len, skin));
    parent.add(joint);
    thumb.push(joint);
    parent = joint;
  });
  root.add(thumbBase);

  const pinch = new Object3D();
  pinch.position.set(side * -0.004, 0.0, -0.002);
  indexTip.add(pinch);
  return { root, fingers, thumb, indexTip, pinch };
}

function applyPose(rig: HandRig, pose: HandPose, extra: { indexCurl?: number; thumbCurl?: number } = {}): void {
  const set = (joints: Group[], curls: readonly number[], add = 0): void => {
    joints.forEach((j, i) => {
      j.rotation.x = -((curls[i] ?? 0) + add);
    });
  };
  set(rig.fingers.index, pose.index, extra.indexCurl ?? 0);
  set(rig.fingers.middle, pose.middle);
  set(rig.fingers.ring, pose.ring);
  set(rig.fingers.pinky, pose.pinky);
  set(rig.thumb, pose.thumb, extra.thumbCurl ?? 0);
}

function buildReel(kind: ReelKind, woodMap: Material, metal: Material, labelMap: Texture, thread: Texture): ReelRig {
  const group = new Group();
  const spinner = new Group();
  group.add(spinner);
  const threadMat = new MeshStandardMaterial({ map: thread, roughness: 0.75 });
  threadMat.map!.repeat.set(6, 1);
  let linePack: Mesh;
  let axis: 'x' | 'y' = 'x';
  let rCore: number;
  let rFull: number;
  let outOffset: (r: number) => Vector3;

  if (kind === 'lata') {
    axis = 'y';
    rCore = 0.055;
    rFull = 0.072;
    const labelMat = new MeshStandardMaterial({ map: labelMap, roughness: 0.55, metalness: 0.15 });
    const capMat = new MeshStandardMaterial({ color: 0xbdbdbd, metalness: 0.9, roughness: 0.35 });
    const can = new Mesh(new CylinderGeometry(0.052, 0.052, 0.12, 40), [labelMat, capMat, capMat]);
    group.add(can);
    for (const y of [-0.06, 0.06]) {
      const rim = new Mesh(new TorusGeometry(0.052, 0.004, 8, 40), capMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      group.add(rim);
    }
    const geo = new CylinderGeometry(1, 1, 0.05, 48);
    linePack = new Mesh(geo, threadMat);
    outOffset = (r) => new Vector3(r * 0.98, 0.026, 0);
  } else {
    const isAlu = kind === 'aluminio';
    const plateR = isAlu ? 0.074 : 0.088;
    rCore = 0.02;
    rFull = plateR - 0.008;
    const plateMat = isAlu ? metal : woodMap;
    for (const x of [-0.036, 0.036]) {
      const plate = new Mesh(new CylinderGeometry(plateR, plateR, 0.008, 48), plateMat);
      plate.rotation.z = Math.PI / 2;
      plate.position.x = x;
      group.add(plate);
      const rim = new Mesh(new TorusGeometry(plateR, 0.0045, 8, 48), isAlu ? metal : woodMap);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = x;
      group.add(rim);
    }
    const hub = new Mesh(new CylinderGeometry(0.017, 0.017, 0.11, 20), metal);
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
    const geo = new CylinderGeometry(1, 1, 0.064, 48);
    geo.rotateZ(Math.PI / 2);
    linePack = new Mesh(geo, threadMat);
    // Manivela na lateral direita (gira com o carretel).
    const arm = new Mesh(new RoundedBoxGeometry(0.012, 0.062, 0.012, 2, 0.004), metal);
    arm.position.set(0.062, 0.03, 0);
    spinner.add(arm);
    const knob = new Mesh(new CylinderGeometry(0.011, 0.011, 0.03, 14), isAlu ? metal : woodMap);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(0.075, 0.062, 0);
    spinner.add(knob);
    outOffset = (r) => new Vector3(0, r + 0.001, 0);
  }
  spinner.add(linePack);
  const spoolOut = new Object3D();
  group.add(spoolOut);

  const radius = (fill: number): number => lerp(rCore, rFull, clamp(fill, 0, 1));
  const setFill = (fill: number): void => {
    const r = radius(fill);
    if (axis === 'x') linePack.scale.set(1, r, r);
    else linePack.scale.set(r, 1, r);
    spoolOut.position.copy(outOffset(r));
  };
  setFill(0.85);
  return { group, spinner, linePack, spoolOut, axis, rCore, rFull, setFill, radius };
}

export class FirstPersonHands {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(VIEW_FOV, 16 / 9, 0.01, 12);

  private readonly sun = new DirectionalLight(0xffffff, 1);
  private readonly hemi = new HemisphereLight(0xffffff, 0x444444, 0.3);
  private readonly ambient = new AmbientLight(0x4a5f8c, 0.0);
  private readonly skin: MeshPhysicalMaterial;
  private readonly band = new MeshStandardMaterial({ color: 0xc62828, roughness: 0.7 });
  private readonly left: HandRig;
  private readonly right: HandRig;
  private readonly leftRoot = new Group();
  private readonly rightRoot = new Group();
  private readonly viewRoot = new Group();
  private reel: ReelRig;
  private readonly reelHolder = new Group();
  private readonly woodMat: MeshStandardMaterial;
  private readonly metalMat = new MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.95, roughness: 0.28 });
  private readonly labelTex = canLabelTexture();
  private readonly threadTex = threadTexture();
  private readonly lineMat = new MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.55, emissive: 0x222222 });
  private readonly lineSegs: Mesh[] = [];
  private readonly skyLine: Mesh;
  private reelKind: ReelKind = 'madeira';

  private spin = 0;
  private pullT = 0;
  private tapT = 0;
  private reelPhase = 0;
  private walkPhase = 0;
  private idle = 0;
  private hide = 0;
  private smoothedTension = 0;
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const skinBump = skinBumpTexture(256);
    skinBump.repeat.set(3, 3);
    this.skin = new MeshPhysicalMaterial({
      color: 0xc98f69, roughness: 0.58, metalness: 0, bumpMap: skinBump, bumpScale: 0.35,
      sheen: 0.6, sheenColor: new Color(0xffb090), sheenRoughness: 0.5,
    });
    const wood = woodTextures(256, [182, 134, 84]);
    this.woodMat = new MeshStandardMaterial({ map: wood.map, roughnessMap: wood.roughnessMap, bumpMap: wood.bumpMap, bumpScale: 0.6, roughness: 1 });

    this.scene.add(this.sun, this.hemi, this.ambient, this.viewRoot);
    this.viewRoot.add(this.leftRoot, this.rightRoot, this.reelHolder);

    this.left = buildHand(-1, this.skin, this.band);
    this.right = buildHand(1, this.skin, null);
    this.leftRoot.add(this.left.root);
    this.rightRoot.add(this.right.root);

    this.reel = buildReel(this.reelKind, this.woodMat, this.metalMat, this.labelTex, this.threadTex);
    this.reelHolder.add(this.reel.group);
    this.reelHolder.position.copy(REEL_POS);

    // Linha: trecho reel -> mao em 8 segmentos + trecho mao -> ceu.
    const unit = new CylinderGeometry(0.0006, 0.0006, 1, 5);
    for (let i = 0; i < 8; i++) {
      const m = new Mesh(unit, this.lineMat);
      this.lineSegs.push(m);
      this.viewRoot.add(m);
    }
    this.skyLine = new Mesh(unit, this.lineMat);
    this.viewRoot.add(this.skyLine);
    this.layoutHands(0, 0);
    this.update(0, { lineSpeed: 0, tension: 0.4, reeling: false, fill: 0.85 }, 0, 0);
  }

  setReel(kind: ReelKind): void {
    if (kind === this.reelKind) return;
    this.reelKind = kind;
    this.reelHolder.remove(this.reel.group);
    this.reel.group.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.reel = buildReel(kind, this.woodMat, this.metalMat, this.labelTex, this.threadTex);
    this.reelHolder.add(this.reel.group);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Copia a iluminacao do ceu para a cena do viewmodel (direcao no espaco da camera). */
  setLighting(info: LightingInfo, cameraWorldQuat: Quaternion): void {
    this.tmpQ.copy(cameraWorldQuat).invert();
    this.tmpA.copy(info.dirToLight).applyQuaternion(this.tmpQ).multiplyScalar(6);
    this.sun.position.copy(this.tmpA);
    this.sun.color.copy(info.color);
    this.sun.intensity = info.intensity * 0.6;
    this.hemi.color.copy(info.hemiSky);
    this.hemi.groundColor.copy(info.hemiGround);
    this.hemi.intensity = info.hemiIntensity + 0.1;
    this.ambient.intensity = 1.3 * info.night;
  }

  setEnvironment(texture: Texture | null, intensity: number): void {
    this.scene.environment = texture;
    this.scene.environmentIntensity = intensity;
  }

  /** Puxada rapida (scroll / desbicada): a mao desce e recua. */
  triggerPull(): void {
    this.pullT = 1;
  }

  /** Dedilhada do tapa: o indicador e o polegar vibram. */
  triggerTap(): void {
    this.tapT = 1;
  }

  /** Mostra ou esconde o trecho de linha do viewmodel que sobe ao ceu (a linha fisica o substitui). */
  setSkyLineVisible(visible: boolean): void {
    this.skyLine.visible = visible;
  }

  /** Fator de ocultacao [0, 1] (zoom otico: as maos descem para fora da tela). */
  setHidden(amount: number): void {
    this.hide = clamp(amount, 0, 1);
  }

  /** Raio atual do pacote de linha no carretel (m). */
  spoolRadius(fill: number): number {
    return this.reel.radius(fill);
  }

  /**
   * Ponto onde a linha sai da mao direita, em coordenadas de mundo, alinhado na
   * tela com o viewmodel (usado como ancora da linha fisica na fase 2).
   */
  pinchWorld(mainCamera: Camera & { fov: number; aspect: number }, out: Vector3): Vector3 {
    this.viewRoot.updateMatrixWorld(true);
    this.right.pinch.getWorldPosition(this.tmpA);
    const depth = -this.tmpA.z;
    const ndc = this.tmpB.copy(this.tmpA).project(this.camera);
    const th = Math.tan((mainCamera.fov * Math.PI) / 360);
    const cx = ndc.x * th * mainCamera.aspect * depth;
    const cy = ndc.y * th * depth;
    return mainCamera.localToWorld(out.set(cx, cy, -depth));
  }

  private layoutHands(bob: number, sway: number): void {
    // Mao esquerda: palma na placa lateral do carretel, dedos contornando a borda.
    this.leftRoot.position.set(REEL_POS.x - 0.058, REEL_POS.y - 0.006 + bob, REEL_POS.z + 0.07);
    this.leftRoot.rotation.set(0.28, -0.3, Math.PI / 2, 'YXZ');
    this.reelHolder.position.set(REEL_POS.x, REEL_POS.y + bob, REEL_POS.z);
    this.reelHolder.rotation.z = sway;
    // Mao direita: alcancando a linha a frente do carretel.
    this.rightRoot.position.set(0.12, -0.13 + bob, -0.54);
    this.rightRoot.rotation.set(0.37, 0.62, -Math.PI / 2, 'YXZ');
  }

  update(dt: number, input: HandsInput, moveSpeed: number, zoomHide: number): void {
    this.hide += (clamp(zoomHide, 0, 1) - this.hide) * (1 - Math.exp(-dt * 8));
    this.idle += dt;
    this.walkPhase += dt * (3 + moveSpeed * 2.2) * (moveSpeed > 0.1 ? 1 : 0.0);
    const bob = Math.sin(this.walkPhase * 2) * 0.004 * Math.min(1, moveSpeed) + Math.sin(this.idle * 1.4) * 0.0012;
    const sway = Math.sin(this.walkPhase) * 0.012 * Math.min(1, moveSpeed) + Math.sin(this.idle * 0.9) * 0.004;
    this.smoothedTension += (clamp(input.tension, 0, 1) - this.smoothedTension) * (1 - Math.exp(-dt * 10));

    this.layoutHands(bob - this.hide * 0.34, sway + this.smoothedTension * 0.02);

    // Carretel: omega = v_linha / raio do pacote de linha.
    this.reel.setFill(input.fill);
    const r = this.reel.radius(input.fill);
    const omega = input.lineSpeed / Math.max(r, 1e-3);
    this.spin += omega * dt;
    if (this.reel.axis === 'x') this.reel.spinner.rotation.x = -this.spin;
    else this.reel.spinner.rotation.y = this.spin;

    // Animacoes de gesto.
    this.pullT = Math.max(0, this.pullT - dt * 4.5);
    this.tapT = Math.max(0, this.tapT - dt * 4);
    const pull = Math.sin(this.pullT * Math.PI);
    if (input.reeling) this.reelPhase += dt * 7.5;
    const circle = input.reeling ? 1 : 0;
    const t = this.smoothedTension;
    this.rightRoot.position.x += -Math.cos(this.reelPhase) * 0.028 * circle - pull * 0.012;
    this.rightRoot.position.y += Math.sin(this.reelPhase) * 0.022 * circle - pull * 0.05 - t * 0.016;
    this.rightRoot.position.z += pull * 0.08 + t * 0.022 + Math.sin(this.reelPhase * 0.5) * 0.008 * circle;
    this.leftRoot.position.z += pull * 0.012;
    this.leftRoot.position.y += -pull * 0.008;

    const flick = this.tapT > 0 ? Math.sin((1 - this.tapT) * 38) * 0.4 * this.tapT : 0;
    applyPose(this.left, LEFT_POSE);
    applyPose(this.right, RIGHT_POSE, { indexCurl: flick, thumbCurl: -flick * 0.6 });

    this.updateLine(t);
    this.viewRoot.visible = this.hide < 0.995;
  }

  private placeSegment(mesh: Mesh, a: Vector3, b: Vector3): void {
    const len = a.distanceTo(b);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.tmpA.copy(b).sub(a).normalize();
    mesh.quaternion.setFromUnitVectors(this.up, this.tmpA);
    mesh.scale.set(1, Math.max(len, 1e-4), 1);
  }

  private updateLine(tension: number): void {
    this.viewRoot.updateMatrixWorld(true);
    const start = new Vector3();
    const end = new Vector3();
    this.reel.spoolOut.getWorldPosition(start);
    this.right.pinch.getWorldPosition(end);
    // Curva quadratica com barriga que some quando a linha estica.
    const sag = 0.03 * (1 - tension);
    const n = this.lineSegs.length;
    let prev = start.clone();
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const p = start.clone().lerp(end, s);
      p.y -= sag * 4 * s * (1 - s);
      this.placeSegment(this.lineSegs[i - 1]!, prev, p);
      prev = p;
    }
    const sky = end.clone().addScaledVector(SKY_DIR, 3.0);
    this.placeSegment(this.skyLine, end, sky);
  }

  render(renderer: WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.skin.dispose();
    this.band.dispose();
    this.woodMat.dispose();
    this.metalMat.dispose();
    this.lineMat.dispose();
    this.labelTex.dispose();
    this.threadTex.dispose();
  }
}
