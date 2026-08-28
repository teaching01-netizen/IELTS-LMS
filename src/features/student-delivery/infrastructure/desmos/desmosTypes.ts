export type DesmosCalculatorMode = 'scientific' | 'graphing';
export type DesmosCalculatorState = unknown;

export interface DesmosEnabledFeatures {
  GraphingCalculator: boolean;
  FourFunctionCalculator?: boolean;
  ScientificCalculator: boolean;
  GeometryCalculator?: boolean;
  Calculator3D?: boolean;
}

export interface DesmosCalculatorInstance {
  getState(): DesmosCalculatorState;
  setState(state: DesmosCalculatorState): void;
  setBlank?(options?: Record<string, unknown>): void;
  resize(): void;
  focusFirstExpression?(): void;
  observeEvent(eventName: string, callback: () => void): void;
  unobserveEvent(eventName: string): void;
  destroy(): void;
}

export interface DesmosGraphingOptions {
  expressions?: boolean;
  graphpaper?: boolean;
  settingsMenu?: boolean;
  zoomButtons?: boolean;
  keypad?: boolean;
  images?: boolean;
  folders?: boolean;
  notes?: boolean;
  links?: boolean;
  authorFeatures?: boolean;
  forceLogModeRegressions?: boolean;
  showEvaluationCopyButtons?: boolean;
  brailleControls?: boolean;
}

export interface DesmosScientificOptions {
  links?: boolean;
  qwertyKeyboard?: boolean;
  degreeMode?: boolean;
  allowComplex?: boolean;
  settingsMenu?: boolean;
  capExpressionSize?: boolean;
  limitNumberScale?: boolean;
}

export interface DesmosNamespace {
  enabledFeatures: DesmosEnabledFeatures;
  GraphingCalculator(
    element: HTMLElement,
    options?: DesmosGraphingOptions,
  ): DesmosCalculatorInstance;
  ScientificCalculator(
    element: HTMLElement,
    options?: DesmosScientificOptions,
  ): DesmosCalculatorInstance;
}
declare global {
  interface Window {
    Desmos?: DesmosNamespace;
  }
}

export {};
