/**
 * Perfil do jogador: moedas, equipamento comprado e equipado, patente (Ranqueado),
 * missoes diarias e semanais e tabela de classificacao. Persistido em localStorage;
 * toda a logica e pura (o armazenamento e injetavel) para ser testada.
 */
import { KITE_BY_ID, LINE_MODELS, REEL_BY_ID, SKIN_BY_ID, type KiteModelId, type SkinId } from './Catalog';
import type { LineId } from '../physics/LineSpec';
import type { ReelKind } from '../world/FirstPersonHands';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PATENTES: ReadonlyArray<{ name: string; minRp: number }> = [
  { name: 'Mirin', minRp: 0 },
  { name: 'Rabeiro', minRp: 100 },
  { name: 'Chocão III', minRp: 250 },
  { name: 'Chocão II', minRp: 450 },
  { name: 'Chocão I', minRp: 700 },
  { name: 'Lenda do Bairro', minRp: 1000 },
];

export interface PatenteInfo {
  index: number;
  name: string;
  /** Progresso [0, 1] ate a proxima patente (1 na ultima). */
  progress: number;
  nextName: string | null;
  nextRp: number | null;
}

export function patenteFor(rp: number): PatenteInfo {
  let index = 0;
  for (let i = 0; i < PATENTES.length; i++) if (rp >= PATENTES[i]!.minRp) index = i;
  const cur = PATENTES[index]!;
  const next = PATENTES[index + 1];
  const progress = next ? (rp - cur.minRp) / (next.minRp - cur.minRp) : 1;
  return { index, name: cur.name, progress, nextName: next?.name ?? null, nextRp: next?.minRp ?? null };
}

export type MissionStat = 'cuts' | 'aparas' | 'airtime' | 'duelWins';

export interface Mission {
  id: string;
  scope: 'diaria' | 'semanal';
  title: string;
  stat: MissionStat;
  goal: number;
  reward: number;
  progress: number;
  claimed: boolean;
}

const DAILY: ReadonlyArray<Omit<Mission, 'progress' | 'claimed' | 'scope'>> = [
  { id: 'd-cortes', title: 'Corte 3 pipas', stat: 'cuts', goal: 3, reward: 100 },
  { id: 'd-apara', title: 'Apare 1 pipa avoada', stat: 'aparas', goal: 1, reward: 80 },
  { id: 'd-ar', title: 'Fique 120 s com a pipa no ar', stat: 'airtime', goal: 120, reward: 60 },
];

const WEEKLY: ReadonlyArray<Omit<Mission, 'progress' | 'claimed' | 'scope'>> = [
  { id: 'w-cortes', title: 'Corte 20 pipas', stat: 'cuts', goal: 20, reward: 500 },
  { id: 'w-apara', title: 'Apare 5 pipas avoadas', stat: 'aparas', goal: 5, reward: 400 },
  { id: 'w-duelos', title: 'Vença 3 duelos', stat: 'duelWins', goal: 3, reward: 450 },
];

export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Semana ISO (segunda a domingo) em UTC: AAAA-Wss. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export type ItemKind = 'kite' | 'line' | 'reel' | 'skin';

export interface Equipped {
  kite: KiteModelId;
  line: LineId;
  reel: ReelKind;
  skin: SkinId;
}

export interface ProfileData {
  version: 1;
  coins: number;
  rp: number;
  matches: number;
  owned: { kite: KiteModelId[]; line: LineId[]; reel: ReelKind[]; skin: SkinId[] };
  equipped: Equipped;
  missions: { dayKey: string; weekKey: string; list: Mission[] };
  stats: { cuts: number; aparas: number; duelWins: number; championships: number };
}

const STORAGE_KEY = 'manda-busca-perfil-v1';

function defaults(now: Date): ProfileData {
  return {
    version: 1,
    coins: 200,
    rp: 0,
    matches: 0,
    owned: { kite: ['bico-medio'], line: ['linha10'], reel: ['madeira'], skin: ['padrao'] },
    equipped: { kite: 'bico-medio', line: 'linha10', reel: 'madeira', skin: 'padrao' },
    missions: { dayKey: dayKey(now), weekKey: weekKey(now), list: [...makeMissions('diaria'), ...makeMissions('semanal')] },
    stats: { cuts: 0, aparas: 0, duelWins: 0, championships: 0 },
  };
}

function makeMissions(scope: 'diaria' | 'semanal'): Mission[] {
  return (scope === 'diaria' ? DAILY : WEEKLY).map((m) => ({ ...m, scope, progress: 0, claimed: false }));
}

export interface BuyResult {
  ok: boolean;
  reason?: 'ja-possui' | 'sem-moedas' | 'item-invalido';
}

export class Profile {
  data: ProfileData;

  constructor(
    private readonly storage: StorageLike | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.data = this.load();
    this.refreshMissions();
  }

  private load(): ProfileData {
    if (this.storage) {
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ProfileData;
          if (parsed.version === 1) return this.sanitize(parsed);
        }
      } catch {
        /* armazenamento indisponivel ou corrompido: comeca do zero */
      }
    }
    return defaults(this.now());
  }

  /** Garante que itens equipados existem e foram comprados (dados antigos ou editados a mao). */
  private sanitize(d: ProfileData): ProfileData {
    const base = defaults(this.now());
    const out: ProfileData = { ...base, ...d, owned: { ...base.owned, ...d.owned }, equipped: { ...base.equipped, ...d.equipped } };
    out.coins = Math.max(0, Math.floor(Number.isFinite(out.coins) ? out.coins : base.coins));
    out.rp = Math.max(0, Math.floor(Number.isFinite(out.rp) ? out.rp : 0));
    if (!KITE_BY_ID[out.equipped.kite] || !out.owned.kite.includes(out.equipped.kite)) out.equipped.kite = 'bico-medio';
    if (!REEL_BY_ID[out.equipped.reel] || !out.owned.reel.includes(out.equipped.reel)) out.equipped.reel = 'madeira';
    if (!SKIN_BY_ID[out.equipped.skin] || !out.owned.skin.includes(out.equipped.skin)) out.equipped.skin = 'padrao';
    if (!LINE_MODELS.some((l) => l.id === out.equipped.line) || !out.owned.line.includes(out.equipped.line)) out.equipped.line = 'linha10';
    return out;
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* cota cheia ou bloqueado: o jogo segue sem persistir */
    }
  }

  get patente(): PatenteInfo {
    return patenteFor(this.data.rp);
  }

  addCoins(n: number): void {
    this.data.coins = Math.max(0, this.data.coins + Math.floor(n));
    this.save();
  }

  priceOf(kind: ItemKind, id: string): number | null {
    switch (kind) {
      case 'kite': return KITE_BY_ID[id as KiteModelId]?.price ?? null;
      case 'reel': return REEL_BY_ID[id as ReelKind]?.price ?? null;
      case 'skin': return SKIN_BY_ID[id as SkinId]?.price ?? null;
      case 'line': return LINE_MODELS.find((l) => l.id === id)?.price ?? null;
    }
  }

  owns(kind: ItemKind, id: string): boolean {
    return (this.data.owned[kind] as string[]).includes(id);
  }

  buy(kind: ItemKind, id: string): BuyResult {
    const price = this.priceOf(kind, id);
    if (price === null) return { ok: false, reason: 'item-invalido' };
    if (this.owns(kind, id)) return { ok: false, reason: 'ja-possui' };
    if (this.data.coins < price) return { ok: false, reason: 'sem-moedas' };
    this.data.coins -= price;
    (this.data.owned[kind] as string[]).push(id);
    this.save();
    return { ok: true };
  }

  /** Equipa um item ja comprado. Devolve false se nao for dono. */
  equip(kind: ItemKind, id: string): boolean {
    if (!this.owns(kind, id)) return false;
    (this.data.equipped as unknown as Record<string, string>)[kind] = id;
    this.save();
    return true;
  }

  /** Troca de dia ou de semana renova as missoes correspondentes. */
  refreshMissions(): void {
    const d = this.now();
    const m = this.data.missions;
    let changed = false;
    if (m.dayKey !== dayKey(d)) {
      m.list = [...makeMissions('diaria'), ...m.list.filter((x) => x.scope === 'semanal')];
      m.dayKey = dayKey(d);
      changed = true;
    }
    if (m.weekKey !== weekKey(d)) {
      m.list = [...m.list.filter((x) => x.scope === 'diaria'), ...makeMissions('semanal')];
      m.weekKey = weekKey(d);
      changed = true;
    }
    if (changed) this.save();
  }

  /** Registra progresso (cortes, aparas, tempo no ar, duelos vencidos). */
  record(stat: MissionStat, amount = 1): void {
    this.refreshMissions();
    for (const m of this.data.missions.list) {
      if (m.stat === stat && !m.claimed) m.progress = Math.min(m.goal, m.progress + amount);
    }
    if (stat === 'cuts') this.data.stats.cuts += amount;
    if (stat === 'aparas') this.data.stats.aparas += amount;
    if (stat === 'duelWins') this.data.stats.duelWins += amount;
    this.save();
  }

  /** Resgata a recompensa de uma missao concluida. Devolve as moedas ganhas (0 se nao pode). */
  claim(id: string): number {
    const m = this.data.missions.list.find((x) => x.id === id);
    if (!m || m.claimed || m.progress < m.goal) return 0;
    m.claimed = true;
    this.addCoins(m.reward);
    return m.reward;
  }

  /** Resultado do Ranqueado: vitoria +25 RP, derrota -15 RP (nunca abaixo de 0). */
  recordRanked(won: boolean): { delta: number; promoted: boolean } {
    const before = patenteFor(this.data.rp).index;
    const delta = won ? 25 : -15;
    this.data.rp = Math.max(0, this.data.rp + delta);
    this.data.matches += 1;
    this.save();
    return { delta, promoted: patenteFor(this.data.rp).index > before };
  }
}

export interface LeaderboardRow {
  name: string;
  rp: number;
  patente: string;
  isPlayer: boolean;
}

const RIVALS: ReadonlyArray<{ name: string; rp: number }> = [
  { name: 'Zé do Cerol', rp: 880 },
  { name: 'Dona Maria Chocão', rp: 640 },
  { name: 'Bira da Laje', rp: 520 },
  { name: 'Tonhão', rp: 410 },
  { name: 'Jorginho Mirin', rp: 230 },
  { name: 'Neguinho do Relo', rp: 120 },
];

/** Tabela de classificacao: o jogador contra rivais fixos que oscilam de forma deterministica. */
export function leaderboard(profile: Profile): LeaderboardRow[] {
  const m = profile.data.matches;
  const rows: LeaderboardRow[] = RIVALS.map((r, i) => {
    const rp = Math.max(0, r.rp + Math.round(12 * Math.sin(m * (i + 1.7) * 0.9)));
    return { name: r.name, rp, patente: patenteFor(rp).name, isPlayer: false };
  });
  rows.push({ name: 'Você', rp: profile.data.rp, patente: profile.patente.name, isPlayer: true });
  return rows.sort((a, b) => b.rp - a.rp);
}
