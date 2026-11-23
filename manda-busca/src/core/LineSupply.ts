/**
 * Linha disponivel no carretel. Capacidade em jardas (1 jarda = 0,9144 m).
 * `remaining` nunca fica negativo nem acima da capacidade.
 */
export const YARD_TO_M = 0.9144;

export class LineSupply {
  readonly capacity: number;
  private amount: number;

  constructor(capacityYards = 250, initialFill = 0.85) {
    this.capacity = capacityYards * YARD_TO_M;
    this.amount = this.capacity * Math.min(Math.max(initialFill, 0), 1);
  }

  /** Metros de linha ainda no carretel. */
  get remaining(): number {
    return this.amount;
  }

  /** Fracao [0, 1] do carretel. */
  get fill(): number {
    return this.amount / this.capacity;
  }

  /** Jardas restantes (para o HUD). */
  get remainingYards(): number {
    return this.amount / YARD_TO_M;
  }

  get capacityYards(): number {
    return this.capacity / YARD_TO_M;
  }

  /** Solta linha do carretel. Devolve quantos metros sairam de fato. */
  payOut(meters: number): number {
    const taken = Math.min(Math.max(meters, 0), this.amount);
    this.amount -= taken;
    return taken;
  }

  /** Recolhe linha para o carretel. Devolve quantos metros entraram de fato. */
  takeIn(meters: number): number {
    const room = this.capacity - this.amount;
    const given = Math.min(Math.max(meters, 0), room);
    this.amount += given;
    return given;
  }

  setCapacityYards(yards: number): LineSupply {
    return new LineSupply(yards, this.fill);
  }
}
