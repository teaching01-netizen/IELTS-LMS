# SAT Word Vault import — test case pack

Owner: QA. Status: **for review, not yet executed**
Build under test: `da5bf2b8` — *Reach the Word Vault import from the published exam header*
Branch: `codex/sat-score-report-cold-render`

---

## 1. What changed

Two things, and they are the only things that are genuinely new:

1. **Placement.** The vocabulary workbook importer is reachable from the same `Import`
   menu as the exam workbook — on the draft workspace *and* on the published-exam
   receipt screen, which previously had no Import menu at all.
2. **Targeting.** Opening the importer from that menu asks the server which versions
   exist and defaults the `Exam version` select to the **latest published version**.
   The draft remains selectable. Settings keeps its own button and still defaults to
   the draft.

Everything else — parsing, replacement, PDF rendering, publish pinning — is
pre-existing behaviour that this change reuses. It is in scope for regression, but
it is not what should fail.

## 2. Risk ranking

Ranked by "if this breaks, how bad and how quietly".

| # | Risk | Why it is ranked here | Cases |
| --- | --- | --- | --- |
| R1 | Writing vocabulary to the **wrong version** (draft edit silently changing the live student PDF, or a published edit silently changing the draft) | Wrong target is invisible in the UI after the fact, and silently changes what students receive | B1–B11, D1, G1–G2 |
| R2 | **Whole-vault replacement** wiping modules the file did not mention | The user's mental model is "add words"; the operation is "replace everything" | D1–D4 |
| R3 | Author imports against a published version **whose question map differs** from the workbook (draft has more questions) | Produces confusing cell errors, or wrong question binding | B10, C14, E2 |
| R4 | Import from the published screen **accidentally creating a draft** | Would be a surprising side effect and pollute the exam list | A4 |
| R5 | Concurrent edits / double submit producing two imports | Money-adjacent pattern: non-idempotent writes | E1–E6 |
| R6 | PDF regression (missing appendix, Thai not rendering, appendix after review slides, answer-key coupling) | Student-facing, hard to catch without opening the PDF | G1–G9 |
| R7 | Permission leak — observer/grader able to write | Security | F1–F4 |
| R8 | Discoverability/a11y of the new menu item | Blocked keyboard users cannot import at all | A7–A9, I1–I8 |

## 3. Environment and fixtures

- **Env A** — disposable MySQL with migrations through `0134`, Go API serving the built
  `dist`, signed-in as a *builder*.
- **Env B** — same, signed-in as *admin observer* (read-only role) and as a builder in a
  second org (cross-tenant probe).
- **Fixtures**
  - F1 `vocab-valid-1.xlsx` — 1 word on `Reading & Writing · Module 1`, question 1.
  - F2 `vocab-valid-3-modules.xlsx` — entries across M1, M2-Lower, M2-Higher.
  - F3 `vocab-header-only.xlsx` — headers, zero data rows (explicit clear).
  - F4 `vocab-201-rows.xlsx`, `vocab-1001-rows.xlsx`.
  - F5 `vocab-math-module.xlsx` — `Math · Module 1`.
  - F6 `vocab-q99.xlsx` — question number beyond the module's count.
  - F7 `vocab-formula.xlsx` — `=A1` in the word column.
  - F8 `vocab-extra-column.xlsx` — value in column G.
  - F9 `vocab-thai.xlsx` — Thai with combining vowels/tone marks.
  - F10 `vocab-dup.xlsx` — the same row twice.
  - F11 `vocab-3mb.xlsx`, F12 `vocab.xls`, F13 `vocab-macro.xlsm` renamed to `.xlsx`.
  - F14 `vocab-wrong-header.xlsx`, F15 `vocab-no-sheet.xlsx` (sheet renamed).
  - F16 `vocab-boundary-lengths.xlsx` — 80 / 160 / 320 / 320 characters exactly, plus a
    second file one character over each.
- **Seeded exams**
  - E1 draft only, no published version.
  - E2 published V1, draft open.
  - E3 published V1 + V2, draft open (checks default = V2).
  - E4 published V1, **no draft** (the receipt screen).
  - E5 published V1 with 20 questions per module; draft has 27 (the "map differs" case).
  - E6 IELTS exam (provider key `ielts`).

---

## 4. Test cases

Priority: **P0** ship-blocker · **P1** must fix before release · **P2** should fix · **P3** nice to have.

### A. Entry point placement

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| A1 | P0 | Draft workspace menu contents | Open E2 as builder → `Import` | Menu reads, in order: `Add questions to this module…`, `Import Excel workbook…`, separator, `Import vocabulary workbook…`. Vocabulary item is **below** a divider, never between the two exam-workbook items |
| A2 | P0 | Published receipt has the menu | Open E4 → `Import` | Menu exists and contains exactly `Import vocabulary workbook…` |
| A3 | P0 | Published screen does not create a draft | On E4, open the item, upload F1, confirm | No `POST …/drafts`, no `ensureDraft`, URL unchanged, header still shows the published receipt ("Ready to create rooms"), exam still has no draft in the exam list |
| A4 | P1 | IELTS exam excluded | Open E6 → `Import` | Only the two exam-workbook items; no vocabulary item, no divider |
| A5 | P1 | Observer role | Sign in as observer on E2 and E4 | No `Import` button on either surface; `GET …/sat-word-vault` still 200 (read allowed) |
| A6 | P2 | Both doorways, one contract | Compare header-menu sheet vs Settings-button sheet on E2 | Same dialog name, same fields, same validation; only the default target differs (B1 vs B2) |
| A7 | P2 | Menu keyboard operation | Focus `Import`, press Enter; then ArrowDown/ArrowUp; then Escape | Menu opens, roving focus over enabled items only, separator is `role="separator"` and skipped, Escape returns focus to the trigger |
| A8 | P2 | Focus after a completed import | Complete an import from the header menu | Dialog closes, focus returns to the `Import` trigger, success notice is announced (`role="status"`) |
| A9 | P3 | Deep link still works | Navigate to `…/settings?panel=word-vault` | Page scrolls to and focuses "The Word Vault" panel; Settings button opens the sheet defaulting to the draft |

### B. Target selection

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| B1 | P0 | Default is latest published | Open header-menu sheet on E3 | `Exam version` = `Published version 2` (highest number, not the draft, not V1) |
| B2 | P0 | Settings keeps draft default | Open the same sheet from Settings on E3 | `Exam version` = `Editable draft` |
| B3 | P0 | Published-only exam | Open on E4 | Options: published versions only — no `Editable draft` entry even though the exam is editable elsewhere |
| B4 | P0 | Draft-only exam | Open on E1 | Version select is **not rendered** at all; headings/footers say "the draft"; no "Students who took this version…" sentence |
| B5 | P1 | Switching target resets the sheet | On E3 select V2, upload F1, reach the review step, then switch to `Editable draft` | File chip clears, preview disappears, footer disappears, any error clears, `Check again` disappears; committing is impossible until a new upload |
| B6 | P1 | Draft commit side effects | Target `Editable draft`, import F1 | Success text `1 word saved to the draft.`; draft revision increments; authoring shell refreshes; draft is marked changed |
| B7 | P1 | Published commit side effects | Target `Published version 2`, import F1 | Success text `Version 2 updated. Students will get the changes on their next PDF download.`; **draft revision unchanged**; no unsaved-changes indicator; no shell refetch required |
| B8 | P1 | Hint copy follows the target | Toggle the select | Published → `Updates student PDFs for this version.`; draft → `Draft vocabulary appears after the exam is published.` |
| B9 | P1 | Version ordering matches the rest of the app | Compare select order on E3 with the version numbers on the receipt header / room list | Newest first (`Version 2`, `Version 1`), same identifiers behind the labels |
| B10 | P1 | Workbook written against a newer draft, applied to an older version | On E5 upload a file that references question 25 of Module 1, target V1 (20 questions) | Preview shows `Workbook needs attention` with `Vocabulary · B2` → `Question 25 is missing from the selected version. Valid numbers for this module are 1–20.`; primary action absent; no commit possible |
| B11 | P2 | Controls disabled while busy | Upload a large-but-valid file, interact during `Checking vocabulary…` / `Saving vocabulary…` | Version select disabled, close button disabled, dropzone non-interactive, `aria-disabled` set |
| B12 | P2 | Status fetch failure | Force `GET …/sat-word-vault` to 500, open the item | Sheet does **not** open; page shows `Couldn’t load exam versions for the Word Vault. Try again.` |
| B13 | P1 | Published fix carries into an untouched draft | On E3, import to `Published version 2` while a draft open whose vault still equals V2's pre-import vault | Draft vault now holds the same entries, draft revision moves, notice adds `Your draft now carries the same words.` A following publish keeps the fix |
| B14 | P1 | Published fix leaves a diverged draft alone | Same, but first give the draft its own words | Draft vault and draft revision unchanged; notice omits the carry clause; nothing the author wrote is lost |

### C. Workbook contract (regression — parser is unchanged, must still hold)

Read this section against two different presentations:

- **Cell-level issues** (row/column diagnostics) render as `Workbook needs attention`
  with a `Vocabulary · B2` list, and there is no primary action.
- **Form-level errors** (unreadable file, size, container, row cap) render as a single
  red `role="alert"` line and also leave no primary action.

Cases below name which one to expect.

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| C1 | P1 | Template integrity | `Download vocabulary template` | File `SAT-Vocabulary-Template.xlsx`; sheets `Vocabulary`, `Guide`, `AI Instructions`; row 1 has the six headers in order; `Guide` states the limits |
| C2 | P1 | Only `Vocabulary` is imported | Fill `Guide` with junk data, import | Junk ignored; no issues raised from reference sheets |
| C3 | P1 | Client-side extension guard | Upload F12 (`vocab.xls`) | `Choose an .xlsx vocabulary workbook up to 2 MB.`; no network call |
| C4 | P1 | Client-side size guard | Upload F11 (3 MB) | Same message; no network call |
| C5 | P1 | Server size boundary | POST exactly 2 MB and 2 MB + 1 byte | 2 MB accepted; +1 byte → 413 `Vocabulary workbooks must be 2 MB or smaller.` |
| C6 | P1 | Missing worksheet | F15 | Form-level: `The Vocabulary worksheet is missing. Start with the vocabulary template.` |
| C7 | P1 | Wrong header | F14 | `Workbook needs attention`, cell-level `The header must be "Module".` (or the offending column); header errors replace the entry list |
| C8 | P1 | Extra column | F8 | `Vocabulary · G{n}` → `Use the six columns in the vocabulary template.` |
| C9 | P1 | Formula cell | F7 | `Paste values here instead of formulas.` |
| C10 | P1 | Length boundaries | F16 and the one-over variant | Exact limits accepted (80 / 160 / 320 / 320); one over → `Enter plain text between 1 and 80 characters on one line.` etc. |
| C11 | P1 | Non–Reading & Writing module | F5 | Cell-level `Vocabulary · A{n}` → `Choose a Reading & Writing module listed in the Guide.` |
| C12 | P1 | Question number validation | `0`, `-1`, `abc`, blank | Cell-level `Vocabulary · B{n}` → `Enter a positive whole question number.`; fully blank rows are skipped, never errored |
| C13 | P1 | Duplicate row | F10 | `Vocabulary · C{n}` → `This vocabulary entry is duplicated.` |
| C14 | P2 | Row / entry caps | F4 | 200 entries accepted. 201 → cell-level `Include at most 200 vocabulary entries.` Data beyond row 1000 → form-level `Keep the Vocabulary worksheet within the first 1,000 rows.` |
| C15 | P2 | Zip-bomb and container guards | Rename an encrypted file, a macro file, and an over-compressed archive to `.xlsx` | Form-level: `Use a plain workbook without encryption, attachments, external links, or macros.` / `The vocabulary workbook expands beyond 16 MB.` / `Choose a readable vocabulary .xlsx workbook.` — one message per class, never a stack trace |
| C16 | P2 | Thai round-trip | F9 | Preview shows Thai with combining marks intact; `lang="th"` on the Thai cell; PDF later matches |
| C17 | P2 | Whitespace trimming | Rows padded with spaces | Trimmed; no spurious errors; trimmed values appear in the preview |
| C18 | P2 | Header-only, nothing to replace | F3 on an exam whose target vault is empty | Footer hidden or commit disabled with `Add at least one vocabulary entry and upload again.` — clearing an empty vault is not offered |

### D. Replacement semantics

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| D1 | P0 | Whole-vault replacement | Vault has words in M1, M2-Lower, M2-Higher; import F1 (M1 only) | M1 = 1 word; M2-Lower and M2-Higher = 0. Impact chips read `… Module 2 — Lower · 3 → 0 · removed` |
| D2 | P1 | Footer states the consequence | Reach review with F1 against a populated vault | `Replaces all N words in <target>, including modules this file does not mention.` and the primary button reads `Replace Word Vault` |
| D3 | P1 | Explicit clear | F3 against a populated vault | Primary button `Remove all words` (published target) or `Remove all draft words` (draft); after commit, notice `Draft vocabulary removed.` for the draft and the empty state for a published version |
| D4 | P2 | Additive-looking case | Import F1 against an empty target | Footer `1 word will be added to the draft.`; button `Import 1 word`; no "replace" wording |
| D5 | P2 | Same word on two questions | Two rows, same word, different question numbers | Both accepted and both listed (uniqueness is per module+question+word+content) |
| D6 | P2 | Re-import identical file | Import F1 twice | Same content, no duplication, count unchanged, second commit is a clean success |

### E. Concurrency, conflict, idempotency

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| E1 | P1 | Double submit | Double-click the primary button | Exactly one `POST …/commit`; second click has no effect while `Saving vocabulary…` |
| E2 | P0 | Draft changed between preview and commit | Preview, then write a question revision from another tab, then commit | 409 → `The selected version or its vocabulary changed. Check the workbook again.` + `Check again`; commit disabled until re-checked |
| E3 | P0 | Concurrent published replacement | Two builders preview the same version; one commits; the other commits | Second gets 409 with the same message; no partial write; vault equals the first committer's file |
| E4 | P1 | Replay after success | Re-send the identical commit payload with the same `operationKey` | 200 with the original receipt; vault not written twice |
| E5 | P2 | Two different workbooks, same key (API-level) | Same `operationKey`, different file, replay by hand | 409 `This operation key was already used with different content; use a new key.` Never silently applied. Not reachable through the UI, which mints a new key whenever the file or target changes — assert at API level only |
| E6 | P2 | Version deleted/republished mid-flight | Preview, then publish a new version / delete the targeted draft | Conflict or validation error naming the target; the sheet stays open and recoverable |

### F. Authorization and scoping

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| F1 | P0 | Read-only role cannot write | Observer calls `POST …/preview` and `…/commit` directly | 403 `You cannot edit this SAT exam.`; `status` still 200 |
| F2 | P0 | Cross-tenant | Builder from org B requests org A's exam id | 404, no existence oracle |
| F3 | P1 | Non-SAT provider | Call the endpoint on an IELTS exam id | 404 `SAT exam not found.` |
| F4 | P1 | Archived exam | Call on an archived exam | Rejected; no vault written |
| F5 | P2 | CSRF | Commit without the CSRF token | Rejected by the existing CSRF layer, not by the handler |

### G. Student PDF (regression + the payoff for B7)

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| G1 | P0 | Existing attempt picks up a published update | Sit a Classroom exam, download the PDF, then update the same version's vault from the header menu, download again | Second PDF contains the new words; **no new room version** created; attempt count unchanged |
| G2 | P0 | Draft import must not touch the live PDF | Import to the draft while V1 is live | A student attempt on V1 re-downloads an unchanged appendix |
| G3 | P1 | Appendix placement | Multi-page report with review slides | Appendix starts after the last question review **and** after the review-end slides; headings repeat on continuation pages |
| G4 | P1 | Answer-key independence | Toggle the answer key off, download | Vocabulary appendix still present (only the key changes) |
| G5 | P1 | Empty vault | Version with no words | No appendix pages at all — not an empty heading page |
| G6 | P1 | Thai rendering | Appendix with Thai | Thai glyphs render (Noto Sans Thai embedded); no tofu; the license file ships with the bundle |
| G7 | P1 | Both adaptive branches | Entries on M2-Lower and M2-Higher; student took one | Both branches' words appear; the student is not filtered to the branch they sat |
| G8 | P2 | Source reference | Any appendix | Reads `From Question 01`-style labels matching the workbook's question number |
| G9 | P2 | Page furniture | Last pages | A4 landscape, footer/pagination continues from the review pages, no clipped table |

### H. Publish integration

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| H1 | P1 | Stale reference blocks publish | Save a vault, then replace a referenced question, then validate | Blocking issue `sat.word_vault.stale` with the "Results & scoring" wording |
| H2 | P1 | Fix link | Click the issue's action | Lands on `…/settings?panel=word-vault` with the panel focused and the stale count shown |
| H3 | P1 | Draft inheritance | Publish V1, open a new draft | New draft copies the vault forward; the published version keeps its own copy |
| H4 | P2 | Attempts keep their version | Attempt on V1; publish V2 with different words | V1 attempts keep V1 words on re-download |

### I. Accessibility

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| I1 | P1 | Initial focus | Open the sheet with versions present; open again with none | Focus lands on `Exam version` select, else on `Upload workbook` |
| I2 | P1 | Error and heading focus | Upload F14, then upload a valid file | Focus moves to the `Workbook needs attention` / `Review vocabulary` heading; errors are `role="alert"` and focusable |
| I3 | P1 | Escape behaviour | Escape while idle; Escape while saving | Closes and returns focus in the first case; blocked while saving (close button disabled too) |
| I4 | P1 | Keyboard-only happy path | Tab to dropzone, Enter to open picker, choose F1, Tab to primary action, Enter | Completes without a mouse; no focus escapes the dialog (`aria-modal`, background inert) |
| I5 | P2 | Busy announcements | Watch the live region during check/save | `Checking vocabulary…` / `Saving vocabulary…` announced once, not on every keystroke |
| I6 | P2 | Target sizes and contrast | Inspect controls | Interactive targets ≥ 44×44; error text meets 4.5:1; focus rings visible on all controls |
| I7 | P2 | Reflow | 375 px wide viewport, 200 % zoom | Select, dropzone, entry list, and footer wrap without horizontal scroll; the primary action stays reachable |

### J. Resilience

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| J1 | P1 | Template download failure | Block `…/template` | `Couldn’t download the template. Try again.`; the rest of the sheet still works |
| J2 | P1 | Preview failure | Force `…/preview` 500 | Error shown, sheet stays on the upload state, re-upload possible, no stale preview left behind |
| J3 | P1 | Commit failure | Force `…/commit` 500 | Error shown; primary action remains enabled for a retry; no success notice |
| J4 | P1 | Unsaved question blocks the sheet | Dirty the open question, make the save fail, then open the item | Sheet does **not** open; the existing navigation-error message is shown; no vault write |
| J5 | P2 | Offline mid-flow | Go offline after preview, commit | Network error surfaced, `Check again` path available, no false success |
| J6 | P3 | Slow server | 10 s delay on preview | Busy state persists, controls stay disabled, no double submit |

### K. Regression around the change

| ID | Pri | Test | Steps | Expected |
| --- | --- | --- | --- | --- |
| K1 | P0 | Exam workbook import untouched | Full 20-question import via `Import Excel workbook…` | Preview, commit, undo banner all unchanged; vocab item never intercepts it |
| K2 | P0 | Publish + create room | Publish from the draft, create a Classroom room | Unchanged; no vocabulary side effects; receipt version still pinned |
| K3 | P1 | Settings page | Open Settings tab | Delivery, scoring, forms, and Word Vault panels all render; no layout shift from the new menu |
| K4 | P1 | Autosave | Edit a question, navigate away, come back | Unchanged; the added flush before opening the sheet does not mark the draft dirty |

---

## 5. Automation status

Already automated on this branch — QA should **review, not duplicate**:

| Case | Existing coverage |
| --- | --- |
| A1, A4 | `AuthoringWorkspace.test.tsx` › *keeps the vocabulary import out of non-SAT exams* |
| A2, B1 | `AuthoringWorkspace.test.tsx` › *defaults to the current published version while still offering the draft* |
| A3, B7 | `AuthoringWorkspace.test.tsx` › *replaces the published vault through the authoring menu without opening a draft* |
| B1, G1–G8 (thin) | `e2e/sat-workbook-import.spec.ts` › *Word Vault imports separately and ends the released student PDF* |
| B13, B14 | `internal/authoring` › `TestWordVaultPublishedFixCarriesIntoDraftMySQL` (three MySQL subtests) |
| B5, B10, J4, B3, B4 | `AuthoringWorkspace.test.tsx` — target switch, version-bound cell error, blocked flush, absent controls |
| C1–C18 (server) | `backend/go/internal/authoring` word-vault unit and integration tests |
| E2, E4 | MySQL integration coverage named in the release handoff |

Not yet automated, highest value first: **B5, B10, D1, E1, F1, G2, I3, J4**.

## 6. Open questions for product/eng

These are not defects yet. They are the places where "correct" depends on intent, and I
would rather settle them than encode guesswork into the suite.

1. **RESOLVED — published updates now follow into an untouched draft (B13/B14).**
   Publishing seals the *draft* row, so a fix applied to an already-published version
   never reached the next release: the next draft was cloned before the fix and is what
   the next publish seals. The fix is carried into the draft inside the same
   transaction, but only while the draft still holds exactly the vocabulary it
   inherited (compared by module, question position and the four printed fields,
   because clone regenerates question ids). A draft with its own words wins and is left
   untouched, and the receipt reports which happened via `draftUpdated`.
2. **Is "latest published" the right default on the draft workspace? (B1)** It is right
   for the published receipt. On the draft screen the author is mid-build and may expect
   the draft. Current behaviour is deliberate per the release notes; I am flagging it
   because it is the one place where the menu's default can surprise.
3. **Two doorways (A6).** Settings keeps an `Import Vocabulary Excel` button and now the
   header has the same action with a different default. Options: keep both with clear
   labels, or make Settings link to the header action. Either is fine; the labels should
   not imply different capabilities, because they do not.

## 7. Execution log — 28 Nov 2026

Build `da5bf2b8` plus the QA additions in this change (three workspace tests, two
assertions, one focused Playwright config).

**Environment.** macOS/arm64, disposable MySQL 8.4.9 on `127.0.0.1:3407` with a
temp data directory, migrations `0001`–`0134` applied from empty, Chromium via
Playwright, Vite dev frontend, Go API. The pre-existing Homebrew MySQL data
directory on this machine is corrupt (`ibdata1`, OS error 71) and was left
untouched; a throwaway instance was used instead.

### Executed

| Case group | Status | Evidence |
| --- | --- | --- |
| A1, A2, A3, A4, A5 | PASS | `AuthoringWorkspace.test.tsx` — menu order, published-receipt menu, no draft on published import, IELTS exclusion, Import hidden for non-editing roles |
| B1, B3, B4 | PASS | Version select holds the newest published id; `Editable draft` absent when no draft exists; whole control absent on draft-only exams |
| B5 | PASS | Switching target clears file, review, error and primary action; hint reverts to draft copy |
| B7 (UI half) | PASS | Notice reads `Version N updated…`; draft shell is not invalidated for a version commit |
| B10 | PASS | Cell-level `Question 25 is missing… Valid numbers for this module are 1–20.` with no primary action, and the preview request carries the published version id |
| C1, C3, C7, D1, D2, D3 | PASS | Playwright run: template downloaded from the sheet, deliberate cell error surfaced, corrected upload replaced the vault, notice shown |
| G1, G4, G6, G8 | PASS | Same schedule re-downloaded after a published-vault commit; appendix gained the revised word and lost the obsolete one; Thai glyphs, `From Question 01`, answer key off |
| J4 | PASS | A question that cannot flush keeps the importer shut and never fetches vault status |
| K1, K2 | PASS | Exam-workbook import and room creation ran in the same session with no interference |
| C4–C18, D4–D6, E2, E4, H1–H4 (server) | PASS | `go test ./internal/authoring ./internal/satpublish ./internal/exams ./internal/authz ./internal/answeredpdf ./cmd/migrate` |

Playwright command and result:

```sh
TEST_DATABASE_URL=mysql://…/sat_vault_qa AUTH_SECRET=… \
  bunx playwright test --config playwright.sat-word-vault.config.ts \
  --project=chromium -g "Word Vault"
# 1 passed (2.0m)
```

Server log confirmed the new path end to end:
`GET …/sat-word-vault` → `…/template` → `POST …/preview` → `POST …/commit`, then a
second `POST /sat-answered-pdf/…/prepare` for the **same** schedule.

Vitest: `AuthoringWorkspace.test.tsx` 38/38. Go: `satpublish`, `exams`, `authz`,
`answeredpdf`, `cmd/migrate` all `ok`.

### Not executed — deferred, not passed

| Case | Why deferred |
| --- | --- |
| B6, B8, B9, B11, B12 | Read-only UI assertions; covered by inspection of the committed component, not by a run |
| E1, E3, E5 | Need two concurrent sessions; the MySQL integration tests cover the server fence, not the double-click |
| F1, F2, F3, F5 | Need direct API calls as observer/other-tenant; not exercised in this pass |
| G2, G3, G5, G7, G9 | Need a second PDF scenario (draft-only edit, empty vault, page furniture) |
| I1–I7 | Needs a real browser a11y pass (Safari + Firefox) |

### B13 fix — verified after the log above

| Check | Result |
| --- | --- |
| `go test ./internal/authoring -run 'TestWordVaultPublishedFixCarriesIntoDraftMySQL\|TestWordVaultVersionLifecycleMySQL'` | PASS — carry into an untouched draft, skip when the draft diverged, skip when no draft exists; the pre-existing lifecycle test still asserts a diverged draft is never touched |
| `AuthoringWorkspace.test.tsx` | 39/39 — new case asserts the carry clause in the success notice |
| `playwright … -g "Word Vault"` | 1 passed (2.5m) — the shipped flow is unchanged: after a room is created there is no draft, so no carry and the notice keeps its shorter form |
| `go test ./internal/authoring` | only the pre-existing `TestOpenShellClonePreservesFlexibleFlagAndPlan` failure remains |

### Findings raised by this pass

1. **B13 was a real defect** and is fixed above: a published-only vocabulary fix used
   to be reverted by the next publish, silently.
2. **The base Playwright config makes this spec fail for the wrong reason.** With
   `playwright.config.ts` the sitting step fails at 5 s against a cold Vite server
   (`Workbook question 1` not found) before the import is reached. `expect.timeout`
   is unset there, so it inherits 5 s. The focused config raises it to 20 s and
   wires `FRONTEND_DIST_DIR` / `ANSWEREDPDF_DIST` so the PDF branch runs at all.
   Anyone re-running the Word Vault spec with the default config will see a
   false failure.
3. **Five tests are red at the release base `be6eae11`**, reproduced on a fresh
   database in a separate worktree: four in `cmd/api`
   (`TestIELTSRowFirstEquivalenceMySQL`, `TestSATFlexibleCreateIdempotencyMySQL`,
   `TestSATFlexibleSubmitRetrySingleTerminalMySQL`,
   `TestSATFlexiblePracticeScheduleRefusedMySQL`) and one in `internal/authoring`
   (`TestOpenShellClonePreservesFlexibleFlagAndPlan`). None touch the Word Vault,
   but "full Go suite green" is not currently claimable by anyone.

## 8. Exit criteria

- All P0 cases pass on Env A.
- No open P1 without a signed-off workaround.
- Every P1 case that touches a *write* has been run at least once against real MySQL,
  not a mock.
- One end-to-end pass on Chromium with the built SPA served by Go (Playwright), and one
  manual pass in Safari + Firefox for the dialog focus behaviour.
- The PDF cases checked by extracting text, not by eyeballing the download.

## 9. Out of scope

- Staff/administrator PDF exports (v1 excludes them by design).
- The account-specific Classroom download lane, which lives in unpublished work; it must
  be re-pointed at the same payload loader when merged.
- Bulk vocabulary editing outside the workbook, translation quality, and the content of
  the AI prompt sheet.
