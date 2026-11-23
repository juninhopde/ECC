/**
 * Entrada de teclado, mouse e roda. Separa dois tipos de "pressionou":
 *  - wasPressed / mousePressed: borda lida pela simulacao, limpa a cada passo fixo;
 *  - consumePressed: borda lida pela interface (uma vez por clique), no render.
 * `enabled` fica falso enquanto o ponteiro nao esta travado (menu aberto).
 */

const PREVENT_DEFAULT_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyN', 'KeyF', 'KeyB', 'KeyC',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Space', 'Tab', 'F3',
  'Digit1', 'Digit2', 'Digit3',
]);

export class InputManager {
  enabled = false;
  private readonly down = new Set<string>();
  private readonly tickPressed = new Set<string>();
  private readonly uiPressed = new Set<string>();
  private readonly mouseDownSet = new Set<number>();
  private readonly mouseTickPressed = new Set<number>();
  private wheelDownAccum = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(target: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.enabled && PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressKey(e.code);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.down.delete(e.code);
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (!this.enabled) return;
      this.pressMouse(e.button);
    };
    const onMouseUp = (e: MouseEvent): void => {
      this.mouseDownSet.delete(e.button);
    };
    const onWheel = (e: WheelEvent): void => {
      if (!this.enabled) return;
      e.preventDefault();
      this.injectWheel(e.deltaY);
    };
    const onContextMenu = (e: Event): void => e.preventDefault();
    const onBlur = (): void => this.releaseAll();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    target.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('contextmenu', onContextMenu);
    this.cleanup.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('blur', onBlur),
      () => target.removeEventListener('wheel', onWheel),
      () => target.removeEventListener('contextmenu', onContextMenu),
    );
  }

  private pressKey(code: string): void {
    this.down.add(code);
    this.tickPressed.add(code);
    this.uiPressed.add(code);
  }

  private pressMouse(button: number): void {
    this.mouseDownSet.add(button);
    this.mouseTickPressed.add(button);
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** Borda de tecla para a simulacao (valida ate o proximo endTick). */
  wasPressed(code: string): boolean {
    return this.enabled && this.tickPressed.has(code);
  }

  /** Borda de tecla para a interface: devolve true uma unica vez por toque. */
  consumePressed(code: string): boolean {
    return this.uiPressed.delete(code);
  }

  mouseDown(button: number): boolean {
    return this.enabled && this.mouseDownSet.has(button);
  }

  mousePressed(button: number): boolean {
    return this.enabled && this.mouseTickPressed.has(button);
  }

  /** Quantidade de "cliques" de roda para baixo acumulados desde a ultima leitura. */
  consumeWheelDown(): number {
    const v = this.wheelDownAccum;
    this.wheelDownAccum = 0;
    return v;
  }

  /** Chamar apos cada passo fixo para limpar as bordas. */
  endTick(): void {
    this.tickPressed.clear();
    this.mouseTickPressed.clear();
  }

  releaseAll(): void {
    this.down.clear();
    this.mouseDownSet.clear();
    this.tickPressed.clear();
    this.mouseTickPressed.clear();
  }

  // Ganchos programaticos (testes e captura automatizada).
  injectKey(code: string, isDown: boolean): void {
    if (isDown) this.pressKey(code);
    else this.down.delete(code);
  }

  injectMouse(button: number, isDown: boolean): void {
    if (isDown) this.pressMouse(button);
    else this.mouseDownSet.delete(button);
  }

  injectWheel(deltaY: number): void {
    if (deltaY > 0) this.wheelDownAccum += Math.min(deltaY / 100, 3);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
  }
}
