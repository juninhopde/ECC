/** Moedas e missoes por cortes, aparas e tempo de voo do jogador (valem em qualquer modo). */
import type { Profile } from '../data/Profile';
import type { KiteRig } from '../physics/KiteRig';
import type { CombatEvent } from '../physics/ReloSystem';

export const COINS_PER_CUT = 25;
export const COINS_PER_APARA = 40;

export interface RewardSummary {
  cuts: number;
  aparas: number;
  coins: number;
}

/** Corte (na linha ou no estirante) conta para quem corta; a rabiola cortada nao paga. */
export function applyRewards(events: readonly CombatEvent[], player: KiteRig, profile: Profile): RewardSummary {
  let cuts = 0;
  let aparas = 0;
  for (const e of events) {
    if (e.attacker !== player) continue;
    if (e.type === 'cut' || e.type === 'bridle-cut') cuts++;
    else if (e.type === 'capture') aparas++;
  }
  if (cuts > 0) profile.record('cuts', cuts);
  if (aparas > 0) profile.record('aparas', aparas);
  const coins = cuts * COINS_PER_CUT + aparas * COINS_PER_APARA;
  if (coins > 0) profile.addCoins(coins);
  return { cuts, aparas, coins };
}

/** Acumula tempo com a pipa no ar e o lanca na missao em blocos de 1 s (evita gravar a cada passo). */
export class AirTime {
  private acc = 0;

  update(dt: number, player: KiteRig, profile: Profile): void {
    if (player.state !== 'FLYING' || !player.connected) return;
    this.acc += dt;
    if (this.acc >= 1) {
      const whole = Math.floor(this.acc);
      profile.record('airtime', whole);
      this.acc -= whole;
    }
  }
}
