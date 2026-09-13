import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthoringConnectionState } from "./contracts";
import {
  PRESENCE_SWEEP_MS,
  PRESENCE_THROTTLE_MS,
  editorsOf,
  excludeSelf,
  expirePresence,
  filterDraft,
  mergePresence,
  shouldSend,
} from "./presenceChannel";
import {
  buildPresenceFrame,
  derivePresenceState,
  parsePresenceBroadcast,
  type AuthoringPresence,
  type PresenceIntent,
} from "./presenceTypes";
import { PRESENCE_IDLE_MS } from "./presenceChannel";

export interface UseAuthoringPresenceOptions {
  draftVersionId: string | null;
  selectedExamQuestionId: string | null;
  /** Autosave-defined dirty flag. Editing presence derives from this, never keystrokes. */
  isDirty: boolean;
  /** Effective presence capability: server grant ANDed with the local kill switch. */
  enabled: boolean;
  connectionState: AuthoringConnectionState;
  sendFrame(frame: unknown): boolean;
  /** Learned from the handshake ack; used to hide yourself without hiding your other tabs. */
  selfConnectionId: string | null;
  /** Injectable clock (tests). */
  now?: (() => number) | undefined;
}

export interface UseAuthoringPresenceResult {
  /** Whole exam, current draft, unexpired, self excluded. */
  occupants: AuthoringPresence[];
  /** Occupants editing the OPEN question, for the subtle header label. */
  editorsHere: AuthoringPresence[];
  /** Feed raw inbound presence frames here (wired from the realtime hook). */
  handlePresenceFrame(raw: unknown): void;
  /** Last state actually published, for tests and debugging. */
  lastPublishedState: PresenceIntent["state"];
}

/**
 * Presence send/receive. Small on purpose: it owns cadence and the TTL window,
 * and every decision it makes delegates to the pure helpers in presenceChannel.
 *
 * Three invariants worth stating because breaking any of them is invisible in
 * review:
 *   1. Nothing here ever touches the draft, React Query, or focus. Presence is
 *      written to the local map and nowhere else.
 *   2. Frames carry ids + state, never content (enforced by the frame builder).
 *   3. Sending stops entirely while disconnected or disabled; a queued intent
 *      is simply re-attempted on the next tick.
 */
export function useAuthoringPresence(
  options: UseAuthoringPresenceOptions,
): UseAuthoringPresenceResult {
  const [entries, setEntries] = useState<AuthoringPresence[]>([]);
  const [lastPublishedState, setLastPublishedState] = useState<PresenceIntent["state"]>("viewing");

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const now = useCallback((): number => optionsRef.current.now?.() ?? Date.now(), []);

  const lastSentRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(0);
  const intentRef = useRef<PresenceIntent>({ selectedQuestionId: null, state: "viewing" });

  // Activity is selection + save activity only: opening a question or a dirty
  // transition. Typing is deliberately NOT activity, because idle must not be
  // reset by every keystroke.
  const { selectedExamQuestionId, isDirty } = options;
  useEffect(() => {
    lastActivityRef.current = now();
  }, [selectedExamQuestionId, isDirty, now]);

  const currentIntent = useCallback((): PresenceIntent => {
    const current = optionsRef.current;
    const at = now();
    return {
      selectedQuestionId: current.selectedExamQuestionId,
      state: derivePresenceState({
        selectedQuestionId: current.selectedExamQuestionId,
        isDirty: current.isDirty,
        lastActivityAt: lastActivityRef.current,
        now: at,
        idleAfterMs: PRESENCE_IDLE_MS,
      }),
    };
  }, [now]);

  const publish = useCallback(
    (force: boolean) => {
      const current = optionsRef.current;
      if (!current.enabled || !current.draftVersionId) return;
      if (current.connectionState !== "live") return;
      const at = now();
      if (!force && !shouldSend(at, lastSentRef.current)) return;
      const intent = currentIntent();
      intentRef.current = intent;
      if (current.sendFrame(buildPresenceFrame(intent))) {
        lastSentRef.current = at;
        setLastPublishedState(intent.state);
      }
    },
    [currentIntent, now],
  );

  // A change after a quiet window goes out immediately; a change inside the
  // window waits for the tick, which is what "coalesce into the next slot" means.
  useEffect(() => {
    publish(false);
  }, [publish, selectedExamQuestionId, isDirty, options.connectionState, options.enabled]);

  // Heartbeat + keepalive: the tick is what keeps peers' TTL fresh, so it runs
  // even when nothing changed.
  useEffect(() => {
    if (!options.enabled) return undefined;
    const timer = window.setInterval(() => publish(false), PRESENCE_THROTTLE_MS);
    return () => window.clearInterval(timer);
  }, [publish, options.enabled]);

  // Receive-side TTL sweep. Expiry is the ONLY removal path, so a clean close
  // and an unclean disconnect cannot disagree.
  useEffect(() => {
    if (!options.enabled) return undefined;
    const timer = window.setInterval(() => {
      const at = now();
      setEntries((previous) => {
        const live = expirePresence(previous, at);
        return live.length === previous.length ? previous : live;
      });
    }, PRESENCE_SWEEP_MS);
    return () => window.clearInterval(timer);
  }, [now, options.enabled]);

  const handlePresenceFrame = useCallback((raw: unknown) => {
    const parsed = parsePresenceBroadcast(raw);
    if (!parsed) return;
    setEntries((previous) => {
      // Stale-draft frames are dropped: presence from a retired working draft
      // describes a document nobody is looking at any more.
      const current = optionsRef.current.draftVersionId;
      if (!current || parsed.draftVersionId !== current) return previous;
      return mergePresence(previous, parsed);
    });
  }, []);

  // Disabling presence must make other authors vanish immediately rather than
  // lingering until their TTL expires.
  useEffect(() => {
    if (!options.enabled) {
      setEntries((previous) => (previous.length === 0 ? previous : []));
    }
  }, [options.enabled]);

  const { selfConnectionId, draftVersionId } = options;
  const occupants = useMemo(() => {
    const scoped = filterDraft(entries, draftVersionId);
    return excludeSelf(scoped, selfConnectionId);
  }, [entries, draftVersionId, selfConnectionId]);

  const editorsHere = useMemo(
    () => editorsOf(occupants, selectedExamQuestionId),
    [occupants, selectedExamQuestionId],
  );

  return { occupants, editorsHere, handlePresenceFrame, lastPublishedState };
}
