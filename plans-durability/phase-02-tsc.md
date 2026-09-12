# Phase 02 — tsc OOM Investigation (toolchain owner)

> Stage: PLAN ONLY — implementation agents execute this file without redesigning.
> Lane: student-answer durability close-out · Overall plan: `plans-durability/overall-plan.md`
> (goal §1, blocker B2 §3, phases §4, standing rules §6).
> Parallel with Phase 01 / Phase 03. **No dependency** on either. Phase 04 needs
> 02-green-or-waiver before it can close.
> Ownership: repo/tsconfig scope only. **No prod edits to "fix the tool".**
> Lane files are FROZEN — a type error in lane files is reported to L0, never fixed here.

## 1. Objective

Turn blocker B2 (tsc-full OOM, pre-existing toolchain scale issue) into either:

- (a) **full green-with-evidence** — `npm run typecheck` exits 0 on the final tree
  with pasted command + exit code + tail, or
- (b) **owner-signed waiver** — owner + date + scoped-clean evidence + history
  citations, explicitly allowed by overall-plan §5
  ("tsc full green-with-evidence OR toolchain waiver (owner + date + scoped-clean evidence)").

## 2. Dependencies

**None.** Do not wait for Phase 01 (seed FK) or Phase 03 (k6/staging).
Do not touch `backend/`, `src/`, `e2e/`, `docs/`, `k6/` file contents.
Allowed writes: **/tmp only** (temp tsconfigs, temp tsbuildinfo, evidence logs).
Reading anything is always allowed.

## 3. Starting state (verified by reading — not assumed)

### 3.1 The single first-party tsconfig

- Root `tsconfig.json` (80 lines, read 2026-09-11) is the ONLY first-party tsconfig:
  `glob **/tsconfig*.json` returns it plus vendored copies under `node_modules/`,
  `load-runner/node_modules/`, and the untracked `deepseek-harness/` checkout.
  **There are no per-app configs and no project references** — rung "project-references
  or per-app configs if they exist" resolves to: they do not exist; skip to /tmp
  split-scope configs (rung 3) instead of inventing repo structure.
- Critical content (line numbers from the read):
  - `incremental: true` (:68), `tsBuildInfoFile: ".tsbuildinfo"` (:69, repo root).
  - `exclude` (:71-79): `node_modules`, `dist`, `src/stories`, `e2e`,
    `**/__tests__`, `**/*.test.ts`, `**/*.test.tsx`.
  - **No `include` key exists** — tsc therefore programs every `.ts/.tsx`
    under the repo root minus excludes (see §3.3 prime suspect).
  - Strict family: `strict`, `strictNullChecks`, `noImplicitAny`,
    `exactOptionalPropertyTypes` (:55), `noUncheckedIndexedAccess` (:56),
    `noImplicitOverride` (:62), `noPropertyAccessFromIndexSignature` (:63),
    `skipLibCheck: true` (:14), `moduleResolution: bundler` (:15),
    `jsx: react-jsx` (:19), `allowImportingTsExtensions` (:49),
    `types: ["vite/client"]` (:13).
- Typecheck script — `package.json:13`: `"typecheck": "tsc --noEmit"`.
  No scoped typecheck variants exist. CI runs it (`.github/workflows/ci.yml:134-135`).

### 3.2 Toolchain pins (observed 2026-09-11, re-verify at execution)

- `node --version` → `v26.0.0`; `npx tsc --version` → `Version 5.8.3`
  (dep declares `typescript ~5.8.2`).
- Machine: `hw.memsize: 8589934592` (8 GB physical). **Heap must never exceed
  6144 MB on this box** — leave room for the OS; more heap risks swap-death/SIGKILL.
- Prior evidence (overall-plan B2 + history):
  - `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` → V8 OOM at ~4 GB,
    ~470 s wall. Budget every full-program rung accordingly.
  - A larger-heap run once died differently: TS **internal crash** (`flags` of
    undefined) — heap is not the whole story; §7 distinguishes the two signatures.
  - Scoped `tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts` exits 0.
  - `docs/sat-hardening.md:42`: "full-repo tsc OOMs on 8GB machines (pre-existing
    env limit)"; scoped delivery config clean except pre-existing untouched
    `src/shared/error/errorTypes.ts` captureStackTrace lib artifact.
- Root `.tsbuildinfo` exists (129711 bytes, 2026-09-10) — incremental cache from a
  prior full-enough run. Do NOT delete it. It is gitignored (`.gitignore:8-9`
  cover `*.tsbuildinfo` + `.tsbuildinfo`).

### 3.3 Prime suspect (measured, needs rung-0 confirmation)

- `find src e2e -name "*.ts" -o -name "*.tsx"` → 1345 files; `git ls-files
  "*.ts" "*.tsx"` → 1265 tracked files (~1.3 k first-party program files).
- `deepseek-harness/` (untracked DSH checkout living in the repo root):
  **5103 `.ts` files outside its own `node_modules`**, 1.9 GB, **0 git-tracked
  files** (`git ls-files | grep -c deepseek-harness` → 0). Because root
  `tsconfig.json` has no `include` and no exclude entry for it, these files are
  almost certainly in the tsc program — a ~4-5× program-size inflation vs the real
  repo. Rung 0 census confirms or refutes this before any expensive run.
- Secondary scope: `load-runner/e2e/prod-load/*.ts`, `lib/utils.ts`,
  `.storybook/*.ts`, root configs, `scripts/eslint-rules/__tests__/*.test.ts`
  (excluded by pattern).

### 3.4 Frozen durability lane files (scoped-check targets, rung 1)

| File | Lines (measured) | Role |
|---|---|---|
| `src/shared/durability/DurableResponseEngine.ts` | 2298 | V2 engine (only owner of ordering/delivery) |
| `src/shared/durability/types.ts` | 132 | Domain & contract types |
| `src/shared/durability/useResponseDurabilityStatus.ts` | 177 | Status hook |
| `src/services/studentMutationOutbox.ts` | 773 | Mutation outbox / flush |
| `src/services/studentAttemptRepository.ts` | 1795 | Attempt repo incl. heartbeat flush |
| `src/components/student/providers/StudentAttemptProvider.tsx` | 2232 | Provider (V2 wiring) |
| `e2e/student-durability.spec.ts` | 672 | 5-scenario durability spec (prior scoped exit 0) |

Lane unit tests under `src/shared/durability/__tests__/` (5 files) are excluded
from the default program by `**/__tests__` + `**/*.test.ts` and stay excluded.

### 3.5 Behaviour that changes the commands below

- **Passing file paths to `tsc` IGNORES `tsconfig.json` entirely** (unless
  `--project` is given). Every scoped rung-1 command must therefore restate the
  strictness flags explicitly (§5 rung 1 gives the exact command). Transitive
  imports are still followed and checked — that is what we want.
- `--listFilesOnly` builds the program (parse + module resolution) WITHOUT type
  checking — the cheap census tool for rung 0. It can still OOM on a pathological
  program; that outcome is itself evidence (record heap + duration).

## 4. Contracts / interfaces

This phase produces **evidence, not code**. The only artifacts:

1. `/tmp/tsc-phase02/*.log` — raw logs per rung (commands, exit codes, tails,
   timings, HEAD sha, `node --version`, `npx tsc --version`).
2. Optional `/tmp/tsc-phase02/*.json` — temp split-scope configs (rung 3).
   **Never write temp configs or tsbuildinfo into the repo.**
3. Final verdict posted to the Phase 04 gate: GREEN (full) or WAIVER (signed).

No function signatures, no API changes, no schema changes. Nothing in this phase
may alter type-checking semantics of the repo for other phases.

## 5. Step-by-step implementation

> Prefix every rung: `git rev-parse HEAD` (record sha; tree is shared with
> 01/03 and may move — 2026-09-11 status already showed a dirty tree), `node
> --version`, `npx tsc --version`. Append all output to the rung log with
> `tee`. Time each rung with `time` or `date +%s` before/after.

### Rung 0 — program census (budget: < 10 min, heap default, must come first)

Goal: confirm/refute the §3.3 suspect with numbers, so later rungs are grounded.

1. `mkdir -p /tmp/tsc-phase02`
2. `npx tsc --noEmit --listFilesOnly > /tmp/tsc-phase02/program-files.txt 2>/tmp/tsc-phase02/census.err; echo "exit=$?"`
3. `wc -l /tmp/tsc-phase02/program-files.txt` (expected if suspect holds: ~6 k+
   lines; first-party-only would be ~1.3 k).
4. `grep -c deepseek-harness /tmp/tsc-phase02/program-files.txt; grep -c "^.*node_modules" /tmp/tsc-phase02/program-files.txt; grep -vc "node_modules\|deepseek-harness" /tmp/tsc-phase02/program-files.txt`
5. Record: total count, deepseek-harness count, node_modules count, first-party count.

**Green for rung 0:** command exits 0 and counts are recorded (any counts — this
rung is diagnostic, it cannot fail except by OOM, which is itself B2 evidence:
record heap bytes + wall time from the fatal line).

### Rung 1 — scoped lane checks (budget: < 5 min total, heap default)

Goal: prove the frozen lane files are type-clean independent of the toolchain
scale issue. Uses explicit flags (per §3.5, file-args ignore tsconfig).

1. Lane core (engine + contracts + hook + provider + outbox + repo):
```sh
npx tsc --noEmit --skipLibCheck \
  --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 \
  --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess \
  --noImplicitOverride --noPropertyAccessFromIndexSignature \
  --allowImportingTsExtensions --resolveJsonModule --esModuleInterop \
  --allowSyntheticDefaultImports \
  src/shared/durability/DurableResponseEngine.ts \
  src/shared/durability/types.ts \
  src/shared/durability/useResponseDurabilityStatus.ts \
  src/components/student/providers/StudentAttemptProvider.tsx \
  src/services/studentMutationOutbox.ts \
  src/services/studentAttemptRepository.ts \
  2>&1 | tee /tmp/tsc-phase02/rung1-lane.log; echo "exit=${PIPESTATUS[0]}"
```
2. Durability e2e spec (re-baselines the prior exit-0 evidence on this tree):
```sh
npx tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts \
  2>&1 | tee /tmp/tsc-phase02/rung1-spec.log; echo "exit=${PIPESTATUS[0]}"
```
   (Spec-only flags are intentionally loose — matches the prior evidence command
   exactly; do NOT "improve" it into a strict check.)

**Green for rung 1:** both commands exit 0 with empty output. Paste command +
`exit=0` + `tail -5` of each log into the verdict.
**If EITHER command reports a type error in a lane file:** STOP the ladder.
Do NOT fix, do NOT scope around it, do NOT redesign. Report to L0: file, line,
full error text, HEAD sha, rung-1 log path. Lane files are frozen (overall-plan
§6: engine untouched unless a gate proves loss — a tool-phase type error is not
that gate). The waiver path is then closed until L0 dispositions the error.

### Rung 2 — full program, incremental to /tmp (budget: 1 attempt ≈ 600 s cap)

Goal: full green if the census + incremental cache make it fit.

```sh
NODE_OPTIONS=--max-old-space-size=4096 timeout 900 npx tsc --noEmit \
  --incremental --tsBuildInfoFile /tmp/tsc-phase02/tsc-phase02.tsbuildinfo \
  2>&1 | tee /tmp/tsc-phase02/rung2-full.log; echo "exit=${PIPESTATUS[0]}"
```
Rules:
- `--tsBuildInfoFile` MUST point to /tmp. The root `.tsbuildinfo` already
  exists and stays untouched; verify afterwards with
  `git status --porcelain -- '*.tsbuildinfo' .tsbuildinfo` → empty output
  (belt-and-braces: they are gitignored, but repo pollution is an explicit edge
  case in §7).
- `timeout 900` (not 470): the prior ~470 s OOM wall plus parse variance.
  `timeout` kills with exit 124 — record as TIMEOUT signature (§7), distinct
  from OOM.
- On OOM, retry rung 2 **exactly once** (repair-locally rule: same failure twice
  → escalate, never blind re-patch). The single retry may use 6144 MB heap
  (max sane on this 8 GB box: `--max-old-space-size=6144`). No 8192+ attempt.

**Green for rung 2:** exit 0, empty output, wall time recorded. This is FULL
green — skip rungs 3-4, go to §9 verdict (a).

### Rung 3 — split-scope configs in /tmp (only if rung 2 OOMs twice; budget: < 20 min)

No per-app configs or project references exist (§3.1), so "per-app configs" means
**temp /tmp configs that extend the root config**. Never write them into the repo.

1. Create `/tmp/tsc-phase02/tsc-scope-lane.json`:
```json
{
  "extends": "/ABSOLUTE/PATH/TO/REPO/tsconfig.json",
  "compilerOptions": { "tsBuildInfoFile": "/tmp/tsc-phase02/lane.tsbuildinfo" },
  "include": [
    "src/shared/durability/**/*",
    "src/services/studentMutationOutbox.ts",
    "src/services/studentAttemptRepository.ts",
    "src/components/student/providers/**/*"
  ]
}
```
   (Implementation agent: replace `/ABSOLUTE/PATH/TO/REPO` with `pwd` output.
   Do NOT copy the file into the repo; run with `npx tsc --project
   /tmp/tsc-phase02/tsc-scope-lane.json --noEmit`. Note: CLI `--project` +
   `--noEmit` composes fine; do NOT also pass file args with `--project`.)
2. If rung-0 census proved deepseek-harness inflation, add scope B as a
   diagnostic (NOT a repo change): same template with
   `"exclude": ["node_modules", "dist", "src/stories", "e2e", "**/__tests__",
   "**/*.test.ts", "**/*.test.tsx", "deepseek-harness", "deepseek-harness/**/*"]`
   and no `include` — i.e. "full program minus the untracked checkout".
   This quantifies the suspect: if B goes green fast, the OOM is scope
   inflation, not repo scale.
3. Optional scope C (only if B is still red/OOM): `include: ["src/**/*"]` plus
   the repo's own root-level `.ts/.tsx` as needed — the shipped-product scope
   (mirrors the CI coverage-gate definition of "shipped product code (src/)" in
   `.github/workflows/ci.yml:181-187`).

**Green for rung 3:** each attempted scope exits 0; record per-scope command +
exit + wall time + tail. Scope results are SUPPORTING evidence for a waiver
(§8), never a claim of "full tsc green".

**Forbidden in rung 3:** editing root `tsconfig.json` to "fix" the OOM by
narrowing scope (that would change CI semantics for everyone and could mask real
errors — error-parity would be unprovable inside this phase). If scope B shows
the checkout is the cause, REPORT it as the recommended follow-up (repo-owned
`include`/`exclude` hardening belongs to a future toolchain ticket, not to
this frozen-lane close-out), and proceed to the waiver (§8), not to a repo edit.

### Rung 4 — full `npm run typecheck` as-is (only if rung 2 went green)

```sh
NODE_OPTIONS=--max-old-space-size=4096 timeout 900 npm run typecheck \
  2>&1 | tee /tmp/tsc-phase02/rung4-npm.log; echo "exit=${PIPESTATUS[0]}"
```
Rung 2 green + rung 4 green = the exact CI gate (`.github/workflows/ci.yml:135`)
reproduced locally. Either one green with the other unattempted is insufficient
for verdict (a).

### STOP rule (when to quit the ladder and waive)

STOP and go to §8 when ANY of these hold:
- Rung 2 OOMed twice (4096 + 6144) — further heap is futile on 8 GB (and history
  already shows larger-heap ends in an internal crash, not green).
- Any single rung exceeds its time budget twice (two TIMEOUTs = same-failure-twice).
- Cumulative full-program attempts reach 3 (2× rung 2 + optionally scope B full).
  Each costs ~8 min wall; the lane does not buy more.
- A TS internal crash (§7, signature C) appears — that is a compiler bug, not a
  scale problem the lane can ladder out of.

## 6. Key code / pseudocode

None — this phase writes no production code. The only "code" is the rung-3
`/tmp` config template in §5 and the evidence-collection wrapper:

```sh
# Evidence header pattern — run before every rung, append to the rung log.
{ echo "== HEAD: $(git rev-parse HEAD)";
  echo "== node: $(node --version) / tsc: $(npx tsc --version)";
  echo "== date: $(date -u +%FT%TZ)"; } | tee -a /tmp/tsc-phase02/<rung>.log
```

## 7. Edge cases

1. **tsBuildInfoFile pollution of the repo → must live in /tmp.**
   Root `tsconfig.json:69` points at repo-root `.tsbuildinfo`. Every rung in
   this phase overrides it to `/tmp/tsc-phase02/*.tsbuildinfo`. Post-run check:
   `git status --porcelain -- '*.tsbuildinfo' .tsbuildinfo` must be empty.
   (They are gitignored today, but the standing rule is no repo writes from
   tooling runs — /tmp makes the guarantee structural, not .gitignore-luck.)
2. **OOM-killed process vs TS internal crash — different signatures, record which:**
   - Signature O (V8 OOM): `FATAL ERROR: Reached heap limit Allocation failed -
     JavaScript heap out of memory`, exit 134 (SIGABRT) or 137 (OS SIGKILL).
     Means: program too big for heap → ladder/waiver logic applies.
   - Signature C (compiler crash): `error TS…: Debug failure` or bare
     `TypeError: Cannot read properties of undefined (reading 'flags')` with a
     stack inside `typescript.js`, exit 1-3 WITHOUT the FATAL line. Means:
     compiler bug (matches the historical larger-heap `flags of undefined`
     report) → STOP immediately, waive-leaning, cite the TS version (5.8.3) and
     attach the stack; do not retry with more heap.
   - Signature T (timeout): exit 124 from `timeout 900` → record wall time,
     counts as a failed attempt under the STOP rule, not as OOM evidence.
3. **Node version pinning (Node 26 observed).** Record `node --version` in every
   rung log. If the implementation machine reports anything other than v26.0.0,
   note the delta in the verdict but do NOT change engines/`.nvmrc`/Dockerfile
   to chase green — toolchain repinning is out of scope for the frozen lane.
   (Check `ls .nvmrc .node-version` during rung 0 for the record; absence is
   also a finding, not a task.)
4. **File-args ignore tsconfig (§3.5).** A bare
   `npx tsc --noEmit <files>` is NOT a strict check (defaults: non-strict,
   no jsx, classic resolution) — exit 0 from it proves nothing about the lane.
   Rung 1's explicit-flags command is mandatory, not stylistic.
5. **Stale root `.tsbuildinfo`.** It predates this phase (2026-09-10) and may
   reflect a different tree. Rung 2 does not read it (fresh /tmp path), so no
   staleness hazard — but do not delete or "refresh" it in place.
6. **Dirty shared tree.** 01/03 run in parallel; HEAD may move mid-phase. Every
   rung log carries its HEAD sha; the verdict cites the sha its evidence belongs
   to. If HEAD moved between rung 1 and rung 2, re-run rung 1 on the new HEAD
   (cheap) before claiming anything.
7. **`--listFilesOnly` can itself OOM.** Treat as B2 confirmation (signature O
   with tiny heap + short wall), then proceed directly to rung 1 + waiver track.
8. **Scope-B temptation.** Even if "full minus deepseek-harness" goes green,
   never present it as full green — it is a different program than CI runs.
   It supports a waiver and a follow-up ticket, nothing more.

## 8. Waiver path (explicitly allowed by overall-plan §5)

If the STOP rule fires with rung 1 green, write the waiver block into the Phase
04 handoff (and as `/tmp/tsc-phase02/WAIVER.md` for the record):

```md
## tsc-full waiver request (Phase 02 → Phase 04 gate)
- Owner: <toolchain-owner name> · Date: <YYYY-MM-DD> · HEAD: <sha>
- Claim: full `tsc --noEmit` is not runnable on the standard 8 GB dev box
  (pre-existing scale issue, not a lane regression).
- Scoped-clean evidence (paste command + exit=0 + tail for each):
  - rung 1 lane-core log: /tmp/tsc-phase02/rung1-lane.log
  - rung 1 spec log: /tmp/tsc-phase02/rung1-spec.log
  - best rung-3 scope(s): <command + exit + wall time>
- Failure evidence (paste fatal line + exit code + wall time for each):
  - rung 2 attempt 1 (4096 MB): <log path>
  - rung 2 attempt 2 (6144 MB): <log path>
  - rung 0 census counts (total / deepseek-harness / node_modules / first-party)
- History citations: overall-plan B2; docs/sat-hardening.md:42 (full-repo OOM
  pre-existing on 8 GB); prior scoped-clean e2e spec exit 0; larger-heap
  internal-crash report (signature C, heap is not the fix).
- Follow-up ticket (not this lane): root tsconfig scope hardening
  (`include` and/or exclude for the untracked checkout) with error-parity proof.
- Lane-freeze statement: no type error in lane files was observed (rung 1 green);
  had one appeared it would have gone to L0 per §5, not into this waiver.
```

A waiver WITHOUT rung-1 green is invalid — go to L0 instead (§5 rung 1 red path).

## 9. Tests

This phase adds no test files (PLAN ONLY stage forbids `src/`/`e2e/` edits
anyway). "Tests" = the rung commands themselves:

| Rung | Exact command (abridged; full flags in §5) | Expected output if green |
|---|---|---|
| 0 | `npx tsc --noEmit --listFilesOnly > program-files.txt` | exit 0; counts recorded |
| 1a | `npx tsc --noEmit --skipLibCheck --strict … <6 lane files>` | exit 0, empty output |
| 1b | `npx tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts` | exit 0, empty output |
| 2 | `NODE_OPTIONS=--max-old-space-size=4096 timeout 900 npx tsc --noEmit --incremental --tsBuildInfoFile /tmp/…` | exit 0, empty output |
| 4 | `NODE_OPTIONS=--max-old-space-size=4096 timeout 900 npm run typecheck` | exit 0 |

Paste policy (standing rule: never claim green without pasted output): every
green claim carries command + `exit=N` + last 5-20 lines + wall time + HEAD
sha + node/tsc versions.

## 10. Verification (exact commands + expected outputs)

Post-execution checklist (implementation agent fills in actuals):

- [ ] `node --version` → recorded (observed v26.0.0 at plan time).
- [ ] `npx tsc --version` → recorded (observed 5.8.3 at plan time).
- [ ] Rung 0 counts pasted: total=`__`, deepseek-harness=`__`,
      node_modules=`__`, first-party=`__`.
- [ ] Rung 1a: exit=`__` (green requires 0 + empty output).
- [ ] Rung 1b: exit=`__` (green requires 0 + empty output).
- [ ] Rung 2: exit=`__`, wall=`__`s (green requires 0; OOM requires fatal
      line pasted verbatim + 134/137).
- [ ] `git status --porcelain -- '*.tsbuildinfo' .tsbuildinfo` → empty.
- [ ] Verdict (a) FULL GREEN: rung 2 exit 0 AND rung 4 exit 0, all evidence
      pasted — OR verdict (b) WAIVER: §8 block complete with owner + date.
- [ ] If any lane-file type error appeared: L0 report filed (file:line + error
      text + sha), ladder halted, waiver NOT claimed.

## 11. Definition of done

- [ ] Either FULL GREEN (rung 2 + rung 4 exit 0 with pasted evidence on the
      final HEAD) or a SIGNED WAIVER (§8: owner + date + rung-1-green logs +
      failure logs + history citations).
- [ ] No file under `src/`, `backend/`, `e2e/`, `docs/`, `k6/`, or
      root `tsconfig.json` was modified (verify: `git status --porcelain`
      shows none of these paths; /tmp holds all temp artifacts).
- [ ] Verdict handed to Phase 04 gate with HEAD sha, node/tsc versions, and log
      paths. Phase 04 treats "02 green" and "02 waived" identically as inputs —
      both unblock it when combined with 01-green and 03-green-or-waived.
