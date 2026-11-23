import {
  ACESFilmicToneMapping,
  Euler,
  Matrix4,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { LineSupply } from './core/LineSupply';
import { clamp, lerp } from './core/noise';
import { PlayerController } from './core/PlayerController';
import { KiteView } from './entities/KiteMeshBuilder';
import { LineView } from './entities/LineView';
import { KiteRig, REEL_RATE, type PilotInput, type RigEnvironment } from './physics/KiteRig';
import { WindField } from './physics/WindField';
import { DebugStats } from './ui/DebugStats';
import { HUD } from './ui/HUD';
import { MainMenu } from './ui/MainMenu';
import { FirstPersonHands, type HandsInput, type ReelKind } from './world/FirstPersonHands';
import type { GameMap, MapId } from './world/GameMap';
import { createMap } from './world/maps';
import { setMaxAnisotropy } from './world/ProceduralTextures';
import { SKY_PRESET_ORDER, SkyAtmosphere, type SkyPresetId } from './world/SkyAtmosphere';

export interface GameOptions {
  map: MapId;
  sky: SkyPresetId;
  reel: ReelKind;
  /** Pula o menu e o travamento de ponteiro (captura automatizada). */
  autostart: boolean;
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
  map!: GameMap;
  player!: PlayerController;
  rig!: KiteRig;
  mapId: MapId;
  skyId: SkyPresetId;
  reelKind: ReelKind;
  /** Tempo de simulacao (s), avanca so nos passos fixos: o vento depende dele. */
  simTime = 0;
  zoomT = 0;

  private readonly container: HTMLElement;
  private readonly autostart: boolean;
  private readonly focus = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly anchor = new Vector3();
  private readonly pilot: PilotInput = {
    launch: false, desbicada: false, tapaClick: false, qe: 0, payOut: false, quickPull: false, reel: false,
  };
  private readonly env: RigEnvironment;
  private kiteView: KiteView | null = null;
  private lineView: LineView | null = null;
  private handLineView: LineView | null = null;
  private handsInput: HandsInput = { lineSpeed: 0, tension: 0.35, reeling: false, fill: 1 };
  private quickPullTimer = 0;
  private loadingMap = false;
  private readonly lookMatrix = new Matrix4();
  private readonly lookQuat = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.autostart = options.autostart;
    this.mapId = options.map;
    this.skyId = options.sky;
    this.reelKind = options.reel;

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
      this.menu.show();
    });

    this.sky = new SkyAtmosphere(this.scene, this.renderer, options.sky);
    this.hands = new FirstPersonHands(this.camera.aspect);
    this.hands.setReel(options.reel);
    this.hands.setSkyLineVisible(false);
    this.stats = new DebugStats(container);
    this.hud = new HUD(container);

    this.menu = new MainMenu(container, {
      onPlay: () => this.play(),
      onMapChange: (id) => void this.loadMap(id),
      onSkyChange: (id) => this.setSky(id, false),
      onReelChange: (kind) => this.setReel(kind),
    });
    this.menu.setActive('map', this.mapId);
    this.menu.setActive('sky', this.skyId);
    this.menu.setActive('reel', this.reelKind);

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

  get supply(): LineSupply {
    return this.rig.supply;
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
    if (this.autostart) {
      this.menu.hide();
      this.input.enabled = true;
      return;
    }
    this.controls.lock();
  }

  async loadMap(id: MapId): Promise<void> {
    if (this.loadingMap) return;
    this.loadingMap = true;
    this.menu.setLoading(true);
    await NEXT_FRAME();
    await new Promise((r) => setTimeout(r, 30));
    this.disposeRig();
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
    this.simTime = 0;
    this.buildRig();
    this.anchor.set(this.map.spawn.x, this.player.body.y + 1.3, this.map.spawn.z);
    this.menu.setActive('map', id);
    this.menu.setLoading(false);
    this.loadingMap = false;
  }

  /** Nova pipa na mao com carretel cheio, mais as vistas da pipa e da linha. */
  private buildRig(): void {
    this.rig = new KiteRig('jogador', new LineSupply(250));
    this.kiteView = new KiteView(this.rig.spec);
    this.kiteView.setVisible(false);
    this.scene.add(this.kiteView.root, this.kiteView.tailGroup);
    this.lineView = new LineView(0xeeeee6);
    this.handLineView = new LineView(0xeeeee6);
    this.scene.add(this.lineView.mesh, this.handLineView.mesh);
  }

  private disposeRig(): void {
    if (this.kiteView) {
      this.scene.remove(this.kiteView.root, this.kiteView.tailGroup);
      this.kiteView.dispose();
      this.kiteView = null;
    }
    for (const v of [this.lineView, this.handLineView]) {
      if (v) {
        this.scene.remove(v.mesh);
        v.dispose();
      }
    }
    this.lineView = null;
    this.handLineView = null;
  }

  setSky(id: SkyPresetId, instant: boolean): void {
    this.skyId = id;
    this.sky.setPreset(id, instant);
    this.menu.setActive('sky', id);
  }

  setReel(kind: ReelKind): void {
    this.reelKind = kind;
    this.hands.setReel(kind);
    this.menu.setActive('reel', kind);
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
    const inHand = this.rig.state === 'HAND';
    const lmb = inp.mousePressed(0);
    const rmb = inp.mouseDown(2);
    if (inp.consumeWheelDown() > 0) {
      this.quickPullTimer = 0.35;
      this.hands.triggerPull();
    }
    this.quickPullTimer = Math.max(0, this.quickPullTimer - dt);
    const shift = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    const p = this.pilot;
    p.launch = inp.wasPressed('KeyN') || (lmb && inHand);
    p.desbicada = lmb && !inHand && !rmb;
    p.tapaClick = lmb && rmb && !inHand;
    p.qe = (inp.isDown('KeyQ') ? 1 : 0) - (inp.isDown('KeyE') ? 1 : 0);
    p.payOut = rmb && !inHand;
    p.quickPull = !inHand && (shift || this.quickPullTimer > 0);
    p.reel = inp.isDown('KeyR');
  }

  private fixedUpdate(dt: number): void {
    if (!this.map || this.loadingMap) return;
    this.player.fixedUpdate(dt, this.input, this.currentYaw());
    this.readPilot(dt);

    const rig = this.rig;
    const p = this.pilot;
    const supplyBefore = rig.supply.remaining;
    // Sem pipa no alto e com R, o carretel e reabastecido ate o limite.
    if (rig.state === 'HAND' && p.reel) rig.supply.takeIn(REEL_RATE * dt);
    this.env.time = this.simTime;
    rig.update(dt, p, this.anchor, this.env);
    this.simTime += dt;
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
    SKY_PRESET_ORDER.forEach((id, i) => {
      if (this.input.consumePressed(`Digit${i + 1}`)) this.setSky(id, false);
    });
    if (this.input.consumePressed('F3')) this.stats.toggle();
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
    if (this.zoomT > 0.05 && this.rig.state !== 'HAND') {
      this.lookMatrix.lookAt(this.camera.position, this.rig.kite.pos, this.up);
      this.lookQuat.setFromRotationMatrix(this.lookMatrix);
      this.camera.quaternion.slerp(this.lookQuat, (1 - Math.exp(-frameDt * 6)) * this.zoomT);
    }
  }

  private render(alpha: number, frameDt: number, now: number): void {
    if (!this.map || this.loadingMap) return;
    this.handleUiKeys();
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
    this.hands.pinchWorld(this.camera, this.anchor);

    const rig = this.rig;
    const flying = rig.state !== 'HAND';
    this.kiteView?.setVisible(flying);
    if (flying) this.kiteView?.update(rig.kite, now);
    this.lineView?.update(rig.line, this.camera.position, rig.connected ? this.anchor : undefined);
    this.handLineView?.update(rig.handLine, this.camera.position, this.anchor);

    const dir = this.wind.direction;
    this.hud.show(this.input.enabled || this.autostart);
    this.hud.update({
      windSpeed: this.wind.meanSpeed,
      windDirX: dir.x,
      windDirZ: dir.z,
      cameraYaw: this.currentYaw(),
      lineOutYards: (rig.supply.capacity - rig.supply.remaining) / 0.9144,
      lineTotalYards: rig.supply.capacityYards,
      state: rig.state,
      connected: rig.connected,
    });

    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.hands.render(this.renderer);
    this.stats.update(
      frameDt,
      this.renderer,
      `mapa ${this.mapId}  céu ${this.skyId}  pipa ${rig.state}\n` +
        `altitude ${rig.kite.pos.y.toFixed(1)} m  tração ${rig.tension.toFixed(1)} N  L ${rig.activeLength.toFixed(1)} m`,
    );
  }

  dispose(): void {
    this.loop.stop();
    this.disposeRig();
    this.input.dispose();
    this.controls.dispose();
    this.hands.dispose();
    this.sky.dispose();
    this.map?.dispose();
    this.menu.dispose();
    this.hud.dispose();
    this.stats.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

