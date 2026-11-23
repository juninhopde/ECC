/**
 * Campeonato do Bairro: evento automatico a cada 3 minutos (do inicio de um ao inicio do proximo).
 *  1. Preparacao (nao corta): todos sobem a pipa; o relo fica desligado.
 *  2. Valendo: contagem regressiva de 60 s; quem tem a pipa no ar entra e e eliminado se for cortado.
 *  3. Fim: quem sobreviveu sem ser cortado leva o premio.
 */
import type { KiteRig } from '../physics/KiteRig';
import type { ReloSystem } from '../physics/ReloSystem';

export type ChampionshipPhase = 'idle' | 'prep' | 'run';

export interface ChampionshipHooks {
  onPrep(): void;
  onRun(participants: readonly KiteRig[]): void;
  onEnd(survivors: readonly KiteRig[], participants: readonly KiteRig[]): void;
}

export interface ChampionshipTimings {
  everySeconds: number;
  prepSeconds: number;
  runSeconds: number;
}

export const DEFAULT_TIMINGS: ChampionshipTimings = { everySeconds: 180, prepSeconds: 20, runSeconds: 60 };

export class Championship {
  phase: ChampionshipPhase = 'idle';
  /** Instante do proximo inicio (idle) ou do fim da fase atual (prep/run). */
  private nextStart: number;
  private phaseEnd = 0;
  private startedAt = 0;
  private participants: KiteRig[] = [];

  constructor(
    private readonly relo: ReloSystem,
    private readonly hooks: ChampionshipHooks,
    readonly timings: ChampionshipTimings = DEFAULT_TIMINGS,
    firstAt = timings.everySeconds,
  ) {
    this.nextStart = firstAt;
  }

  /** Segundos ate a proxima etapa (inicio do campeonato, fim da preparacao ou fim da corrida). */
  remaining(now: number): number {
    return Math.max(0, (this.phase === 'idle' ? this.nextStart : this.phaseEnd) - now);
  }

  /** Pipas ainda sem corte durante a corrida. */
  alive(): readonly KiteRig[] {
    return this.participants.filter((r) => r.connected);
  }

  get entered(): readonly KiteRig[] {
    return this.participants;
  }

  update(now: number, rigs: readonly KiteRig[]): void {
    if (this.phase === 'idle') {
      if (now >= this.nextStart) {
        this.phase = 'prep';
        this.startedAt = now;
        this.phaseEnd = now + this.timings.prepSeconds;
        this.relo.enabled = false;
        this.hooks.onPrep();
      }
      return;
    }
    if (this.phase === 'prep') {
      if (now >= this.phaseEnd) {
        this.phase = 'run';
        this.phaseEnd = now + this.timings.runSeconds;
        this.relo.enabled = true;
        this.participants = rigs.filter((r) => r.state === 'FLYING' && r.connected);
        this.hooks.onRun(this.participants);
      }
      return;
    }
    // Valendo: o corte desliga a ligacao da pipa com a mao (connected = false).
    if (now >= this.phaseEnd) {
      const survivors = this.alive();
      const entered = this.participants;
      this.phase = 'idle';
      this.nextStart = this.startedAt + this.timings.everySeconds;
      if (this.nextStart <= now) this.nextStart = now + 1;
      this.participants = [];
      this.hooks.onEnd(survivors, entered);
    }
  }

  /** Cancela o evento (troca de modo): religa o relo. */
  dispose(): void {
    this.relo.enabled = true;
  }
}
