import type { WebGLRenderer } from 'three';

/** Painel de estatisticas (F3): FPS, draw calls, triangulos, memoria de GPU. */
export class DebugStats {
  private readonly el = document.createElement('pre');
  private visible = false;
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(parent: HTMLElement) {
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', top: '8px', margin: '0', padding: '6px 8px', zIndex: '20',
      font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#d8ffd8',
      background: 'rgba(0,0,0,0.55)', borderRadius: '4px', pointerEvents: 'none', display: 'none', whiteSpace: 'pre',
    });
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(frameDt: number, renderer: WebGLRenderer, extra: string): void {
    this.frames++;
    this.acc += frameDt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.visible) {
        const i = renderer.info;
        this.el.textContent =
          `FPS ${this.fps.toFixed(0)}\n` +
          `draw calls ${i.render.calls}\n` +
          `triangulos ${i.render.triangles}\n` +
          `geometrias ${i.memory.geometries}  texturas ${i.memory.textures}\n` +
          extra;
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
