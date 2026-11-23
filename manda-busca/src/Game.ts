import {
  ACESFilmicToneMapping,
  Euler,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { LineSupply } from './core/LineSupply';
import { PlayerController } from './core/PlayerController';
import { DebugStats } from './ui/DebugStats';
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

const PAY_OUT_SPEED = 2.0;
const REEL_IN_SPEED = 3.0;
const NEXT_FRAME = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 16 / 9, 0.05, 5000);
  readonly controls: PointerLockControls;
  readonly input: InputManager;
  readonly sky: SkyAtmosphere;
  readonly hands: FirstPersonHands;
  readonly menu: MainMenu;
  readonly stats: DebugStats;
  readonly loop: GameLoop;
  supply = new LineSupply(250);
  map!: GameMap;
  player!: PlayerController;
  mapId: MapId;
  skyId: SkyPresetId;
  reelKind: ReelKind;

  private readonly container: HTMLElement;
  private readonly autostart: boolean;
  private readonly focus = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private handsInput: HandsInput = { lineSpeed: 0, tension: 0.35, reeling: false, fill: 1 };
  private loadingMap = false;

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
    this.stats = new DebugStats(container);

    this.menu = new MainMenu(container, {
      onPlay: () => this.play(),
      onMapChange: (id) => void this.loadMap(id),
      onSkyChange: (id) => this.setSky(id, false),
      onReelChange: (kind) => this.setReel(kind),
    });
    this.menu.setActive('map', this.mapId);
    this.menu.setActive('sky', this.skyId);
    this.menu.setActive('reel', this.reelKind);

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, frameDt, now) => this.render(alpha, frameDt, now),
    });
    window.addEventListener('resize', () => this.resize());
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
    if (this.map) {
      this.scene.remove(this.map.root);
      this.map.dispose();
    }
    this.mapId = id;
    this.map = createMap(id);
    this.scene.add(this.map.root);
    this.player = new PlayerController(this.map.walk, this.map.spawn.x, this.map.spawn.z);
    this.camera.rotation.set(0, this.map.spawn.yaw, 0, 'YXZ');
    this.supply = new LineSupply(250);
    this.menu.setActive('map', id);
    this.menu.setLoading(false);
    this.loadingMap = false;
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

  private fixedUpdate(dt: number): void {
    if (!this.map || this.loadingMap) return;
    this.player.fixedUpdate(dt, this.input, this.currentYaw());

    const reeling = this.input.isDown('KeyR');
    const paying = this.input.mouseDown(2) && !reeling;
    let lineSpeed = 0;
    if (reeling) {
      const taken = this.supply.takeIn(REEL_IN_SPEED * dt);
      lineSpeed = -taken / dt;
    } else if (paying) {
      const given = this.supply.payOut(PAY_OUT_SPEED * dt);
      lineSpeed = given / dt;
    }
    if (this.input.mousePressed(0)) {
      if (this.input.mouseDown(2)) this.hands.triggerTap();
      else this.hands.triggerPull();
    }
    if (this.input.consumeWheelDown() > 0) this.hands.triggerPull();
    this.handsInput = {
      lineSpeed,
      tension: paying ? 0.1 : reeling ? 0.8 : 0.35,
      reeling: reeling && lineSpeed !== 0,
      fill: this.supply.fill,
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

  private render(alpha: number, frameDt: number, now: number): void {
    if (!this.map || this.loadingMap) return;
    this.handleUiKeys();
    this.player.applyToCamera(this.camera, alpha);
    this.focus.copy(this.camera.position);
    this.camera.updateMatrixWorld();

    this.sky.update(frameDt, this.camera, this.focus);
    this.map.update(frameDt, now);
    this.map.setNight(this.sky.nightFactor);

    this.hands.setLighting(this.sky.lighting, this.camera.quaternion);
    this.hands.setEnvironment(this.scene.environment, this.scene.environmentIntensity);
    this.hands.update(frameDt, this.handsInput, this.player.speed, 0);

    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.hands.render(this.renderer);
    this.stats.update(
      frameDt,
      this.renderer,
      `mapa ${this.mapId}  céu ${this.skyId}\nlinha ${this.supply.remainingYards.toFixed(0)}/${this.supply.capacityYards.toFixed(0)} jd`,
    );
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.controls.dispose();
    this.hands.dispose();
    this.sky.dispose();
    this.map?.dispose();
    this.menu.dispose();
    this.stats.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
