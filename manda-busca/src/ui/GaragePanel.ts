/**
 * Painel unico com quatro abas: Equipamento (menu B), Loja (Valdir Pipas), Missoes e Classificacao.
 * Toda a interface e montada com textContent (sem innerHTML), a partir do Profile.
 */
import { KITE_MODELS, LINE_MODELS, REEL_MODELS, SKIN_MODELS } from '../data/Catalog';
import { leaderboard, type ItemKind, type Profile } from '../data/Profile';

export type GarageTab = 'equip' | 'shop' | 'missions' | 'leaderboard';

export interface GarageOptions {
  /** Pode comprar agora (esta perto da loja, no Bairro Livre). */
  shopEnabled: boolean;
  /** A pipa esta na mao: trocar equipamento vale ja; senao vale na proxima pipa. */
  swapNow: boolean;
}

export interface GarageCallbacks {
  /** Equipamento, compra ou missao mudou (o Game reaplica o equipamento). */
  onChange(): void;
  onClose(): void;
}

const TAB_LABELS: Record<GarageTab, string> = {
  equip: 'Equipamento (B)',
  shop: 'Loja Valdir Pipas',
  missions: 'Missões',
  leaderboard: 'Classificação',
};

const CSS = `
.mb-garage{position:fixed;inset:0;z-index:35;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);
  color:#eef3ff;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.mb-gcard{width:min(860px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:16px;background:rgba(14,20,36,.96);
  border:1px solid rgba(160,190,255,.25);box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
.mb-ghead{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid rgba(160,190,255,.18);flex-wrap:wrap}
.mb-ghead .coins{margin-left:auto;font-weight:800;color:#ffd21f}
.mb-tab{cursor:pointer;border:1px solid rgba(160,190,255,.3);background:rgba(40,56,92,.6);color:#eef3ff;padding:7px 12px;border-radius:9px;font-size:13px}
.mb-tab.active{background:#ffd21f;color:#1a1204;border-color:#ffd21f;font-weight:700}
.mb-gbody{padding:14px 16px;overflow:auto}
.mb-gnote{font-size:13px;opacity:.8;margin:0 0 10px}
.mb-gsec{margin:14px 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
.mb-gitem{display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:10px;background:rgba(40,56,92,.4);border:1px solid rgba(160,190,255,.15)}
.mb-gitem.on{border-color:#66bb6a;background:rgba(60,110,70,.35)}
.mb-gitem .info{flex:1;min-width:0}
.mb-gitem .name{font-weight:700}
.mb-gitem .desc{font-size:12px;opacity:.75}
.mb-gbtn{cursor:pointer;border:0;border-radius:8px;padding:7px 12px;font-weight:700;font-size:13px;background:#e53935;color:#fff;white-space:nowrap}
.mb-gbtn[disabled]{opacity:.4;cursor:default}
.mb-gbtn.alt{background:#2e7d32}
.mb-gbtn.ghost{background:rgba(255,255,255,.12)}
.mb-gbar{height:8px;border-radius:5px;background:rgba(0,0,0,.45);overflow:hidden;margin-top:4px}
.mb-gbar i{display:block;height:100%;background:linear-gradient(90deg,#66bb6a,#ffd54f)}
.mb-gtable{width:100%;border-collapse:collapse;font-size:14px}
.mb-gtable td,.mb-gtable th{padding:7px 10px;text-align:left;border-bottom:1px solid rgba(160,190,255,.12)}
.mb-gtable tr.me td{background:rgba(255,210,31,.16);font-weight:800}
.mb-gfoot{padding:10px 16px;border-top:1px solid rgba(160,190,255,.18);text-align:right}
`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export class GaragePanel {
  private readonly root = h('div', 'mb-garage');
  private readonly style = h('style');
  private readonly head = h('div', 'mb-ghead');
  private readonly body = h('div', 'mb-gbody');
  private readonly coins = h('span', 'coins');
  private readonly tabs = new Map<GarageTab, HTMLButtonElement>();
  private tab: GarageTab = 'equip';
  private opts: GarageOptions = { shopEnabled: false, swapNow: true };

  constructor(parent: HTMLElement, private readonly profile: Profile, private readonly cb: GarageCallbacks) {
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const card = h('div', 'mb-gcard');
    for (const t of Object.keys(TAB_LABELS) as GarageTab[]) {
      const b = h('button', 'mb-tab', TAB_LABELS[t]);
      b.addEventListener('click', () => this.show(t));
      this.tabs.set(t, b);
      this.head.appendChild(b);
    }
    this.head.appendChild(this.coins);
    const foot = h('div', 'mb-gfoot');
    const close = h('button', 'mb-gbtn ghost', 'Fechar');
    close.addEventListener('click', () => this.cb.onClose());
    foot.appendChild(close);
    card.append(this.head, this.body, foot);
    this.root.appendChild(card);
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display === 'flex';
  }

  open(tab: GarageTab, opts: GarageOptions): void {
    this.opts = opts;
    this.root.style.display = 'flex';
    this.show(tab);
  }

  close(): void {
    this.root.style.display = 'none';
  }

  /** Redesenha a aba atual (depois de uma compra, de equipar ou de um resgate). */
  refresh(): void {
    this.show(this.tab);
  }

  private show(tab: GarageTab): void {
    this.tab = tab;
    this.profile.refreshMissions();
    for (const [t, b] of this.tabs) b.classList.toggle('active', t === tab);
    this.coins.textContent = `${this.profile.data.coins} moedas`;
    this.body.replaceChildren();
    if (tab === 'equip') this.renderItems(false);
    else if (tab === 'shop') this.renderItems(true);
    else if (tab === 'missions') this.renderMissions();
    else this.renderLeaderboard();
  }

  private renderItems(shop: boolean): void {
    const p = this.profile;
    if (shop) {
      this.body.appendChild(
        h('p', 'mb-gnote', this.opts.shopEnabled
          ? 'Bem-vindo à Valdir Pipas! Compre com as moedas ganhas em cortes e aparas.'
          : 'Para comprar, vá até a porta da loja Valdir Pipas no Bairro Livre e aperte E. Aqui você só vê os preços.'),
      );
    } else if (!this.opts.swapNow) {
      this.body.appendChild(h('p', 'mb-gnote', 'Sua pipa está no ar: o equipamento novo vale na próxima pipa (com a pipa na mão).'));
    }
    const section = (title: string, kind: ItemKind, rows: Array<{ id: string; label: string; desc: string; price: number }>): void => {
      this.body.appendChild(h('div', 'mb-gsec', title));
      for (const r of rows) {
        const owned = p.owns(kind, r.id);
        const equipped = (p.data.equipped as unknown as Record<string, string>)[kind] === r.id;
        const row = h('div', `mb-gitem${equipped ? ' on' : ''}`);
        const info = h('div', 'info');
        info.append(h('div', 'name', r.label), h('div', 'desc', r.desc));
        const btn = h('button', 'mb-gbtn');
        if (shop) {
          if (owned) {
            btn.textContent = 'Comprado';
            btn.disabled = true;
            btn.classList.add('ghost');
          } else {
            btn.textContent = `Comprar · ${r.price}`;
            btn.disabled = !this.opts.shopEnabled || p.data.coins < r.price;
            btn.addEventListener('click', () => {
              if (p.buy(kind, r.id).ok) {
                this.cb.onChange();
                this.refresh();
              }
            });
          }
        } else if (owned) {
          btn.textContent = equipped ? 'Equipado' : 'Equipar';
          btn.disabled = equipped;
          btn.classList.add('alt');
          btn.addEventListener('click', () => {
            if (p.equip(kind, r.id)) {
              this.cb.onChange();
              this.refresh();
            }
          });
        } else {
          btn.textContent = `Bloqueado · ${r.price}`;
          btn.disabled = true;
          btn.classList.add('ghost');
        }
        row.append(info, btn);
        this.body.appendChild(row);
      }
    };
    section('Pipa', 'kite', KITE_MODELS.map((k) => ({
      id: k.id, label: k.label, price: k.price,
      desc: `${k.description} Peso ${(k.spec.mass * 1000).toFixed(0)} g · área ${(k.spec.area * 10000).toFixed(0)} cm² · ${k.spec.hasTail ? 'com rabiola' : 'sem rabiola'}.`,
    })));
    section('Linha', 'line', LINE_MODELS.map((l) => ({ id: l.id, label: l.label, price: l.price, desc: l.description })));
    section('Carretel', 'reel', REEL_MODELS.map((r) => ({ id: r.id, label: r.label, price: r.price, desc: r.description })));
    section('Skin', 'skin', SKIN_MODELS.map((s) => ({ id: s.id, label: s.label, price: s.price, desc: `Cores ${s.skin.c1} e ${s.skin.c2}.` })));
  }

  private renderMissions(): void {
    const p = this.profile;
    for (const scope of ['diaria', 'semanal'] as const) {
      this.body.appendChild(h('div', 'mb-gsec', scope === 'diaria' ? 'Missões diárias' : 'Missões semanais'));
      for (const m of p.data.missions.list.filter((x) => x.scope === scope)) {
        const row = h('div', `mb-gitem${m.claimed ? ' on' : ''}`);
        const info = h('div', 'info');
        info.append(h('div', 'name', m.title), h('div', 'desc', `${m.progress} / ${m.goal} · recompensa ${m.reward} moedas`));
        const bar = h('div', 'mb-gbar');
        const fill = h('i');
        fill.style.width = `${Math.round((m.progress / m.goal) * 100)}%`;
        bar.appendChild(fill);
        info.appendChild(bar);
        const btn = h('button', 'mb-gbtn alt');
        if (m.claimed) {
          btn.textContent = 'Resgatada';
          btn.disabled = true;
          btn.classList.add('ghost');
        } else {
          btn.textContent = `Resgatar +${m.reward}`;
          btn.disabled = m.progress < m.goal;
          btn.addEventListener('click', () => {
            if (p.claim(m.id) > 0) {
              this.cb.onChange();
              this.refresh();
            }
          });
        }
        row.append(info, btn);
        this.body.appendChild(row);
      }
    }
  }

  private renderLeaderboard(): void {
    const p = this.profile;
    this.body.appendChild(h('p', 'mb-gnote', `Sua patente: ${p.patente.name} · ${p.data.rp} RP · ${p.data.matches} partidas ranqueadas. Vitória +25 RP, derrota -15 RP.`));
    const table = h('table', 'mb-gtable');
    const head = h('tr');
    for (const t of ['#', 'Jogador', 'Patente', 'RP']) head.appendChild(h('th', undefined, t));
    table.appendChild(head);
    leaderboard(p).forEach((r, i) => {
      const tr = h('tr', r.isPlayer ? 'me' : undefined);
      for (const t of [String(i + 1), r.name, r.patente, String(r.rp)]) tr.appendChild(h('td', undefined, t));
      table.appendChild(tr);
    });
    this.body.appendChild(table);
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
