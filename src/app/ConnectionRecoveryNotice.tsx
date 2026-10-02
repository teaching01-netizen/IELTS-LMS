import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../shared/api-client/errors";
import { connectionRecovery } from "../shared/api/connectionRecovery";
import { useAuthSession } from "../features/auth/authSession";

export function ConnectionRecoveryNotice() {
  const state = useSyncExternalStore(connectionRecovery.subscribe, connectionRecovery.getSnapshot);
  const client = useQueryClient();
  const { refresh } = useAuthSession();
  if (state === "connected") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-slate-100 px-4 py-2 text-sm text-slate-800 shadow-sm"
    >
      <span>
        {state === "connecting" ? "Connecting…" : "Connection unavailable. Please try again."}
      </span>
      {state === "unavailable" && (
        <button
          type="button"
          className="rounded px-2 py-1 font-medium underline focus-visible:outline focus-visible:outline-2"
          onClick={() => {
            // Refresh reads only. Mutation and answer replay retain their own owners.
            void refresh();
            void client.refetchQueries({
              type: "active",
              predicate: (query) =>
                query.state.error instanceof ApiError && query.state.error.requestMethod === "GET",
            });
          }}
        >
          Retry connection
        </button>
      )}
    </div>
  );
}
