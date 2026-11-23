/**
 * Atmosfera procedural: espalhamento Rayleigh/Mie (addon Sky do Three.js, sem
 * texturas externas), nuvens, estrelas, lua e iluminacao ligada ao preset.
 * Os presets sao alternaveis em tempo real com transicao suave. O ambiente de
 * reflexo (PMREM) e gerado a partir do proprio ceu, entao vidro, agua e pele
 * refletem o ceu que o jogador realmente ve.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  PMREMGenerator,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32, smoothstep } from '../core/noise';
import { moonTexture, radialGlowTexture } from './ProceduralTextures';

export type SkyPresetId = 'manha' | 'tarde' | 'noite';

export const SKY_PRESET_LABELS: Record<SkyPresetId, string> = {
  manha: 'Manhã Limpa',
  tarde: 'Fim de Tarde',
  noite: 'Noite Iluminada',
};

export const SKY_PRESET_ORDER: SkyPresetId[] = ['manha', 'tarde', 'noite'];

interface PresetNumbers {
  sunElevation: number;
  sunAzimuth: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  lightElevation: number;
  lightAzimuth: number;
  lightIntensity: number;
  hemiIntensity: number;
  envIntensity: number;
  fogDensity: number;
  night: number;
}

interface PresetColors {
  lightColor: Color;
  hemiSky: Color;
  hemiGround: Color;
  fogColor: Color;
}

interface PresetState {
  n: PresetNumbers;
  c: PresetColors;
}

function makeState(n: PresetNumbers, light: number, hemiSky: number, hemiGround: number, fog: number): PresetState {
  return {
    n,
    c: {
      lightColor: new Color(light),
      hemiSky: new Color(hemiSky),
      hemiGround: new Color(hemiGround),
      fogColor: new Color(fog),
    },
  };
}

function cloneState(s: PresetState): PresetState {
  return {
    n: { ...s.n },
    c: {
      lightColor: s.c.lightColor.clone(),
      hemiSky: s.c.hemiSky.clone(),
      hemiGround: s.c.hemiGround.clone(),
      fogColor: s.c.fogColor.clone(),
    },
  };
}

const PRESETS: Record<SkyPresetId, PresetState> = {
  // Sol alto (45 graus), luz branca quente, sombras nitidas.
  manha: makeState(
    {
      sunElevation: 45, sunAzimuth: 135, turbidity: 2.4, rayleigh: 1.35, mieCoefficient: 0.004, mieDirectionalG: 0.78,
      cloudCoverage: 0.38, cloudDensity: 0.42, lightElevation: 45, lightAzimuth: 135, lightIntensity: 2.3,
      hemiIntensity: 0.18, envIntensity: 0.42, fogDensity: 0.00055, night: 0,
    },
    0xfff3e0, 0xa6ccff, 0x6a5a48, 0xbcd7f5,
  ),
  // Sol baixo (12 graus), luz ambar longa, neblina atmosferica suave.
  tarde: makeState(
    {
      sunElevation: 12, sunAzimuth: 250, turbidity: 7, rayleigh: 2.4, mieCoefficient: 0.012, mieDirectionalG: 0.86,
      cloudCoverage: 0.5, cloudDensity: 0.5, lightElevation: 12, lightAzimuth: 250, lightIntensity: 2.2,
      hemiIntensity: 0.16, envIntensity: 0.5, fogDensity: 0.0016, night: 0,
    },
    0xffa85a, 0xffc093, 0x4a382d, 0xf0b384,
  ),
  // Ceu estrelado, lua fria como luz direcional.
  noite: makeState(
    {
      sunElevation: -25, sunAzimuth: 250, turbidity: 0.6, rayleigh: 0.25, mieCoefficient: 0.002, mieDirectionalG: 0.7,
      cloudCoverage: 0.3, cloudDensity: 0.3, lightElevation: 38, lightAzimuth: 200, lightIntensity: 0.55,
      hemiIntensity: 0.25, envIntensity: 0.35, fogDensity: 0.0011, night: 1,
    },
    0x9db8ff, 0x1b2a52, 0x080b12, 0x0a1226,
  ),
};

export function directionFromAngles(elevationDeg: number, azimuthDeg: number, out = new Vector3()): Vector3 {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

/** Informacoes de luz para quem precisa iluminar outra cena (mao/viewmodel). */
export interface LightingInfo {
  dirToLight: Vector3;
  color: Color;
  intensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  night: number;
}

const SHADOW_HALF = 60;
const SHADOW_MAP = 2048;
const UP = new Vector3(0, 1, 0);

export class SkyAtmosphere {
  readonly rig = new Group();
  readonly sky = new Sky();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: FogExp2;
  readonly lighting: LightingInfo;
  preset: SkyPresetId;

  private readonly scene: Scene;
  private readonly stars: Points;
  private readonly moon: Sprite;
  private readonly moonGlow: Sprite;
  private readonly envSky = new Sky();
  private readonly envScene = new Scene();
  private readonly pmrem: PMREMGenerator;
  private envTarget: WebGLRenderTarget | null = null;
  private envTimer = 0;
  private envDirty = true;
  private cur: PresetState;
  private tgt: PresetState;
  private clock = 0;
  private transitioning = false;
  private readonly tmpDir = new Vector3();
  private readonly tmpBasis = { r: new Vector3(), u: new Vector3(), f: new Vector3(), p: new Vector3() };

  constructor(scene: Scene, renderer: WebGLRenderer, initial: SkyPresetId = 'manha') {
    this.scene = scene;
    this.preset = initial;
    this.cur = cloneState(PRESETS[initial]);
    this.tgt = cloneState(PRESETS[initial]);

    this.sky.scale.setScalar(3000);
    this.sky.renderOrder = -1000;
    this.sky.material.uniforms.showSunDisc.value = 1;
    this.rig.add(this.sky);

    // Estrelas: pontos na semi-esfera superior, tons levemente variados.
    const rand = mulberry32(99);
    const starCount = 2600;
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const y = rand() * 1.05 - 0.05;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = rand() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r * 1800;
      pos[i * 3 + 1] = y * 1800;
      pos[i * 3 + 2] = Math.sin(a) * r * 1800;
      const mag = 0.35 + Math.pow(rand(), 3) * 0.65;
      const warm = rand();
      col[i * 3] = mag * (0.85 + warm * 0.15);
      col[i * 3 + 1] = mag * 0.92;
      col[i * 3 + 2] = mag * (1 - warm * 0.2);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sg.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.stars = new Points(
      sg,
      new PointsMaterial({
        size: 2.1, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0,
        depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    this.rig.add(this.stars);

    this.moonGlow = new Sprite(
      new SpriteMaterial({
        map: radialGlowTexture(128, 2.6), color: 0x9fb4e8, transparent: true, opacity: 0, depthWrite: false,
        blending: AdditiveBlending, fog: false, toneMapped: false,
      }),
    );
    this.moonGlow.scale.setScalar(620);
    this.moonGlow.renderOrder = -890;
    this.rig.add(this.moonGlow);

    this.moon = new Sprite(
      new SpriteMaterial({ map: moonTexture(256), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }),
    );
    this.moon.scale.setScalar(170);
    this.moon.renderOrder = -880;
    this.rig.add(this.moon);
    scene.add(this.rig);

    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(this.hemi);

    this.fog = new FogExp2(0xffffff, 0.001);
    scene.fog = this.fog;

    this.lighting = {
      dirToLight: new Vector3(0, 1, 0),
      color: new Color(),
      intensity: 1,
      hemiSky: new Color(),
      hemiGround: new Color(),
      hemiIntensity: 0.3,
      night: 0,
    };

    this.pmrem = new PMREMGenerator(renderer);
    this.envScene.add(this.envSky);
    this.envSky.scale.setScalar(1000);
    this.apply(new Vector3());
    this.regenerateEnvironment();
  }

  /** Troca o preset. `instant` pula a transicao suave. */
  setPreset(id: SkyPresetId, instant = false): void {
    this.preset = id;
    this.tgt = cloneState(PRESETS[id]);
    if (instant) {
      this.cur = cloneState(PRESETS[id]);
      this.transitioning = false;
      this.envDirty = true;
    } else {
      this.transitioning = true;
    }
  }

  get nightFactor(): number {
    return this.cur.n.night;
  }

  /** Aplica o estado atual a luzes, ceu, neblina e ambiente. */
  private apply(focus: Vector3): void {
    const n = this.cur.n;
    const c = this.cur.c;
    const u = this.sky.material.uniforms;
    u.turbidity.value = n.turbidity;
    u.rayleigh.value = n.rayleigh;
    u.mieCoefficient.value = n.mieCoefficient;
    u.mieDirectionalG.value = n.mieDirectionalG;
    u.cloudCoverage.value = n.cloudCoverage;
    u.cloudDensity.value = n.cloudDensity;
    u.time.value = this.clock;
    directionFromAngles(n.sunElevation, n.sunAzimuth, u.sunPosition.value as Vector3);

    const dir = directionFromAngles(n.lightElevation, n.lightAzimuth, this.tmpDir);
    this.lighting.dirToLight.copy(dir);
    this.sun.color.copy(c.lightColor);
    this.sun.intensity = n.lightIntensity;
    this.positionSun(focus, dir);

    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = n.hemiIntensity;

    this.fog.color.copy(c.fogColor);
    this.fog.density = n.fogDensity;
    this.scene.environmentIntensity = n.envIntensity;

    const nightOpacity = smoothstep(0.35, 1, n.night);
    (this.stars.material as PointsMaterial).opacity = nightOpacity;
    (this.moon.material as SpriteMaterial).opacity = nightOpacity;
    (this.moonGlow.material as SpriteMaterial).opacity = nightOpacity * 0.55;
    this.moon.position.copy(dir).multiplyScalar(1700);
    this.moonGlow.position.copy(this.moon.position);

    this.lighting.color.copy(c.lightColor);
    this.lighting.intensity = n.lightIntensity;
    this.lighting.hemiSky.copy(c.hemiSky);
    this.lighting.hemiGround.copy(c.hemiGround);
    this.lighting.hemiIntensity = n.hemiIntensity;
    this.lighting.night = n.night;
  }

  /** Posiciona o sol seguindo o foco, alinhado ao texel do mapa de sombra (sem tremor). */
  private positionSun(focus: Vector3, dirToLight: Vector3): void {
    const b = this.tmpBasis;
    b.f.copy(dirToLight).negate();
    b.r.crossVectors(b.f, UP);
    if (b.r.lengthSq() < 1e-8) b.r.set(1, 0, 0);
    b.r.normalize();
    b.u.crossVectors(b.r, b.f).normalize();
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const x = Math.round(focus.dot(b.r) / texel) * texel;
    const y = Math.round(focus.dot(b.u) / texel) * texel;
    const z = focus.dot(b.f);
    b.p.set(0, 0, 0).addScaledVector(b.r, x).addScaledVector(b.u, y).addScaledVector(b.f, z);
    this.sun.target.position.copy(b.p);
    this.sun.position.copy(b.p).addScaledVector(dirToLight, 220);
    this.sun.target.updateMatrixWorld();
  }

  private regenerateEnvironment(): void {
    const src = this.sky.material.uniforms;
    const dst = this.envSky.material.uniforms;
    for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity', 'cloudScale', 'cloudSpeed', 'cloudElevation', 'time']) {
      dst[key]!.value = src[key]!.value;
    }
    dst.showSunDisc.value = 0;
    (dst.sunPosition.value as Vector3).copy(src.sunPosition.value as Vector3);
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 3000);
    this.envTarget?.dispose();
    this.envTarget = next;
    this.scene.environment = next.texture;
    this.envDirty = false;
  }

  /** Avanca transicao/nuvens e segue o foco com luz e sombras. */
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void {
    this.clock += dt;
    if (this.transitioning) {
      const k = 1 - Math.exp(-dt * 2.6);
      const a = this.cur.n as unknown as Record<string, number>;
      const b = this.tgt.n as unknown as Record<string, number>;
      let maxDiff = 0;
      for (const key of Object.keys(a)) {
        a[key]! += (b[key]! - a[key]!) * k;
        maxDiff = Math.max(maxDiff, Math.abs(b[key]! - a[key]!) / (Math.abs(b[key]!) + 1));
      }
      this.cur.c.lightColor.lerp(this.tgt.c.lightColor, k);
      this.cur.c.hemiSky.lerp(this.tgt.c.hemiSky, k);
      this.cur.c.hemiGround.lerp(this.tgt.c.hemiGround, k);
      this.cur.c.fogColor.lerp(this.tgt.c.fogColor, k);
      this.envTimer += dt;
      if (this.envTimer > 0.45) {
        this.envTimer = 0;
        this.envDirty = true;
      }
      if (maxDiff < 0.002) {
        this.cur = cloneState(this.tgt);
        this.transitioning = false;
        this.envDirty = true;
      }
    }
    this.rig.position.copy(camera.position);
    this.apply(focus);
    if (this.envDirty) this.regenerateEnvironment();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.scene.remove(this.rig, this.sun, this.sun.target, this.hemi);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envSky.geometry.dispose();
    this.envSky.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
    (this.moon.material as SpriteMaterial).map?.dispose();
    (this.moon.material as SpriteMaterial).dispose();
    (this.moonGlow.material as SpriteMaterial).map?.dispose();
    (this.moonGlow.material as SpriteMaterial).dispose();
  }
}
