# Phase 06 — editor

Progressive toolbar using existing Radix-backed SatMenu; context replaces toolbar for tables/equations/images. Equation placement converts schema node type. Image edits target captured selection position and retain attributes/identity rather than inserting a second image. Quiet editor surfaces, readable 16px content, 44px toolbar and reorder controls. Compact choice capability flags retained.

Editor/serialization/option tests and scoped lint pass (`evidence/phase-06-tests.txt`). Corrected duplicate Tiptap core type identity by importing Extension through React peer re-export. Actual tsc completes: zero authoring diagnostics, but 13 diagnostics in concurrently changed student-delivery/SAT-session files outside this task (`evidence/phase-06-types.txt`); not modified. Final build/full suite remains an integration gate.
