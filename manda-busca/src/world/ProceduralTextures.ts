/**
 * Texturas PBR 100% procedurais (sem arquivos externos). Cada conjunto traz
 * mapa difuso (sRGB), rugosidade e bump (lineares). Todas ladrilham sem emenda
 * porque usam ruido periodico (TileableNoise).
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { TileableNoise, clamp, lerp, mulberry32, smoothstep } from '../core/noise';

export interface PbrTextureSet {
  map: CanvasTexture;
  roughnessMap: CanvasTexture;
  bumpMap: CanvasTexture;
}

interface Texel {
  r: number;
  g: number;
  b: number;
  rough: number;
  bump: number;
}

type TexelFn = (u: number, v: number, out: Texel) => void;

let maxAnisotropy = 4;

export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, value);
}

function prepare(canvas: HTMLCanvasElement, srgb: boolean, repeat: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function buildSet(size: number, fn: TexelFn): PbrTextureSet {
  const cd = makeCanvas(size, size);
  const cr = makeCanvas(size, size);
  const cb = makeCanvas(size, size);
  const ctxD = cd.getContext('2d')!;
  const ctxR = cr.getContext('2d')!;
  const ctxB = cb.getContext('2d')!;
  const imgD = ctxD.createImageData(size, size);
  const imgR = ctxR.createImageData(size, size);
  const imgB = ctxB.createImageData(size, size);
  const out: Texel = { r: 0, g: 0, b: 0, rough: 1, bump: 0 };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      fn(u, v, out);
      const i = (y * size + x) * 4;
      imgD.data[i] = clamp(out.r, 0, 255);
      imgD.data[i + 1] = clamp(out.g, 0, 255);
      imgD.data[i + 2] = clamp(out.b, 0, 255);
      imgD.data[i + 3] = 255;
      const rg = clamp(out.rough, 0, 1) * 255;
      imgR.data[i] = imgR.data[i + 1] = imgR.data[i + 2] = rg;
      imgR.data[i + 3] = 255;
      const bg = clamp(out.bump, 0, 1) * 255;
      imgB.data[i] = imgB.data[i + 1] = imgB.data[i + 2] = bg;
      imgB.data[i + 3] = 255;
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxR.putImageData(imgR, 0, 0);
  ctxB.putImageData(imgB, 0, 0);
  return {
    map: prepare(cd, true, true),
    roughnessMap: prepare(cr, false, true),
    bumpMap: prepare(cb, false, true),
  };
}

function mix3(out: Texel, a: readonly [number, number, number], b: readonly [number, number, number], t: number): void {
  out.r = lerp(a[0], b[0], t);
  out.g = lerp(a[1], b[1], t);
  out.b = lerp(a[2], b[2], t);
}

function scale(out: Texel, k: number): void {
  out.r *= k;
  out.g *= k;
  out.b *= k;
}

/** Grama irregular com manchas secas. */
export function grassTextures(size = 1024): PbrTextureSet {
  const n = new TileableNoise(11);
  return buildSet(size, (u, v, o) => {
    const base = n.fbm(u, v, 4, 5);
    const fine = n.fbm(u, v, 64, 3);
    const patch = n.fbm(u, v, 3, 3);
    mix3(o, [64, 102, 38], [98, 136, 52], base);
    const dry = smoothstep(0.6, 0.8, patch);
    o.r = lerp(o.r, 140, dry * 0.35);
    o.g = lerp(o.g, 128, dry * 0.3);
    o.b = lerp(o.b, 70, dry * 0.25);
    scale(o, 0.8 + 0.4 * fine);
    o.rough = 0.9 + 0.1 * fine;
    o.bump = fine * 0.7 + base * 0.3;
  });
}

/** Terra batida com seixos e rachaduras de seca. */
export function dirtTextures(size = 1024): PbrTextureSet {
  const n = new TileableNoise(23);
  return buildSet(size, (u, v, o) => {
    const base = n.fbm(u, v, 5, 5);
    const fine = n.fbm(u, v, 96, 3);
    mix3(o, [112, 80, 52], [156, 116, 80], base);
    const [f1] = n.worley(u, v, 44);
    const pebble = 1 - smoothstep(0.06, 0.2, f1);
    const [c1, c2] = n.worley(u, v, 4);
    const dryPatch = smoothstep(0.58, 0.78, n.fbm(u, v, 3, 3));
    const crack = (1 - smoothstep(0.012, 0.04, c2 - c1)) * dryPatch;
    scale(o, 0.85 + 0.3 * fine);
    o.r = lerp(o.r, 178, pebble * 0.45);
    o.g = lerp(o.g, 160, pebble * 0.45);
    o.b = lerp(o.b, 138, pebble * 0.45);
    scale(o, 1 - crack * 0.2);
    o.rough = 0.95 - pebble * 0.1;
    o.bump = clamp(0.5 + pebble * 0.4 + (fine - 0.5) * 0.25 - crack * 0.18, 0, 1);
  });
}

/** Asfalto com granulometria e trincas esparsas. */
export function asphaltTextures(size = 512): PbrTextureSet {
  const n = new TileableNoise(31);
  return buildSet(size, (u, v, o) => {
    const patch = n.fbm(u, v, 4, 4);
    const grain = n.value(u, v, 180);
    const grain2 = n.value(u, v, 96);
    const base = 60 + patch * 22;
    o.r = base + 3;
    o.g = base + 1;
    o.b = base + 1;
    const spec = smoothstep(0.84, 0.97, grain);
    o.r = lerp(o.r, 104, spec * 0.7);
    o.g = lerp(o.g, 102, spec * 0.7);
    o.b = lerp(o.b, 100, spec * 0.7);
    scale(o, 0.9 + 0.2 * grain2);
    const [c1, c2] = n.worley(u, v, 3);
    const wear = smoothstep(0.6, 0.8, n.fbm(u, v, 3, 3));
    const crack = (1 - smoothstep(0.008, 0.026, c2 - c1)) * wear;
    scale(o, 1 - crack * 0.5);
    o.rough = 0.9 - spec * 0.2;
    o.bump = clamp(0.45 + spec * 0.3 + (grain2 - 0.5) * 0.2 - crack * 0.25, 0, 1);
  });
}

/** Concreto de calcada: manchado, juntas de dilatacao e rachaduras. */
export function concreteTextures(size = 512, cracked = true): PbrTextureSet {
  const n = new TileableNoise(41);
  return buildSet(size, (u, v, o) => {
    const mott = n.fbm(u, v, 6, 5);
    const fine = n.fbm(u, v, 128, 2);
    const g = 150 + mott * 46;
    o.r = g + 4;
    o.g = g;
    o.b = g - 6;
    scale(o, 0.93 + 0.14 * fine);
    let crack = 0;
    if (cracked) {
      const [c1, c2] = n.worley(u, v, 3);
      const wear = smoothstep(0.52, 0.72, mott);
      crack = (1 - smoothstep(0.01, 0.035, c2 - c1)) * wear;
      scale(o, 1 - crack * 0.55);
    }
    const fu = (u * 2) % 1;
    const fv = (v * 2) % 1;
    const joint = Math.min(fu, 1 - fu) < 0.006 || Math.min(fv, 1 - fv) < 0.006 ? 1 : 0;
    scale(o, 1 - joint * 0.45);
    o.rough = 0.88 + 0.1 * fine;
    o.bump = clamp(0.55 + (fine - 0.5) * 0.3 - crack * 0.4 - joint * 0.35, 0, 1);
  });
}

/** Reboco chapiscado claro (tingido por cor de vertice/material). */
export function plasterTextures(size = 512): PbrTextureSet {
  const n = new TileableNoise(53);
  return buildSet(size, (u, v, o) => {
    const stain = n.fbm(u, v, 5, 4);
    const grain = n.value(u, v, 140);
    const grain2 = n.value(u, v, 220);
    const g = 232 - stain * 26;
    o.r = g;
    o.g = g - 3;
    o.b = g - 8;
    const spot = smoothstep(0.6, 0.85, grain);
    scale(o, 0.9 + spot * 0.1 + (grain2 - 0.5) * 0.08);
    o.rough = 0.96;
    o.bump = clamp(0.35 + spot * 0.5 + (grain2 - 0.5) * 0.3, 0, 1);
  });
}

/** Areia com ondulacao de vento e graos. */
export function sandTextures(size = 1024): PbrTextureSet {
  const n = new TileableNoise(61);
  return buildSet(size, (u, v, o) => {
    const warp = n.fbm(u, v, 6, 4);
    const ripple = Math.sin((v + 0.09 * warp) * Math.PI * 2 * 18) * 0.5 + 0.5;
    const grain = n.value(u, v, 280);
    const body = n.fbm(u, v, 4, 4);
    mix3(o, [204, 168, 108], [232, 198, 140], body);
    scale(o, 0.9 + ripple * 0.1 + (grain - 0.5) * 0.14);
    o.rough = 0.98;
    o.bump = clamp(0.4 + ripple * 0.35 + (grain - 0.5) * 0.2, 0, 1);
  });
}

/** Rocha estratificada com fissuras. */
export function rockTextures(size = 1024): PbrTextureSet {
  const n = new TileableNoise(71);
  return buildSet(size, (u, v, o) => {
    const warp = n.fbm(u, v, 3, 4);
    const strata = Math.sin((v + warp * 0.18) * Math.PI * 2 * 9) * 0.5 + 0.5;
    const body = n.fbm(u, v, 6, 5);
    const fine = n.fbm(u, v, 96, 3);
    mix3(o, [84, 78, 72], [138, 126, 114], body);
    scale(o, 0.85 + strata * 0.18 + (fine - 0.5) * 0.2);
    const [c1, c2] = n.worley(u, v, 3);
    const fissure = smoothstep(0.55, 0.75, n.fbm(u, v, 3, 3));
    const crack = (1 - smoothstep(0.015, 0.06, c2 - c1)) * fissure;
    scale(o, 1 - crack * 0.4);
    o.rough = 0.92 + 0.08 * fine;
    o.bump = clamp(0.5 + (body - 0.5) * 0.7 + strata * 0.15 - crack * 0.3, 0, 1);
  });
}

/** Calcadao de pedra portuguesa em ondas pretas e brancas. */
export function portuguesePavementTextures(size = 512): PbrTextureSet {
  const n = new TileableNoise(83);
  const stones = 16;
  return buildSet(size, (u, v, o) => {
    const band = Math.floor(v * 4 + 0.55 * Math.sin(u * Math.PI * 2 * 2) + 64) % 2;
    const su = u * stones;
    const sv = v * stones;
    const fu = su - Math.floor(su);
    const fv = sv - Math.floor(sv);
    const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
    const grout = 1 - smoothstep(0.04, 0.11, edge);
    const jitter = n.value(Math.floor(su) / stones, Math.floor(sv) / stones, stones) - 0.5;
    const tone = band === 0 ? 232 : 36;
    const shade = tone + jitter * (band === 0 ? 24 : 16);
    o.r = lerp(shade, 118, grout);
    o.g = lerp(shade, 114, grout);
    o.b = lerp(shade + 2, 108, grout);
    o.rough = lerp(0.52, 0.95, grout);
    o.bump = lerp(0.72, 0.12, grout);
  });
}

/** Madeira com veios (vertical por padrao). */
export function woodTextures(size = 512, base: readonly [number, number, number] = [150, 108, 66]): PbrTextureSet {
  const n = new TileableNoise(97);
  return buildSet(size, (u, v, o) => {
    const grain = n.fbmXY(u, v, 24, 3, 4);
    const rings = Math.sin((u + 0.08 * n.fbmXY(u, v, 4, 2, 3)) * Math.PI * 2 * 14) * 0.5 + 0.5;
    const fine = n.fbmXY(u, v, 90, 6, 2);
    const dark: [number, number, number] = [base[0] * 0.55, base[1] * 0.55, base[2] * 0.55];
    mix3(o, dark, base, 0.35 + grain * 0.45 + rings * 0.2);
    scale(o, 0.9 + 0.2 * fine);
    o.rough = 0.62 + 0.25 * fine;
    o.bump = clamp(0.4 + rings * 0.3 + (fine - 0.5) * 0.3, 0, 1);
  });
}

/** Bump de poros de pele (somente relevo). */
export function skinBumpTexture(size = 256): CanvasTexture {
  const n = new TileableNoise(101);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const [f1] = n.worley(u, v, 38);
      const pore = smoothstep(0.05, 0.22, f1);
      const wrinkle = n.fbmXY(u, v, 6, 24, 3);
      const val = clamp(0.35 + pore * 0.4 + wrinkle * 0.25, 0, 1) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return prepare(c, false, true);
}

/** Fios de linha enrolados: faixas horizontais para o pacote do carretel. */
export function threadTexture(size = 256): CanvasTexture {
  const rand = mulberry32(5);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    const shade = 200 + Math.floor(rand() * 50);
    ctx.fillStyle = `rgb(${shade},${shade},${shade - 6})`;
    ctx.fillRect(0, y, size, 1);
    if (y % 3 === 0) {
      ctx.fillStyle = 'rgba(70,70,70,0.35)';
      ctx.fillRect(0, y, size, 1);
    }
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.25})`;
    ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 3 + rand() * 8, 1);
  }
  return prepare(c, true, true);
}

/** Rotulo generico da lata de achocolatado (sem marca real). */
export function canLabelTexture(): CanvasTexture {
  const c = makeCanvas(512, 256);
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#7a3b14');
  grad.addColorStop(1, '#4a200a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 96, 512, 64);
  ctx.fillStyle = '#4a200a';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ACHOCOLATADO', 256, 142);
  ctx.fillStyle = '#f2c230';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('LATA 400g', 256, 215);
  for (let x = 0; x < 512; x += 64) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, 0, 2, 256);
  }
  return prepare(c, true, true);
}

/** Textura de gradiente radial branca (halos de lampada, lua, brilho). */
export function radialGlowTexture(size = 128, soft = 2.2): CanvasTexture {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.pow(clamp(1 - d, 0, 1), soft);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return prepare(c, true, false);
}

/** Disco lunar com crateras sutis. */
export function moonTexture(size = 256): CanvasTexture {
  const n = new TileableNoise(113);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const inside = 1 - smoothstep(0.93, 1.0, d);
      const maria = n.fbm(u, v, 3, 4);
      const crater = n.fbm(u, v, 12, 3);
      const g = 214 - maria * 52 - crater * 22;
      const i = (y * size + x) * 4;
      img.data[i] = g + 4;
      img.data[i + 1] = g + 2;
      img.data[i + 2] = g - 6;
      img.data[i + 3] = inside * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return prepare(c, true, false);
}

/** Textura de neblina (alfa em fBm) para as camadas de nevoa dos vales. */
export function fogLayerTexture(size = 512): CanvasTexture {
  const n = new TileableNoise(127);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = smoothstep(0.38, 0.78, n.fbm(u, v, 3, 5));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return prepare(c, true, true);
}

/** Fachada de predio com janelas; `emissiveMap` acende janelas aleatorias. */
export function buildingFacadeTextures(seed: number, cols = 8, rows = 16): { map: CanvasTexture; emissiveMap: CanvasTexture } {
  const rand = mulberry32(seed);
  const w = 512;
  const h = 1024;
  const base = makeCanvas(w, h);
  const glow = makeCanvas(w, h);
  const cb = base.getContext('2d')!;
  const cg = glow.getContext('2d')!;
  const tints = ['#d9d3c7', '#c9ced3', '#d8c8b4', '#bfc7c0'];
  cb.fillStyle = tints[Math.floor(rand() * tints.length)]!;
  cb.fillRect(0, 0, w, h);
  cg.fillStyle = '#000';
  cg.fillRect(0, 0, w, h);
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.18;
      const y = r * ch + ch * 0.2;
      const ww = cw * 0.64;
      const hh = ch * 0.6;
      cb.fillStyle = '#16222e';
      cb.fillRect(x, y, ww, hh);
      cb.fillStyle = 'rgba(160,190,220,0.18)';
      cb.fillRect(x, y, ww, hh * 0.45);
      cb.fillStyle = 'rgba(0,0,0,0.25)';
      cb.fillRect(x - 2, y + hh, ww + 4, 3);
      if (rand() < 0.38) {
        cg.fillStyle = rand() < 0.7 ? '#ffd9a0' : '#bcd8ff';
        cg.fillRect(x, y, ww, hh);
      }
    }
  }
  return { map: prepare(base, true, true), emissiveMap: prepare(glow, true, true) };
}

export function disposeTextureSet(set: PbrTextureSet): void {
  set.map.dispose();
  set.roughnessMap.dispose();
  set.bumpMap.dispose();
}

export function applyRepeat(tex: Texture, rx: number, ry: number): void {
  tex.repeat.set(rx, ry);
}

const setCache = new Map<string, PbrTextureSet>();

/** Memoriza conjuntos pesados entre trocas de mapa (dispose e seguro: a textura reenvia do canvas). */
export function cachedTextures(key: string, factory: () => PbrTextureSet): PbrTextureSet {
  let set = setCache.get(key);
  if (!set) {
    set = factory();
    setCache.set(key, set);
  }
  return set;
}

/** Contorno normalizado da folha (x, y em [-0.5, 0.5]); y positivo e o nariz. */
export type KiteOutline = ReadonlyArray<readonly [number, number]>;

/**
 * Papel de seda da pipa: paineis em duas cores recortados pelo contorno (o alfa do
 * mapa define a forma) e mascara das varetas (espinha e arco), usada para a sombra
 * interna quando o sol atravessa o papel.
 */
export function silkPaperTextures(
  outline: KiteOutline,
  c1: string,
  c2: string,
  bowY: number,
): { map: CanvasTexture; sparMap: CanvasTexture } {
  const S = 512;
  const rand = mulberry32(21);
  const px = (x: number): number => (x + 0.5) * S;
  const py = (y: number): number => (0.5 - y) * S;

  const map = makeCanvas(S, S);
  const m = map.getContext('2d')!;
  m.clearRect(0, 0, S, S);
  m.save();
  m.beginPath();
  outline.forEach(([x, y], i) => (i === 0 ? m.moveTo(px(x), py(y)) : m.lineTo(px(x), py(y))));
  m.closePath();
  m.clip();
  // Quatro paineis separados pela espinha (x = 0) e pelo arco (y = bowY).
  const split = py(bowY);
  const mid = px(0);
  m.fillStyle = c1;
  m.fillRect(0, 0, mid, split);
  m.fillRect(mid, split, S - mid, S - split);
  m.fillStyle = c2;
  m.fillRect(mid, 0, S - mid, split);
  m.fillRect(0, split, mid, S - split);
  // Fibras e amassados do papel.
  for (let i = 0; i < 1800; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = 6 + rand() * 24;
    const a = rand() * Math.PI;
    m.strokeStyle = `rgba(255,255,255,${0.04 + rand() * 0.08})`;
    m.lineWidth = 1;
    m.beginPath();
    m.moveTo(x, y);
    m.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    m.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * S;
    const y = rand() * S;
    m.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    m.lineWidth = 1 + rand() * 2;
    m.beginPath();
    m.moveTo(x, y);
    m.quadraticCurveTo(x + (rand() - 0.5) * 80, y + (rand() - 0.5) * 80, x + (rand() - 0.5) * 140, y + (rand() - 0.5) * 140);
    m.stroke();
  }
  // Fita de cola ao longo das varetas.
  m.fillStyle = 'rgba(255,255,255,0.18)';
  m.fillRect(mid - 3, 0, 6, S);
  m.restore();

  const spar = makeCanvas(S, S);
  const s = spar.getContext('2d')!;
  s.fillStyle = '#000';
  s.fillRect(0, 0, S, S);
  try {
    s.filter = 'blur(2.5px)';
  } catch {
    /* navegadores sem filtro de canvas: a vareta fica sem desfoque */
  }
  s.strokeStyle = '#fff';
  s.lineCap = 'round';
  s.lineWidth = 11;
  s.beginPath();
  s.moveTo(mid, py(outline[0]![1]));
  s.lineTo(mid, py(-0.5));
  s.stroke();
  s.lineWidth = 9;
  s.beginPath();
  s.moveTo(px(-0.5), split + 6);
  s.quadraticCurveTo(mid, split - 22, px(0.5), split + 6);
  s.stroke();
  return { map: prepare(map, true, false), sparMap: prepare(spar, false, false) };
}
