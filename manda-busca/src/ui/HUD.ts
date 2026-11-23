/**
 * HUD basico: vento medio com seta direcional, linha em jardas e estado da pipa.
 * Os demais elementos (patente, kill-feed, rotulos 3D, barra de relo) chegam na fase 5.
 */
import type { KiteState } from '../physics/KiteRig';

export interface HudState {
  windSpeed: number;
  /** Direcao do vento no mundo (para onde sopra), vetor unitario em XZ. */
  windDirX: number;
  windDirZ: number;
  /** Rotacao Y da camera (rad). */
  cameraYaw: number;
  lineOutYards: number;
  lineTotalYards: number;
  state: KiteState;
  connected: boolean;
}

const CSS = `
.mb-hud{position:fixed;left:14px;top:14px;z-index:15;color:#fff;font:600 14px/1.5 system-ui,Segoe UI,sans-serif;
  text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none;display:none}
.mb-hud .row{display:flex;align-items:center;gap:8px}
.mb-hud svg{width:26px;height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
.mb-hud .msg{margin-top:6px;font-weight:700;color:#ffe27a}
`;

function fmt(v: number, digits: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export class HUD {
  private readonly root = document.createElement('div');
  private readonly style = document.createElement('style');
  private readonly wind = document.createElement('span');
  private readonly line = document.createElement('span');
  private readonly msg = document.createElement('div');
  private readonly arrow: SVGSVGElement;

  constructor(parent: HTMLElement) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'mb-hud';
    const windRow = document.createElement('div');
    windRow.className = 'row';
    const ns = 'http://www.w3.org/2000/svg';
    this.arrow = document.createElementNS(ns, 'svg');
    this.arrow.setAttribute('viewBox', '-12 -12 24 24');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M0,-10 L7,4 L0,1 L-7,4 Z');
    path.setAttribute('fill', '#ffffff');
    this.arrow.appendChild(path);
    windRow.append(this.arrow, this.wind);
    const lineRow = document.createElement('div');
    lineRow.className = 'row';
    lineRow.appendChild(this.line);
    this.msg.className = 'msg';
    this.root.append(windRow, lineRow, this.msg);
    parent.appendChild(this.root);
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(s: HudState): void {
    this.wind.textContent = `Vento Médio: ${fmt(s.windSpeed, 1)} m/s`;
    // Seta: aponta para onde o vento sopra, relativa a direcao em que o jogador olha.
    const worldAngle = Math.atan2(s.windDirX, -s.windDirZ); // 0 = -z (norte)
    const rel = worldAngle + s.cameraYaw;
    this.arrow.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    this.line.textContent = `Linha: ${fmt(s.lineOutYards, 0)} / ${fmt(s.lineTotalYards, 0)} jardas`;
    let text = '';
    if (s.state === 'HAND') text = 'Pipa na mão — N ou clique para soltar';
    else if (s.state === 'AVOADA') text = 'Pipa avoada! Recolha a linha (R) e solte outra (N)';
    else if (s.state === 'GROUNDED') text = s.connected ? 'Pipa no chão — recolha com R' : 'Pipa no chão';
    this.msg.textContent = text;
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
