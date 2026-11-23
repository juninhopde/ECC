/**
 * Orquestra todas as pipas: intercala os sub-passos de cada piloto e roda o
 * combate (relo, estirante, apara) apos cada sub-passo, a 240 Hz efetivos.
 */
import type { Vector3 } from 'three';
import { SUBSTEPS, type KiteRig, type PilotInput, type RigEnvironment } from './KiteRig';
import { ReloSystem, type CombatEvent } from './ReloSystem';

export interface RigDrive {
  input: PilotInput;
  /** Ponto onde a linha sai da mao do piloto. */
  anchor: Vector3;
}

export class CombatWorld {
  readonly rigs: KiteRig[] = [];
  readonly relo = new ReloSystem();

  add(rig: KiteRig): void {
    if (!this.rigs.includes(rig)) this.rigs.push(rig);
  }

  remove(rig: KiteRig): void {
    const i = this.rigs.indexOf(rig);
    if (i >= 0) this.rigs.splice(i, 1);
    this.relo.hooks.delete(rig);
    for (const [k, c] of [...this.relo.contacts]) if (c.a === rig || c.b === rig) this.relo.contacts.delete(k);
  }

  /** Um passo fixo de 1/60 s para todos. `drive` entrega entrada e ancora de cada piloto. */
  step(dt: number, drive: (rig: KiteRig) => RigDrive, env: RigEnvironment): CombatEvent[] {
    const drives: RigDrive[] = this.rigs.map((r) => drive(r));
    const simulating: KiteRig[] = [];
    this.rigs.forEach((rig, i) => {
      if (rig.beginTick(dt, drives[i]!.input, drives[i]!.anchor, env)) simulating.push(rig);
    });
    const dtS = dt / SUBSTEPS;
    for (let s = 1; s <= SUBSTEPS; s++) {
      for (const rig of simulating) rig.subStep(s, dtS, env);
      this.relo.detect(this.rigs, dtS);
    }
    this.rigs.forEach((rig, i) => rig.endTick(dt, drives[i]!.input, env));
    this.relo.tick(dt, this.rigs);
    return this.relo.drainEvents();
  }
}
