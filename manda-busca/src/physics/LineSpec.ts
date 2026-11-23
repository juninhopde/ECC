/**
 * Tipos de linha. `abrasion` multiplica o poder de corte no relo (fase 3) e
 * `resistance` multiplica a resistencia a ruptura (fase 2 e 3).
 */
export type LineId = 'linha10' | 'cerol' | 'chilena';

export interface LineSpec {
  id: LineId;
  label: string;
  /** Multiplicador de abrasividade (poder de corte). */
  abrasion: number;
  /** Multiplicador de resistencia ao atrito acumulado e a tracao. */
  resistance: number;
  /** Massa por metro (kg/m). */
  linearDensity: number;
  /** Diametro (m). */
  diameter: number;
  /** Rigidez axial EA (N). */
  stiffness: number;
  /** Tracao de ruptura (N) usada no engate em cabos de poste. */
  breakTension: number;
  /** Cor da linha no render (sRGB hex). */
  color: number;
}

export const LINE_SPECS: Record<LineId, LineSpec> = {
  linha10: {
    id: 'linha10', label: 'Linha 10 Pura', abrasion: 1.0, resistance: 1.0,
    linearDensity: 0.0005, diameter: 0.0005, stiffness: 500, breakTension: 18, color: 0xeeeee6,
  },
  cerol: {
    id: 'cerol', label: 'Cerol', abrasion: 1.45, resistance: 1.15,
    linearDensity: 0.0007, diameter: 0.0006, stiffness: 520, breakTension: 21, color: 0xe6c8a0,
  },
  chilena: {
    id: 'chilena', label: 'Linha Chilena', abrasion: 1.95, resistance: 1.35,
    linearDensity: 0.0008, diameter: 0.0006, stiffness: 560, breakTension: 24, color: 0xb8c7d9,
  },
};

export const LINE_ORDER: LineId[] = ['linha10', 'cerol', 'chilena'];
