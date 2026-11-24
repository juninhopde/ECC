import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, WalkWorld, createPlayerBody } from '../src/world/Collision';

function makeWorld(): WalkWorld {
  const boxes = [
    { minX: 10, maxX: 20, minZ: -5, maxZ: 5, top: 3.2 }, // casa com laje
    { minX: 4, maxX: 4.5, minZ: 8, maxZ: 9, top: 0.2 },
    { minX: 4.5, maxX: 5, minZ: 8, maxZ: 9, top: 0.4 },
  ];
  // escada: degraus de 0.2 m subindo em +x junto a uma plataforma
  for (let i = 0; i < 16; i++) {
    boxes.push({ minX: 30 + i * 0.28, maxX: 30.28 + i * 0.28, minZ: 0, maxZ: 1, top: 0.2 * (i + 1) });
  }
  boxes.push({ minX: 34.48, maxX: 38, minZ: 0, maxZ: 1, top: 3.2 }); // laje no topo da escada
  return new WalkWorld({
    terrainHeight: () => 0,
    boxes,
    ramps: [{ cx: 60, cz: 0, dirX: 1, dirZ: 0, length: 8, width: 2, baseY: 0, topY: 3 }],
    bounds: { minX: -50, maxX: 80, minZ: -50, maxZ: 50 },
  });
}

function walk(world: WalkWorld, body: ReturnType<typeof createPlayerBody>, dx: number, dz: number, steps: number): void {
  for (let i = 0; i < steps; i++) world.move(body, dx / steps, dz / steps, 1 / 60);
}

describe('WalkWorld', () => {
  it('anda livre no plano', () => {
    const w = makeWorld();
    const b = createPlayerBody(0, 0);
    walk(w, b, 3, 2, 60);
    expect(b.x).toBeCloseTo(3, 6);
    expect(b.z).toBeCloseTo(2, 6);
    expect(b.y).toBe(0);
  });

  it('parede alta bloqueia e o jogador nunca entra na caixa', () => {
    const w = makeWorld();
    const b = createPlayerBody(5, 0);
    walk(w, b, 20, 0, 300);
    expect(b.x).toBeLessThanOrEqual(10 - PLAYER_RADIUS + 1e-6);
    expect(b.y).toBe(0);
  });

  it('desliza ao longo da parede', () => {
    const w = makeWorld();
    const b = createPlayerBody(9, -2);
    walk(w, b, 5, 3, 120);
    expect(b.z).toBeGreaterThan(-2);
    expect(b.x).toBeLessThanOrEqual(10 - PLAYER_RADIUS + 1e-6);
  });

  it('sobe degraus baixos automaticamente', () => {
    const w = makeWorld();
    const b = createPlayerBody(3, 8.5);
    walk(w, b, 1.8, 0, 120); // termina em x=4.8, sobre o segundo degrau (0.4 m)
    expect(b.y).toBeCloseTo(0.4, 6);
    walk(w, b, 2, 0, 120); // passa do ultimo degrau: volta ao chao
    expect(b.y).toBeCloseTo(0, 6);
  });

  it('sobe a escada ate a laje e fica em cima', () => {
    const w = makeWorld();
    const b = createPlayerBody(29, 0.5);
    walk(w, b, 8, 0, 480);
    expect(b.y).toBeCloseTo(3.2, 6);
    expect(b.x).toBeGreaterThan(34.5);
  });

  it('cai da laje ate o chao ao sair pela borda (gravidade)', () => {
    const w = makeWorld();
    const b = createPlayerBody(36, 0.5, 3.2);
    walk(w, b, 6, 0, 360);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.onGround).toBe(true);
  });

  it('sobe rampa e acompanha a altura', () => {
    const w = makeWorld();
    const b = createPlayerBody(55, 0);
    walk(w, b, 8, 0, 480); // termina em x=63: altura = 3 * (63 - 56) / 8
    expect(b.y).toBeCloseTo(2.625, 4);
  });

  it('respeita os limites do mapa', () => {
    const w = makeWorld();
    const b = createPlayerBody(70, 0);
    walk(w, b, 100, 0, 600);
    expect(b.x).toBeLessThanOrEqual(80);
  });

  it('bloqueio extra (agua) impede entrar', () => {
    const w = new WalkWorld({
      terrainHeight: () => 0,
      boxes: [],
      ramps: [],
      bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
      isBlocked: (_x, z) => z < -10,
    });
    const b = createPlayerBody(0, 0);
    walk(w, b, 0, -30, 300);
    expect(b.z).toBeGreaterThanOrEqual(-10);
  });

  it('terreno muito inclinado bloqueia', () => {
    const w = new WalkWorld({
      terrainHeight: (x) => (x > 5 ? 20 : 0),
      boxes: [],
      ramps: [],
      bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    });
    const b = createPlayerBody(0, 0);
    walk(w, b, 20, 0, 300);
    expect(b.x).toBeLessThanOrEqual(5.01);
  });
});
