# iPad-First Student Highlight Tool Implementation Plan

1. Characterize provider state, header accessibility, completion-event deduplication, automatic apply/erase, tool-off behavior, persistence, and surface isolation with focused tests.
2. Evolve `StudentUIProvider` to explicit tool modes while preserving the last palette color.
3. Add the persistent Reading/Listening header split control and lifecycle resets.
4. Replace floating-toolbar selection state with completion-driven surface commands; remove toolbar coordinates and sticky selection behavior.
5. Run focused Vitest, lint, typecheck, and iPad/WebKit checks; record repository-wide baseline blockers separately.
6. Update UX invariants and failure-case memory.
