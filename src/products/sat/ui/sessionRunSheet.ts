/**
 * The staff run sheet: when the cohort is supposed to be where, in Thailand
 * time, on the clock the session is ACTUALLY running.
 *
 * Authority, in order:
 *
 *   - `runtime.sections` is the session's own clock. Each runtime row carries the
 *     section length snapshotted when the proctor started the session
 *     (`plannedDurationMinutes`), its extension, its accumulated pause, and its
 *     actual start/end. That snapshot — not the exam plan — is what every
 *     candidate's countdown runs on (`computeSectionRemaining` server-side,
 *     `useAuthoritativeDeadlineClock` in the student app), so it is what the
 *     sheet projects. A session started before a section-length repair keeps the
 *     longer clock until it is restarted, and the sheet must say so, not paper
 *     over it.
 *   - `plan` (proctor session detail `examPlan`) is the authored run sheet. It
 *     supplies the stage labels, the Module 1 / Module 2 split, and the fallback
 *     window for a section the runtime has no row for. Where the two disagree,
 *     the runtime wins and the row carries the discrepancy (`runtimeMismatch` /
 *     `mismatchNote`) instead of silently rendering the plan's number.
 *
 * Thailand time is pinned (Asia/Bangkok, UTC+7) rather than read from the
 * viewer's device: staff compare the sheet against a fixed cohort schedule, and
 * an operator travelling with a laptop on another timezone must still read the
 * same clock as the room.
 *
 * Per-module and per-break facts: the runtime records section-level instants
 * only. A module boundary is a per-candidate event (routing picks which Module 2
 * a candidate sits), so the sheet derives module windows inside the section
 * window — tiling it exactly, surplus included. When the clock is shorter than
 * the plan's modules (a version switched after Start, a repaired snapshot
 * against an older plan), the plan is scaled onto the clock and each compressed
 * row says what the module gets against the authored length: rendering the
 * authored lengths instead would claim time the section does not have. Actual
 * times are marked only where a section-level instant genuinely is the module's
 * or the break's own (Module 1 starts when its section starts; a break starts
 * when its section ends and ends when the next section starts).
 */

import type {
  ExamPlanSection,
  ExamSessionRuntime,
  SatAdaptiveRole,
  SectionRuntimeState,
} from "../../../types/domain";

export const SAT_RUN_SHEET_TIME_ZONE = "Asia/Bangkok";
export const SAT_RUN_SHEET_TIME_ZONE_LABEL = "ICT (UTC+7)";

export type SatRunSheetAnchor = "runtime" | "scheduled" | "none";
export type SatRunSheetRowKind = "section" | "module" | "break";
export type SatRunSheetRowStatus =
  | "done"
  | "live"
  | "paused"
  | "upcoming"
  | "projected";

export interface SatRunSheetRow {
  id: string;
  kind: SatRunSheetRowKind;
  label: string;
  /**
   * The authored name of the row when it says more than the label (a module's
   * own title against its `Module 1` / `Module 2` slot, an extension, a cut
   * clock). Null when the label already carries the whole name.
   */
  title: string | null;
  /** Extra truth for the row: branch lengths, extension, pause. */
  detail: string | null;
  /**
   * Seconds left in this row's own window on the room's clock, for the row the
   * room is inside right now. Null for every other row: a projected or upcoming
   * row has no running window to count down (its window and length are on the
   * row), and a finished one would only report a clamped 0:00 that reads as
   * "live". A paused row reports the window the pause landed on — the same
   * freeze the candidates' own clocks show.
   */
  remainingSeconds: number | null;
  /** Authored length from the exam plan, null when only the runtime knows the row. */
  plannedDurationMinutes: number | null;
  /** The runtime snapshot length in force (sections only), null otherwise. */
  runtimeDurationMinutes: number | null;
  /**
   * True when the runtime clock disagrees with the authored plan: the window
   * below is the runtime's, and staff must be able to see why it looks long.
   */
  runtimeMismatch: boolean;
  /** Human sentence for the divergence, rendered next to `detail`. */
  mismatchNote: string | null;
  status: SatRunSheetRowStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
}

export interface SatRunSheet {
  anchor: SatRunSheetAnchor;
  /** The instant every planned window is projected from; null when unknown. */
  anchorAt: string | null;
  rows: SatRunSheetRow[];
  /** Planned end of the run (breaks included); null when it cannot be known. */
  plannedEndAt: string | null;
}

export interface SatRunSheetInput {
  /** Authored plan; null on reads that do not carry it (summary/student). */
  plan?: ExamPlanSection[] | null | undefined;
  /** Live runtime sections: the authoritative clock, actuals, pauses, status. */
  runtime?: Pick<
    ExamSessionRuntime,
    "sections" | "actualStartAt" | "actualEndAt" | "status" | "serverNow"
  > | null | undefined;
  /** Session start from the schedule; used only before the proctor starts. */
  scheduledStartAt?: string | null | undefined;
  /** Server-clock "now" as an ISO instant; the only clock rows are read against. */
  now?: string | null | undefined;
}

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * Seconds left in one row's own window on the room's clock, for the row the
 * room is inside right now. A paused room reports the window the pause landed on
 * (its clock is not running, and the candidates' own timers are frozen with it);
 * every other row reports nothing rather than a clamped 0:00 that would read as
 * "live".
 */
function rowRemainingSeconds(args: {
  status: SatRunSheetRowStatus;
  endMs: number | null;
  nowMs: number | null;
  pausedAtMs: number | null;
}): number | null {
  if (args.status !== "live" && args.status !== "paused") return null;
  if (args.endMs === null) return null;
  const referenceMs = args.pausedAtMs ?? args.nowMs;
  if (referenceMs === null) return null;
  return Math.max(0, Math.ceil((args.endMs - referenceMs) / 1_000));
}

/**
 * A remaining window as staff read it off the sheet: `mm:ss`, or `h:mm:ss` once
 * the window is an hour or longer. `—` when the row has no running window.
 */
export function formatRunSheetRemaining(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}:${rest}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAT_RUN_SHEET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAT_RUN_SHEET_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

// en-CA renders YYYY-MM-DD, which compares lexically — the cheapest correct way
// to ask "is this instant on a different Bangkok day than that one".
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SAT_RUN_SHEET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(ms: number | null): string | null {
  return ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

/** The later instant; a missing side never shortens the other. */
function laterOf(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

/** Bangkok clock time, e.g. `09:04`. `—` for an unparseable instant. */
export function formatRunSheetClock(value: string | null | undefined): string {
  const ms = parseInstant(value);
  if (ms === null) return "—";
  return clockFormatter.format(new Date(ms));
}

/**
 * A planned/actual window in Thailand time: `09:00–10:04`, or
 * `Sun 21 Sep 09:00 – 10:04` when the window does not sit on `referenceAt`'s
 * Bangkok day (a run that crosses midnight must not read as a same-day span).
 */
export function formatRunSheetWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  referenceAt?: string | null | undefined
): string {
  const startMs = parseInstant(start);
  if (startMs === null) return "—";
  const endMs = parseInstant(end);
  const startClock = clockFormatter.format(new Date(startMs));
  const referenceMs = parseInstant(referenceAt) ?? startMs;
  const sameDay =
    dayKeyFormatter.format(new Date(startMs)) ===
    dayKeyFormatter.format(new Date(referenceMs));
  const startLabel = sameDay
    ? startClock
    : `${dayFormatter.format(new Date(startMs))} ${startClock}`;
  if (endMs === null) return startLabel;
  if (endMs <= startMs) return startLabel;
  const endClock = clockFormatter.format(new Date(endMs));
  const endSameDay =
    dayKeyFormatter.format(new Date(endMs)) ===
    dayKeyFormatter.format(new Date(startMs));
  return `${startLabel}–${endSameDay ? endClock : `${dayFormatter.format(new Date(endMs))} ${endClock}`}`;
}

function roleLabel(role: string): string {
  if (role === "lower_branch") return "Lower";
  if (role === "higher_branch") return "Higher";
  if (role === "base") return "Base";
  return "Module";
}

/**
 * The module slot one adaptive role denotes, in the words the room uses:
 * Module 1 is the base module and "Module 2" is whichever branch routing picked
 * for that candidate.
 *
 * The staff room labels a candidate's current module from this — the roster row
 * and the detail panel name the slot beside the section, so a proctor reading
 * "Section 1 · Module 2" knows a candidate has moved on without reading anyone
 * else's row. Null when there is no adaptive slot to name (a non-adaptive
 * section, or a candidate between modules): the caller renders nothing rather
 * than a guess.
 */
export function satModuleSlotLabel(role: SatAdaptiveRole | null | undefined): string | null {
  switch (role) {
    case "base":
      return "Module 1";
    case "lower_branch":
      return "Module 2 · Lower";
    case "higher_branch":
      return "Module 2 · Higher";
    default:
      return null;
  }
}

/** One authored section, normalised from `ExamPlanSection`. */
interface AuthoredSection {
  sectionKey: string;
  label: string;
  order: number;
  durationMinutes: number;
  gapAfterMinutes: number;
  modules: Array<{
    moduleKey: string;
    title: string;
    adaptiveRole: string;
    durationMinutes: number;
  }>;
}

/**
 * One run-sheet stage: the authored section (when the read carries a plan) and
 * the runtime row for the same key (when the session has one).
 */
interface RunSheetStage {
  sectionKey: string;
  label: string;
  order: number;
  plan: AuthoredSection | null;
  live: SectionRuntimeState | undefined;
}

/**
 * The union of the plan's sections and the runtime's rows, in display order.
 * A section the runtime has not created a row for yet (or a runtime row whose
 * version is no longer in the plan) still gets a stage: the run sheet shows what
 * the session will do, not only what it has already written down.
 */
function buildStages(input: SatRunSheetInput): RunSheetStage[] {
  const plans = new Map<string, AuthoredSection>();
  for (const section of input.plan ?? []) {
    const key = String(section.sectionKey);
    plans.set(key, {
      sectionKey: key,
      label: section.label,
      order: section.order,
      durationMinutes: section.durationMinutes,
      gapAfterMinutes: section.gapAfterMinutes,
      modules: (section.modules ?? []).map((module) => ({
        moduleKey: module.moduleKey,
        title: module.title,
        adaptiveRole: module.adaptiveRole,
        durationMinutes: module.durationMinutes,
      })),
    });
  }
  const lives = new Map<string, SectionRuntimeState>();
  for (const section of input.runtime?.sections ?? []) {
    lives.set(String(section.sectionKey), section);
  }

  const keys = new Set<string>([...plans.keys(), ...lives.keys()]);
  return [...keys]
    .map((key) => {
      const plan = plans.get(key) ?? null;
      const live = lives.get(key);
      return {
        sectionKey: key,
        label: plan?.label?.trim() || live?.label?.trim() || key,
        order: plan?.order ?? live?.order ?? 0,
        plan,
        live,
      };
    })
    .sort(
      (left, right) =>
        left.order - right.order || left.sectionKey.localeCompare(right.sectionKey)
    );
}

function resolveAnchor(input: SatRunSheetInput): {
  anchor: SatRunSheetAnchor;
  anchorAt: number | null;
} {
  const runtimeState = input.runtime?.status ?? null;
  const runtimeStart = parseInstant(input.runtime?.actualStartAt);
  if (runtimeStart !== null && runtimeState !== null && runtimeState !== "not_started") {
    return { anchor: "runtime", anchorAt: runtimeStart };
  }
  const scheduledStart = parseInstant(input.scheduledStartAt);
  if (scheduledStart !== null) return { anchor: "scheduled", anchorAt: scheduledStart };
  return { anchor: "none", anchorAt: null };
}

function sectionStatus(live: SectionRuntimeState | undefined): SatRunSheetRowStatus {
  if (!live) return "projected";
  if (live.status === "completed") return "done";
  if (live.status === "paused" || live.pausedAt) return "paused";
  if (live.status === "live") return "live";
  return "upcoming";
}

/** A module row inside a live section: which authored window holds `now`. */
function moduleStatus(
  parentStatus: SatRunSheetRowStatus,
  startMs: number | null,
  endMs: number | null,
  nowMs: number | null,
  isFirst: boolean
): SatRunSheetRowStatus {
  if (parentStatus === "done") return "done";
  if (parentStatus === "upcoming" || parentStatus === "projected") return parentStatus;
  if (startMs === null || endMs === null || nowMs === null) {
    // No server instant to place the cohort with: the first module is the
    // run's current stage and everything after it is still ahead.
    return isFirst ? parentStatus : "upcoming";
  }
  if (nowMs < startMs) return "upcoming";
  if (nowMs >= endMs) return "done";
  return parentStatus === "paused" ? "paused" : "live";
}

/**
 * The Module 1 / Module 2 slot the sheet shows for one section. The stable
 * `m1` / `m2` ids keep row identity steady while staff watch: the branch a
 * candidate sits is chosen by routing, and the slot is what the run sheet shows
 * either way. Legacy (non-adaptive) sections list their modules in authored
 * order instead.
 */
interface ModuleSlot {
  idSuffix: string;
  /** `Module 1`, `Module 2`, … — the slot the room talks in. */
  label: string;
  /** The authored module name, when it adds anything to the slot label. */
  title: string | null;
  detail: string | null;
  /** Authored minutes; the section window's surplus is added separately. */
  minutes: number;
}

function moduleSlots(modules: AuthoredSection["modules"]): ModuleSlot[] {
  const baseModule =
    modules.find((module) => module.adaptiveRole === "base") ??
    (modules.length === 1 ? modules[0] : undefined);
  const branchModules = modules.filter(
    (module) =>
      module.adaptiveRole === "lower_branch" ||
      module.adaptiveRole === "higher_branch"
  );
  const sequentialModules = modules.filter(
    (module) =>
      // `baseModule` already owns a slot when a lone roleless module is what
      // made it a base: listing it again would double its window.
      module !== baseModule &&
      module.adaptiveRole !== "base" &&
      module.adaptiveRole !== "lower_branch" &&
      module.adaptiveRole !== "higher_branch"
  );

  const slots: ModuleSlot[] = [];
  if (branchModules.length > 0) {
    if (baseModule) {
      slots.push({
        idSuffix: "m1",
        label: "Module 1",
        title: baseModule.title || baseModule.moduleKey,
        detail: roleLabel(baseModule.adaptiveRole),
        minutes: baseModule.durationMinutes,
      });
    }
    const onlyBranch = branchModules.length === 1 ? branchModules[0] : undefined;
    if (onlyBranch) {
      slots.push({
        idSuffix: "m2",
        label: "Module 2",
        title: onlyBranch.title || onlyBranch.moduleKey,
        detail: roleLabel(onlyBranch.adaptiveRole),
        minutes: onlyBranch.durationMinutes,
      });
    } else {
      // Two branches exist but only one is sat: show the slot once, with both
      // authored lengths, projected from the longer branch.
      const longest = branchModules.reduce((current, candidate) =>
        candidate.durationMinutes > current.durationMinutes ? candidate : current
      );
      slots.push({
        idSuffix: "m2",
        label: "Module 2",
        title: longest.title || longest.moduleKey,
        detail: branchModules
          .map((module) => `${roleLabel(module.adaptiveRole)} ${module.durationMinutes}′`)
          .join(" · "),
        minutes: longest.durationMinutes,
      });
    }
  } else if (baseModule) {
    slots.push({
      idSuffix: "m1",
      label: "Module 1",
      title: baseModule.title || baseModule.moduleKey,
      detail: roleLabel(baseModule.adaptiveRole),
      minutes: baseModule.durationMinutes,
    });
  }
  for (const module of sequentialModules) {
    slots.push({
      idSuffix: module.moduleKey,
      label: `Module ${slots.length + 1}`,
      title: module.title || module.moduleKey,
      detail: roleLabel(module.adaptiveRole),
      minutes: module.durationMinutes,
    });
  }
  // The slot label is the room's name for the module ("Module 1", "Module 2");
  // an authored title that only repeats it adds nothing.
  return slots.map((slot) => (slot.title === slot.label ? { ...slot, title: null } : slot));
}

/**
 * Which module absorbs the section's surplus (extension, accumulated pause, or
 * a runtime clock longer than the plan). The runtime records no module
 * boundaries, so the surplus is placed where the cohort is actually sitting —
 * the module holding `now` — and, when the run has not reached the section, on
 * the last module. The surplus is what makes a stretched clock visible on the
 * module the room is inside, instead of leaving a hole between the last module
 * row and its section row.
 */
function absorbIndex(
  slots: ModuleSlot[],
  startMs: number,
  nowMs: number | null
): number {
  if (nowMs !== null && nowMs >= startMs) {
    let cursor = startMs;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot) break;
      cursor += slot.minutes * MINUTE_MS;
      if (nowMs < cursor) return index;
    }
  }
  return slots.length - 1;
}

/**
 * The whole run sheet. Sections follow display order; each section emits its
 * module rows (when the plan carries them, tiled across the section window) and
 * its break. Windows come from the runtime clock, so extensions and accumulated
 * pause time shift every later window exactly as they shift the candidates'.
 */
export function buildSatRunSheet(input: SatRunSheetInput): SatRunSheet {
  const stages = buildStages(input);
  const { anchor, anchorAt } = resolveAnchor(input);
  const nowMs =
    parseInstant(input.now) ?? parseInstant(input.runtime?.serverNow) ?? null;

  const rows: SatRunSheetRow[] = [];
  let cursorMs = anchorAt;
  let plannedEndMs: number | null = null;

  stages.forEach((stage, index) => {
    const live = stage.live;
    const runtimeMinutes = live?.plannedDurationMinutes ?? null;
    const planMinutes = stage.plan?.durationMinutes ?? null;
    const extensionMinutes = live?.extensionMinutes ?? 0;
    const pausedSeconds = live?.accumulatedPausedSeconds ?? 0;
    // Runtime first: the snapshot is the clock the candidates are on. The plan
    // only fills in a section the runtime has no row for at all.
    const baseMinutes = runtimeMinutes ?? planMinutes;
    // A section that has not started has no actual start, whatever a row may
    // carry: only a live/paused/completed row's start is a fact about the run.
    const started = live !== undefined && live.status !== "locked";
    const startMs =
      (started ? parseInstant(live?.actualStartAt) : null) ??
      cursorMs ??
      parseInstant(live?.projectedStartAt);
    const clockMs =
      baseMinutes === null
        ? null
        : baseMinutes * MINUTE_MS +
          extensionMinutes * MINUTE_MS +
          pausedSeconds * SECOND_MS;
    const derivedEndMs =
      startMs === null || clockMs === null ? null : startMs + clockMs;
    const actualEndMs = parseInstant(live?.actualEndAt);
    // A section can never close EARLIER than the clock its candidates are on:
    // the derivation above is the same arithmetic as the server's
    // computeSectionRemaining, so a stored projection is only allowed to extend
    // it. Ratcheting up is the safe direction — an under-reported end is the
    // exact failure this sheet exists to expose.
    const endMs =
      actualEndMs ?? laterOf(derivedEndMs, parseInstant(live?.projectedEndAt));
    const status = sectionStatus(live);
    // A paused room's clock stopped where the pause landed: which module the
    // room is inside is read at THAT instant, not at the wall clock that kept
    // running. Otherwise a pause during Module 1 would mark Module 2 as the row
    // the room is sitting in, and the Remaining column would show a window the
    // candidates never saw.
    const positionMs = parseInstant(live?.pausedAt) ?? nowMs;

    const runtimeMismatch =
      runtimeMinutes !== null && planMinutes !== null && runtimeMinutes !== planMinutes;
    const details: string[] = [];
    if (extensionMinutes > 0) details.push(`+${extensionMinutes} min added`);
    if (pausedSeconds > 0) {
      details.push(`${Math.round(pausedSeconds / 60)} min paused`);
    }

    rows.push({
      id: `${stage.sectionKey}:section`,
      kind: "section",
      label: `Section ${index + 1} · ${stage.label}`,
      title: null,
      remainingSeconds: rowRemainingSeconds({
        status,
        endMs,
        nowMs,
        pausedAtMs: parseInstant(live?.pausedAt),
      }),
      detail: details.length > 0 ? details.join(" · ") : null,
      plannedDurationMinutes: planMinutes,
      runtimeDurationMinutes: runtimeMinutes,
      runtimeMismatch,
      mismatchNote: runtimeMismatch
        ? `Clock ${runtimeMinutes} min · plan ${planMinutes} min`
        : null,
      status,
      plannedStartAt: toIso(startMs),
      plannedEndAt: toIso(endMs),
      actualStartAt: started ? (live?.actualStartAt ?? null) : null,
      actualEndAt: live?.actualEndAt ?? null,
    });

    if (startMs !== null && endMs !== null) {
      const slots = moduleSlots(stage.plan?.modules ?? []);
      if (slots.length > 0) {
        const authoredMs = slots.reduce(
          (total, slot) => total + slot.minutes * MINUTE_MS,
          0
        );
        // The module rows tile this window exactly — contiguous, in order, and
        // never claiming a millisecond outside the section.
        const windowMs = Math.max(0, endMs - startMs);
        const tiledEndMs = startMs + windowMs;
        // Clock longer than (or equal to) the plan: every module keeps its
        // authored length and the surplus lands on the module the cohort is
        // inside (or the last one while the run is still ahead of it).
        const absorbing =
          windowMs > authoredMs ? absorbIndex(slots, startMs, positionMs) : -1;
        let moduleCursorMs = startMs;
        let prefixMs = 0;
        slots.forEach((slot, slotIndex) => {
          const authoredSlotMs = slot.minutes * MINUTE_MS;
          prefixMs += authoredSlotMs;
          let moduleEndMs: number;
          if (absorbing >= 0 && slotIndex === absorbing) {
            moduleEndMs =
              moduleCursorMs + authoredSlotMs + (windowMs - authoredMs);
          } else if (windowMs < authoredMs) {
            // Clock shorter than the plan: the authored lengths cannot all be
            // rendered — their tail would run past the section end, and
            // clamping only the last row inverted it. Scale the plan's
            // proportions onto the clock instead, rounding once per boundary so
            // neighbours share the exact instant, and let each compressed row
            // say what the module gets against what the plan listed.
            moduleEndMs =
              slotIndex === slots.length - 1
                ? tiledEndMs
                : startMs + Math.round((windowMs * prefixMs) / authoredMs);
          } else {
            moduleEndMs = moduleCursorMs + authoredSlotMs;
          }
          const allottedMs = moduleEndMs - moduleCursorMs;
          const compressed = allottedMs < authoredSlotMs;
          const moduleRowStatus = moduleStatus(
            status,
            moduleCursorMs,
            moduleEndMs,
            positionMs,
            slotIndex === 0
          );
          rows.push({
            id: `${stage.sectionKey}:module:${slot.idSuffix}`,
            kind: "module",
            label: slot.label,
            title: slot.title,
            remainingSeconds: rowRemainingSeconds({
              status: moduleRowStatus,
              endMs: moduleEndMs,
              nowMs,
              pausedAtMs: parseInstant(live?.pausedAt),
            }),
            detail: slot.detail,
            plannedDurationMinutes: slot.minutes,
            runtimeDurationMinutes: null,
            runtimeMismatch: compressed,
            mismatchNote: compressed
              ? `Plan ${slot.minutes} min · ${Math.round(allottedMs / MINUTE_MS)} min on the clock`
              : null,
            status: moduleRowStatus,
            plannedStartAt: toIso(moduleCursorMs),
            plannedEndAt: toIso(moduleEndMs),
            // The section opens by serving Module 1, so its start IS Module 1's
            // actual start. Later module boundaries are per-candidate events the
            // cohort runtime does not record: left empty rather than invented.
            actualStartAt:
              slotIndex === 0 && started ? (live?.actualStartAt ?? null) : null,
            actualEndAt: null,
          });
          moduleCursorMs = moduleEndMs;
        });
      }
    }

    const gapMinutes = live?.gapAfterMinutes ?? stage.plan?.gapAfterMinutes ?? 0;
    if (endMs !== null) {
      if (gapMinutes > 0) {
        // A finished section's break starts at its ACTUAL end (a proctor may
        // have ended it early or late); an unfinished one still has its break
        // ahead of it, whatever the clock says.
        const breakStartMs = actualEndMs ?? endMs;
        const breakEndMs = breakStartMs + gapMinutes * MINUTE_MS;
        // The break ends when the next section actually starts — the one
        // genuine cohort-level instant for a break's own end.
        const nextStartMs = parseInstant(stages[index + 1]?.live?.actualStartAt);
        const actualBreakEndMs =
          nextStartMs ??
          (index === stages.length - 1
            ? parseInstant(input.runtime?.actualEndAt)
            : null);
        // The break cannot have started before the section ends — a section can
        // sit past its derived window (a stalled reconciler, a paused clock)
        // while the room is still inside it, and the sheet must not report a
        // break that has not happened.
        let breakStatus: SatRunSheetRowStatus;
        if (status === "projected" || status === "upcoming") {
          breakStatus = status;
        } else if (status !== "done") {
          breakStatus = "upcoming";
        } else if (nowMs === null) {
          breakStatus = "done";
        } else if (actualBreakEndMs !== null && nowMs >= actualBreakEndMs) {
          breakStatus = "done";
        } else if (nowMs < breakStartMs) {
          breakStatus = "upcoming";
        } else if (actualBreakEndMs === null && nowMs >= breakEndMs) {
          breakStatus = "done";
        } else {
          breakStatus = "live";
        }
        rows.push({
          id: `${stage.sectionKey}:break`,
          kind: "break",
          label: `Break · ${gapMinutes} min`,
          title: null,
          remainingSeconds: rowRemainingSeconds({
            status: breakStatus,
            endMs: actualBreakEndMs ?? breakEndMs,
            nowMs,
            pausedAtMs: null,
          }),
          detail: null,
          plannedDurationMinutes: gapMinutes,
          runtimeDurationMinutes: null,
          runtimeMismatch: false,
          mismatchNote: null,
          status: breakStatus,
          plannedStartAt: toIso(breakStartMs),
          plannedEndAt: toIso(breakEndMs),
          actualStartAt: toIso(actualEndMs),
          actualEndAt: toIso(actualBreakEndMs),
        });
        cursorMs = breakEndMs;
      } else {
        cursorMs = endMs;
      }
      plannedEndMs = cursorMs;
    }
  });

  return {
    anchor,
    anchorAt: toIso(anchorAt),
    rows,
    plannedEndAt: toIso(plannedEndMs),
  };
}

export interface SatRunSheetCurrentRows {
  section: SatRunSheetRow | null;
  module: SatRunSheetRow | null;
  break: SatRunSheetRow | null;
}

/**
 * Where the room is right now, in one place: the section, the module slot and
 * the break the cohort is inside. A paused room keeps its current rows (the
 * pause froze the window it landed on), so the room's header reads the same
 * stage the table highlights instead of inventing a second answer to "which
 * module are we in?".
 */
export function satRunSheetCurrentRows(sheet: SatRunSheet): SatRunSheetCurrentRows {
  const current = (kind: SatRunSheetRowKind): SatRunSheetRow | null =>
    sheet.rows.find(
      (row) => row.kind === kind && (row.status === "live" || row.status === "paused")
    ) ?? null;
  return { section: current("section"), module: current("module"), break: current("break") };
}
