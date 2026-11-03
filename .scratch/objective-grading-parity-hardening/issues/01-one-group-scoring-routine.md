# 01: One group-scoring routine per side (prefactor)

**What to build:** A behaviour-neutral consolidation so each grader has one routine that applies grouped-slot scoring, sub-answer-tree roots, shared answer-pool consumption and the group representative mark. Today the same representative-slot loop is copied across the Go group appliers and mirrored again on the website; changing grouped scoring should require one edit per side.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The Go grader has one group-scoring routine used by required-correct groups, tree roots and shared pools; the copied representative-slot loops are gone.
- [ ] The website grader has one corresponding routine used by the same three group kinds.
- [ ] Existing grouped-table, sub-answer-tree and shared-pool tests stay green.
- [ ] The baseline and full-coverage parity reports still show zero mismatches.
- [ ] Each group kind still has a test proving its representative mark and per-slot correctness.

## Implementation note

Go group appliers now share `applyGroupRepresentative`; website scoring shares `applyGroupRepresentative`. Existing grouped/tree/pool tests and the parity harness pass.
