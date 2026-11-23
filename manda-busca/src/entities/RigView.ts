/**
 * Visual de um piloto: a pipa (folha, estirante, rabiola), a linha ate o piloto e,
 * depois de um corte, o resto da linha do lado da mao. Uma instancia por KiteRig.
 */
import type { Scene, Vector3 } from 'three';
import type { KiteRig } from '../physics/KiteRig';
import type { KiteSpec } from '../physics/KitePhysics';
import type { LineSpec } from '../physics/LineSpec';
import { DEFAULT_SKIN, KiteView, type KiteSkin } from './KiteMeshBuilder';
import { LineView } from './LineView';

export class RigView {
  private kite: KiteView;
  private readonly line: LineView;
  private readonly handLine: LineView;
  private specKey = '';

  constructor(private readonly scene: Scene, rig: KiteRig, private skin: KiteSkin = DEFAULT_SKIN) {
    this.kite = new KiteView(rig.spec, skin);
    this.line = new LineView(rig.lineSpec.color);
    this.handLine = new LineView(rig.lineSpec.color);
    this.kite.setVisible(false);
    scene.add(this.kite.root, this.kite.tailGroup, this.line.mesh, this.handLine.mesh);
    this.specKey = RigView.key(rig.spec, rig.lineSpec, skin);
  }

  private static key(spec: KiteSpec, line: LineSpec, skin: KiteSkin): string {
    return `${spec.id}|${line.id}|${skin.c1}|${skin.c2}`;
  }

  /** Reconstroi a pipa e a cor da linha se o equipamento ou a skin mudaram. */
  refresh(rig: KiteRig, skin: KiteSkin = this.skin): void {
    const k = RigView.key(rig.spec, rig.lineSpec, skin);
    if (k === this.specKey) return;
    this.scene.remove(this.kite.root, this.kite.tailGroup);
    this.kite.dispose();
    this.skin = skin;
    this.kite = new KiteView(rig.spec, skin);
    this.kite.setVisible(false);
    this.scene.add(this.kite.root, this.kite.tailGroup);
    this.line.setColor(rig.lineSpec.color);
    this.handLine.setColor(rig.lineSpec.color);
    this.specKey = k;
  }

  /** `anchorOverride` ancora o inicio da linha no ponto exato da mao (so o jogador). */
  update(rig: KiteRig, cameraPos: Vector3, now: number, anchorOverride?: Vector3): void {
    const visible = rig.state !== 'HAND' && rig.state !== 'CAPTURED';
    this.kite.setVisible(visible);
    if (visible) this.kite.update(rig.kite, now);
    const live = rig.state !== 'CAPTURED';
    this.line.update(live ? rig.line : null, cameraPos, rig.connected ? anchorOverride : undefined);
    this.handLine.update(live ? rig.handLine : null, cameraPos, anchorOverride);
  }

  dispose(): void {
    this.scene.remove(this.kite.root, this.kite.tailGroup, this.line.mesh, this.handLine.mesh);
    this.kite.dispose();
    this.line.dispose();
    this.handLine.dispose();
  }
}
