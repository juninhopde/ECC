import { DIFFICULTY_LABELS, DIFFICULTY_ORDER, type Difficulty } from '../entities/KiteAI';
import { MODE_LABELS, MODE_ORDER, type ModeId } from '../game/types';
import { MAP_LABELS, type MapId } from '../world/GameMap';
import { SKY_PRESET_LABELS, SKY_PRESET_ORDER, type SkyPresetId } from '../world/SkyAtmosphere';
import type { GarageTab } from './GaragePanel';

export interface MenuCallbacks {
  onPlay(): void;
  onMapChange(id: MapId): void;
  onSkyChange(id: SkyPresetId): void;
  onModeChange(id: ModeId): void;
  onDifficultyChange(id: Difficulty): void;
  onTeamSizeChange(size: 3 | 4): void;
  onOpenPanel(tab: GarageTab): void;
}

const MODE_HINTS: Record<ModeId, string> = {
  bairro: 'Cenário aberto com até 8 bots, loja Valdir Pipas, missões e o Campeonato do Bairro a cada 3 minutos.',
  duelo: 'Arena dividida ao meio: melhor de 5 cortes contra um bot da dificuldade escolhida.',
  matamata: 'Dois times, sem fogo amigo e com pipas infinitas: vence quem chegar a 50 cortes.',
  ranqueado: 'Partida competitiva 1x1: o rival acompanha a sua patente e o resultado vale RP.',
};

const CSS = `
.mb-menu{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 30%,rgba(10,18,40,.55),rgba(0,0,0,.82));color:#eef3ff;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.mb-card{width:min(720px,92vw);max-height:94vh;overflow:auto;padding:24px 28px;border-radius:16px;background:rgba(14,20,36,.84);
  border:1px solid rgba(160,190,255,.22);backdrop-filter:blur(10px);box-shadow:0 20px 60px rgba(0,0,0,.55)}
.mb-title{margin:0 0 2px;font-size:44px;letter-spacing:.14em;font-weight:900;color:#ffd21f;text-shadow:0 3px 0 #7a1015}
.mb-sub{margin:0 0 6px;font-size:14px;opacity:.75}
.mb-prof{margin:0 0 10px;font-size:13px;font-weight:700;color:#ffd21f}
.mb-row{margin:12px 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
.mb-group{display:flex;flex-wrap:wrap;gap:8px}
.mb-btn{cursor:pointer;border:1px solid rgba(160,190,255,.3);background:rgba(40,56,92,.6);color:#eef3ff;padding:8px 14px;border-radius:10px;font-size:14px}
.mb-btn:hover{background:rgba(70,98,160,.7)}
.mb-btn.active{background:#ffd21f;color:#1a1204;border-color:#ffd21f;font-weight:700}
.mb-hint{margin:6px 0 0;font-size:12.5px;opacity:.78}
.mb-play{margin-top:20px;width:100%;padding:14px;font-size:18px;font-weight:800;letter-spacing:.1em;border-radius:12px;border:0;cursor:pointer;
  background:linear-gradient(180deg,#e53935,#a30f15);color:#fff}
.mb-play:hover{filter:brightness(1.12)}
.mb-keys{margin-top:16px;font-size:13px;line-height:1.7;opacity:.82}
.mb-keys kbd{background:rgba(255,255,255,.12);border-radius:5px;padding:1px 6px;font-family:ui-monospace,monospace;font-size:12px}
.mb-loading{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:#05070d;color:#cfe0ff;font:600 20px system-ui}
`;

interface Group {
  title: HTMLElement;
  box: HTMLElement;
  buttons: HTMLButtonElement[];
}

export class MainMenu {
  private readonly root = document.createElement('div');
  private readonly loading = document.createElement('div');
  private readonly style = document.createElement('style');
  private readonly groups = new Map<string, Group>();
  private readonly profile = document.createElement('p');
  private readonly hint = document.createElement('p');

  constructor(parent: HTMLElement, private readonly cb: MenuCallbacks) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root.className = 'mb-menu';
    const card = document.createElement('div');
    card.className = 'mb-card';
    const title = document.createElement('h1');
    title.className = 'mb-title';
    title.textContent = 'MANDA BUSCA';
    const sub = document.createElement('p');
    sub.className = 'mb-sub';
    sub.textContent = 'Simulador 3D de combate de pipas em primeira pessoa';
    this.profile.className = 'mb-prof';
    card.append(title, sub, this.profile);

    this.addGroup(card, 'Modo de jogo', 'mode', MODE_ORDER, (id) => MODE_LABELS[id], (id) => {
      this.hint.textContent = MODE_HINTS[id];
      this.cb.onModeChange(id);
    });
    this.hint.className = 'mb-hint';
    card.appendChild(this.hint);
    this.addGroup(card, 'Dificuldade dos bots', 'difficulty', DIFFICULTY_ORDER, (id) => DIFFICULTY_LABELS[id], (id) => this.cb.onDifficultyChange(id));
    this.addGroup(card, 'Tamanho do time', 'team', ['3', '4'] as const, (id) => `${id} x ${id}`, (id) => this.cb.onTeamSizeChange(id === '3' ? 3 : 4));
    this.addGroup(card, 'Mapa', 'map', Object.keys(MAP_LABELS) as MapId[], (id) => MAP_LABELS[id], (id) => this.cb.onMapChange(id));
    this.addGroup(card, 'Céu (também teclas 1, 2, 3 durante o jogo)', 'sky', SKY_PRESET_ORDER, (id) => SKY_PRESET_LABELS[id], (id) => this.cb.onSkyChange(id));

    const panels = document.createElement('div');
    panels.className = 'mb-group';
    panels.style.marginTop = '14px';
    for (const [tab, label] of [['equip', 'Equipamento'], ['missions', 'Missões'], ['leaderboard', 'Classificação']] as const) {
      const b = document.createElement('button');
      b.className = 'mb-btn';
      b.textContent = label;
      b.addEventListener('click', () => this.cb.onOpenPanel(tab));
      panels.appendChild(b);
    }
    card.appendChild(panels);

    const play = document.createElement('button');
    play.className = 'mb-play';
    play.textContent = 'JOGAR';
    play.addEventListener('click', () => this.cb.onPlay());
    card.appendChild(play);

    const keys = document.createElement('div');
    keys.className = 'mb-keys';
    keys.innerHTML =
      '<kbd>W A S D</kbd> mover · <kbd>Mouse</kbd> olhar · <kbd>N</kbd> ou <kbd>Clique</kbd> soltar a pipa · ' +
      '<kbd>Clique esquerdo</kbd> desbicada · <kbd>Q</kbd> / <kbd>E</kbd> inclinar o nariz · ' +
      '<kbd>Botão direito</kbd> (segurar) dar linha · <kbd>Botão direito</kbd> + cliques rápidos = tapa · ' +
      '<kbd>Scroll ↓</kbd> ou <kbd>Shift</kbd> puxada rápida · <kbd>R</kbd> (segurar) recolher / encher carretel · ' +
      '<kbd>N</kbd> com a pipa perdida = pipa nova · <kbd>F</kbd> ou <kbd>Ctrl</kbd> zoom óptico · ' +
      '<kbd>B</kbd> equipamento · <kbd>E</kbd> perto da loja (Bairro Livre) · <kbd>M</kbd> missões · <kbd>T</kbd> mais um bot · ' +
      '<kbd>1 2 3</kbd> céu · <kbd>F3</kbd> estatísticas · <kbd>Esc</kbd> menu';
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
    ids: readonly T[],
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
    this.groups.set(key, { title: h, box: g, buttons });
  }

  setActive(group: string, id: string): void {
    for (const b of this.groups.get(group)?.buttons ?? []) b.classList.toggle('active', b.dataset.id === id);
    if (group === 'mode') this.hint.textContent = MODE_HINTS[id as ModeId] ?? '';
  }

  /** Mostra ou esconde um grupo (tamanho do time so no Mata-Mata; dificuldade nao vale no Ranqueado). */
  setGroupVisible(group: string, visible: boolean): void {
    const g = this.groups.get(group);
    if (!g) return;
    g.title.style.display = visible ? '' : 'none';
    g.box.style.display = visible ? '' : 'none';
  }

  setProfileSummary(text: string): void {
    this.profile.textContent = text;
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
