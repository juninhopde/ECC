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
  captured?: number;
}

/** Estado do combate para a barra central (relo) ou para a apara (engate). */
export interface CombatHud {
  relo: { power: number; enemyPower: number; wear: number; resistance: number } | null;
  hook: { kind: 'linha' | 'rabiola'; stress: number } | null;
}

const CSS = `
.mb-hud{position:fixed;left:14px;top:14px;z-index:15;color:#fff;font:600 14px/1.5 system-ui,Segoe UI,sans-serif;
  text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none;display:none}
.mb-hud .row{display:flex;align-items:center;gap:8px}
.mb-hud svg{width:26px;height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
.mb-hud .msg{margin-top:6px;font-weight:700;color:#ffe27a}
.mb-hud .cap{margin-top:2px;font-weight:600;opacity:.9}
.mb-combat{position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:15;width:min(460px,80vw);color:#fff;
  font:700 13px system-ui,Segoe UI,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8);pointer-events:none;display:none;text-align:center}
.mb-combat .title{letter-spacing:.2em;margin-bottom:4px}
.mb-bar{position:relative;height:12px;border-radius:7px;background:rgba(0,0,0,.45);overflow:hidden;margin:4px 0;border:1px solid rgba(255,255,255,.25)}
.mb-bar>i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:7px;transition:width .08s linear}
.mb-bar .zone{position:absolute;left:0;top:0;bottom:0;width:50%;background:rgba(80,200,120,.25)}
.mb-feed{position:fixed;right:14px;top:14px;z-index:15;color:#fff;font:600 14px/1.5 system-ui,Segoe UI,sans-serif;
  text-shadow:0 1px 3px rgba(0,0,0,.8);pointer-events:none;text-align:right}
.mb-feed div{background:rgba(0,0,0,.38);border-radius:6px;padding:2px 9px;margin-bottom:3px;transition:opacity .4s}
.mb-hud .prof{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:13px}
.mb-hud .prof b{color:#ffd21f;letter-spacing:.04em}
.mb-hud .xp{display:inline-block;position:relative;width:120px;height:8px;border-radius:5px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);overflow:hidden}
.mb-hud .xp i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#66bb6a,#ffd54f)}
.mb-hud .status{margin-top:6px;font-weight:600;font-size:13px;line-height:1.45;background:rgba(0,0,0,.32);border-radius:6px;padding:4px 9px;display:none}
.mb-hud .status div:first-child{color:#ffd21f;font-weight:800}
.mb-banner{position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:16;max-width:min(760px,88vw);text-align:center;color:#fff;
  font:800 22px/1.3 system-ui,Segoe UI,sans-serif;text-shadow:0 2px 6px rgba(0,0,0,.85);background:rgba(10,14,28,.55);border:1px solid rgba(255,255,255,.18);
  border-radius:12px;padding:10px 20px;pointer-events:none;display:none;transition:opacity .5s}
.mb-replay{position:fixed;left:50%;bottom:6%;transform:translateX(-50%);z-index:16;color:#fff;font:700 15px system-ui,Segoe UI,sans-serif;
  text-shadow:0 1px 4px rgba(0,0,0,.9);background:rgba(10,14,28,.7);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:8px 16px;
  pointer-events:none;display:none;text-align:center}
.mb-replay b{color:#ff5252;letter-spacing:.2em;margin-right:10px}
.mb-replay span{margin:0 6px;opacity:.65}
.mb-replay span.on{opacity:1;color:#ffd21f}
.mb-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:16;color:#fff;font:700 15px system-ui,Segoe UI,sans-serif;
  text-shadow:0 1px 4px rgba(0,0,0,.9);background:rgba(0,0,0,.5);border-radius:8px;padding:6px 14px;pointer-events:none;display:none}
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
  private readonly cap = document.createElement('div');
  private readonly arrow: SVGSVGElement;
  private readonly combat = document.createElement('div');
  private readonly combatTitle = document.createElement('div');
  private readonly barPower = document.createElement('i');
  private readonly barWear = document.createElement('i');
  private readonly barStress = document.createElement('i');
  private readonly combatMsg = document.createElement('div');
  private readonly feed = document.createElement('div');
  private readonly feedItems: Array<{ el: HTMLElement; until: number }> = [];
  private readonly profName = document.createElement('b');
  private readonly profXp = document.createElement('i');
  private readonly profInfo = document.createElement('span');
  private readonly status = document.createElement('div');
  private readonly bannerEl = document.createElement('div');
  private readonly promptEl = document.createElement('div');
  private readonly replayEl = document.createElement('div');
  private bannerUntil = 0;
  private visible = false;

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
    this.cap.className = 'cap';
    const prof = document.createElement('div');
    prof.className = 'prof';
    const xp = document.createElement('span');
    xp.className = 'xp';
    xp.appendChild(this.profXp);
    prof.append(this.profName, xp, this.profInfo);
    this.status.className = 'status';
    this.root.append(prof, windRow, lineRow, this.cap, this.msg, this.status);
    parent.appendChild(this.root);
    this.bannerEl.className = 'mb-banner';
    this.promptEl.className = 'mb-prompt';
    this.replayEl.className = 'mb-replay';
    parent.append(this.bannerEl, this.promptEl, this.replayEl);

    this.combat.className = 'mb-combat';
    this.combatTitle.className = 'title';
    const mkBar = (fill: HTMLElement, label: string, zone = false): HTMLElement => {
      const wrap = document.createElement('div');
      const cap = document.createElement('div');
      cap.textContent = label;
      cap.style.fontWeight = '600';
      cap.style.fontSize = '11px';
      const bar = document.createElement('div');
      bar.className = 'mb-bar';
      if (zone) {
        const z = document.createElement('span');
        z.className = 'zone';
        bar.appendChild(z);
      }
      bar.appendChild(fill);
      wrap.append(cap, bar);
      return wrap;
    };
    this.barPower.style.background = 'linear-gradient(90deg,#ffd54f,#ff7043)';
    this.barWear.style.background = 'linear-gradient(90deg,#ef5350,#b71c1c)';
    this.barStress.style.background = '#66bb6a';
    this.combat.append(
      this.combatTitle,
      mkBar(this.barPower, 'Velocidade da linha (poder de corte)'),
      mkBar(this.barWear, 'Desgaste da sua linha'),
      mkBar(this.barStress, 'Tens\u00e3o (zona verde: recolha devagar)', true),
      this.combatMsg,
    );
    parent.appendChild(this.combat);
    this.feed.className = 'mb-feed';
    parent.appendChild(this.feed);
  }

  show(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
    this.feed.style.display = visible ? 'block' : 'none';
    if (!visible) this.promptEl.style.display = 'none';
  }

  /** Patente, barra de progresso ate a proxima patente e moedas (canto superior esquerdo). */
  setProfile(p: { patente: string; progress: number; rp: number; nextRp: number | null; coins: number }): void {
    this.profName.textContent = p.patente;
    this.profXp.style.width = `${Math.round(Math.min(1, Math.max(0, p.progress)) * 100)}%`;
    this.profInfo.textContent = `${p.rp}${p.nextRp !== null ? ` / ${p.nextRp}` : ''} RP \u00b7 ${p.coins} moedas`;
  }

  /** Painel de status do modo (placar, cronometro). null esconde. */
  setStatus(lines: string[] | null): void {
    this.status.replaceChildren();
    if (!lines || lines.length === 0) {
      this.status.style.display = 'none';
      return;
    }
    for (const l of lines) {
      const d = document.createElement('div');
      d.textContent = l;
      this.status.appendChild(d);
    }
    this.status.style.display = 'block';
  }

  /** Aviso grande no alto da tela por `seconds` s (tempo real). */
  banner(text: string, seconds: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = 'block';
    this.bannerEl.style.opacity = '1';
    this.bannerUntil = performance.now() / 1000 + seconds;
  }

  /** Controles do replay: velocidade atual e atalhos. null esconde. */
  setReplay(speed: number | null, speeds: readonly number[]): void {
    this.replayEl.replaceChildren();
    if (speed === null) {
      this.replayEl.style.display = 'none';
      return;
    }
    const title = document.createElement('b');
    title.textContent = 'REPLAY';
    this.replayEl.appendChild(title);
    speeds.forEach((v, i) => {
      const sp = document.createElement('span');
      sp.textContent = `[${i + 1}] ${fmt(v, v < 1 ? 2 : 0)}x`;
      if (v === speed) sp.className = 'on';
      this.replayEl.appendChild(sp);
    });
    const exit = document.createElement('span');
    exit.textContent = '[C] sair';
    this.replayEl.appendChild(exit);
    this.replayEl.style.display = 'block';
  }

  /** Dica de interacao perto do fundo da tela (por exemplo, E para a loja). */
  setPrompt(text: string | null): void {
    if (!text || !this.visible) {
      this.promptEl.style.display = 'none';
      return;
    }
    this.promptEl.textContent = text;
    this.promptEl.style.display = 'block';
  }

  /** Mensagem no canto superior direito (cortes, aparas). Some depois de ~5 s. */
  notify(text: string, nowSeconds: number): void {
    const el = document.createElement('div');
    el.textContent = text;
    this.feed.appendChild(el);
    this.feedItems.push({ el, until: nowSeconds + 5 });
    while (this.feedItems.length > 5) this.feedItems.shift()!.el.remove();
  }

  /** Barra central de tensao/velocidade durante o relo; zona verde na apara. */
  setCombat(c: CombatHud, nowSeconds: number): void {
    const real = performance.now() / 1000;
    if (this.bannerUntil > 0 && real > this.bannerUntil) {
      this.bannerEl.style.opacity = '0';
      if (real > this.bannerUntil + 0.6) {
        this.bannerEl.style.display = 'none';
        this.bannerUntil = 0;
      }
    }
    for (const f of [...this.feedItems]) {
      if (nowSeconds > f.until) {
        f.el.style.opacity = '0';
        if (nowSeconds > f.until + 0.5) {
          f.el.remove();
          this.feedItems.splice(this.feedItems.indexOf(f), 1);
        }
      }
    }
    if (c.relo) {
      this.combat.style.display = 'block';
      this.combatTitle.textContent = 'RELO';
      this.barPower.parentElement!.parentElement!.style.display = 'block';
      this.barWear.parentElement!.parentElement!.style.display = 'block';
      this.barStress.parentElement!.parentElement!.style.display = 'none';
      this.barPower.style.width = `${Math.min(100, (c.relo.power / 30) * 100)}%`;
      this.barWear.style.width = `${Math.min(100, (c.relo.wear / Math.max(c.relo.resistance, 0.01)) * 100)}%`;
      this.combatMsg.textContent = c.relo.power >= c.relo.enemyPower ? 'Voc\u00ea est\u00e1 serrando a linha deles!' : 'Cuidado: sua linha est\u00e1 sendo serrada!';
    } else if (c.hook) {
      this.combat.style.display = 'block';
      this.combatTitle.textContent = c.hook.kind === 'rabiola' ? 'RABIOLA ENGATADA' : 'LINHA ENGATADA';
      this.barPower.parentElement!.parentElement!.style.display = 'none';
      this.barWear.parentElement!.parentElement!.style.display = 'none';
      this.barStress.parentElement!.parentElement!.style.display = 'block';
      this.barStress.style.width = `${Math.min(100, (c.hook.stress / 2) * 100)}%`;
      this.barStress.style.background = c.hook.stress <= 1 ? '#66bb6a' : '#ef5350';
      this.combatMsg.textContent =
        c.hook.kind === 'rabiola'
          ? 'Engate firme: puxe para capturar'
          : 'Linha engatada! Segure R devagar para aparar';
    } else {
      this.combat.style.display = 'none';
    }
  }

  update(s: HudState): void {
    this.wind.textContent = `Vento Médio: ${fmt(s.windSpeed, 1)} m/s`;
    // Seta: aponta para onde o vento sopra, relativa a direcao em que o jogador olha.
    const worldAngle = Math.atan2(s.windDirX, -s.windDirZ); // 0 = -z (norte)
    const rel = worldAngle + s.cameraYaw;
    this.arrow.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    this.line.textContent = `Linha: ${fmt(s.lineOutYards, 0)} / ${fmt(s.lineTotalYards, 0)} jardas`;
    this.cap.textContent = s.captured ? `Pipas apanhadas: ${s.captured}` : '';
    let text = '';
    if (s.state === 'HAND') text = 'Pipa na mão — N ou clique para soltar';
    else if (s.state === 'AVOADA') text = 'Pipa avoada! Recolha a linha (R) e peça outra (N)';
    else if (s.state === 'GROUNDED') text = s.connected ? 'Pipa no chão — recolha com R' : 'Pipa no chão';
    this.msg.textContent = text;
  }

  dispose(): void {
    this.root.remove();
    this.combat.remove();
    this.feed.remove();
    this.bannerEl.remove();
    this.promptEl.remove();
    this.replayEl.remove();
    this.style.remove();
  }
}
