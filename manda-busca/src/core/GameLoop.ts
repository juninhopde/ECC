/**
 * Loop de jogo com passo fixo de 60 Hz desacoplado da taxa de renderizacao.
 * Toda a fisica roda em FIXED_DT; o render apenas interpola com `alpha`.
 */

export const FIXED_DT = 1 / 60;

/** Acumulador de passo fixo, separado do requestAnimationFrame para ser testavel. */
export class FixedTimestep {
  private accumulator = 0;

  constructor(
    readonly dt: number = FIXED_DT,
    private readonly maxFrame: number = 0.25,
  ) {}

  /** Consome o tempo do quadro e devolve quantos passos fixos devem rodar. */
  advance(frameDt: number): number {
    const safe = Math.min(Math.max(frameDt, 0), this.maxFrame);
    this.accumulator += safe;
    let steps = 0;
    while (this.accumulator >= this.dt - 1e-9) {
      this.accumulator -= this.dt;
      steps++;
    }
    return steps;
  }

  /** Fracao [0, 1) do proximo passo ja decorrida, para interpolacao de render. */
  get alpha(): number {
    return Math.min(Math.max(this.accumulator / this.dt, 0), 1);
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export interface GameLoopCallbacks {
  /** Rodado 0..n vezes por quadro, sempre com dt = FIXED_DT. */
  fixedUpdate(dt: number, tick: number): void;
  /** Rodado uma vez por quadro. `alpha` e a fracao de interpolacao. */
  render(alpha: number, frameDt: number, nowSeconds: number): void;
}

export class GameLoop {
  private readonly stepper = new FixedTimestep();
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private tickCount = 0;
  private clock = 0;

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  get tick(): number {
    return this.tickCount;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      const frameDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.step(frameDt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Avanca a simulacao manualmente (usado por testes e captura automatizada). */
  step(frameDt: number): void {
    const steps = this.stepper.advance(frameDt);
    for (let i = 0; i < steps; i++) {
      this.callbacks.fixedUpdate(FIXED_DT, this.tickCount);
      this.tickCount++;
    }
    this.clock += Math.min(Math.max(frameDt, 0), 0.25);
    this.callbacks.render(this.stepper.alpha, frameDt, this.clock);
  }
}
