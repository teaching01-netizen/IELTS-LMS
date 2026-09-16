# Frontend architecture guards

These tests are executable acceptance criteria for the migration roadmap. They scan all
production TypeScript source under `src/` and ignore test, Storybook, and architecture-test
files so test doubles do not become production dependency edges.

`architecture-baseline.json` records the violations that existed when the repository-wide
guards were introduced. A change may remove baseline entries, but it may not add a violation
that is absent from the baseline. The baseline is now empty: production code has no known
feature-isolation, layer-dependency, browser-boundary, domain-purity, legacy-service, or
coedit-transport edges.

When a migration removes a legacy edge, delete its exact entry from the baseline in the same
change. When a new edge is required temporarily, document the owning adapter and add the exact
edge deliberately; do not broaden the baseline with a wildcard. Cross-feature imports are
allowed only to another feature's public `api` or `routes` entry points; feature internals remain
isolated.

Current compatibility seams are intentionally explicit:

- `app/data` compatibility modules re-export feature-owned query APIs, while shared transport,
  query-client, validation, hooks, error types, and observability implementations live under
  `shared`.
- Legacy service access is limited to approved feature infrastructure gateways; production
  consumers use feature public APIs or gateway-owned compatibility exports.
- `shared/ui` owns migrated generic primitives while `components/ui` keeps compatibility exports
  for existing consumers.
- Router composition lives under `app/router`, and capability route ownership lives under
  `features/*/routes` with thin compatibility exports for legacy paths.
- Student route-data parsing, candidate persistence, and published-content diagnostics live in
  separate hook support modules; the route hook remains the orchestration boundary.
- The collaborative transport (`yjs`, `y-prosemirror`, `y-indexeddb`, `y-protocols`,
  `@hocuspocus/*`, and Tiptap's collaboration extensions) is owned by
  `src/features/exam-authoring/realtime/coedit`. Every other file talks to a collaborative
  document through that package's vocabulary — for example
  `isCollaborativeTransaction(transaction)` answers "was this the collaborator's edit?" so an
  editor never reads Yjs metadata. The rule is
  `coedit-transport-boundary`; the boundary and its reasons are recorded in
  `docs/sat-authoring-coedit.md`.
