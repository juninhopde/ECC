/**
 * Simulacao de um passo fixo da partida: IA dos bots, combate, recompensas e regras do modo.
 * Usada pelo Game (com visuais) e pelos testes (sem navegador): o mesmo codigo, o mesmo resultado.
 */
import { Vector3 } from 'three';
import { LineSupply } from '../core/LineSupply';
import { KITE_BY_ID, LINE_MODELS, REEL_BY_ID } from '../data/Catalog';
import type { Profile } from '../data/Profile';
import { KiteAI } from '../entities/KiteAI';
import { CombatWorld } from '../physics/CombatWorld';
import { BICO_MEDIO } from '../physics/KitePhysics';
import { KiteRig, type PilotInput, type RigEnvironment } from '../physics/KiteRig';
import { LINE_SPECS } from '../physics/LineSpec';
import type { CombatEvent } from '../physics/ReloSystem';
import type { WindField } from '../physics/WindField';
import { createMode, type ModeConfig } from './modes';
import { AirTime, applyRewards } from './Rewards';
import { isLost, type Bot, type BotSpec, type GameMode, type ModeHost, type Point2 } from './types';

export interface SimMap {
  spawn: Point2 & { yaw: number };
  shop: (Point2 & { radius: number }) | null;
  groundAt(x: number, z: number): number;
  canStand(x: number, z: number): boolean;
}

export interface SimHooks {
  onBotAdded?(bot: Bot): void;
  onBotRemoved?(bot: Bot): void;
  banner?(text: string, seconds: number): void;
  feed?(text: string): void;
  status?(lines: string[] | null): void;
  divider?(line: { cx: number; cz: number; dirX: number; dirZ: number; length: number } | null): void;
  placePlayer?(x: number, z: number, yaw: number): void;
}

export class Simulation implements ModeHost {
  readonly world = new CombatWorld();
  readonly player: KiteRig;
  readonly bots: Bot[] = [];
  mode: GameMode | null = null;
  /** Ponto da mao do jogador (o Game atualiza a cada quadro). */
  readonly playerAnchor = new Vector3();
  private time = 0;
  private botCounter = 0;
  private readonly byRig = new Map<KiteRig, Bot>();
  private readonly airTime = new AirTime();

  constructor(
    private readonly env: RigEnvironment,
    private readonly wind: WindField,
    readonly profile: Profile,
    private readonly map: SimMap,
    private readonly hooks: SimHooks = {},
  ) {
    this.player = new KiteRig('jogador', new LineSupply(250, 1), BICO_MEDIO);
    this.world.add(this.player);
    this.equipPlayer();
  }

  get windDir(): Point2 {
    return this.wind.direction;
  }

  get spawn(): Point2 & { yaw: number } {
    return this.map.spawn;
  }

  get shop(): (Point2 & { radius: number }) | null {
    return this.map.shop;
  }

  now(): number {
    return this.time;
  }

  groundAt(x: number, z: number): number {
    return this.map.groundAt(x, z);
  }

  canStand(x: number, z: number): boolean {
    return this.map.canStand(x, z);
  }

  /**
   * Aplica o equipamento do perfil ao jogador. So vale com a pipa na mao, e so se algo mudou
   * (senao o carretel seria reabastecido a cada chamada).
   */
  equipPlayer(): boolean {
    if (this.player.state !== 'HAND') return false;
    const eq = this.profile.data.equipped;
    const reel = REEL_BY_ID[eq.reel];
    const p = this.player;
    if (p.spec.id === eq.kite && p.lineSpec.id === eq.line && p.supply.capacityYards === reel.capacityYards && p.rates === reel.rates) return true;
    p.setEquipment(KITE_BY_ID[eq.kite].spec, LINE_SPECS[eq.line], { capacityYards: reel.capacityYards, rates: reel.rates });
    return true;
  }

  addBot(spec: BotSpec): Bot {
    const n = ++this.botCounter;
    const lineModel = LINE_MODELS.find((l) => l.id === spec.line);
    const rig = new KiteRig(`bot-${n}`, new LineSupply(250, 1), KITE_BY_ID[spec.kite].spec, LINE_SPECS[lineModel?.id ?? 'linha10']);
    rig.team = spec.team;
    const bot: Bot = { id: rig.id, name: spec.name, rig, ai: new KiteAI(rig, spec.difficulty, 1000 + n * 17), anchor: spec.anchor.clone(), team: spec.team, skin: spec.skin, respawnAt: -1 };
    this.bots.push(bot);
    this.byRig.set(rig, bot);
    this.world.add(rig);
    this.hooks.onBotAdded?.(bot);
    return bot;
  }

  removeBot(bot: Bot): void {
    const i = this.bots.indexOf(bot);
    if (i >= 0) this.bots.splice(i, 1);
    this.byRig.delete(bot.rig);
    this.world.remove(bot.rig);
    this.hooks.onBotRemoved?.(bot);
  }

  nameOf(rig: KiteRig | undefined): string {
    if (!rig) return '?';
    if (rig === this.player) return 'Você';
    return this.byRig.get(rig)?.name ?? rig.id;
  }

  placePlayer(x: number, z: number, yaw: number): void {
    this.hooks.placePlayer?.(x, z, yaw);
  }

  banner(text: string, seconds: number): void {
    this.hooks.banner?.(text, seconds);
  }

  feed(text: string): void {
    this.hooks.feed?.(text);
  }

  status(lines: string[] | null): void {
    this.hooks.status?.(lines);
  }

  divider(line: { cx: number; cz: number; dirX: number; dirZ: number; length: number } | null): void {
    this.hooks.divider?.(line);
  }

  /** Troca o modo: remove bots e efeitos do anterior, reinicia a pipa do jogador e comeca o novo. */
  setMode(cfg: ModeConfig): void {
    this.mode?.dispose();
    for (const b of [...this.bots]) this.removeBot(b);
    this.world.relo.enabled = true;
    this.player.team = -1;
    this.player.resetToHand();
    this.equipPlayer();
    this.mode = createMode(this, cfg);
    this.mode.start();
  }

  /** Pipa perdida + N: o modo decide se a nova pipa e concedida. */
  requestRespawn(): boolean {
    if (!isLost(this.player)) return false;
    const ok = this.mode?.requestRespawn() ?? false;
    if (ok) this.equipPlayer();
    return ok;
  }

  /** Um passo fixo. Devolve os eventos de combate do passo (efeitos e kill-feed). */
  step(dt: number, playerInput: PilotInput): CombatEvent[] {
    const ctx = { rigs: this.world.rigs, relo: this.world.relo, wind: this.env.wind, groundHeight: this.env.groundHeight, time: this.time };
    for (const b of this.bots) b.ai.update(dt, ctx);
    this.env.time = this.time;
    const events = this.world.step(
      dt,
      (r) => {
        const bot = this.byRig.get(r);
        return bot ? { input: bot.ai.input, anchor: bot.anchor } : { input: playerInput, anchor: this.playerAnchor };
      },
      this.env,
    );
    this.time += dt;
    applyRewards(events, this.player, this.profile);
    this.airTime.update(dt, this.player, this.profile);
    this.mode?.update(dt, events);
    return events;
  }

  dispose(): void {
    this.mode?.dispose();
    this.mode = null;
    for (const b of [...this.bots]) this.removeBot(b);
  }
}
