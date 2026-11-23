import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LINE_SPECS } from '../src/physics/LineSpec';
import { VerletLine, LINE_NODES } from '../src/physics/VerletLine';
import type { WireSegment } from '../src/world/Catenary';

const noWind = (_x: number, _y: number, _z: number, _t: number, out: Vector3): Vector3 => out.set(0, 0, 0);
const DT = 1 / 240;

function settle(line: VerletLine, seconds: number, wind = noWind, wires: readonly WireSegment[] = []): void {
  for (let i = 0; i < seconds / DT; i++) line.step(DT, { wind, time: i * DT, wires });
}

/** Parametro `a` da catenaria com comprimento de arco L e vao S: L = 2a sinh(S/2a). */
function catenaryParamForLength(L: number, S: number): number {
  let lo = S / 100;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (2 * mid * Math.sinh(S / (2 * mid)) > L) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('VerletLine', () => {
  it('usa 36 nos por padrao e o comprimento ativo informado', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 54);
    expect(l.n).toBe(36);
    expect(l.activeLength).toBeCloseTo(54, 9);
    l.activeLength = 90;
    expect(l.restLen).toBeCloseTo(90 / 35, 9);
  });

  it('forma a barriga de uma catenaria (flecha confere com a teoria)', () => {
    const L = 44;
    const S = 40;
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, L);
    const a = new Vector3(-S / 2, 30, 0);
    const b = new Vector3(S / 2, 30, 0);
    l.layout(a, b);
    l.startAnchor.copy(a);
    l.endAnchor.copy(b);
    settle(l, 6);
    const mid = l.node(17, new Vector3());
    const mid2 = l.node(18, new Vector3());
    const sag = 30 - (mid.y + mid2.y) / 2;
    const p = catenaryParamForLength(L, S);
    const theory = p * (Math.cosh(S / (2 * p)) - 1);
    expect(sag).toBeGreaterThan(theory * 0.85);
    expect(sag).toBeLessThan(theory * 1.15);
  });

  it('linha esticada: a tracao segue a rigidez (T ~ EA * deformacao)', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 39.8);
    const a = new Vector3(0, 20, 0);
    const b = new Vector3(40, 20, 0);
    l.layout(a, b);
    l.startAnchor.copy(a);
    l.endAnchor.copy(b);
    settle(l, 2);
    const expected = (LINE_SPECS.linha10.stiffness * (40 - 39.8)) / 39.8;
    const t = l.endForce.length();
    expect(t).toBeGreaterThan(expected * 0.85);
    expect(t).toBeLessThan(expected * 1.25);
    // E a deformacao real e pequena: o cordao nao "estica feito mola mole".
    expect(l.chordLength() / l.activeLength).toBeLessThan(1.012);
  });

  it('a linha traciona mas nunca empurra (folga vira barriga, forca ~ 0)', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 60);
    const a = new Vector3(0, 10, 0);
    const b = new Vector3(30, 10, 0);
    l.layout(a, b);
    l.startAnchor.copy(a);
    l.endAnchor.copy(b);
    settle(l, 3);
    expect(l.endForce.length()).toBeLessThan(0.5);
    for (let i = 0; i < l.pos.length; i++) expect(Number.isFinite(l.pos[i])).toBe(true);
    // O no do meio desce bastante: ha barriga.
    expect(l.node(17, new Vector3()).y).toBeLessThan(9);
  });

  it('e deterministico (mesmo estado e entrada, mesmo resultado)', () => {
    const run = (): Float64Array => {
      const l = new VerletLine(LINE_SPECS.cerol, LINE_NODES, 50);
      const a = new Vector3(0, 5, 0);
      const b = new Vector3(40, 18, 3);
      l.layout(a, b);
      l.startAnchor.copy(a);
      l.endAnchor.copy(b);
      const wind = (x: number, y: number, z: number, t: number, o: Vector3): Vector3 => o.set(6 + Math.sin(t + x * 0.1), 0.3 * Math.sin(y), 0.5 * Math.cos(z + t));
      settle(l, 2, wind);
      return l.pos.slice();
    };
    const r1 = run();
    const r2 = run();
    for (let i = 0; i < r1.length; i++) expect(r1[i]).toBe(r2[i]);
  });

  it('o vento lateral curva a linha para o lado de sotavento', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 80);
    const a = new Vector3(0, 2, 0);
    const b = new Vector3(0, 40, 40);
    l.layout(a, b);
    l.startAnchor.copy(a);
    l.endAnchor.copy(b);
    const wind = (_x: number, _y: number, _z: number, _t: number, o: Vector3): Vector3 => o.set(8, 0, 0);
    settle(l, 4, wind);
    const m = l.node(17, new Vector3());
    expect(m.x).toBeGreaterThan(0.2);
  });

  it('splitAt divide a linha sem perder nos e preserva posicoes', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 70);
    const a = new Vector3(0, 5, 0);
    const b = new Vector3(35, 25, 0);
    l.layout(a, b);
    const before = l.node(20, new Vector3());
    const right = l.splitAt(12);
    expect(l.n + right.n).toBe(LINE_NODES); // nenhum no perdido: 13 + 23 = 36
    expect(l.n).toBe(13);
    expect(right.n).toBe(36 - 1 - 12);
    expect(l.endPinned).toBe(false);
    expect(right.startPinned).toBe(false);
    expect(right.node(20 - 13, new Vector3()).distanceTo(before)).toBeLessThan(1e-12);
    expect(right.restLen).toBeCloseTo(l.restLen, 12);
  });

  it('engata em cabo de poste e rompe quando puxada com forca', () => {
    const wire: WireSegment = { a: new Vector3(15, 8, -6), b: new Vector3(15, 8, 6), radius: 0.015 };
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 30);
    const a = new Vector3(0, 1, 0);
    const b = new Vector3(30, 15, 0);
    l.layout(a, b);
    l.startAnchor.copy(a);
    // Primeiro a linha toca o cabo com pouca tracao: engata sem romper.
    l.endAnchor.copy(b);
    for (let i = 0; i < 60 && !l.isSnagged(); i++) l.step(DT, { wind: noWind, time: 0, wires: [wire] });
    expect(l.isSnagged()).toBe(true);
    expect(l.pendingBreak).toBeNull();
    // Agora puxa com forca: o extremo se afasta e a tracao passa do limite.
    l.endAnchor.set(38, 19, 0);
    let broke = false;
    for (let i = 0; i < 480 && !broke; i++) {
      l.step(DT, { wind: noWind, time: 0, wires: [wire] });
      broke = l.pendingBreak !== null;
    }
    expect(broke).toBe(true);
    expect(l.pendingBreak!.cause).toBe('cabo');
    expect(l.pendingBreak!.node).toBeGreaterThan(5);
    expect(l.pendingBreak!.node).toBeLessThan(30);
  });

  it('colide com o chao e nao atravessa', () => {
    const l = new VerletLine(LINE_SPECS.linha10, LINE_NODES, 70);
    const a = new Vector3(0, 1, 0);
    const b = new Vector3(30, 1, 0);
    l.layout(a, b);
    l.startAnchor.copy(a);
    l.endAnchor.copy(b);
    for (let i = 0; i < 4 / DT; i++) l.step(DT, { wind: noWind, time: 0, groundHeight: () => 0 });
    for (let i = 0; i < l.n; i++) expect(l.node(i, new Vector3()).y).toBeGreaterThanOrEqual(0.0199);
  });
});
