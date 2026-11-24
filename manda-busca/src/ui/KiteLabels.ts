/**
 * Rotulos discretos acompanhando cada pipa no ceu, com a distancia em metros:
 * "sua pipa 38m", "avoada 47m", "pipa no chao 35m". Alternavel (tecla L).
 * O texto vem de uma funcao pura; a camada so projeta as posicoes na tela.
 */
import { Vector3, type Camera } from 'three';
import type { KiteRig } from '../physics/KiteRig';

/** Texto do rotulo, ou null quando a pipa nao deve ter rotulo (na mao ou ja apanhada). */
export function labelText(rig: Pick<KiteRig, 'state'>, isPlayer: boolean, name: string, distance: number): string | null {
  const d = `${Math.round(distance)}m`;
  switch (rig.state) {
    case 'AVOADA': return `avoada ${d}`;
    case 'GROUNDED': return `pipa no chão ${d}`;
    case 'FLYING': return isPlayer ? `sua pipa ${d}` : `${name} ${d}`;
    default: return null;
  }
}

export interface LabelEntry {
  rig: KiteRig;
  isPlayer: boolean;
  name: string;
}

const CSS = `
.mb-labels{position:fixed;inset:0;z-index:12;pointer-events:none;overflow:hidden}
.mb-label{position:absolute;left:0;top:0;transform:translate(-50%,-140%);font:600 11px system-ui,Segoe UI,sans-serif;color:#fff;
  text-shadow:0 1px 2px rgba(0,0,0,.9);background:rgba(0,0,0,.28);border-radius:4px;padding:1px 6px;white-space:nowrap;display:none}
.mb-label.me{color:#ffe27a}
.mb-label.loose{color:#9ad1ff}
`;

export class KiteLabels {
  private readonly root = document.createElement('div');
  private readonly style = document.createElement('style');
  private readonly pool: HTMLDivElement[] = [];
  private readonly v = new Vector3();
  enabled = true;

  constructor(parent: HTMLElement) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'mb-labels';
    parent.appendChild(this.root);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** Posiciona os rotulos; `width`/`height` sao o tamanho da tela em pixels. */
  update(camera: Camera, width: number, height: number, entries: readonly LabelEntry[], visible: boolean): void {
    let used = 0;
    if (visible && this.enabled) {
      for (const e of entries) {
        const pos = e.rig.kite.pos;
        const text = labelText(e.rig, e.isPlayer, e.name, pos.distanceTo(camera.position));
        if (text === null) continue;
        this.v.copy(pos).project(camera as never);
        // Atras da camera (z > 1) ou fora da tela: sem rotulo.
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
        const el = this.slot(used++);
        el.textContent = text;
        el.className = `mb-label${e.isPlayer ? ' me' : ''}${e.rig.state === 'AVOADA' || e.rig.state === 'GROUNDED' ? ' loose' : ''}`;
        el.style.display = 'block';
        el.style.transform = `translate(${((this.v.x + 1) / 2) * width}px, ${((1 - this.v.y) / 2) * height}px) translate(-50%,-140%)`;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.style.display = 'none';
  }

  private slot(i: number): HTMLDivElement {
    let el = this.pool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'mb-label';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    return el;
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
