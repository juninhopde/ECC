import type { ReelKind } from '../world/FirstPersonHands';
import { MAP_LABELS, type MapId } from '../world/GameMap';
import { SKY_PRESET_LABELS, SKY_PRESET_ORDER, type SkyPresetId } from '../world/SkyAtmosphere';

export interface MenuCallbacks {
  onPlay(): void;
  onMapChange(id: MapId): void;
  onSkyChange(id: SkyPresetId): void;
  onReelChange(kind: ReelKind): void;
}

const REEL_LABELS: Record<ReelKind, string> = {
  madeira: 'Carretilha de Madeira',
  aluminio: 'Carretilha de Alumínio',
  lata: 'Lata de Achocolatado',
};

const CSS = `
.mb-menu{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 30%,rgba(10,18,40,.55),rgba(0,0,0,.82));color:#eef3ff;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.mb-card{width:min(680px,92vw);max-height:92vh;overflow:auto;padding:26px 28px;border-radius:16px;background:rgba(14,20,36,.82);
  border:1px solid rgba(160,190,255,.22);backdrop-filter:blur(10px);box-shadow:0 20px 60px rgba(0,0,0,.55)}
.mb-title{margin:0 0 2px;font-size:44px;letter-spacing:.14em;font-weight:900;color:#ffd21f;text-shadow:0 3px 0 #7a1015}
.mb-sub{margin:0 0 18px;font-size:14px;opacity:.75}
.mb-row{margin:14px 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
.mb-group{display:flex;flex-wrap:wrap;gap:8px}
.mb-btn{cursor:pointer;border:1px solid rgba(160,190,255,.3);background:rgba(40,56,92,.6);color:#eef3ff;padding:9px 14px;border-radius:10px;font-size:14px}
.mb-btn:hover{background:rgba(70,98,160,.7)}
.mb-btn.active{background:#ffd21f;color:#1a1204;border-color:#ffd21f;font-weight:700}
.mb-play{margin-top:22px;width:100%;padding:14px;font-size:18px;font-weight:800;letter-spacing:.1em;border-radius:12px;border:0;cursor:pointer;
  background:linear-gradient(180deg,#e53935,#a30f15);color:#fff}
.mb-play:hover{filter:brightness(1.12)}
.mb-keys{margin-top:18px;font-size:13px;line-height:1.7;opacity:.82}
.mb-keys kbd{background:rgba(255,255,255,.12);border-radius:5px;padding:1px 6px;font-family:ui-monospace,monospace;font-size:12px}
.mb-loading{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:#05070d;color:#cfe0ff;font:600 20px system-ui}
`;

export class MainMenu {
  private readonly root = document.createElement('div');
  private readonly loading = document.createElement('div');
  private readonly style = document.createElement('style');
  private readonly groups = new Map<string, HTMLButtonElement[]>();

  constructor(parent: HTMLElement, private readonly cb: MenuCallbacks) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'mb-menu';
    const card = document.createElement('div');
    card.className = 'mb-card';
    card.innerHTML =
      '<h1 class="mb-title">MANDA BUSCA</h1>' +
      '<p class="mb-sub">Simulador 3D de combate de pipas em primeira pessoa</p>';
    this.addGroup(card, 'Mapa', 'map', Object.keys(MAP_LABELS) as MapId[], (id) => MAP_LABELS[id], (id) => this.cb.onMapChange(id));
    this.addGroup(card, 'Céu (também teclas 1, 2, 3 durante o jogo)', 'sky', SKY_PRESET_ORDER, (id) => SKY_PRESET_LABELS[id], (id) => this.cb.onSkyChange(id));
    this.addGroup(card, 'Carretel', 'reel', Object.keys(REEL_LABELS) as ReelKind[], (id) => REEL_LABELS[id], (id) => this.cb.onReelChange(id));

    const play = document.createElement('button');
    play.className = 'mb-play';
    play.textContent = 'JOGAR';
    play.addEventListener('click', () => this.cb.onPlay());
    card.appendChild(play);

    const keys = document.createElement('div');
    keys.className = 'mb-keys';
    keys.innerHTML =
      '<kbd>W A S D</kbd> mover \u00b7 <kbd>Mouse</kbd> olhar \u00b7 <kbd>N</kbd> ou <kbd>Clique</kbd> soltar a pipa \u00b7 ' +
      '<kbd>Clique esquerdo</kbd> desbicada \u00b7 <kbd>Q</kbd> / <kbd>E</kbd> inclinar o nariz \u00b7 ' +
      '<kbd>Bot\u00e3o direito</kbd> (segurar) dar linha \u00b7 <kbd>Bot\u00e3o direito</kbd> + cliques r\u00e1pidos = tapa \u00b7 ' +
      '<kbd>Scroll \u2193</kbd> ou <kbd>Shift</kbd> puxada r\u00e1pida \u00b7 <kbd>R</kbd> (segurar) recolher / encher carretel \u00b7 ' +
      '<kbd>T</kbd> pipa de treino \u00b7 <kbd>F</kbd> ou <kbd>Ctrl</kbd> zoom \u00f3ptico \u00b7 <kbd>1 2 3</kbd> c\u00e9u \u00b7 <kbd>F3</kbd> estat\u00edsticas \u00b7 <kbd>Esc</kbd> menu';
    card.appendChild(keys);
    this.root.appendChild(card);
    parent.appendChild(this.root);

    this.loading.className = 'mb-loading';
    this.loading.textContent = 'Carregando cenário...';
    parent.appendChild(this.loading);
  }

  private addGroup<T extends string>(
    card: HTMLElement,
    title: string,
    key: string,
    ids: T[],
    label: (id: T) => string,
    onPick: (id: T) => void,
  ): void {
    const h = document.createElement('div');
    h.className = 'mb-row';
    h.textContent = title;
    card.appendChild(h);
    const g = document.createElement('div');
    g.className = 'mb-group';
    const buttons: HTMLButtonElement[] = [];
    for (const id of ids) {
      const b = document.createElement('button');
      b.className = 'mb-btn';
      b.textContent = label(id);
      b.dataset.id = id;
      b.addEventListener('click', () => {
        this.setActive(key, id);
        onPick(id);
      });
      g.appendChild(b);
      buttons.push(b);
    }
    card.appendChild(g);
    this.groups.set(key, buttons);
  }

  setActive(group: 'map' | 'sky' | 'reel' | string, id: string): void {
    for (const b of this.groups.get(group) ?? []) b.classList.toggle('active', b.dataset.id === id);
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  setLoading(on: boolean): void {
    this.loading.style.display = on ? 'flex' : 'none';
  }

  dispose(): void {
    this.root.remove();
    this.loading.remove();
    this.style.remove();
  }
}
