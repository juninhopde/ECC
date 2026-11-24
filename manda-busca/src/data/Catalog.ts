/**
 * Catalogo de equipamentos: 7 modelos de pipa (geometria e fisica proprias), 3 carreteis,
 * 3 linhas e 4 skins. Os precos alimentam a loja "Valdir Pipas".
 */
import { BICO_MEDIO, type KiteSpec } from '../physics/KitePhysics';
import type { ReelRates } from '../physics/KiteRig';
import { LINE_ORDER, LINE_SPECS, type LineId } from '../physics/LineSpec';
import type { KiteOutline } from '../world/ProceduralTextures';
import type { KiteSkin } from '../entities/KiteMeshBuilder';
import type { ReelKind } from '../world/FirstPersonHands';

export type KiteModelId =
  | 'bico-pequeno' | 'bico-medio' | 'carioquinha' | 'carioca-grande' | 'paulista' | 'raia' | 'peixinho';

export interface KiteModel {
  id: KiteModelId;
  label: string;
  description: string;
  price: number;
  spec: KiteSpec;
  outline: KiteOutline;
  /** Altura relativa do arco (vareta curva) na folha, em [-0.5, 0.5]. */
  bowY: number;
}

/** Cria uma especificacao a partir da base, escalando o estirante pelo tamanho da folha. */
function spec(id: KiteModelId, name: string, o: Partial<KiteSpec> & Pick<KiteSpec, 'width' | 'height' | 'area' | 'mass'>): KiteSpec {
  const w = o.width;
  const h = o.height;
  const kz = 0.2 * (h / 0.55);
  return {
    ...BICO_MEDIO,
    id,
    name,
    knot: [0, 0.02, kz],
    anchors: [[0, 0.36 * h, 0], [0, -0.22 * h, 0], [0.24 * w, 0.07 * h, 0]],
    ...o,
  };
}

const DIAMOND: KiteOutline = [[0, 0.5], [0.5, 0.12], [0.04, -0.5], [-0.04, -0.5], [-0.5, 0.12]];
const SQUARE_ISH: KiteOutline = [[0, 0.5], [0.5, 0.18], [0.38, -0.5], [-0.38, -0.5], [-0.5, 0.18]];
const WIDE: KiteOutline = [[0, 0.5], [0.5, 0.1], [0.3, -0.5], [-0.3, -0.5], [-0.5, 0.1]];
const RHOMBUS: KiteOutline = [[0, 0.5], [0.5, 0], [0, -0.5], [-0.5, 0]];
const FISH: KiteOutline = [[0, 0.5], [0.34, 0.1], [0.18, -0.5], [-0.18, -0.5], [-0.34, 0.1]];

export const KITE_MODELS: KiteModel[] = [
  {
    id: 'bico-pequeno', label: 'Bico Pequeno', price: 150, outline: DIAMOND, bowY: 0.12,
    description: 'Muito leve: sobe rápido em vento fraco e o tapa é muito ágil, mas é instável nas rajadas.',
    spec: spec('bico-pequeno', 'Bico Pequeno', {
      width: 0.42, height: 0.46, area: 0.15, mass: 0.022, trimAlpha: 0.66, pitchStiffness: 0.55, yawStiffness: 0.5,
      inPlaneStability: 0.12, tailRibbons: 12, tailLength: 1.2, tailRibbonArea: 0.0013, tailRibbonMass: 0.0006, dartImpulse: 5.2,
    }),
  },
  {
    id: 'bico-medio', label: 'Bico Médio', price: 0, outline: DIAMOND, bowY: 0.12,
    description: 'Equilibrado em peso, tapa e estabilidade. O ponto de partida.',
    spec: BICO_MEDIO,
  },
  {
    id: 'carioquinha', label: 'Carioquinha', price: 250, outline: SQUARE_ISH, bowY: 0.18,
    description: 'A cortada clássica carioca: resposta rápida na desbicada e excelente no tenteio.',
    spec: spec('carioquinha', 'Carioquinha', {
      width: 0.5, height: 0.52, area: 0.19, mass: 0.03, trimAlpha: 0.6, pitchStiffness: 0.6, yawStiffness: 0.85,
      inPlaneStability: 0.17, tailRibbons: 14, tailLength: 1.5, dartImpulse: 5.8,
    }),
  },
  {
    id: 'carioca-grande', label: 'Carioca Grande (Pipão)', price: 600, outline: DIAMOND, bowY: 0.12,
    description: 'Grande área de arrasto: puxa forte no vento e exige carretilha com boa tração. Presença imponente.',
    spec: spec('carioca-grande', 'Carioca Grande', {
      width: 0.74, height: 0.8, area: 0.46, mass: 0.075, cnMax: 1.25, trimAlpha: 0.56, pitchStiffness: 0.75, yawStiffness: 1.1,
      inPlaneStability: 0.2, tailRibbons: 20, tailLength: 2.4, tailRibbonArea: 0.0022, tailRibbonMass: 0.001, dartImpulse: 3.0,
    }),
  },
  {
    id: 'paulista', label: 'Paulista', price: 350, outline: WIDE, bowY: 0.1,
    description: 'Formato tradicional largo: estabilidade alta lá no alto e tapa cadenciado.',
    spec: spec('paulista', 'Paulista', {
      width: 0.62, height: 0.64, area: 0.3, mass: 0.045, trimAlpha: 0.6, pitchStiffness: 0.7, yawStiffness: 1.5,
      inPlaneStability: 0.24, tailRibbons: 16, tailLength: 1.8, dartImpulse: 3.6,
    }),
  },
  {
    id: 'raia', label: 'Raia', price: 400, outline: RHOMBUS, bowY: 0,
    description: 'Losango sem rabiola: velocidade extrema nas desbicadas. Não dá tapa.',
    spec: spec('raia', 'Raia', {
      width: 0.5, height: 0.56, area: 0.2, mass: 0.02, hasTail: false, trimAlpha: 0.72, pitchStiffness: 0.8, yawStiffness: 1.0,
      inPlaneStability: 0.4, dartImpulse: 6.5, canTapa: false,
    }),
  },
  {
    id: 'peixinho', label: 'Peixinho', price: 400, outline: FISH, bowY: 0.1,
    description: 'Compacta e sem rabiola: aceleração instantânea e curvas fechadas. Não dá tapa.',
    spec: spec('peixinho', 'Peixinho', {
      width: 0.34, height: 0.5, area: 0.12, mass: 0.018, hasTail: false, trimAlpha: 0.7, pitchStiffness: 0.8, yawStiffness: 0.9,
      inPlaneStability: 0.45, dartImpulse: 7.0, canTapa: false,
    }),
  },
];

export const KITE_BY_ID: Record<KiteModelId, KiteModel> = Object.fromEntries(KITE_MODELS.map((k) => [k.id, k])) as Record<KiteModelId, KiteModel>;

export interface ReelModel {
  id: ReelKind;
  label: string;
  description: string;
  price: number;
  capacityYards: number;
  rates: ReelRates;
}

export const REEL_MODELS: ReelModel[] = [
  {
    id: 'madeira', label: 'Carretilha de Madeira', price: 0, capacityYards: 250,
    description: '250 jardas, puxada média.', rates: { reel: 4, payOut: 6, quick: 14 },
  },
  {
    id: 'aluminio', label: 'Carretilha de Alumínio Rolamentada', price: 800, capacityYards: 350,
    description: '350 jardas, puxada e recolhimento rápidos.', rates: { reel: 6, payOut: 6.5, quick: 18 },
  },
  {
    id: 'lata', label: 'Lata de Achocolatado', price: 300, capacityYards: 200,
    description: '200 jardas, solta rápido; o recolhimento manual é mais lento.', rates: { reel: 2.5, payOut: 9, quick: 11 },
  },
];

export const REEL_BY_ID: Record<ReelKind, ReelModel> = Object.fromEntries(REEL_MODELS.map((r) => [r.id, r])) as Record<ReelKind, ReelModel>;

export interface LineModel {
  id: LineId;
  label: string;
  description: string;
  price: number;
}

export const LINE_MODELS: LineModel[] = LINE_ORDER.map((id) => ({
  id,
  label: LINE_SPECS[id].label,
  price: id === 'linha10' ? 0 : id === 'cerol' ? 300 : 700,
  description: `Abrasividade ${LINE_SPECS[id].abrasion.toFixed(2)}x, resistência ${LINE_SPECS[id].resistance.toFixed(2)}x.`,
}));

export type SkinId = 'padrao' | 'samurai' | 'halloween' | 'dourada';

export interface SkinModel {
  id: SkinId;
  label: string;
  price: number;
  skin: KiteSkin;
}

export const SKIN_MODELS: SkinModel[] = [
  { id: 'padrao', label: 'Padrão', price: 0, skin: { c1: '#e53935', c2: '#fdd835' } },
  { id: 'samurai', label: 'Samurai', price: 200, skin: { c1: '#b71c1c', c2: '#212121' } },
  { id: 'halloween', label: 'Halloween', price: 250, skin: { c1: '#ef6c00', c2: '#4a148c' } },
  { id: 'dourada', label: 'Pipa Dourada', price: 1200, skin: { c1: '#ffd54f', c2: '#ff8f00' } },
];

export const SKIN_BY_ID: Record<SkinId, SkinModel> = Object.fromEntries(SKIN_MODELS.map((s) => [s.id, s])) as Record<SkinId, SkinModel>;
