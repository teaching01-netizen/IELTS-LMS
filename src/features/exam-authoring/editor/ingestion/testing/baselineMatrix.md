# Phase 00 Baseline Matrix — current composer behavior (observed, not ideal)

> Ground truth for all later SAT-ingestion phases. Every row was observed by driving the REAL
> composer extension stack in jsdom (see Harness below) plus code-reads of the inspection set.
> Nothing in this file describes desired behavior — warts are recorded, not fixed.
> Zero production files were modified to produce it (`git status` shows only `ingestion/testing/` additions).

## Probe harness (applies to every row unless noted)

- **Stack under test** (exact copy of `RichQuestionComposer.tsx:28-40` `baseExtensions`):
  `RichContentIdentity` + `StarterKit.configure({ blockquote: false, heading: { levels: [2, 3] } })` +
  `EditableInlineMath` / `EditableBlockMath` + `TableKit.configure({ table: { resizable: true, lastColumnResizable: false } })` +
  `Subscript` + `Superscript` + `SatImage.configure({ inline: false, allowBase64: false })`.
- **Paste driver**: ProseMirror `EditorView.pasteText` / `pasteHTML` (the same `doPaste` path a real
  browser paste takes through `parseFromClipboard` + `replaceSelection`; `ClipboardEvent` stubbed —
  jsdom has no clipboard). No composer-level `handlePaste`/`handleDrop` exists anywhere in
  `src/features/exam-authoring` (verified by grep): paste/drop falls through to ProseMirror defaults.
  TipTap core `Paste`/`Drop` extensions only re-emit events (`node_modules/@tiptap/core`); they transform nothing.
- **Doc JSON** in fixtures is id-normalized (`content-*` → `content-<stable>`; helper
  `normalizeBaselineDoc` in `baselinePaste.behavior.test.ts`).
- **Browser fidelity limits (jsdom-only, marked UNKNOWN where applicable)**: real ClipboardItem flavor
  availability (Chrome vs Safari HTML flavor, image-file-vs-reference), DataTransfer file drops,
  MathLive lazy-load failure offline, and IME/composition paste were NOT exercised — recorded from code-reads.

## Behavior matrix B1–B12

| # | Probe | Input | Target field | Observed (fill in) | Validator outcome |
|---|---|---|---|---|---|
| B1 | Type plain text | `Solve for x typed` typed | prompt | Single paragraph, text verbatim; block gets `content-*` id via `RichContentIdentity` backfill (`RichContentIdentityExtension.ts:11-30`). Typing and plain-text paste share one insertion path — no paste-specific transform exists. | valid (prompt has content; a whole question additionally needs section/domain/skill + 4 choices + key — `satProvider.ts:178-278`) |
| B2 | Paste plain text | `text/plain` clipboard | prompt | Identical to B1: one paragraph, verbatim text. `doPaste` dispatches ONE transaction with `meta paste:true` (`prosemirror-view doPaste`); selection (collapsed or range) is replaced via `replaceSelection`. | valid (same as B1 — marks/capabilities not involved) |
| B3 | Paste rich HTML (marks) | Docs/Word-style inline HTML | prompt vs choice | **Survives**: bold, italic, underline, strike, code, superscript, subscript marks all preserved (`StarterKit` defaults + `Subscript`/`Superscript` extensions). Anchor tags survive as `link` marks with `href/target:_blank/rel:noopener noreferrer nofollow` — no SAT link policy exists. **Headings clamped**: h1→paragraph, h2/h3 kept, h4→paragraph (schema has no h1/h4 node). **Blockquote DISABLED** (`blockquote:false`, `RichQuestionComposer.tsx:30-33`): `<blockquote>` unwraps to a plain paragraph — quote semantics silently lost at the paste layer. `pre/code`→`codeBlock`; `hr`→`horizontalRule`; **nested lists preserved verbatim**. Vendor cruft (Docs inline `font-size/font-family`, Word `MsoNormal`/`o:p`, `<meta>`) collapses away; `<script>` content and `onclick` attrs dropped by the DOM parser (parser-level, NOT a sanitizer policy — no ingestion sanitizer exists yet). | valid (marks/blocks invisible to SAT validators; choice-targeted paste is UNFILTERED — see B10) |
| B4 | Paste table | 3×3 HTML table w/ header row | stimulus | `th`→`tableHeader` preserved; every cell keeps its paragraph wrapper with `content-*` id backfill; trailing empty paragraph appended by `replaceSelection` wiring. **No caps exist today**: no row/col/cell limit, no header inference, no oversize split — the 250×50×5000 cap is a phase-05 requirement, not current behavior. | valid (any table node counts as content — `richContent.ts:103-111`; tables invisible to SAT validators) |
| B5 | Paste equation (LaTeX/MathML/OMML) | per source | prompt | **Only TipTap's own math markup survives**: `<span data-type="inline-math" data-latex="…">` → `inlineMath`, `<div data-type="block-math">` → `blockMath` (math extensions `parseHTML` only their own `data-type` tags). **LaTeX delimiters NOT detected**: `\\(x^2\\)`, `$$…$$` paste as literal text (phase-03 must add detection). **MathML VANISHES**: `<math>/<mi>` has no parser — content lost silently (phase-03 rescue case). Office OMML-ish HTML likewise unparsed. | valid but semantically wrong (equation became text / vanished); validators never inspect latex |
| B6 | Paste image (file + HTML img) | png + `img src=data:` | stimulus | **data: src SILENTLY DROPPED** at parse: Image `parseHTML` is `img[src]:not([src^="data:"])` with `allowBase64:false` — node absent, surrounding text kept, author NOT prompted to upload. A lone dropped image leaves an empty paragraph. **https src kept** as image node (`assetId:null`); `isDirectSource` renders it directly (`SatImageExtension.tsx:11-13`). **blob: src NOT filtered** (rule only excludes `data:`) → image node IS created with unresolvable src → permanent missing-visual placeholder + object-URL lifetime leaks into the draft if saved. Programmatic `insertContent` with `data:` src bypasses the parse rule (dialog path uses `assetSource()` + upload instead). Only supported insertion path today: `ImageDialog` file input → `uploadAssessmentAsset` (question ownerKind) with required alt (commit disabled until assetId+alt — `RichQuestionComposer.tsx:711`). | data: drop → NO image issue raised (no node exists) — loss invisible to validation; empty prompt → `question.prompt.required` (blocking). https w/o alt → `sat.accessibility.alt.required` (blocking). blob: w/o alt → alt blocking; blob persistence violates the future no-blob invariant (phase-06). |
| B7 | Drop image file | png 1 MB / 11 MB | stimulus | **No drop handler exists** — dropped files hit ProseMirror default drop handling, NOT an upload. File→question path is exclusively `ImageDialog` → `uploadImageAsset` (`assessmentMediaApi.ts:25-55`): type gate (`image/*` else `Only image files can be inserted here.`), 10 MB gate (11 MB rejected before any network), SHA-256-via-`crypto.subtle` required (else `Secure browser cryptography…`), then intent (`ownerKind: assessment_question`) → PUT bytes → complete. `uploadAssessmentImportAsset` (`assessment_import` ownerKind — the future ingestion staging path) **exists but is not wired anywhere**. Dialog preview uses `URL.createObjectURL` + revoke-on-unmount; persisted node uses `assetSource(assetId)` or https URL, never the object URL. | size-gate/type-gate messages surface in dialog alert w/ Retry; staged node w/o alt → `sat.accessibility.alt.required` (blocking) |
| B8 | Undo after paste | Ctrl+Z once | any | **Paste = 1 undo step** (observed: multi-node `pasteHTML` reverts in ONE `undo()`; `replaceSelection` is a single transaction and the `RichContentIdentity` id-backfill folds into the same history entry in observed runs). Pre-paste text restored exactly. Cursor lands after inserted content (ProseMirror default; no composer override). Phase-07 single-undo requirement is ALREADY met for single paste events — phase-08 multi-field fill must preserve it at the revision level. | — |
| B9 | Autosave after paste | paste then navigate | question | Paste → `onUpdate` → `structuredContentFromDocument` (always v2 + identities, `RichQuestionComposer.tsx:127-129`) → `onChange` → `AuthoringWorkspace handleChange` → `scheduleAutosave` (debounce **800 ms** default, `useQuestionAutosave.ts:72-73`). Statuses: `saved/unsaved/saving/error/offline/conflict` (+ `isOffline`, `hasPendingChanges`). Offline: edits stay local (durable draft), status `offline`, save NOT called; `online` event reschedules newest draft. Conflict: 409/412/CONFLICT/VERSION_COLLISION/CONTROL_EPOCH_STALE or stale/revision message → `conflict`; local wording stays durable, never auto-retried/dropped. `flushNow`/`commitAndAdvance` flush latest (`{ok,isLatest}`); navigation guarded by `flushBeforeNavigation` + `beforeunload` warn (`AuthoringWorkspace.tsx:374-400`); external-value resync skipped while focused (`RichQuestionComposer.tsx:132-138`). | — (autosave content-agnostic; SAT validation stays the release gate) |
| B10 | Choice-capability probe | paste H2 + list into choice A | choice | **UNFILTERED (confirmed — the critical gap)**: heading + bulletList (+ codeBlock/horizontalRule) LAND in choice content. Capabilities (`SAT_CHOICE…: blockStyles:false, lists:false`, `RichQuestionComposer.tsx:69-78`) gate ONLY the toolbar (style select, list items, divider hidden — `ComposerToolbar.tsx:34-45`); schema/parse path is IDENTICAL for prompt and choice composers (same `baseExtensions`). Choice composers render via `AnswerKeyField.tsx:115-134` → `FastQuestionComposer` (pure pass-through, `FastQuestionComposer.tsx:15-36`) with `SAT_CHOICE_COMPOSER_CAPABILITIES`. **Phase-07 MUST add per-capability filtering on the paste/drop applicator. Record-only here — NO fix.** | — (validators ignore block styles; choices with headings are “valid” today) |
| B11 | Invalid-latex probe | broken latex node via dialog | prompt | **Cannot occur via dialog UI**: `MathDialog` previews with `katex.renderToString({throwOnError:true, strict:false})` and the commit button is DISABLED until preview HTML exists (`RichQuestionComposer.tsx:220-240`). **Runtime is total-fallback**: `EditableMathExtension renderEquation` uses `throwOnError:false` + try/catch returning raw latex (`:10,19-25`); a broken-latex node mounts stably, editor never throws. MathLive load failure → `logger.error` + exit edit mode, doc untouched (`:153-159`); visual-edit exit/commit restores focus via `Selection.near` (`:50-88`). | — (validators never inspect latex; phase-03 must add `import.latex.invalid` + fenced-code fallback) |
| B12 | Cursor/selection probe | paste over range selection | prompt | **REPLACEMENT, not insert**: range `[7,12)` over `Hello world` + `pasteText("there")` → `Hello there` (ProseMirror `replaceSelection`; collapsed caret inserts at caret). No composer-level selection policy; toolbar context resolution is node-kind-authoritative (`composerContext.ts:7-15`: image/inlineMath/blockMath NodeSelection → table ancestor → text) and unaffected by paste. | valid |

## Requirement inputs for later phases (explicit)

- **Phase-06 (image)**: close B6b (data: silent drop → staged-upload offer), B6c (blob: node must never persist — stage-upload or refuse), wire `uploadAssessmentImportAsset` (`assessmentMediaApi.ts:78-83`).
- **Phase-07 (plugin)**: enforce B10 (capability filtering on paste/drop applicator), keep B8 (single undo) for single-field inserts, add preview-before-commit + cursor/focus + screen-reader announcement (none exist today).
- **Phase-03 (math)**: add B5b delimiter/MML/OMML detection + `import.latex.invalid` fallback (B11 documents the KaTeX gate split).
- **Phase-05 (spreadsheet)**: add table caps (B4 documents absence), header inference, oversize split-or-warn.

## Capability & field wiring (read-only refs)

- Prompt/stimulus/rationale: default `SAT_RICH_COMPOSER_CAPABILITIES` (all true) — `SpineQuestionView.tsx:142,145,151`.
- Choices A–D: `SAT_CHOICE_COMPOSER_CAPABILITIES` via `AnswerKeyField.tsx:115-134` (toolbar-only effect — see B10).
- Toolbar rows: text/table/equation/image — `ComposerToolbar.tsx:16-47`; table actions honor `can().mergeCells/splitCell` (`:18-27`); equation inline↔block convert preserves latex (`:29`); image row edits metadata instead of inserting (`:31-32`).
- SPR math-only + RW single-choice gates: `satProvider.ts:280-287,318-325`; SPR char/length/format/fraction rules: `studentResponse.ts:1-90`.

## Vendor-source coverage (fixtures)

| Source | Fixture(s) | Expected post-paste doc + validator outcome |
|---|---|---|
| Google Docs (styled inline HTML) | `b03-rich-html.*`, `b03e-vendor-cruft.*` | marks kept, font cruft collapsed; valid |
| Word (MsoNormal/o:p) | `b03e-vendor-cruft.*` | cruft collapsed to plain/bold; valid |
| Sheets/Excel (HTML table) | `b04-table.*` | header+body preserved, no caps; valid |
| PDF viewers (latex delimiters, MathML, line text) | `b05-math-nodes.*`, `b05-latex-delimiters.*` | native math markup only; delimiters literal, MathML lost; “valid” but lossy |
| Chrome/Safari image copy | `b06-image-https.*`, `b06-image-data.*`, `b06-image-blob.*` | https kept; data: dropped; blob: broken node (Safari-flavor risk) |
| Typed / plain-text (any) | `b01-plain-text.*`, `b02-paste-plain.*`, `b12-selection-replace.*` | verbatim; valid |
| Multi-node / undo / lifecycle | `b08-undo.*`, `b07-drop-gates.*`, `b09-autosave-lifecycle.*`, `b10-choice-filter.*`, `b11-invalid-latex-node.*` | 1-step undo; upload gates; autosave matrix; UNFILTERED choice proof; latex gate split |

## Files

- Matrix: `src/features/exam-authoring/editor/ingestion/testing/baselineMatrix.md` (this file)
- Fixtures: `src/features/exam-authoring/editor/ingestion/testing/fixtures/baseline/*` (.json + .html/.txt paste inputs + expected normalized doc JSON + validator outcome)
- Tests: `baselinePaste.behavior.test.ts` (B1–B12 through the real composer) + `baselineContracts.test.ts` (capability snapshots, round-trips, identity, SPR/validator pins)
