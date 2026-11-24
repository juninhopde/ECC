import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { AudioEngine } from './core/AudioEngine';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { LineSupply } from './core/LineSupply';
import { clamp, lerp } from './core/noise';
import { PlayerController } from './core/PlayerController';
import { SKIN_BY_ID } from './data/Catalog';
import { Profile, type StorageLike } from './data/Profile';
import { ContactFx } from './entities/ContactFx';
import type { Difficulty } from './entities/KiteAI';
import { RigView } from './entities/RigView';
import { GhostRig, REPLAY_SPEEDS, ReplayPlayer, ReplayRecorder } from './game/Replay';
import { Simulation } from './game/Simulation';
import { isLost, type ModeId } from './game/types';
import { type KiteRig, type PilotInput, type RigEnvironment } from './physics/KiteRig';
import { MIN_POWER, lineResistance, type CombatEvent } from './physics/ReloSystem';
import { WindField } from './physics/WindField';
import { DebugStats } from './ui/DebugStats';
import { GaragePanel, type GarageTab } from './ui/GaragePanel';
import { HUD } from './ui/HUD';
import { KiteLabels, type LabelEntry } from './ui/KiteLabels';
import { MainMenu } from './ui/MainMenu';
import { FirstPersonHands, type HandsInput } from './world/FirstPersonHands';
import type { GameMap, MapId } from './world/GameMap';
import { createMap } from './world/maps';
import { setMaxAnisotropy } from './world/ProceduralTextures';
import { SKY_PRESET_ORDER, SkyAtmosphere, type SkyPresetId } from './world/SkyAtmosphere';

export interface GameOptions {
  map: MapId;
  sky: SkyPresetId;
  mode: ModeId;
  difficulty: Difficulty;
  /** Bots do Bairro Livre (opcional, padrao do modo). */
  bots?: number;
  /** Tempos do Campeonato do Bairro (so para depuracao e validacao: padrao 180/20/60 s). */
  championship?: { first: number; timings: { everySeconds: number; prepSeconds: number; runSeconds: number } };
  /** Pula o menu e o travamento de ponteiro (captura automatizada). */
  autostart: boolean;
}

/** localStorage pode lancar (modo privado, dados bloqueados): o perfil funciona sem ele. */
function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const BASE_FOV = 75;
const ZOOM_FOV = 20;
const NEXT_FRAME = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 5000);
  readonly controls: PointerLockControls;
  readonly input: InputManager;
  readonly sky: SkyAtmosphere;
  readonly hands: FirstPersonHands;
  readonly menu: MainMenu;
  readonly hud: HUD;
  readonly stats: DebugStats;
  readonly loop: GameLoop;
  readonly wind = new WindField();
  readonly profile: Profile;
  readonly garage: GaragePanel;
  readonly fx = new ContactFx();
  readonly audio = new AudioEngine();
  readonly recorder = new ReplayRecorder();
  readonly labels: KiteLabels;
  map!: GameMap;
  player!: PlayerController;
  sim!: Simulation;
  mapId: MapId;
  skyId: SkyPresetId;
  modeId: ModeId;
  difficulty: Difficulty;
  teamSize: 3 | 4 = 3;
  zoomT = 0;

  private readonly container: HTMLElement;
  private readonly autostart: boolean;
  private readonly options: GameOptions;
  private readonly focus = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly pilot: PilotInput = {
    launch: false, desbicada: false, tapaClick: false, qe: 0, payOut: false, quickPull: false, reel: false,
  };
  private readonly env: RigEnvironment;
  private readonly views = new Map<KiteRig, RigView>();
  private handsInput: HandsInput = { lineSpeed: 0, tension: 0.35, reeling: false, fill: 1 };
  private quickPullTimer = 0;
  private loadingMap = false;
  private modeDirty = true;
  private divider: Mesh | null = null;
  private replay: ReplayPlayer | null = null;
  private savedCamera: { rotation: Euler; fov: number } | null = null;
  private readonly replayTarget = new Vector3();
  private readonly hiddenGhost = new GhostRig('oculta');
  private readonly labelEntries: LabelEntry[] = [];
  private shownReel = '';
  private profileKey = '';
  private readonly lookMatrix = new Matrix4();
  private readonly lookQuat = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.options = options;
    this.autostart = options.autostart;
    this.mapId = options.map;
    this.skyId = options.sky;
    this.modeId = options.mode;
    this.difficulty = options.difficulty;
    this.profile = new Profile(safeStorage());

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    // O Three r187 removeu PCFSoftShadowMap; PCFShadowMap e o equivalente atual (filtro suave).
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    container.appendChild(this.renderer.domElement);

    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(this.fx.group);

    this.input = new InputManager(this.renderer.domElement);
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI - 0.12;
    this.controls.addEventListener('lock', () => {
      this.input.enabled = true;
      this.menu.hide();
    });
    this.controls.addEventListener('unlock', () => {
      this.input.enabled = false;
      this.input.releaseAll();
      this.exitReplay();
      // Abrir a garagem solta o ponteiro de proposito: nesse caso o menu principal nao aparece.
      if (!this.garage.visible) this.menu.show();
    });

    this.sky = new SkyAtmosphere(this.scene, this.renderer, options.sky);
    this.hands = new FirstPersonHands(this.camera.aspect);
    this.hands.setSkyLineVisible(false);
    this.stats = new DebugStats(container);
    this.hud = new HUD(container);
    this.labels = new KiteLabels(container);
    this.hiddenGhost.state = 'CAPTURED';

    this.garage = new GaragePanel(container, this.profile, {
      onChange: () => this.onEquipmentChange(),
      onClose: () => this.closeGarage(true),
    });
    window.addEventListener('keydown', (e) => {
      if (this.garage.visible && (e.code === 'Escape' || e.code === 'KeyB')) {
        e.preventDefault();
        this.closeGarage(false);
      }
    });

    this.menu = new MainMenu(container, {
      onPlay: () => this.play(),
      onMapChange: (id) => void this.loadMap(id),
      onSkyChange: (id) => this.setSky(id, false),
      onModeChange: (id) => this.setModeId(id),
      onDifficultyChange: (d) => {
        this.difficulty = d;
        this.modeDirty = true;
      },
      onTeamSizeChange: (n) => {
        this.teamSize = n;
        this.modeDirty = true;
      },
      onOpenPanel: (tab) => this.openGarage(tab),
    });
    this.menu.setActive('map', this.mapId);
    this.menu.setActive('sky', this.skyId);
    this.menu.setActive('mode', this.modeId);
    this.menu.setActive('difficulty', this.difficulty);
    this.menu.setActive('team', String(this.teamSize));
    this.syncMenuGroups();

    this.env = {
      wind: this.wind.sample,
      time: 0,
      groundHeight: (x, z) => (this.map ? this.map.walk.surfaceHeightAt(x, z, 1e9) : 0),
      wires: [],
    };

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, frameDt, now) => this.render(alpha, frameDt, now),
    });
    window.addEventListener('resize', () => this.resize());
  }

  get rig(): KiteRig {
    return this.sim.player;
  }

  get supply(): LineSupply {
    return this.sim.player.supply;
  }

  get world(): Simulation['world'] {
    return this.sim.world;
  }

  /** Tempo de simulacao (s): avanca so nos passos fixos; o vento depende dele. */
  get simTime(): number {
    return this.sim ? this.sim.now() : 0;
  }

  /** Menu ou garagem abertos: a simulacao fica parada. */
  get paused(): boolean {
    return this.menu.visible || this.garage.visible || this.replay !== null;
  }

  async start(): Promise<void> {
    await this.loadMap(this.mapId);
    if (this.autostart) {
      this.menu.hide();
      this.input.enabled = true;
    }
    this.loop.start();
  }

  private play(): void {
    this.audio.resume(); // o clique em JOGAR e o gesto que libera o audio do navegador
    if (this.modeDirty) this.startMode();
    if (this.autostart) {
      this.menu.hide();
      this.input.enabled = true;
      return;
    }
    this.controls.lock();
  }

  private setModeId(id: ModeId): void {
    this.modeId = id;
    this.modeDirty = true;
    this.syncMenuGroups();
  }

  private syncMenuGroups(): void {
    this.menu.setGroupVisible('team', this.modeId === 'matamata');
    this.menu.setGroupVisible('difficulty', this.modeId !== 'ranqueado');
  }

  /** Comeca o modo escolhido do zero: bots, placar e contagens. */
  startMode(): void {
    this.sim.setMode({
      id: this.modeId,
      difficulty: this.difficulty,
      teamSize: this.teamSize,
      bots: this.options.bots,
      timings: this.options.championship?.timings,
      firstChampionshipAt: this.options.championship ? this.sim.now() + this.options.championship.first : undefined,
    });
    this.modeDirty = false;
    this.recorder.reset();
    this.onEquipmentChange();
  }

  async loadMap(id: MapId): Promise<void> {
    if (this.loadingMap) return;
    this.loadingMap = true;
    this.menu.setLoading(true);
    await NEXT_FRAME();
    await new Promise((r) => setTimeout(r, 30));
    this.exitReplay();
    this.disposeSim();
    if (this.map) {
      this.scene.remove(this.map.root);
      this.map.dispose();
    }
    this.mapId = id;
    this.map = createMap(id);
    this.scene.add(this.map.root);
    this.wind.setProfile(this.map.wind);
    this.env.wires = this.map.wires;
    this.player = new PlayerController(this.map.walk, this.map.spawn.x, this.map.spawn.z);
    this.camera.rotation.set(0, this.map.spawn.yaw, 0, 'YXZ');
    this.buildSim();
    this.startMode();
    this.menu.setActive('map', id);
    this.menu.setLoading(false);
    this.loadingMap = false;
  }

  /** Nova simulacao para o mapa: piloto do jogador, ganchos de interface e bots com suas vistas. */
  private buildSim(): void {
    const map = this.map;
    this.sim = new Simulation(
      this.env,
      this.wind,
      this.profile,
      {
        spawn: map.spawn,
        shop: map.shop ?? null,
        groundAt: (x, z) => map.walk.terrainAt(x, z),
        canStand: (x, z) => map.walk.canStand(x, z),
      },
      {
        onBotAdded: (bot) => this.views.set(bot.rig, new RigView(this.scene, bot.rig, SKIN_BY_ID[bot.skin].skin)),
        onBotRemoved: (bot) => {
          this.views.get(bot.rig)?.dispose();
          this.views.delete(bot.rig);
        },
        banner: (text, seconds) => this.hud.banner(text, seconds),
        feed: (text) => this.hud.notify(text, this.sim.now()),
        status: (lines) => this.hud.setStatus(lines),
        divider: (line) => this.setDivider(line),
        placePlayer: (x, z, yaw) => this.placePlayer(x, z, yaw),
      },
    );
    this.sim.playerAnchor.set(map.spawn.x, this.player.body.y + 1.3, map.spawn.z);
    this.views.set(this.sim.player, new RigView(this.scene, this.sim.player, SKIN_BY_ID[this.profile.data.equipped.skin].skin));
  }

  private disposeSim(): void {
    this.sim?.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.setDivider(null);
  }

  /** Leva o jogador (e a mao da linha) ate (x, z), olhando para `yaw`. */
  private placePlayer(x: number, z: number, yaw: number): void {
    this.player.teleport(this.map.walk, x, z);
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
    this.sim.playerAnchor.set(x, this.player.body.y + 1.3, z);
  }

  /** Faixa branca no chao (arena do Duelo), acompanhando o relevo. */
  private setDivider(line: { cx: number; cz: number; dirX: number; dirZ: number; length: number } | null): void {
    if (this.divider) {
      this.scene.remove(this.divider);
      this.divider.geometry.dispose();
      (this.divider.material as MeshBasicMaterial).dispose();
      this.divider = null;
    }
    if (!line) return;
    const n = Math.ceil(line.length / 2);
    const half = 0.12;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * line.length;
      const x = line.cx + line.dirX * t;
      const z = line.cz + line.dirZ * t;
      const y = this.map.walk.terrainAt(x, z) + 0.06;
      pos.set([x - line.dirZ * half, y, z + line.dirX * half, x + line.dirZ * half, y, z - line.dirX * half], i * 6);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new MeshBasicMaterial({ color: 0xf2f2ea, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.divider = new Mesh(geo, mat);
    this.divider.name = 'divider';
    this.divider.frustumCulled = false;
    this.scene.add(this.divider);
  }

  /** C: exibe o ultimo corte (ou os ultimos 5 s) com camera orbital no ponto em que as linhas se cruzaram. */
  startReplay(): void {
    if (this.replay) return;
    const clip = this.recorder.clip() ?? this.recorder.liveClip(this.sim.player.kite.pos);
    if (!clip || clip.frames.length < 10) {
      this.hud.banner('Ainda n\u00e3o h\u00e1 nada para reprisar.', 2);
      return;
    }
    this.savedCamera = { rotation: this.camera.rotation.clone(), fov: this.camera.fov };
    this.replay = new ReplayPlayer(clip);
    this.hud.setReplay(this.replay.speed, REPLAY_SPEEDS);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
  }

  exitReplay(): void {
    if (!this.replay) return;
    this.replay = null;
    this.hud.setReplay(null, REPLAY_SPEEDS);
    if (this.savedCamera) {
      this.camera.rotation.copy(this.savedCamera.rotation);
      this.camera.fov = this.savedCamera.fov;
      this.camera.updateProjectionMatrix();
      this.savedCamera = null;
    }
  }

  private renderReplay(frameDt: number, now: number): void {
    const replay = this.replay!;
    replay.advance(frameDt);
    const ghosts = replay.sample();
    replay.orbit(this.camera.position, this.replayTarget);
    this.camera.lookAt(this.replayTarget);
    this.camera.updateMatrixWorld();
    this.focus.copy(this.camera.position);
    this.sky.update(frameDt, this.camera, this.focus);
    this.map.update(frameDt, now);
    this.map.setNight(this.sky.nightFactor);
    const byId = new Map<string, GhostRig>(ghosts.map((g) => [g.id, g]));
    for (const [r, v] of this.views) v.update(byId.get(r.id) ?? this.hiddenGhost, this.camera.position, now);
    this.fx.update(frameDt, [], () => 0, now);
    this.hud.show(false);
    this.labels.update(this.camera, this.container.clientWidth, this.container.clientHeight, [], false);
    this.audio.update(frameDt, { windSpeed: this.wind.meanSpeed, tension: 0, lineSpeed: 0, connected: false, paused: false });
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.stats.update(frameDt, this.renderer, `replay ${replay.speed}x  t ${replay.time.toFixed(2)} / ${replay.clip.duration.toFixed(2)} s`);
  }

  private onEquipmentChange(): void {
    this.sim.equipPlayer();
    const eq = this.profile.data.equipped;
    if (this.shownReel !== eq.reel) {
      this.hands.setReel(eq.reel);
      this.shownReel = eq.reel;
    }
    this.views.get(this.sim.player)?.refresh(this.sim.player, SKIN_BY_ID[eq.skin].skin);
    this.menu.setProfileSummary(`${this.profile.patente.name} \u00b7 ${this.profile.data.rp} RP \u00b7 ${this.profile.data.coins} moedas`);
  }

  private nearShop(): boolean {
    const shop = this.map.shop;
    if (!shop || this.sim.mode?.id !== 'bairro') return false;
    const p = this.camera.position;
    return Math.hypot(p.x - shop.x, p.z - shop.z) < shop.radius;
  }

  openGarage(tab: GarageTab): void {
    const opts = { shopEnabled: this.nearShop(), swapNow: this.sim.player.state === 'HAND' };
    if (this.garage.visible) {
      this.garage.open(tab, opts);
      return;
    }
    // Em autostart nao ha trava de ponteiro: desabilita a entrada para os cliques da interface nao virarem comandos.
    if (this.autostart) {
      this.input.enabled = false;
      this.input.releaseAll();
    }
    this.controls.unlock();
    this.garage.open(tab, opts);
  }

  private closeGarage(viaClick: boolean): void {
    this.garage.close();
    this.onEquipmentChange();
    if (this.autostart) {
      this.input.enabled = !this.menu.visible;
      return;
    }
    if (this.menu.visible) return;
    // O clique do botao e um gesto do usuario (pode travar o ponteiro); o Esc nao: volta ao menu.
    if (viaClick) this.controls.lock();
    else this.menu.show();
  }

  private handleEvents(events: CombatEvent[], now: number): void {
    const name = (r: KiteRig | undefined): string => this.sim.nameOf(r);
    for (const e of events) {
      const who = name(e.attacker);
      const vic = name(e.victim);
      switch (e.type) {
        case 'cut': this.hud.notify(`${who} \u2702\uFE0F ${vic}`, now); break;
        case 'bridle-cut': this.hud.notify(`${who} \u2702\uFE0F ${vic} (estirante)`, now); break;
        case 'tail-cut': this.hud.notify(`${who} cortou a rabiola de ${vic}`, now); break;
        case 'capture': this.hud.notify(`${who} \u{1FA81} Aparou pipa avoada (${e.hookKind})`, now); break;
        case 'hook-saw': this.hud.notify(`${who === 'Voc\u00ea' ? 'A avoada' : who} serrou a linha de ${vic}`, now); break;
        default: break;
      }
      if (e.point && (e.type === 'cut' || e.type === 'bridle-cut' || e.type === 'tail-cut' || e.type === 'hook-saw')) this.fx.burst(e.point, 40, 6);
      if (e.point && e.type === 'hook') this.fx.burst(e.point, 12, 2.5);
      if (e.point && (e.type === 'cut' || e.type === 'bridle-cut' || e.type === 'hook-saw')) {
        this.audio.cut(e.point.distanceTo(this.camera.position));
        if (e.type !== 'hook-saw') {
          const mine = this.sim.player;
          this.recorder.markCut(e.point, e.attacker === mine || e.victim === mine, now);
        }
      }
    }
  }

  setSky(id: SkyPresetId, instant: boolean): void {
    this.skyId = id;
    this.sky.setPreset(id, instant);
    this.menu.setActive('sky', id);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hands.resize(this.camera.aspect);
  }

  private currentYaw(): number {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    return this.euler.y;
  }

  /** Traduz teclado e mouse nos comandos do piloto. */
  private readPilot(dt: number): void {
    const inp = this.input;
    const rig = this.sim.player;
    const inHand = rig.state === 'HAND';
    const lmb = inp.mousePressed(0);
    const rmb = inp.mouseDown(2);
    if (inp.consumeWheelDown() > 0) {
      this.quickPullTimer = 0.35;
      this.hands.triggerPull();
    }
    this.quickPullTimer = Math.max(0, this.quickPullTimer - dt);
    const shift = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    const p = this.pilot;
    // N com a pipa perdida pede pipa nova; nesse quadro ela nao e solta (so no proximo N).
    const pressedN = inp.wasPressed('KeyN');
    const respawned = pressedN && isLost(rig) && this.sim.requestRespawn();
    p.launch = !respawned && (pressedN || (lmb && inHand));
    p.desbicada = lmb && !inHand && !rmb;
    p.tapaClick = lmb && rmb && !inHand;
    p.qe = (inp.isDown('KeyQ') ? 1 : 0) - (inp.isDown('KeyE') ? 1 : 0);
    p.payOut = rmb && !inHand;
    p.quickPull = !inHand && (shift || this.quickPullTimer > 0);
    p.reel = inp.isDown('KeyR');
  }

  private fixedUpdate(dt: number): void {
    if (!this.map || this.loadingMap) return;
    if (this.paused) {
      this.input.endTick(); // arestas de entrada nao podem vazar para o primeiro quadro depois da pausa
      return;
    }
    this.player.fixedUpdate(dt, this.input, this.currentYaw());
    this.readPilot(dt);

    const rig = this.sim.player;
    const p = this.pilot;
    this.sim.equipPlayer();
    const supplyBefore = rig.supply.remaining;
    // Sem pipa no alto e com R, o carretel e reabastecido ate o limite.
    if (rig.state === 'HAND' && p.reel) rig.supply.takeIn(rig.rates.reel * dt);
    const events = this.sim.step(dt, p);
    this.recorder.record(this.sim.now(), this.sim.world.rigs);
    this.handleEvents(events, this.sim.now());
    if (p.desbicada || p.tapaClick) this.audio.paperCrackle();
    const lineSpeed = (supplyBefore - rig.supply.remaining) / dt;

    if (p.launch || p.desbicada) this.hands.triggerPull();
    if (p.tapaClick) this.hands.triggerTap();
    this.handsInput = {
      lineSpeed,
      tension: rig.line ? clamp(rig.tension / 8, 0, 1) : 0.3,
      reeling: lineSpeed < -0.1,
      fill: rig.supply.fill,
    };
    this.input.endTick();
  }

  private handleUiKeys(): void {
    if (!this.input.enabled) return;
    if (this.replay) {
      // No replay: C sai e 1, 2, 3 escolhem a velocidade (os atalhos de ceu ficam de lado).
      if (this.input.consumePressed('KeyC')) this.exitReplay();
      REPLAY_SPEEDS.forEach((v, i) => {
        if (this.input.consumePressed(`Digit${i + 1}`)) {
          this.replay?.setSpeed(v);
          this.hud.setReplay(v, REPLAY_SPEEDS);
        }
      });
      return;
    }
    if (this.input.consumePressed('KeyC')) this.startReplay();
    if (this.input.consumePressed('KeyL')) this.hud.notify(`R\u00f3tulos das pipas: ${this.labels.toggle() ? 'ligados' : 'desligados'}`, this.sim.now());
    if (this.input.consumePressed('KeyU')) {
      this.audio.setMuted(!this.audio.isMuted);
      this.hud.notify(`Som: ${this.audio.isMuted ? 'desligado' : 'ligado'}`, this.sim.now());
    }
    SKY_PRESET_ORDER.forEach((id, i) => {
      if (this.input.consumePressed(`Digit${i + 1}`)) this.setSky(id, false);
    });
    if (this.input.consumePressed('F3')) this.stats.toggle();
    if (this.input.consumePressed('KeyT')) this.sim.mode?.addBot();
    if (this.input.consumePressed('KeyB')) this.openGarage('equip');
    if (this.input.consumePressed('KeyM')) this.openGarage('missions');
    if (this.input.consumePressed('KeyE') && this.nearShop()) this.openGarage('shop');
  }

  /** Zoom otico: FOV 75 -> 20 e enquadramento travado na pipa no ceu. */
  private updateZoom(frameDt: number): void {
    const held = this.input.isDown('KeyF') || this.input.isDown('ControlLeft') || this.input.isDown('ControlRight');
    this.zoomT += ((held ? 1 : 0) - this.zoomT) * (1 - Math.exp(-frameDt * 7));
    if (Math.abs(this.zoomT) < 1e-4) this.zoomT = 0;
    const fov = lerp(BASE_FOV, ZOOM_FOV, this.zoomT);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.controls.pointerSpeed = fov / BASE_FOV;
    const rig = this.sim.player;
    if (this.zoomT > 0.05 && rig.state !== 'HAND') {
      this.lookMatrix.lookAt(this.camera.position, rig.kite.pos, this.up);
      this.lookQuat.setFromRotationMatrix(this.lookMatrix);
      this.camera.quaternion.slerp(this.lookQuat, (1 - Math.exp(-frameDt * 6)) * this.zoomT);
    }
  }

  private render(alpha: number, frameDt: number, now: number): void {
    if (!this.map || this.loadingMap) return;
    this.handleUiKeys();
    if (this.replay) {
      this.renderReplay(frameDt, now);
      return;
    }
    this.player.applyToCamera(this.camera, alpha);
    this.updateZoom(frameDt);
    this.focus.copy(this.camera.position);
    this.camera.updateMatrixWorld();

    this.sky.update(frameDt, this.camera, this.focus);
    this.map.update(frameDt, now);
    this.map.setNight(this.sky.nightFactor);

    this.hands.setLighting(this.sky.lighting, this.camera.quaternion);
    this.hands.setEnvironment(this.scene.environment, this.scene.environmentIntensity);
    this.hands.update(frameDt, this.handsInput, this.player.speed, this.zoomT);
    // Ponto exato onde a linha sai da mao, alinhado na tela com o viewmodel.
    this.hands.pinchWorld(this.camera, this.sim.playerAnchor);

    const rig = this.sim.player;
    const skin = SKIN_BY_ID[this.profile.data.equipped.skin].skin;
    this.views.get(rig)?.refresh(rig, skin);
    for (const [r, v] of this.views) v.update(r, this.camera.position, now, r === rig ? this.sim.playerAnchor : undefined);
    const world = this.sim.world;
    const reloContact = world.relo.contactFor(rig);
    this.fx.update(
      frameDt,
      world.relo.contacts.values(),
      (c) => Math.max(c.a.cutPower, c.b.cutPower) / 25,
      now,
    );

    const dir = this.wind.direction;
    this.hud.show(this.input.enabled || this.autostart);
    const pt = this.profile.patente;
    const key = `${pt.name}|${pt.progress.toFixed(3)}|${this.profile.data.rp}|${this.profile.data.coins}`;
    if (key !== this.profileKey) {
      this.profileKey = key;
      this.hud.setProfile({ patente: pt.name, progress: pt.progress, rp: this.profile.data.rp, nextRp: pt.nextRp, coins: this.profile.data.coins });
    }
    this.hud.setPrompt(this.nearShop() ? 'E \u2014 Loja Valdir Pipas' : null);
    this.labelEntries.length = 0;
    this.labelEntries.push({ rig, isPlayer: true, name: 'Voc\u00ea' });
    for (const b of this.sim.bots) this.labelEntries.push({ rig: b.rig, isPlayer: false, name: b.name });
    this.labels.update(this.camera, this.container.clientWidth, this.container.clientHeight, this.labelEntries, this.input.enabled || this.autostart);
    const reeling = Math.abs(this.handsInput.lineSpeed) > 0.05;
    this.audio.update(frameDt, {
      windSpeed: this.wind.meanSpeed,
      tension: rig.tension,
      lineSpeed: this.handsInput.lineSpeed,
      connected: rig.connected || reeling,
      paused: this.paused,
    });
    this.hud.update({
      windSpeed: this.wind.meanSpeed,
      windDirX: dir.x,
      windDirZ: dir.z,
      cameraYaw: this.currentYaw(),
      lineOutYards: (rig.supply.capacity - rig.supply.remaining) / 0.9144,
      lineTotalYards: rig.supply.capacityYards,
      state: rig.state,
      connected: rig.connected,
      captured: rig.capturedKites,
    });
    const hook = world.relo.hookFor(rig);
    const other = reloContact ? (reloContact.a === rig ? reloContact.b : reloContact.a) : null;
    this.hud.setCombat(
      {
        relo: reloContact && other && Math.max(rig.cutPower, other.cutPower) >= MIN_POWER
          ? { power: rig.cutPower, enemyPower: other.cutPower, wear: rig.wear, resistance: lineResistance(rig.lineSpec) }
          : null,
        hook: hook ? { kind: hook.kind, stress: hook.stress } : null,
      },
      this.sim.now(),
    );

    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.hands.render(this.renderer);
    this.stats.update(
      frameDt,
      this.renderer,
      `mapa ${this.mapId}  c\u00e9u ${this.skyId}  modo ${this.modeId}  pipa ${rig.state}  bots ${this.sim.bots.length}\n` +
        `altitude ${rig.kite.pos.y.toFixed(1)} m  tra\u00e7\u00e3o ${rig.tension.toFixed(1)} N  L ${rig.activeLength.toFixed(1)} m`,
    );
  }

  dispose(): void {
    this.loop.stop();
    this.disposeSim();
    this.fx.dispose();
    this.labels.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.controls.dispose();
    this.hands.dispose();
    this.sky.dispose();
    this.map?.dispose();
    this.menu.dispose();
    this.garage.dispose();
    this.hud.dispose();
    this.stats.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
