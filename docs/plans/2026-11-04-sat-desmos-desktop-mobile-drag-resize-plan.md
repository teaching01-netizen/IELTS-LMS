# SAT Desmos Calculator — Desktop Drag/Resize Parity with Mobile/iPad (Implementation Plan)

> PLAN ONLY — no source edits. Consolidates `drag-resize-planner` (low-level design) + `drag-resize-auditor` (business-logic edge-case audit §80).
> Goal: desktop mouse drag/resize behaves like mobile/iPad touch (screenshot target: full-height Desmos with Graphing/Scientific tabs, green header, graph, expression list, keypad), with one unified gesture pipeline.
> Date: 2026-11-04. Sie: `src/features/student-delivery/ui/tools/**`, `domain/satToolSizePolicy.ts`, `infrastructure/satToolGeometryStore.ts`, `ui/tools/satToolPointer.ts`, `index.css`, tests.

## 1. Change boundary & repository evidence

**Current behavior (Verified by read):**
- `SatFloatingTool.tsx` (1152 lines): `compact = (max-width:639px)|(max-height:560px)` L278; `coarsePointer` L279. Calculator never takes the bottom-sheet branch (`compact && !isCalculator` L906) — it renders the floating tree with centered-sheet geometry (`left: centered(min(vw,520/scale))`, `top: vh*0.15`, `w: min(vw,520/scale)`, `h: vh*0.85`, L1026–1029) and `presentation = compact ? "compact-sheet" : "floating"` L972 (probe alias only).
- Drag/resize disabled in compact: `handleHeaderPointerDown` L677, `moveByKeyboard` L730, `resizeByKeyboard` L745, `startResize` L759, cancel effect L828 — all gate on `compact`. Resize targets gated `props.resizable && !compact` L1102 (SE) / L1134 (7 edges). Header split L1073–1101: compact = plain "Calculator" label, no grip, no `headerControls`; desktop = grab header + grip `role=button` + `headerControls` (mode switch).
- `SatCalculatorPanel.tsx`: `SAT_TOOL_COMPACT_QUERY` L40, `compact` L103, full-height first-open `firstOpenSize` L277–280, `edgeGutter = coarsePointer ? toLogical(20) : 0` L252, `clampArea/dragArea/safeArea` L256–271, `headerControls={compact?undefined:modeSwitch}` L321 + compact body strip L218–222, `keepAlive`, `geometryScale=scale`, `resizable` always true.
- `satToolPlacementRuntime.ts`: `readSatCalculatorSafeArea` (body+8) L67, `readSatCalculatorDragArea` (screen-wide+8) L84. `domain/satToolSizePolicy.ts`: scientific 460×560 / graphing 520×640 defaults, min 400×480, max 0.48/620 — **panel does NOT consume this** (hand-rolled firstOpen/min/max; Verified divergence). `satToolGeometryStore.ts`: 2-arg legacy clamp (viewport−32, floor 320×360) vs 3-arg safe-area clamp (folds min into span); `satToolPointer.ts`: `dragExceeded 4px`, `resizeGeometry`, `alignToSafeArea 8px` (left/top only). `index.css`: coarse outside-band 20/28px vs fine inside bands.
- Tests lock current contract: `SatFloatingCoexistence.test.tsx:148` compact undraggable by design, `:192` no edges on compact sheet, panel `:236` single selector in body on compact, Gestures scale=2 1:1 proof, `:38` prewarm identity, `:189` mode-no-resize.

**Desired (Inferred — needs product confirm):** unify the gesture pipeline: one drag/resize codepath on every presentation (gates on `disabled` only, never `compact`); single draggable header with mode switch everywhere; sheet keeps centered width but gains draggable `y` + N-edge height resize; unconditional 20px gutter + CSS outside-band on sheet. Screenshot's mobile calculator stays visually identical; desktop gains the same 1:1 tracking.

**Non-goals:** no Desmos content/embed changes; no mode-switch-resizes (INV-004); no new placement brain; no collapse for Calculator; no Reference visual change; no storage schema/API changes.

**Assumption → decision needed:** parity = unify toward draggable sheet (this plan). One-line alternative (lock desktop like compact) inverts RULE-01 — flagged in §9.

## 2. Requirements & invariants

### FR (acceptance)
- FR-01 Desktop drag 1:1: header pointerdown (not on button/radio, primary only) → 4px threshold → logical `dx/scale` rAF-batched → release persists once + `onManualMove`. ✓ existing Gestures L96–110 at scale=2; NEW: +50 physical px @200% ⇒ +25 logical.
- FR-02 Desktop resize 1:1: 8 targets → `resizeGeometry` → min/max pin → clamp → rAF; release persists once + `onManualResize`. ✓ west-overshoot pins at min.w (existing :278); NEW: 1px SE drag ⇒ ≤2px change (no-snap, cf. Ref :481).
- FR-03 Compact parity: sheet keeps visuals/probe (`compact-sheet`, centered 520/scale, 15%/85% first-open pixel-identical) but gains same drag math (y moves, x recentered) + N/NE/NW height resize; width fixed. NEW tests: `data-sat-resize-edge` present on sheet; keyboard grip moves sheet.
- FR-04 One mode selector: `radiogroup "Calculator type"` in header slot on ALL presentations; delete body-duplicated strip. Update panel `:236`.
- FR-05 Zoom bands: 20/28 physical px at any scale (`--sat-tool-unit:1/scale`); unconditional gutter.

### RULE / ERR
- RULE-01 Gates on `!interactive` (+`resizable` for resize) only; never `compact`. Compact no longer cancels gestures (L828 → `!open||disabled` only).
- RULE-02 Presentation stays viewport-derived (probes/e2e unchanged); behavior identical. Collapse stays Reference-only.
- RULE-03 Every commit through `persist = clamp(candidate)`; keep 8px snap, extend to sheet (one ternary to disable — review point).
- RULE-04 Mode switch never resizes. ERR: corrupt geometry → defaults (existing normalize); non-primary/button/radio/resize-without-flag/disabled-keyboard → ignore; Esc/blur/hide/close/disable/unmount mid-gesture → restore origin, never persist (existing matrix + compact variant); viewport < minimum → clamp folds min into span.

### INV (owners §3)
- INV-001 Geometry identity: single `{x,y,w,h}` logical owner (`lastCommittedRef`); storage physical. Owner: SatFloatingTool. — PROTECTED
- INV-002 Math-only/keepAlive: gestures never touch Desmos nodes; closed tree hidden+inert. — PROTECTED
- INV-003 Keyboard parity (arrows 8/Shift 24 logical, same `viewportToLogicalLength`). — PARTIAL (no snap, no hint; tiny-viewport collapse BUG-002)
- INV-004 Always clamped to safe/drag areas. — PARTIAL (rotation mid-gesture bypass BUG-001; legacy 2-arg clamp BUG-009)
- INV-005 Paused blocks gestures. — PROTECTED mechanics; Close-disabled dead-end BUG-006 (spec question)
- INV-006 No Reference drift (`isReference` gates byte-identical). — PROTECTED (tests pin)
- INV-007 No cross-module leak (keys per moduleAttempt). — PROTECTED
- INV-008 Bare/RW zero Desmos docs. — PROTECTED (C2b e2e)
- INV-009 Physical size preserved across Display zoom (save ×scale/load ÷scale). — PROTECTED (scale=2 test)
- INV-010 Empty/corrupt recovers to defaults. — PARTIAL (floor 320×360 < calculator min; BUG-009)
- INV-011 Prewarm read-only. — PARTIAL (workspace blocked; geometry writes not — BUG-010)

## 3. Entities, ownership & relationships

| Unit | Owns | State | Mutability |
|---|---|---|---|
| `SatFloatingTool` (orchestrator) | gesture lifecycle, clamp, persist, probes, a11y | AUTH `lastCommittedRef`, `dragRef/resizeRef`; DERIVED `geometry` mirror, `presentation`, `renderedH`, min/max | only `commitDragPoint/commitResizePoint/finish*/moveByKeyboard/resizeByKeyboard` mutate |
| `SatCalculatorPanel` (placement) | first-open rect, clamp/min/max areas, header slot, keepAlive | DERIVED per render (`safeArea/dragArea/clampArea/edgeGutter/firstOpen/default/min/max`) | recompute only; never writes geometry |
| `satToolPointer.ts` (pure math) | threshold/rect/snap | stateless | add `constrainCompactSheet(rect,viewport,sheetW)` here |
| `satToolGeometryStore.ts` | normalize/clamp/load/save, v1 fallback | AUTH disk `v2:` records | `save` via `persist` only |
| `satToolSizePolicy.ts` | Reference sizes; calculator rows frozen | constants (panel intentionally bypasses — document) | read-only |
| `index.css` | band geometry per pointer/presentation | tokens | class-only |

Drag transition: `IDLE →(pointerdown primary, not button/radio) ARMED(live=false) →(≥4px) LIVE →(rAF) moved →(up) committed(persist+save×scale+snap?) / (Esc/blur/hide/close/disable) cancelled(restore origin, no save)`. Resize symmetric via `committed` flag. Compact sheet (NEW): same rows; `x` recentered to `sheetX` each commit, `w` fixed to `sheetW`.

## 4. Exact function-level design

`SatFloatingTool.tsx` (all calculator-visual diffs `isCalculator`-gated; shared gesture helpers change for both tools):
1. `canDrag = interactive` (drop `&& !compact`); `canResize = interactive && resizable` (drop `&& !compact`). Callers: `handleHeaderPointerDown`, `moveByKeyboard`, `startResize`, `resizeByKeyboard`, L828 effect, L1102/L1134 gates.
2. `handleHeaderPointerDown`: delete `compact` guard (keep `!interactive`, `isPrimary===false`, button/radio check). Compact calculator header becomes the same draggable node (render change 7).
3. `moveByKeyboard` / `startResize` / `resizeByKeyboard`: delete `compact` guard. Compact arrows move sheet (x recentered by clamp/constrain).
4. `finishDrag` snap L542: `resizable!==true ? committed : alignToSafeArea(...)` (drop `compact||`); keep assist on sheet (one ternary to disable — review point).
5. L828 effect deps drop `compact`; body `if (!open||disabled)`.
6. Header render L1073–1101: always desktop markup (`data-sat-tool-header`, grip + `handleGripKeyDown`, `headerControls`, Close); remove compact title span.
7. Style L1025–1030: `left: compact ? sheetX : geometry.x` (NEW recenter; initial = current centered constant ⇒ pixel-identical first open), `top: geometry.y` (unified, draggable), `width: compact ? sheetW : geometry.w`, `height: compact ? geometry.h : renderedH`. Panel `defaultGeometry` compact initial `{x:sheetX, y:vh*0.15, w:sheetW, h:vh*0.85}` (current constants).
8. Resize targets: gate `props.resizable`; compact calculator renders `["n","ne","nw"]` only (height/top; E/S/W would fight centering — full-8 viable alternative with x-recenter rule). Reference compact early-return L906 untouched.
9. `commitDragPoint` math unchanged (`viewportToLogicalLength`); compact x-recenter in new pure `constrainCompactSheet(rect, viewport, sheetW)` (`satToolPointer.ts`, testable).
10. `SatCalculatorPanel.tsx`: `edgeGutter` unconditional `toLogical(20)` (FR-05); `headerControls={modeSwitch}` always + delete body strip L218–222; `firstOpen/min/max` math unchanged; geometry key/scale/keepAlive unchanged.
11. `index.css`: extend coarse outside-band block to `.sat-tool-calculator[data-sat-tool-presentation="compact-sheet"]` (same `--edge-zone:0/--edge-outside:20*unit/--corner-zone:28*unit`, `overflow:visible`); no token value changes.
12. Guards (auditor P1/P2, same PR or fast-follow): rotation `onResize` early-return while `dragRef/resizeRef` live (BUG-001); re-down guard `if (dragRef.current||resizeRef.current) return` on both entries (BUG-003); keyboard ignored while pointer session live + drag/resize mutual exclusion (BUG-004); fold min into available span before keyboard/ARIA use (BUG-002); unify min height to 480 via policy owner (BUG-005, +test update); Close enabled when disabled after product sign-off (BUG-006); wire `onManualMove/Resize` → view-state (BUG-007); skip geometry save on prewarm keys (BUG-010); remove calculator header `onLostPointerCapture` cancel (BUG-008); min-aware legacy clamp or doc (BUG-009).

No changes: storage keys/schema, Desmos embed, probes/roles, `resizeGeometry/dragExceeded/alignToSafeArea` constants, `useSatMediaQuery`, version fallback.

## 5. Algorithm / control flow

Desktop drag @scale=2: `pointerdown grip (80,140) → ARMED{origin:{20,60,210,250}} + capture + noselect` → `move(200,160): hypot≥4 → LIVE + hint + pending + rAF` → `flush: dx=(200-80)/2=60, dy=10 → updateGeometry({80,70,…})` → `move(240,180) → {100,80}` → `up → persist(clamp) → save×scale + onManualMove + optional 8px snap`. Sub-threshold up: no commit/save/hint (C12). Esc/blur/hide/close/disable/unmount: `finish*(true)` → restore origin if live/committed, no save.
Compact N-resize (NEW): `pointerdown n-edge → resizeRef{edge:n,origin:sheet}` → `move dy=-40 → resizeGeometry(n,0,-40,min,max) → {y-40,h+40}` → rAF commit → `up → persist + onManualResize`; width recentered to `sheetW`.

## 6. Concrete implementation sequence

1. `satToolPointer.ts` ADD `constrainCompactSheet` + unit tests (additive, no callers).
2. `index.css` extend outside-band selectors to compact-sheet calculator (visual-only).
3. `SatFloatingTool.tsx` single PR: (a) drop `compact` from 4 guards + L828 + snap ternary; (b) unify calculator header; (c) sheet style live-geometry + fixed centered width; (d) resize subset N/NE/NW on sheet; probes/roles/inert/keepAlive/Escape-D5 untouched; `isReference` blocks untouched.
4. `SatCalculatorPanel.tsx`: unconditional gutter; always `headerControls`; delete body strip. No key/scale/keepAlive changes.
5. Auditor hardening (same PR or immediate follow): BUG-001/002 (P1) → BUG-003/004/005/006 (P2) → BUG-007/010 + quota beacon + `clearSatToolGeometriesForAttempt` + shared min/max selector (P3) → SPEC-001/002/003 + BUG-008/009 docs (P4).
6. Tests — UPDATE (intentional contract flips): `Coexistence:148,192–214` (sheet draggable + N-edges, probe still `compact-sheet`); `Panel:236` (radiogroup in header on compact). ADD: sheet drag 1:1, N-resize, Esc-cancel, keyboard move/resize, 200% physical/logical (mirror Gestures L96–110); rotation-mid-gesture no-jump; tiny-viewport ARIA range; re-down guard; keyboard-during-pointer; 480-min pin; prewarm no-write; compact-flip-mid-gesture cancel; 200%+320px reachability. KEEP green: Reference compact `:582`, collapse suite, D5 Escape, keepAlive/disabled, C10/C11/C12/C14/C16, min hard-stop, no-snap, quota, mode-no-resize, footer-overdrag.

## 7. Worked trace (scale=1, 1280×800)

Desktop `{600,110,420,520}` vs sheet `{380,120,520,680}`: `pointerdown(700,120) → ARMED` → `move(701,121) ignored (<4px)` → `move(750,150) → LIVE + rAF: desktop {650,140}, sheet constrain → {380,140,520,680}` → `up → persist each + onManualMove`. Cancel variant @scale=2: SE drag `{20,60,210,250} → pending {230,250} → Esc → restore origin, no save, no close`.

## 8. Verification

| Req | Unit | Integration | E2E/manual |
|---|---|---|---|
| FR-01/02 1:1+threshold/pin | `dragExceeded`, `resizeGeometry`, `constrainCompactSheet` (new) | Gestures scale=2, hard-stop, 1px no-snap (new), Esc matrix | mouse drag, touch corner drag, 200% zoom drag |
| FR-03 sheet parity | — | updated Coexistence + Gestures-compact (new) | iPhone SE 375×667 drag + N-resize; rotation reachable |
| FR-04 one selector | — | updated Panel :236 | visual tabs above graph both presentations |
| FR-05 bands | CSS token assert | physical/logical tests | 100/200/50% caliper, `any-pointer:coarse` laptop |
| Cancel matrix | — | Gestures L113 + compact-Esc + rotation/pin tests | iOS backgrounding |
| INV keepAlive/mode/Escape | — | burst identity, mode-no-resize, D5, keyboard, C10–C16 | SR grip/separator names, inert, no trap; Bluebook chrome check |

Commands (Bun): `bunx vitest run src/features/student-delivery/ui/tools`, `bun run typecheck`, `bun run lint`, `bunx playwright test` (touch + coarse + zoom matrix).

## 9. Extensibility & remaining risks

- Probe: detachable left/right dock → owner `finishDrag` snap site + screen-wide `dragArea`; CSS-only affordance; seam stays single call-site.
- Risks: (1) compact-undraggable flips 3 asserts "by design" — intentional, flagged; (2) sheet width fixed (full-width resize deferred with x-recenter rule); (3) unconditional 20px gutter moves desktop min-reach off flush edges — intended, one-line revert (`coarsePointer?…`) if design rejects; (4) fine-pointer desktop keeps inside bands (unchanged).
- Unknowns for product: unify-vs-lock direction (RULE-01 inversion is 5 lines); sheet edge subset (N/NE/NW proposed); snap on sheet (proposed yes).
- Auditor residual risks: rotation guard, tiny-viewport fold, re-down/mutual-exclusion, 480-min unification, paused-dismiss (needs product), manual-wins wiring, prewarm geometry guard, quota beacon + cleanup API, shared min/max selector, Escape/RTL/separator notes (§11 P1→P4). No new classes/tables/queues/locks; no migration; no API changes.
