/**
 * Visual da pipa: folha de papel de seda translucida (o sol atravessa o papel e
 * projeta a sombra interna das varetas de bambu), espinha, arco, estirante com no
 * central e rabiola de fitas plasticas. A pose vem do KiteBody; a rabiola e
 * desenhada em coordenadas de mundo a partir da cadeia fisica.
 */
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { silkPaperTextures, type KiteOutline } from '../world/ProceduralTextures';
import type { KiteBody, KiteSpec } from '../physics/KitePhysics';

/** O que o visual le da pipa: pose, e a rabiola se houver (serve ao corpo real e ao fantasma do replay). */
export type KitePose = Pick<KiteBody, 'pos' | 'quat' | 'tailAttached' | 'tailNode'> & { tail: object | null };

export interface KiteSkin {
  /** Cores dos paineis do papel (CSS). */
  c1: string;
  c2: string;
}

export const DEFAULT_SKIN: KiteSkin = { c1: '#e53935', c2: '#fdd835' };

const RIBBON_COLORS = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xab47bc, 0xff7043, 0x26c6da, 0xffffff];
const UP = new Vector3(0, 1, 0);

/** Contorno clássico de pipa (losango com ombros): topo, direita, base, esquerda. */
export const DIAMOND_OUTLINE: KiteOutline = [
  [0, 0.5], [0.5, 0.12], [0.04, -0.5], [-0.04, -0.5], [-0.5, 0.12],
];

const BOW_Y = 0.12;

export class KiteView {
  /** Pose da pipa (posicao e orientacao do corpo). */
  readonly root = new Group();
  /** Rabiola: vive no espaco de mundo. */
  readonly tailGroup = new Group();
  private readonly spec: KiteSpec;
  private readonly paperMat: MeshPhysicalMaterial;
  private readonly stickMat = new MeshStandardMaterial({ color: 0xcaa86a, roughness: 0.7 });
  private readonly bridleMat = new MeshStandardMaterial({ color: 0xf0f0e8, roughness: 0.6 });
  private readonly ribbonMat = new MeshStandardMaterial({ roughness: 0.4, side: DoubleSide });
  private readonly tailLineMat = new MeshStandardMaterial({ color: 0xf0f0e8, roughness: 0.6 });
  private readonly ribbons: InstancedMesh | null;
  private readonly tailSegs: InstancedMesh | null;
  private readonly textures: Array<{ dispose(): void }> = [];
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private readonly tmpE = new Vector3();
  private readonly translucency = { value: 0.55 };

  private readonly bowY: number;

  constructor(spec: KiteSpec, skin: KiteSkin = DEFAULT_SKIN, outline: KiteOutline = DIAMOND_OUTLINE, bowY: number = BOW_Y) {
    this.spec = spec;
    this.bowY = bowY;
    const { map, sparMap } = silkPaperTextures(outline, skin.c1, skin.c2, bowY);
    this.textures.push(map, sparMap);
    this.paperMat = new MeshPhysicalMaterial({
      map, roughness: 0.8, metalness: 0, specularIntensity: 0.12, sheen: 0.05, sheenColor: new Color(0xffffff), sheenRoughness: 0.8,
      transparent: true, opacity: 0.92, alphaTest: 0.5, side: DoubleSide,
    });
    this.paperMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.sparMap = { value: sparMap };
      shader.uniforms.uTranslucency = this.translucency;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D sparMap;\nuniform float uTranslucency;')
        .replace(
          '#include <opaque_fragment>',
          `#if NUM_DIR_LIGHTS > 0
            // Translucidez: luz que chega pelo lado oposto ao do observador atravessa o papel,
            // colorida pelo desenho, e as varetas projetam sombra interna.
            vec3 ld = directionalLights[0].direction;
            float back = max(0.0, -dot(normal, ld));
            float spar = texture2D(sparMap, vMapUv).r;
            outgoingLight += diffuseColor.rgb * directionalLights[0].color * back * uTranslucency * (1.0 - 0.8 * spar);
          #endif
          #include <opaque_fragment>`,
        );
    };

    // Folha com barriga leve (a face abaulada leva o vento).
    const sheet = new PlaneGeometry(spec.width, spec.height, 18, 18);
    const pos = sheet.getAttribute('position');
    const hw = spec.width / 2;
    const hh = spec.height / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / hw;
      const y = pos.getY(i) / hh;
      pos.setZ(i, 0.03 * Math.max(0, 1 - x * x) * (0.6 + 0.4 * Math.max(0, 1 - y * y)));
    }
    pos.needsUpdate = true;
    sheet.computeVertexNormals();
    const sheetMesh = new Mesh(sheet, this.paperMat);
    sheetMesh.castShadow = true;
    sheetMesh.receiveShadow = false;
    this.root.add(sheetMesh);

    // Espinha e arco de bambu, por tras da folha.
    const spine = new Mesh(new CylinderGeometry(0.0055, 0.0055, spec.height, 8), this.stickMat);
    spine.position.set(0, 0, -0.008);
    this.root.add(spine);
    const bow = new Mesh(new CylinderGeometry(0.0045, 0.0045, spec.width * 1.02, 8), this.stickMat);
    bow.rotation.z = Math.PI / 2;
    bow.position.set(0, spec.height * this.bowY, -0.006);
    this.root.add(bow);

    // Estirante: pernas da espinha ate o no central, mais o no.
    const knot = new Vector3(...spec.knot);
    for (const a of spec.anchors) this.addLeg(new Vector3(...a), knot);
    const knotMesh = new Mesh(new SphereGeometry(0.009, 10, 8), this.bridleMat);
    knotMesh.position.copy(knot);
    this.root.add(knotMesh);

    if (spec.hasTail) {
      const ribbonGeo = new PlaneGeometry(0.034, 0.16);
      this.ribbons = new InstancedMesh(ribbonGeo, this.ribbonMat, spec.tailRibbons);
      this.ribbons.frustumCulled = false;
      for (let i = 0; i < spec.tailRibbons; i++) {
        this.ribbons.setColorAt(i, new Color(RIBBON_COLORS[i % RIBBON_COLORS.length]!));
      }
      const unit = new CylinderGeometry(0.0012, 0.0012, 1, 4);
      this.tailSegs = new InstancedMesh(unit, this.tailLineMat, spec.tailRibbons);
      this.tailSegs.frustumCulled = false;
      this.tailGroup.add(this.ribbons, this.tailSegs);
    } else {
      this.ribbons = null;
      this.tailSegs = null;
    }
  }

  private addLeg(a: Vector3, b: Vector3): void {
    const len = a.distanceTo(b);
    const leg = new Mesh(new CylinderGeometry(0.0013, 0.0013, len, 4), this.bridleMat);
    leg.position.copy(a).add(b).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(UP, this.tmpA.copy(b).sub(a).normalize());
    this.root.add(leg);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.tailGroup.visible = visible;
  }

  /** Atualiza pose da folha e fitas da rabiola. `time` (s) anima o tremular. */
  update(body: KitePose, time: number): void {
    this.root.position.copy(body.pos);
    this.root.quaternion.copy(body.quat);
    const ribbons = this.ribbons;
    const segs = this.tailSegs;
    if (!ribbons || !segs) return;
    const attached = body.tailAttached && body.tail !== null;
    this.tailGroup.visible = attached && this.root.visible;
    if (!attached) return;
    const n = this.spec.tailRibbons;
    for (let i = 0; i < n; i++) {
      const a = body.tailNode(i, this.tmpA)!;
      const b = body.tailNode(i + 1, this.tmpB)!;
      const dir = this.tmpC.copy(b).sub(a);
      const len = dir.length();
      if (len < 1e-6) dir.set(0, -1, 0);
      else dir.multiplyScalar(1 / len);
      // Segmento da linha da rabiola.
      this.tmpQ.setFromUnitVectors(UP, dir);
      this.tmpD.copy(a).add(b).multiplyScalar(0.5);
      this.tmpM.compose(this.tmpD, this.tmpQ, this.tmpE.set(1, Math.max(len, 1e-4), 1));
      segs.setMatrixAt(i, this.tmpM);
      // Fita pendurada no no b: alinhada a rabiola e com torcao de tremular.
      const twist = Math.sin(time * 9 + i * 1.7) * 0.9;
      this.tmpQ.multiply(new Quaternion().setFromAxisAngle(UP, twist));
      this.tmpD.copy(b).addScaledVector(dir, 0.08);
      this.tmpM.compose(this.tmpD, this.tmpQ, this.tmpE.set(1, 1, 1));
      ribbons.setMatrixAt(i, this.tmpM);
    }
    ribbons.instanceMatrix.needsUpdate = true;
    segs.instanceMatrix.needsUpdate = true;
    if (ribbons.instanceColor) ribbons.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.ribbons?.geometry.dispose();
    this.tailSegs?.geometry.dispose();
    this.paperMat.dispose();
    this.stickMat.dispose();
    this.bridleMat.dispose();
    this.ribbonMat.dispose();
    this.tailLineMat.dispose();
    for (const t of this.textures) t.dispose();
  }
}
