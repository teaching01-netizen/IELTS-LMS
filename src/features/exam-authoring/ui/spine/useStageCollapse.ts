import { useCallback, useState } from "react";

export type SpineStageId = "prompt" | "material" | "classification" | "key" | "rationale" | "validation";

const STORAGE_KEY = "sat-spine-stage-collapse-v1";

function readStored(): Partial<Record<SpineStageId, boolean>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Partial<Record<SpineStageId, boolean>>;
    }
  } catch {
    // Corrupt collapse state must never block editing; fall back to open.
  }
  return {};
}

/**
 * Field anchor → owning stage. Mirrors the workspace `resolveAuthoringField`
 * vocabulary so a focus jump can expand the stage that owns its target
 * BEFORE the scroll-focus effect queries `[data-authoring-field]`.
 */
export function stageForField(field: string | null | undefined): SpineStageId | null {
  if (!field) return null;
  if (field === "prompt") return "prompt";
  if (field === "stimulus") return "material";
  if (field === "domain" || field === "skill" || field.startsWith("metadata.")) return "classification";
  if (field === "rationale") return "rationale";
  if (field === "validation") return "validation";
  return "key";
}

export interface StageCollapse {
  collapsed: Partial<Record<SpineStageId, boolean>>;
  toggle: (stage: SpineStageId) => void;
  /** Idempotent open: expanding an open stage is a no-op (never toggles shut). */
  expand: (stage: SpineStageId) => void;
}

/** Persisted per-stage collapse for the spine column. Open by default. */
export function useStageCollapse(): StageCollapse {
  const [collapsed, setCollapsed] = useState<Partial<Record<SpineStageId, boolean>>>(() =>
    typeof window === "undefined" ? {} : readStored(),
  );
  const persist = useCallback((next: Partial<Record<SpineStageId, boolean>>) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full/blocked: collapse still works for this session.
    }
  }, []);
  const toggle = useCallback(
    (stage: SpineStageId) => {
      setCollapsed((current) => {
        const next = { ...current, [stage]: !current[stage] };
        persist(next);
        return next;
      });
    },
    [persist],
  );
  const expand = useCallback(
    (stage: SpineStageId) => {
      setCollapsed((current) => {
        if (current[stage] !== true) return current;
        const next = { ...current, [stage]: false };
        persist(next);
        return next;
      });
    },
    [persist],
  );
  return { collapsed, toggle, expand };
}
