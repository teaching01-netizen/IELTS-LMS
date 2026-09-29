import type { MCQOption } from "../types";

export function getMcqOptionLabel(option: Pick<MCQOption, "label">, index: number): string {
  return option.label?.trim() || String.fromCharCode(65 + index);
}

export function hasDuplicateMcqOptionLabels(options: readonly Pick<MCQOption, "label">[]): boolean {
  const labels = new Set<string>();
  return options.some((option, index) => {
    const normalized = getMcqOptionLabel(option, index).toUpperCase();
    if (labels.has(normalized)) {
      return true;
    }
    labels.add(normalized);
    return false;
  });
}
