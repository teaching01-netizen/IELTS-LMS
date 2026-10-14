# SAT Global Score Conversion Settings — Production Implementation Plan

Recommended architecture

Repository: [teaching01-netizen/IELTS-LMS](https://github.com/teaching01-netizen/IELTS-LMS)

The goal is to build a complete, editable Score Conversion Settings page inside the Digital SAT staff workspace, where authorized users can import, edit, manage, and publish conversion tables for SAT Math and SAT Reading & Writing independently.

Most importantly, the active conversion tables must apply to all SAT exams, including results from exams completed in the past.

This is not just an import feature. It should function as a production-grade scoring management system with a spreadsheet-like editing experience.

## 1. What I found in the current repository

The existing architecture already has useful foundations, but three important changes are required.

| Existing implementation                                                                 | Required change                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `satconvert/convert.go` supports versioned, one-dimensional raw-score conversion tables | Extend the engine to support two-dimensional Module 1 × Module 2 matrices                             |
| Scoring policies are linked to published exam versions                                  | Introduce an independent, globally active SAT conversion policy                                       |
| Converted scores are stored in result snapshots                                         | Make current displayed scores resolve against the active global policy, including historical attempts |

Relevant source files:

- [SAT conversion engine](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/satconvert/convert.go)
- [SAT result calculation and persistence](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/backend/go/internal/terminalization/service.go)
- [Digital SAT staff workspace](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/SatRoot.tsx)
- [SAT result detail page](https://github.com/teaching01-netizen/IELTS-LMS/blob/main/src/products/sat/routes/SatResultDetailRoute.tsx)

The database currently stores module-level `raw_correct` values, which provides a foundation for recalculating older results without changing students' submitted answers.

## 2. Recommended UX/UI design

Add a new destination to the existing SAT sidebar:

SAT

Digital SAT

Exams

Rooms

Responses

Score Conversion

Score Conversion

Global SAT Settings

Active version

v1

Reading & Writing

Math

Manage conversion matrices and historical scores.

Conceptual navigation preview. The implementation should reuse the repository's existing SAT design tokens, components and responsive layout.

### Main settings page

## Score Conversion

Global SAT scoring configuration

&#x20;Active

Active version

Version 1.0

Scope

All SAT Exams

Reading & WritingMath

Verbal Conversion Table

28 × 28 · 784 score cells

&#x20;Mockup

Edit TablePaste ImportPreview

Editable grid · Select a cell and enter a score.

| M1 ↓ M2 → | 0   | 1   | 2   | 3   | 4   | 5   |
| --------- | --- | --- | --- | --- | --- | --- |
| 0         | 200 | 200 | 200 | 200 | 250 | 250 |
| 1         | 200 | 200 | 200 | 200 | 250 | 250 |
| 2         | 200 | 200 | 200 | 200 | 250 | 250 |
| 3         | 200 | 200 | 200 | 250 | 250 | 250 |
| 4         | 200 | 200 | 200 | 250 | 250 | 250 |

Preview of the top-left cells only. Production grid includes all rows and columns and direct cell editing.

&#x20;Version history available

Save draft → Publish

This is a conceptual layout preview, not a connected implementation. The live editor should have a full-width grid, search, undo/redo, bulk paste, and a persistent actions toolbar.

## 3. Editing and importing requirements

The core interaction should behave like a lightweight spreadsheet.

| Feature             | Expected behavior                                    |
| ------------------- | ---------------------------------------------------- |
| Edit cell           | Click or double-click to modify a score              |
| Keyboard navigation | Arrow keys, Tab, Enter, Escape                       |
| Multi-cell paste    | Paste a rectangular selection directly into the grid |
| Full table import   | Paste all rows from Google Sheets                    |
| Undo / Redo         | Restore recent local editing actions                 |
| Copy selection      | Copy back into Google Sheets                         |
| Highlight changes   | Distinguish modified cells from the active version   |
| Save Draft          | Persist changes without affecting student scores     |
| Discard changes     | Restore last saved draft or active version           |
| Version history     | See past configurations and restore as a new draft   |
| Export table        | TSV, CSV, or JSON                                    |
| Publish             | Activate after validation and impact preview         |

Import behavior: The exact TSV format supplied should be accepted. The parser must handle the blank top-left cell, row and column headers, tabs, CRLF/newlines, trailing blank lines, and pastes without headers.

Validation should reject incomplete matrices, duplicate headers, non-numeric cells and scores outside 200–800 or not divisible by 10.

However, do not automatically reject non-monotonic score tables. The supplied matrix has some score decreases between adjacent cells, so these should produce review warnings rather than automatic modifications.

## 4. Scoring model — separate Verbal and Math

The matrix should use two coordinates:

\\[ \text{Converted Score}=T[\text{M1 Correct}][\text{M2 Correct}] \\]

For example, in your supplied table:

M1 correct

# 27

M2 correct

# 27

Converted

# 800

The repository's current SAT exam blueprint has different operational question counts:

| Subject           | M1 | M2 | Matrix  |
| ----------------- | -- | -- | ------- |
| Reading & Writing | 27 | 27 | 28 × 28 |
| Math              | 22 | 22 | 23 × 23 |

Therefore the 28 × 28 table provided is dimensionally appropriate for Verbal. Math should have its own separately configurable 23 × 23 table for the default blueprint.

The system should also consider adaptive routes:

- Full Lower: Module 1 + Lower Module 2
- Full Higher: Module 1 + Higher Module 2
- Standalone Lower Module 2
- Standalone Higher Module 2

I recommend an easy default editor with one grid per subject and an expandable Advanced Routing section for assigning separate Lower/Higher matrices when needed. A shared matrix may be used for both routes only when that assignment is explicit.

Standalone Module 2 needs its own one-dimensional conversion configuration; it must not borrow a full two-module matrix.

For historical/custom exams with other operational question counts, the policy can support additional dimension-specific profiles instead of assuming every exam uses the standard counts.

## 5. Historical recalculation — critical architecture

I recommend immutable policy revisions with an atomically activated global version and precomputed score projections.

Global SAT Settings

Math and Verbal conversion revisions

Verbal Matrix

M1 × M2

Math Matrix

M1 × M2

Shared SAT Scoring Engine

Calculate from persisted module raw scores

Historical Results

Recalculate existing scores

Future Results

Use the active version

### How Publish works

1. User edits and saves a draft without affecting live results.
2. Server validates every table, mapping and operational count.
3. Server calculates the impact on existing SAT results and displays an old-versus-new score comparison.
4. Server prepares recalculated historical score projections in batches. The active version remains unchanged during preparation.
5. Once ready, a database transaction changes the global active-version pointer. New results use the same version. Any concurrently completed attempts are calculated on demand or caught up safely.
6. All score-reading endpoints resolve the active version, so staff pages and permitted student score reports show consistent updated scores.

The previous result snapshots remain immutable for audit purposes. We should never overwrite original student answers, module raw scores, or terminalization records just to change a conversion table.

The existing exam-level score report visibility switch must still be respected; global scoring settings must not unintentionally reveal withheld results.

## 6. Backend and database design

Suggested new tables:

| Table                              | Responsibility                                            |
| ---------------------------------- | --------------------------------------------------------- |
| `sat_score_conversion_revisions`   | Immutable published policies plus editable draft metadata |
| `sat_score_conversion_active`      | One globally active SAT revision pointer                  |
| `sat_score_conversion_projections` | Recalculated scores per attempt and revision              |
| `sat_score_conversion_audit`       | Who edited, validated, published or restored a policy     |

A conversion revision should include each subject, route/topology, module dimensions, all score cells, metadata, checksum, author, and timestamps.

For an existing one-dimensional policy, the migration can expand scores into a matrix using the combined raw total only where that transformation is mathematically equivalent and the correct topology is known. Do not fabricate defaults for missing or conflicting legacy policies.

The initial default should be populated from the actual currently approved conversion configuration. That source must be verified during migration because the repository permits different policies on different exam versions.

### Proposed API

| Method | Endpoint                                | Purpose                              |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/v1/sat/scoring/settings`              | Active configuration and summary     |
| GET    | `/v1/sat/scoring/revisions`             | Version history                      |
| POST   | `/v1/sat/scoring/drafts`                | Create editable draft                |
| PUT    | `/v1/sat/scoring/drafts/:id`            | Save draft with concurrency checking |
| POST   | `/v1/sat/scoring/validate`              | Validate pasted/edited tables        |
| POST   | `/v1/sat/scoring/preview`               | Test a score lookup                  |
| POST   | `/v1/sat/scoring/impact`                | Historical impact report             |
| POST   | `/v1/sat/scoring/revisions/:id/publish` | Prepare and activate                 |
| GET    | `/v1/sat/scoring/jobs/:id`              | Publish/recalculation status         |

Server-side RBAC should limit global publish and restore operations to authorized administrators. Optimistic concurrency control (`If-Match` or equivalent), idempotent publish requests, an audit log and rollback to a prior version are required.

## 7. Production implementation phases

01

Scoring model and database

Introduce global versioned policies, immutable revisions, 2D grid scoring, route-aware resolution and existing-policy migration.

02

Editable SAT Settings UI

Add sidebar route, Math/Verbal tabs, spreadsheet editor, paste importer, keyboard support, draft management and accessible validation.

03

Preview and Publish workflow

Implement score lookup preview, diff visualization, historical impact report, permissions, publish confirmation and audit trail.

04

Historical score integration

Build projection recalculation, global activation, cache invalidation and consistent score reads across staff and student surfaces.

05

Testing and staged rollout

Run unit, integration, migration and E2E tests; verify score parity, legacy results, performance, concurrent publishing and rollback.

The main files to modify or extend will include `SatRoot.tsx`, `createRouter.tsx`, `route-manifest.ts`, `satconvert/convert.go`, `terminalization/service.go`, `results/service.go`, the SAT result pages, OpenAPI contract, and a new database migration.

New UI components should live inside the SAT product/features structure, not as a second independent settings application.

## 8. Acceptance criteria before production release

| Test                              | Expected result                                                   |
| --------------------------------- | ----------------------------------------------------------------- |
| Paste the supplied Verbal table   | All 784 score cells import correctly                              |
| Edit one score cell               | Draft changes; live scores do not                                 |
| Paste a partial range             | Only selected draft cells are replaced                            |
| Invalid table data                | Specific cell errors; Publish blocked                             |
| Publish new Verbal table          | Math table remains unchanged                                      |
| Publish new Math table            | Verbal table remains unchanged                                    |
| Previously completed SAT attempt  | Shows recalculated score after activation                         |
| Newly completed SAT attempt       | Uses same active scoring version                                  |
| Score update during active exam   | Does not alter routing, timing, answers or raw grading            |
| Incomplete or unsupported attempt | Conversion unavailable, never an invented score                   |
| Concurrent administrators         | No silent overwriting of published versions                       |
| Restore earlier version           | Current scores return to that conversion through a new activation |
| Large historical dataset          | Bounded, resumable recalculation; no long database lock           |
| Permissions and release gate      | Unauthorized users cannot publish or see withheld scores          |

## Final implementation decisions

I recommend these defaults:

- One global SAT conversion system, not per-exam settings.
- Two independently editable subjects: Reading & Writing and Math.
- Spreadsheet-first UX supporting both direct editing and Google Sheets paste.
- Existing approved conversion as initial default, verified against actual production policies.
- Draft → Validate → Preview Impact → Publish, with no immediate live updates from cell edits.
- Historical and future scores use the active version, while original result evidence is retained.
- Advanced route-specific and standalone-module support to avoid incorrect adaptive scoring.
- Estimated SAT scoring labels remain distinct from official College Board scores.

The most important technical decision is to implement the global scoring engine and historical result projection before connecting Publish to the UI. Otherwise the settings page could appear to work while previously released scores continue using old per-exam snapshots.

Status: This is the implementation plan based on the current repository. No production code or database changes have been made yet.