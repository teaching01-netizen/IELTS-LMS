# SAT RAWDATA XLSX — `SAT Forms` sheet (low-level implementation plan)

Status: implemented (2026-11-01). Source, tests, and the §8.6 verification
commands are in the working tree; the opt-in MySQL integration suite also
passes against an isolated migrated MySQL 9.6 instance.
Scope owner: `backend/go/internal/results` (+ one exported helper in
`backend/go/internal/assessmentforms`).

---

## 1. Change boundary & repository evidence

### 1.1 Current behaviour (Verified)

| Fact | Evidence |
|---|---|
| The export is server-side, `excelize`, two sheets, fixed 50 columns | `backend/go/internal/results/sat_rawdata_xlsx.go` L13-76; `sat_rawdata_schema.go` L23-29 |
| Sheet order is hard-required (`SAT Math`, `SAT Verbal`) | `sat_rawdata_xlsx.go` L17-19 |
| Every row is validated against `SATRawdataColumns` (50) | `sat_rawdata_schema.go` L214-244 |
| Handler allows admin / admin_observer / grader / proctor | `backend/go/cmd/api/handlers_grading.go` L1285-1329 |
| Frontend auth for `/sat/results` = `admin, grader, proctor` | `src/app/router/createRouter.tsx` L414-420 |
| Frontend auth for `/sat/forms` = `admin, proctor` | `src/app/router/createRouter.tsx` L421-427 |
| Form responses are per attempt: `(attempt_id, form_key)` | `migrations/0101_assessment_forms.sql` L8-23, widened by `0104_sat_section_entry_forms.sql` |
| Form definitions are a per-version snapshot `config_snapshot.forms` | `assessmentforms/definition/definition.go` L19, L111-116, L363-382 |
| Field = `{id, type, label, scope, options}`; 4 form keys; ≤50 fields/form | `definition.go` L24-29, L44-50, L61, L78-90 |
| Stored answers: field ID → `string` or `float64`; single_choice stores the **option ID** | `definition/answers.go` L12-14, L106-119 |
| Status vocabulary already exists and is derived in SQL | `assessmentforms/list.go` L17-23, L71-100 |
| `exam_schedules.published_version_id` is updatable → a room can mix pinned versions | `schedules/service.go` L662; attempts snapshot it at creation L1444 |
| `assessment_access_links` is `UNIQUE(schedule_id)` → the LEFT JOIN cannot fan out rows | `migrations/0034_assessment_access_links.sql` L18 |
| `results` may import `assessmentforms`; no cycle | `go list -deps ./internal/assessmentforms` contains no `internal/results` |

### 1.2 Desired behaviour

Add a third worksheet `SAT Forms` to the same workbook, containing one row per
attempt, with the union of the four forms' fields, four status columns, `wcode`
and `attempt_id`. Admin / admin_observer / proctor receive it; **grader does
not**. The two existing sheets, the JSON top-level shape, the endpoint, the
filename, and the UI are unchanged.

### 1.3 Non-goals

- No change to `SAT Math` / `SAT Verbal` columns, values, ordering, or formatting.
- No student-facing surface, no new endpoint, no new UI control.
- No change to how forms are authored, validated, or submitted.
- No new tables/migrations.
- No CSV/other export formats.

---

## 2. Requirements & invariants

### FR-1 — Third sheet exists for permitted roles
`ExportSATRawdata` appends a `SAT Forms` sheet when the actor's role is
`admin`, `admin_observer`, or `proctor`, **and** at least one form field column
is resolvable. Otherwise the workbook keeps exactly two sheets (grader, and
rooms with no forms configured).

### FR-2 — One row per attempt
Row set = every `student_attempts` row for `(examId, scheduleId)` in the
caller's scope, including attempts with no form responses, ordered
`COALESCE(a.submitted_at, a.created_at) ASC, a.id ASC` (identical to the
rawdata sheets). Never one row per module.

### FR-3 — Column plan
Fixed order: identity block → registration fields → verbal-entry fields →
math-entry fields → Eva fields → status block → `attempt_id`.
Columns are the union across versions present, anchored on the schedule's
pinned version:

1. fields of `exam_schedules.published_version_id` first, in definition order;
2. then fields unique to other versions present in the room, versions ordered
   by `version_number ASC, id ASC`, each in definition order.

Duplicate field IDs collapse to the first occurrence (pinned version wins the
label).

### FR-4 — Two-row header
Row 1 = machine name (`cm_user_id`, `wcode`, `candidate_name`, `email`,
`version`, `reg.sat_seat_number`, `status.registration`, `attempt_id`, …).
Row 2 = human label (`Registration · Seat number`, `Registration status`, …).
Both frozen at `A3`, same `YSplit: 2` pane as the other sheets.

### FR-5 — Value rendering
- `text` → inline string (formula-injection safe, same policy as rawdata).
- `number` → numeric cell (`int`-looking values written as integers).
- `single_choice` → the option **label from that attempt's pinned version**;
  raw option ID if the label cannot be resolved.
- unanswered / no response row → empty cell. Empty never means "incorrect".

### FR-6 — Status columns
Four columns reusing the existing vocabulary verbatim: `submitted`,
`not_submitted`, `pending_completion`, `pending_section`, `not_applicable`,
`not_tracked`. Values come from the same SQL expression the `/sat/forms`
screen uses — not a second implementation.

### FR-7 — Contract
`SATRawdataSchemaVersion` = **3**. Top-level `headerRows` / `rows` /
`columnCount` / `rowCount` continue to describe the 50-column rawdata
projection only. The forms sheet appears only in `sheets[]`.

### ERR-1 — Malformed stored forms
A pinned version whose `config_snapshot.forms` is present but unparseable fails
the whole export with `INVALID_ASSESSMENT` (422) naming the version, rather
than emitting blank columns. Absent forms (`null`/missing key) is legacy and
yields no columns.

### ERR-2 — Malformed stored answers
A row whose `assessment_form_responses.answers` is not decodable fails the
export with `INTERNAL`. Silently blanking would misreport a candidate.

### INV-1 — Rawdata immutability
For the same DB snapshot, `SAT Math` and `SAT Verbal` cells are byte-identical
to the pre-change exporter. Verified by the existing golden tests, which must
pass unmodified except for the schema-version constant.

### INV-2 — Single source of status semantics
No status string is derived outside `assessmentforms.statusSQL`. If the
expression changes, both surfaces change together.

### INV-3 — Read-only snapshot
All reads (existing three + new four) run in the same
`LevelRepeatableRead` read-only transaction, so the forms sheet describes the
same committed instant as the score sheets.

---

## 3. Entities, ownership & relationships

| Unit | Responsibility | State | Owner of the rule |
|---|---|---|---|
| `SATRawdataSheet` (existing, extended) | One worksheet projection | name, header rows, rows, width, numeric column set | `internal/results` |
| `satFormAttempt` (new) | One attempt's identity + four derived statuses | ids, wcode, name, email, version, status map | `internal/results` |
| `satFormFieldColumn` (new) | One exported question column | form key, `definition.Field`, header cells, numeric flag | `internal/results` |
| `definition.Forms` (existing) | Per-version form vocabulary | fields per form key | `internal/assessmentforms/definition` |
| status expression (existing) | Derived form status | SQL CASE | `internal/assessmentforms` (exported read-only accessor) |

No new persisted state. No new table. `assessment_form_responses` remains the
only source of answers; `exam_versions.config_snapshot.forms` the only source
of labels and options.

---

## 4. Function-level design

### 4.1 `backend/go/internal/assessmentforms/list.go` (modified)

```go
// StatusSQL returns the derived status CASE expression for one form key,
// bound to the assessment_form_responses join aliased respAlias.
//
// The caller must supply these aliases/joins in its FROM clause:
//   student_attempts a, exam_schedules s, exam_versions v,
//   LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id,
//   LEFT JOIN assessment_form_responses <respAlias>
//          ON <respAlias>.attempt_id = a.id AND <respAlias>.form_key = '<key>'
func StatusSQL(formKey, respAlias string) (string, error)
```

- Validation: alias must match `^[a-z][a-z0-9_]{0,31}$`; form key must be one of
  the four `definition.Form*` constants. Anything else is an error — callers
  must not be able to inject SQL or silently receive the Eva branch.
- Implementation: `strings.ReplaceAll(statusSQL(formKey), "r.attempt_id", respAlias+".attempt_id")`.
  The expression contains exactly one `r.` identifier (`r.attempt_id`) in every
  branch (Verified, `list.go` L81-100), so the substitution is total.
- `statusSQL(formKey string) string` stays as a private wrapper returning
  `statusSQLFor(formKey, "r")` so `rowQuery` is untouched.
- No behaviour change for `/sat/forms`.

### 4.2 `backend/go/internal/results/sat_rawdata_export.go` (modified)

`SATRawdataSheet` gains two optional fields:

```go
type SATRawdataSheet struct {
	Name           string     `json:"name"`
	SectionKey     string     `json:"sectionKey"`
	HeaderRows     [][]string `json:"headerRows"`
	Rows           [][]string `json:"rows"`
	ColumnCount    int        `json:"columnCount,omitempty"`    // 0 => SATRawdataColumns
	NumericColumns []int      `json:"numericColumns,omitempty"` // 0-based; empty => rawdata rule
}
```

`ExportSATRawdata` (signature unchanged) gains, after the existing cell query
and **before** `tx.Commit()`:

```go
if satFormsVisibleTo(actor) {
	formAttempts, err := satFormAttempts(ctx, tx, actor, examID, scheduleID)
	formDefs, err := satFormDefinitions(ctx, tx, versionIDsOf(formAttempts, pinnedID))
	responses, err := satFormResponses(ctx, tx, actor, examID, scheduleID)
	sheet, ok, err := assembleSATForms(formAttempts, formDefs, pinnedID, responses)
	if ok { out.Sheets = append(out.Sheets, sheet) }
}
```

`pinnedID` is read by `satFormPinnedVersion(ctx, tx, actor, scheduleID)` and used
only for column ordering; failure to find it is not fatal (fall back to the
attempts' versions).

```go
func satFormsVisibleTo(actor auth.ActorContext) bool {
	switch actor.Role {
	case auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor:
		return true
	}
	return false
}
```

Validation switches from “all sheets are 50 wide” to per-sheet width
(`validateSATSheet`), keeping `validateSATRawdataHeaders/Rows` intact because
`sat_rawdata_schema_test.go` exercises them directly.

### 4.3 `backend/go/internal/results/sat_form_export.go` (new)

```go
const SATFormsSheetName = "SAT Forms"

var satFormKeys = []string{
	definition.FormRegistration,
	definition.FormVerbalEntry,
	definition.FormMathEntry,
	definition.FormEvaSim,
}

var satFormPrefix = map[string]string{
	definition.FormRegistration: "reg",
	definition.FormVerbalEntry:  "verbal",
	definition.FormMathEntry:    "math",
	definition.FormEvaSim:       "eva",
}

var satFormLabel = map[string]string{
	definition.FormRegistration: "Registration",
	definition.FormVerbalEntry:  "Verbal entry",
	definition.FormMathEntry:    "Math entry",
	definition.FormEvaSim:       "Eva SIM",
}

const (
	satFormsColCandidateID = 0 // cm_user_id
	satFormsColWcode       = 1
	satFormsColName        = 2
	satFormsColEmail       = 3
	satFormsColVersion     = 4
)

type satFormAttempt struct {
	AttemptID     string
	CandidateID   string
	Wcode         string
	CandidateName string
	Email         string
	VersionID     string
	VersionNumber int
	Status        map[string]string // form key -> derived status
}

type satFormFieldColumn struct {
	FormKey  string
	Field    definition.Field
	HeaderID string // row 1: "reg.sat_seat_number"
	Header   string // row 2: "Registration · Seat number"
	Numeric  bool
}
```

#### Loaders

```go
func satFormAttempts(ctx, tx, actor, examID, scheduleID) ([]satFormAttempt, error)
func satFormPinnedVersion(ctx, tx, actor, scheduleID) (string, error)
func satFormDefinitions(ctx, tx, versionIDs []string) (map[string]*definition.Forms, error)
func satFormResponses(ctx, tx, actor, examID, scheduleID) (map[string]map[string]definition.Answers, error)
```

`satFormAttempts` SQL (statuses interpolated from `assessmentforms.StatusSQL`):

```sql
SELECT a.id, COALESCE(a.candidate_id, ''), COALESCE(a.wcode, ''),
       COALESCE(a.candidate_name, ''), a.candidate_email,
       a.published_version_id, v.version_number,
       (<status registration / r_reg>),
       (<status verbal_entry  / r_verbal>),
       (<status math_entry    / r_math>),
       (<status eva_sim       / r_eva>)
FROM student_attempts a
JOIN exam_schedules s ON s.id = a.schedule_id
JOIN exam_versions v ON v.id = a.published_version_id
JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id
LEFT JOIN assessment_form_responses r_reg
       ON r_reg.attempt_id = a.id AND r_reg.form_key = 'registration'
LEFT JOIN assessment_form_responses r_verbal
       ON r_verbal.attempt_id = a.id AND r_verbal.form_key = 'verbal_entry'
LEFT JOIN assessment_form_responses r_math
       ON r_math.attempt_id = a.id AND r_math.form_key = 'math_entry'
LEFT JOIN assessment_form_responses r_eva
       ON r_eva.attempt_id = a.id AND r_eva.form_key = 'eva_sim'
WHERE a.exam_id = ? AND a.schedule_id = ?<resultScope("sch", actor)>
ORDER BY COALESCE(a.submitted_at, a.created_at) ASC, a.id ASC
```

`satFormDefinitions`:

```sql
SELECT id, version_number, CAST(config_snapshot AS CHAR)
FROM exam_versions WHERE id IN (?,?,…)
```

Each value goes through `definition.FromSnapshot`; a non-nil error returns
`apperrors.New(apperrors.CodeInvalidAssessment, "Version <id> has invalid form settings; fix the version before exporting.")`.
Absent forms yields `nil` in the map entry (legacy, no columns).

`satFormResponses`:

```sql
SELECT r.attempt_id, r.form_key, CAST(r.answers AS CHAR)
FROM assessment_form_responses r
JOIN student_attempts a ON a.id = r.attempt_id
WHERE a.exam_id = ? AND a.schedule_id = ?<resultScope("sch", actor)>
```

`json.Unmarshal` into `definition.Answers`; failure aborts the export (ERR-2).

#### Column plan

```go
func satFormColumns(pinnedVersionID string, defs map[string]*definition.Forms,
	attempts []satFormAttempt) []satFormFieldColumn
```

1. `ordered := pinned (if present in defs)` ++ other version IDs sorted by
   `(VersionNumber, ID)` ascending.
2. For each `formKey` in `satFormKeys`, for each version in `ordered`:
   - `fieldsForVersion(forms, formKey)` returns:
     - registration → `forms.Registration.Fields` (all scopes; scope only
       decides applicability, never column existence);
     - verbal_entry → `forms.SectionEntry["reading-writing"].Fields` when
       `forms.SchemaVersion == definition.SchemaVersionSections`, else nil;
     - math_entry → same for `"math"`;
     - eva_sim → `forms.EvaSim.Fields` when `forms.EvaSim.Mode == definition.ModeNative`
       and `len(Fields) > 0`, else nil (embed exports no columns).
   - Deduplicate by `Field.ID` within the form key (`seen` map); the first
     definition wins, including its label and options.
3. Emit `satFormFieldColumn{HeaderID: prefix + "." + Field.ID,
   Header: satFormLabel[formKey] + " · " + Field.Label, Numeric: Field.Type == definition.TypeNumber}`.

Deliberate asymmetry (documented in code): `SectionFields()` is **not** reused
because it returns nil when a section form is disabled; the export must keep
columns for answers captured by an earlier, now-superseded version. Published
snapshots are immutable (`definition.go` L418), so the only drift source is a
different version.

#### Sheet assembly

```go
func assembleSATForms(attempts []satFormAttempt, defs map[string]*definition.Forms,
	pinnedVersionID string, responses map[string]map[string]definition.Answers) (SATRawdataSheet, bool, error)
```

- `columns := satFormColumns(...)`; if `len(columns) == 0` return `ok=false`
  (FR-1: no forms configured → no sheet).
- Header row 1 = identity IDs ++ `columns[i].HeaderID` ++ `status.<formKey>` ++ `attempt_id`.
- Header row 2 = identity labels ++ `columns[i].Header` ++ `<Form> status` ++ `attempt_id`.
- For each attempt, row = identity ++ `satFormValue(columns[i].Field, responses[attempt.ID][columns[i].FormKey])` ++ statuses ++ attempt id.
- `ColumnCount = len(header1)`, `NumericColumns` = indices where `Numeric`.

```go
func satFormValue(field definition.Field, answers definition.Answers) string {
	v, ok := answers[field.ID]
	if !ok || v == nil {
		return ""
	}
	switch field.Type {
	case definition.TypeText:
		s, _ := v.(string)
		return s
	case definition.TypeNumber:
		f, ok := v.(float64)
		if !ok { return "" }
		return strconv.FormatFloat(f, 'f', -1, 64)
	case definition.TypeSingleChoice:
		id, _ := v.(string)
		for _, opt := range field.Options {
			if opt.ID == id { return opt.Label }
		}
		return id // unpinned/removed option: raw ID, never a blank
	}
	return ""
}
```

### 4.4 `backend/go/internal/results/sat_rawdata_xlsx.go` (modified)

```go
func BuildSATRawdataXLSX(export *SATRawdataExport) ([]byte, error)
```

- Require `len(Sheets) >= 2`, `Sheets[0].Name == "SAT Math"`,
  `Sheets[1].Name == "SAT Verbal"`, and any further sheet must be the last and
  named `SAT Forms`. Anything else fails (keeps the current fail-loud posture).
- Create sheet 0 by renaming `Sheet1`, then `NewSheet` for the rest.
- Per-sheet numeric predicate:

```go
func (s SATRawdataSheet) isNumericColumn(i int) bool {
	if len(s.NumericColumns) > 0 {
		return slices.Contains(s.NumericColumns, i) // or a map lookup
	}
	return isSATRawdataNumericColumn(i)
}
```

- `writeSATRawdataWorkbookRow` takes the numeric predicate (or the sheet) as a
  parameter; the rawdata path keeps `isSATRawdataNumericColumn`, so INV-1 holds.
- Integer-looking numbers are written as `int` (existing `strconv.Atoi` branch
  already does this); other floats stay `float64`.

### 4.5 `backend/go/cmd/api/handlers_grading.go` — no functional change

The handler already passes the actor. `Content-Disposition` stays
`sat-rawdata.xlsx`; no query parameter is added.

### 4.6 Frontend — no change

`downloadSatRawdataXlsx` (`src/features/results/api/satRawdataExport.ts`) only
consumes a blob; the third sheet needs no client work.

---

## 5. Algorithm & control flow (happy path)

```
ExportSATRawdata(actor=admin)
 1. BeginTx(RepeatableRead, ReadOnly)
 2. attempts  := satRawdataAttempts(...)          // unchanged
 3. modules   := satRawdataModules(...)           // unchanged
 4. cells     := satRawdataCells(...)             // unchanged
 5. out       := assembleSATRawdata(...)          // unchanged, 2 sheets
 6. pinned    := satFormPinnedVersion(...)        // schedule pin
 7. fAttempts := satFormAttempts(...)             // statuses via StatusSQL
 8. defs      := satFormDefinitions(versionIDs)   // parse each snapshot
 9. responses := satFormResponses(...)            // answers by (attempt, key)
10. sheet, ok := assembleSATForms(...)
11. if ok { out.Sheets = append(out.Sheets, sheet) }
12. validateSATSheet(each sheet)                  // width per sheet
13. Commit; return out
```

Handler then calls `BuildSATRawdataXLSX`, which writes 2 or 3 sheets and returns
the bytes. Nothing about the HTTP path, headers, or rate limiting changes.

### Failure branches

| Condition | Behaviour | Enforcement point |
|---|---|---|
| `examId`/`scheduleId` empty | 422 (unchanged) | `ExportSATRawdata` L112-116 |
| Actor role = grader | forms queries skipped entirely; 2 sheets | `satFormsVisibleTo` |
| No form fields across pinned + present versions | sheet omitted; 2 sheets | `assembleSATForms` `ok=false` |
| Version snapshot malformed | `INVALID_ASSESSMENT` 422 naming the version | `satFormDefinitions` |
| Stored answers undecodable | `INTERNAL` 500 | `satFormResponses` |
| Schedule pin missing / not in defs | column order falls back to attempts' versions | `satFormColumns` |
| Attempt has no responses | row present, field cells blank, statuses explain why | `assembleSATForms` |
| Eva embed | no Eva field columns; `status.eva_sim = not_tracked` | `fieldsForVersion` + `StatusSQL` |
| Duplicate field ID across versions | first (pinned) definition wins | `satFormColumns` dedupe |
| Unknown section form schema v1 | no section-entry columns | `fieldsForVersion` |

---

## 6. Implementation sequence

1. `internal/assessmentforms/list.go` — extract `statusSQLFor(formKey, alias)`,
   add exported `StatusSQL`, keep `statusSQL` as a wrapper. Run
   `go test ./internal/assessmentforms/...` (must be green, untouched expectations).
2. `internal/results/sat_rawdata_schema.go` — bump
   `SATRawdataSchemaVersion = 3`; add `validateSATSheet` (per-sheet width) and
   keep the 50-wide validators.
3. `internal/results/sat_rawdata_export.go` — add `ColumnCount` /
   `NumericColumns` to `SATRawdataSheet`; call `validateSATSheet`; append the
   forms sheet when permitted.
4. `internal/results/sat_form_export.go` (new) — loaders, column plan,
   `satFormValue`, `assembleSATForms`.
5. `internal/results/sat_rawdata_xlsx.go` — accept 2-or-3 sheets, per-sheet
   numeric predicate, unchanged rawdata formatting.
6. Tests (§8). No handler or frontend edits.
7. `cd backend/go && go build ./... && go vet ./... && go test ./...`.

Dependency order matters: step 1 before 4 (compile), step 2 before 5
(validation), step 3 after 4 (call site).

---

## 7. Worked trace

Fixtures: room pinned to **v2**; v3 was published mid-room.

- v2 forms: registration `[seat_number, expected_class]`, verbal entry `[vwpm]`,
  math entry `[]`, eva disabled.
- v3 forms: registration `[seat_number, expected_class, admission_year]`,
  verbal entry `[vwpm]`, math entry `[]`, eva native `[eva_rating]`.

Attempts: `A1` (v2, registration submitted `{seat_number:"A-007", expected_class:"rank_1"}`),
`A2` (v3, registration submitted `{seat_number:"B-102", admission_year:2027}`),
`A3` (v2, no responses).

Column plan (`ordered` = [v2, v3]):

| # | row 1 | row 2 |
|---|---|---|
| 0 | `cm_user_id` | cm_user_id |
| 1 | `wcode` | wcode |
| 2 | `candidate_name` | Candidate name |
| 3 | `email` | email |
| 4 | `version` | Version |
| 5 | `reg.seat_number` | Registration · Seat number |
| 6 | `reg.expected_class` | Registration · Expected Class |
| 7 | `reg.admission_year` | Registration · Admission year (ค.ศ.) |
| 8 | `verbal.vwpm` | Verbal entry · … |
| 9 | `eva.eva_rating` | Eva SIM · … |
| 10 | `status.registration` | Registration status |
| 11 | `status.verbal_entry` | Verbal entry status |
| 12 | `status.math_entry` | Math entry status |
| 13 | `status.eva_sim` | Eva SIM status |
| 14 | `attempt_id` | attempt_id |

`admission_year` (v3-only) and `eva_rating` (v3-only) are appended **after** the
pinned version's columns; `attempt_id` is last.

Rows:

| cm_user_id | wcode | … | version | seat_number | expected_class | admission_year | … | reg.status | … |
|---|---|---|---|---|---|---|---|---|---|
| C1 | W123456 | … | 2 | A-007 | Rank 1 | *(blank)* | … | submitted | … |
| C2 | W123457 | … | 3 | B-102 | *(blank)* | 2027 | … | submitted | … |
| C3 | W123458 | … | 2 | *(blank)* | *(blank)* | *(blank)* | … | not_submitted | … |

Post-conditions: `SAT Math`/`SAT Verbal` cells unchanged (INV-1);
`schemaVersion == 3`; `sheets` length 2 for a grader request and 3 for admin
(FR-1, FR-7); `status.*` values came from `assessmentforms.StatusSQL` (INV-2);
all reads inside one transaction (INV-3).

---

## 8. Verification

### 8.1 New unit tests — `internal/results/sat_form_export_test.go`

| Test | Asserts |
|---|---|
| `TestSATFormColumnsPinnedVersionFirstThenExtras` | pinned fields first, v3-only fields appended, deterministic order, dedupe by ID |
| `TestSATFormColumnsSkipSectionFormsBeforeSchemaV2` | v1 snapshot yields no verbal/math columns |
| `TestSATFormColumnsEvaEmbedAddsNoColumns` | embed mode → zero `eva.*` columns |
| `TestSATFormValueRendersLabelsNumbersAndRawFallback` | option label, integer formatting, unknown option ID fallback, wrong-type → blank |
| `TestAssembleSATFormsOmitsSheetWithoutForms` | `ok == false`, no sheet |
| `TestAssembleSATFormsRowPerAttemptNotPerModule` | two modules, one attempt → one row |

### 8.2 SQL-mocked service tests — extend `sat_rawdata_export_test.go`

- admin: expects the three rawdata queries **plus**
  `satFormAttempts` / `satFormPinnedVersion` / `satFormDefinitions` / `satFormResponses`
  in order; asserts 3 sheets, `wcode` snapshot, four statuses passed through.
- grader: expects **only** the three rawdata queries; asserts 2 sheets.
- malformed snapshot → `INVALID_ASSESSMENT`.
- malformed answers JSON → `INTERNAL`.
- Proctor scope: `resultScope` args present on the new queries (same as existing).

### 8.3 Workbook tests — extend `sat_rawdata_xlsx_test.go`

- three-sheet workbook: `["SAT Math","SAT Verbal","SAT Forms"]`.
- forms sheet headers match row 1 / row 2 exactly.
- `number` field → numeric cell (`excelize.CellTypeUnset`); `text` field →
  `CellTypeInlineString`; a `=HYPERLINK(...)` text answer has no formula.
- freeze panes `YSplit == 2` on the third sheet.
- second sheet missing → `BuildSATRawdataXLSX` errors (negative case).
- **regression**: two-sheet export still produces byte-identical rawdata
  contents (existing assertions unchanged).

### 8.4 Handler tests — extend `cmd/api/sat_rawdata_export_handler_test.go`

- `expectEmptySATRawdataQueries` gains the four form queries for admin.
- grader variant expects three queries and a 2-sheet workbook.
- JSON path: `schemaVersion == 3`, top-level width stays 50, `sheets` length
  follows the role.

### 8.5 Integration — extend `integration/sat_rawdata_export_test.go`

Seed a registration response and a section-entry response; assert on real
MySQL:
- workbook has `SAT Forms` with the seeded labels and values;
- `status.registration == "submitted"`, `status.math_entry == "not_applicable"`
  for a verbal-only sitting;
- `wcode` equals the seeded registration code.

### 8.6 End-to-end

Two end-to-end layers complement the service-level suite:

- `cmd/api/sat_forms_export_e2e_mysql_test.go` (TEST_MYSQL_DSN) drives the
  production router over HTTP with real cookie sessions, the real role gate and
  result scope, real MySQL, and the real export transaction; it asserts the
  JSON contract, the downloaded workbook cells/types/freeze panes, the
  admin/grader/proctor/unassigned/builder/anonymous matrix, and the 422/500
  failure envelopes.
- `e2e/sat-staff-results-ux.spec.ts` (Playwright, `playwright.sat-staff-ux.config.ts`)
  exercises the staff room UI: the export button requests
  `/api/v1/results/sat/export/rawdata?...&format=xlsx` and downloads the
  workbook under the room-derived filename.

### 8.7 Commands

```bash
cd backend/go
go build ./...
go vet ./...
go test ./internal/results/... ./internal/assessmentforms/... ./cmd/api/...
TEST_MYSQL_DSN=... go test ./integration/ -run TestSATRawdata
TEST_MYSQL_DSN=... go test ./cmd/api/ -run TestSATFormsExportE2E
```

```bash
bun run typecheck
bunx playwright test --config playwright.sat-staff-ux.config.ts
```

Coverage gate: every FR/RULE/ERR above maps to at least one of the tests in
8.1-8.5; INV-1 is covered by the untouched rawdata assertions, INV-2 by a test
that mutates the shared expression in one place and observes both surfaces
(sanity check, not a permanent test), INV-3 by the single `ExpectBegin`/`ExpectCommit`.

---

## 9. Extensibility & remaining risks

### 9.1 Extension probe — a fifth form key
Add the key to `satFormKeys`, `satFormPrefix`, `satFormLabel`, add its field
source to `fieldsForVersion`, and extend `normalizeFormKey`/`StatusSQL` in
`assessmentforms`. Column layout, workbook writer, and handler stay untouched.
That is the intended modification point; no current code needs generalising
beyond it.

### 9.2 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `results` now depends on `assessmentforms` (which depends on `exams`, `lifecycle`, `tx`) | Low | No cycle verified; dependency points “up” from a report to the owning domain |
| Status SQL is coupled to caller aliases (`a,s,v,l`) | Medium | Documented in `StatusSQL`; alias validated; add the mutation test in 8.5 if it ever bites |
| A room with several versions produces a wide union | Low | 50 fields × 4 forms worst case; document that headers are per-room, not global |
| Grader and admin receive different content under the same filename | Accepted (decision A) | Documented in this plan and in the handler comment; no client relies on sheet count |
| Malformed legacy snapshot blocks the export | Medium | Fails loudly by design (ERR-1); message names the version number so staff can fix it |
| `admin_observer` has no UI route but backend access | Low | Pre-existing; forms sheet follows backend roles |

### 9.3 Unknowns

- Whether any external consumer parses `sheets[]` today (Unknown; the only
  references are tests and the frontend blob download). `schemaVersion` bump is
  the intended signal if one exists.
- Real-world prevalence of mixed-version rooms (Unknown; the code path makes it
  possible, tests will pin the behaviour either way).
