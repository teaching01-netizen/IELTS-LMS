import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Extensions } from "@tiptap/core";
import type { CoeditClientCapability, PromptCoeditingSession } from "./contracts";
import { resolveCoeditEnabled } from "./contracts";
import { collaborationExtensions } from "./editorBinding";
import {
  PromptCoeditProvider,
  type PromptCoeditProviderOptions,
  type PromptCoeditSnapshot,
} from "./provider";
import { CoeditUnavailableError, requestCoeditToken } from "./tokenApi";

export type PromptCoeditingStatus = "disabled" | "preparing" | "ready" | "error";

/** Composer-facing binding (structurally matches RichComposerCollaboration). */
export interface CoeditingComposerBinding {
  extensions: Extensions;
  ready: boolean;
  readOnly: boolean;
}

export interface UsePromptCoeditingResult {
  status: PromptCoeditingStatus;
  session: PromptCoeditingSession | null;
  /** Composer binding; null while disabled, preparing, or failed. */
  collaboration: CoeditingComposerBinding | null;
  error: string | null;
  /** Re-mints a token and reconnects after a failure. */
  retry: () => void;
  /**
   * Applies the durable `draft.replaced` authoring signal to the open room, so
   * the prompt export is offered even when the socket close never arrived.
   */
  reportReplaced: () => void;
}

export interface UsePromptCoeditingOptions {
  /** The exam question whose prompt is being co-edited. */
  examQuestionId: string | null;
  capability: CoeditClientCapability;
}

const NOTHING = () => {};

/**
 * Owns one provider for the selected question.
 *
 * Lifecycle rules this hook enforces:
 *
 *   - Effective enablement is the AND of the co-edit gates (see
 *     resolveCoeditEnabled). The legacy authoring event socket is independent
 *     and never controls prompt delivery.
 *   - The provider is mounted for exactly one exam question and destroyed when
 *     the question changes. StrictMode double mount is safe: the first
 *     provider is destroyed before the second is created, and creating a
 *     document is idempotent on the server.
 *   - Local work is never discarded on unmount. Teardown leaves the Y.Doc and
 *     its IndexedDB copy intact; only a committed state hash or an explicit
 *     discard removes local state.
 *   - The returned `extensions` array is stable for the lifetime of a provider.
 *     Rebuilding it on every save-state change would recreate the Tiptap editor
 *     on each keystroke acknowledgement.
 */
export function usePromptCoediting(options: UsePromptCoeditingOptions): UsePromptCoeditingResult {
  const enabled = resolveCoeditEnabled(options.capability);
  const examQuestionId = options.capability.activeEditableDraft ? options.examQuestionId : null;

  const [status, setStatus] = useState<PromptCoeditingStatus>("preparing");
  const [snapshot, setSnapshot] = useState<PromptCoeditSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [provider, setProvider] = useState<PromptCoeditProvider | null>(null);

  const cleanupRef = useRef<(() => void) | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  const reportReplaced = useCallback(() => {
    provider?.reportReplaced();
  }, [provider]);

  useEffect(() => {
    if (!enabled || !examQuestionId) {
      return;
    }
    let active = true;
    setStatus("preparing");
    setSnapshot(null);
    setError(null);

    void (async () => {
      try {
        const token = await requestCoeditToken(examQuestionId);
        if (!active) return;

        const providerOptions: PromptCoeditProviderOptions = {
          documentName: token.documentName,
          field: "prompt",
          serviceUrl: token.serviceUrl,
          token: { token: token.token, expiresAt: token.expiresAt },
          // The epoch namespaces the local recovery cache; a legacy server omits
          // it and the provider falls back to epoch zero.
          ...(token.stateEpoch === undefined ? {} : { stateEpoch: token.stateEpoch }),
          self: { actorId: token.actorId, displayName: token.displayName },
          readOnly: token.mode !== "write",
          refreshToken: async () => {
            const refreshed = await requestCoeditToken(examQuestionId);
            // Identity check: a refresh that changes the document must never be
            // applied to the already-open room.
            if (refreshed.documentName !== token.documentName) {
              throw new Error("The collaboration session was replaced.");
            }
            return { token: refreshed.token, expiresAt: refreshed.expiresAt };
          },
          onLifecycle: (issue, message) => {
            if (!active) return;
            // `none` is the provider clearing a problem it had reported (a
            // refusal that became durable). The error has to go with it, or
            // the save area keeps claiming a failure for saved work — the
            // workspace-level hook already clears on `none`.
            if (issue === "none") setError(null);
            else if (message) setError(message);
          },
        };

        const created = new PromptCoeditProvider(providerOptions);
        if (!active) {
          created.destroy();
          return;
        }
        const unsubscribe = created.subscribe((next) => {
          if (!active) return;
          setSnapshot(next);
          setStatus(next.ready ? "ready" : "preparing");
        });
        cleanupRef.current = () => {
          unsubscribe();
          created.destroy();
        };
        setProvider(created);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof CoeditUnavailableError) {
          // The server cannot offer co-editing (capability off or service not
          // admitted). This is a normal posture: fall back to the legacy
          // editor silently rather than showing a failure to the author.
          setStatus("disabled");
          return;
        }
        setError(cause instanceof Error ? cause.message : "Prompt collaboration could not start.");
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      // Teardown flushes and destroys the transport, but leaves the Y.Doc and
      // its IndexedDB copy intact for recovery.
      cleanupRef.current?.();
      cleanupRef.current = null;
      setProvider(null);
    };
  }, [attempt, enabled, examQuestionId]);

  // Stable per provider: identity only changes when a new room is opened.
  const extensions = useMemo(
    () =>
      provider
        ? collaborationExtensions({ session: provider.session, provider })
        : null,
    [provider],
  );

  const ready = snapshot?.ready ?? false;
  const readOnly = snapshot?.readOnly ?? false;

  const collaboration = useMemo<CoeditingComposerBinding | null>(
    () => (extensions ? { extensions, ready, readOnly } : null),
    [extensions, ready, readOnly],
  );

  if (!enabled || !examQuestionId || status === "disabled") {
    return {
      status: "disabled",
      session: null,
      collaboration: null,
      error: null,
      retry: NOTHING,
      reportReplaced: NOTHING,
    };
  }

  return {
    status,
    session: provider ? provider.session : null,
    collaboration,
    error,
    retry,
    reportReplaced,
  };
}
