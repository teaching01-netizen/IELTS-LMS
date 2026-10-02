type ConnectionState = "connected" | "connecting" | "unavailable";
const recovering = new Set<string>();
const failures = new Set<string>();
const listeners = new Set<() => void>();
let state: ConnectionState = "connected";

function publish() {
  const next = recovering.size > 0 ? "connecting" : failures.size > 0 ? "unavailable" : "connected";
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export const connectionRecovery = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  begin(id: string, endpoint: string) {
    failures.delete(endpoint);
    recovering.add(id);
    publish();
  },
  finish(id: string, endpoint: string, failed: boolean) {
    recovering.delete(id);
    if (failed) failures.add(endpoint);
    else failures.clear();
    publish();
  },
};
