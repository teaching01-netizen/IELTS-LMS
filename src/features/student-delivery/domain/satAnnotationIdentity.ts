/** Stable SAT content regions used to qualify persisted text-node anchors. */
export type SatAnnotationRegion = 'stimulus' | 'prompt' | `choice.${string}`;

/** Choice identity follows the stable option id, never its display letter or index. */
export function satChoiceAnnotationRegion(optionId: string): SatAnnotationRegion {
  return `choice.${encodeURIComponent(optionId)}`;
}

/** Store region and structured-content node id in the existing anchor field. */
export function createSatAnnotationNodeId(region: SatAnnotationRegion, contentNodeId: string): string {
  return `${region}:${contentNodeId}`;
}

/** Recover the region and content node id from a persisted anchor. */
export function parseSatAnnotationNodeId(value: string): { region: string; contentNodeId: string } | null {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return null;
  return { region: value.slice(0, separator), contentNodeId: value.slice(separator + 1) };
}
