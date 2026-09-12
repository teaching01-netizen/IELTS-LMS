export type SatToolId = 'calculator' | 'reference_sheet';

export interface SatToolCapabilities {
  calculator: boolean;
  referenceSheet: boolean;
}

export type SatActiveTool = SatToolId | null;

function enabled(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined;
}

export function resolveSatToolCapabilities(
  toolPolicy: Record<string, unknown> | string[],
): SatToolCapabilities {
  if (Array.isArray(toolPolicy)) {
    return {
      calculator: toolPolicy.includes('calculator'),
      referenceSheet: toolPolicy.includes('reference_sheet'),
    };
  }

  return {
    calculator: enabled(toolPolicy['calculator']),
    referenceSheet: enabled(toolPolicy['reference_sheet']),
  };
}
export function isSatToolAvailable(
  capabilities: SatToolCapabilities,
  tool: SatToolId,
): boolean {
  return tool === 'calculator' ? capabilities.calculator : capabilities.referenceSheet;
}

export interface SatActiveTools {
  calculator: boolean;
  referenceSheet: boolean;
}

export const EMPTY_SAT_ACTIVE_TOOLS: SatActiveTools = {
  calculator: false,
  referenceSheet: false,
};

/**
 * Bluebook coexistence (Phase 9): calculator and reference are independent
 * flags. Toggling one never closes the other. Unavailable tools stay shut.
 * Legacy `activeTool` (compat-only, calculator wins ties) migrates via
 * satActiveToolsFromLegacy / toLegacy.
 */
export function toggleSatActiveTool(
  capabilities: SatToolCapabilities,
  current: SatActiveTools,
  requested: SatToolId,
): SatActiveTools {
  if (!isSatToolAvailable(capabilities, requested)) return current;
  if (requested === 'calculator') return { ...current, calculator: !current.calculator };
  return { ...current, referenceSheet: !current.referenceSheet };
}

export function satActiveToolsFromLegacy(tool: SatActiveTool): SatActiveTools {
  return {
    calculator: tool === 'calculator',
    referenceSheet: tool === 'reference_sheet',
  };
}

export function satActiveToolsToLegacy(tools: SatActiveTools): SatActiveTool {
  if (tools.calculator) return 'calculator';
  if (tools.referenceSheet) return 'reference_sheet';
  return null;
}

export function emptySatToolCapabilities(): SatToolCapabilities {
  return { calculator: false, referenceSheet: false };
}
