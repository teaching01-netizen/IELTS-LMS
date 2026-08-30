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

export function nextSatActiveTool(
  capabilities: SatToolCapabilities,
  current: SatActiveTool,
  requested: SatToolId,
): SatActiveTool {
  if (!isSatToolAvailable(capabilities, requested)) return null;
  return current === requested ? null : requested;
}

export function emptySatToolCapabilities(): SatToolCapabilities {
  return { calculator: false, referenceSheet: false };
}
