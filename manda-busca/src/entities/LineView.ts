/**
 * Desenho da linha: um cilindro por segmento (InstancedMesh). A espessura segue a
 * distancia ao observador para a linha continuar visivel a longe (largura quase
 * constante em pixels), como os fios finos em fotografias de pipa.
 */
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { VerletLine } from '../physics/VerletLine';

const UP = new Vector3(0, 1, 0);
const CAPACITY = 64;

/** O que o visual le da linha: numero de nos e a posicao de cada um. */
export type LineSource = Pick<VerletLine, 'n' | 'node'>;

export class LineView {
  readonly mesh: InstancedMesh;
  private readonly material: MeshStandardMaterial;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly dir = new Vector3();
  private readonly mid = new Vector3();
  private readonly scale = new Vector3();
  private readonly q = new Quaternion();
  private readonly m = new Matrix4();

  constructor(color: number) {
    this.material = new MeshStandardMaterial({ color: new Color(color), roughness: 0.6, emissive: new Color(color).multiplyScalar(0.18) });
    this.mesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 4), this.material, CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  setColor(color: number): void {
    this.material.color.setHex(color);
    this.material.emissive.setHex(color).multiplyScalar(0.18);
  }

  /** `startOverride` substitui o primeiro no (ancora visual no ponto exato da mao). */
  update(line: LineSource | null, cameraPos: Vector3, startOverride?: Vector3): void {
    if (!line) {
      this.mesh.count = 0;
      return;
    }
    const segs = Math.min(line.n - 1, CAPACITY);
    this.mesh.count = segs;
    for (let i = 0; i < segs; i++) {
      line.node(i, this.a);
      line.node(i + 1, this.b);
      if (i === 0 && startOverride) this.a.copy(startOverride);
      this.dir.copy(this.b).sub(this.a);
      const len = this.dir.length();
      if (len < 1e-7) {
        this.dir.copy(UP);
      } else {
        this.dir.multiplyScalar(1 / len);
      }
      this.mid.copy(this.a).add(this.b).multiplyScalar(0.5);
      const dist = this.mid.distanceTo(cameraPos);
      const r = Math.max(0.0006, dist * 0.0007);
      this.q.setFromUnitVectors(UP, this.dir);
      this.m.compose(this.mid, this.q, this.scale.set(r, Math.max(len, 1e-4), r));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
