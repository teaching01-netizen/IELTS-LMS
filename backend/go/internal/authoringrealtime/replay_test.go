package authoringrealtime

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func replayDB(t *testing.T) (replayQuerier, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, mock
}

func replayPayload(t *testing.T, cursor int64, examID, draftID string) []byte {
	t.Helper()
	evt, err := NewEvent(EventInput{
		Kind:           KindQuestionChanged,
		ExamID:         examID,
		DraftVersionID: draftID,
		DraftRevision:  10,
		ActorID:        "actor-1",
		Entity:         Entity{Kind: EntityQuestion, ExamQuestionID: "eq-1"},
		EventID:        "evt-" + string(rune('a'+cursor%26)),
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(evt)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func replayRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"sequence_id", "origin_instance_id", "event_name", "event_revision", "payload"})
}

// TestReplaySQLIsExamScopedAndBarrierBounded pins the query shape: the exam is
// the indexed target column, the draft is NOT a transport predicate (it could
// never replay the draft.replaced row that invalidates a stale subscriber), and
// the upper bound is inclusive so replay and live partition the stream.
func TestReplaySQLIsExamScopedAndBarrierBounded(t *testing.T) {
	for _, fragment := range []string{
		"FROM live_update_events",
		"event_kind = ?",
		"event_target_id = ?",
		"sequence_id > ?",
		"sequence_id <= ?",
		"ORDER BY sequence_id ASC",
		"LIMIT ?",
	} {
		if !contains(ReplaySQL, fragment) {
			t.Fatalf("ReplaySQL must contain %q: %s", fragment, ReplaySQL)
		}
	}
	for _, forbidden := range []string{"JSON_EXTRACT", "draftVersionId"} {
		if contains(ReplaySQL, forbidden) {
			t.Fatalf("ReplaySQL must not filter on %q on the hot path: %s", forbidden, ReplaySQL)
		}
	}
}

func TestLoadHistoryReturnsOrderedRows(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(5), int64(20), 201).
		WillReturnRows(replayRows().
			AddRow(6, "peer-1", string(KindQuestionChanged), 10, string(replayPayload(t, 6, "exam-1", "draft-7"))).
			AddRow(7, "peer-1", string(KindQuestionChanged), 11, string(replayPayload(t, 7, "exam-1", "draft-7"))))
	rows, truncated, err := LoadHistory(context.Background(), db, "exam-1", 5, 20, 200)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("two rows must not be reported as truncated")
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if rows[0].Cursor != 6 || rows[1].Cursor != 7 {
		t.Fatalf("rows must be cursor-ordered: %+v", rows)
	}
}

func TestLoadHistoryEmptyIsNotAnError(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(99), int64(120), 201).
		WillReturnRows(replayRows())
	rows, truncated, err := LoadHistory(context.Background(), db, "exam-1", 99, 120, 200)
	if err != nil {
		t.Fatal(err)
	}
	if truncated || len(rows) != 0 {
		t.Fatalf("want no rows and no truncation, got %d truncated=%v", len(rows), truncated)
	}
}

// TestLoadHistoryRejectsUnparseableRows pins the all-or-nothing rule: an
// unreadable retained row must fail the whole load, because skipping it would
// leave a hole in a history that looks complete.
func TestLoadHistoryRejectsUnparseableRows(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(0), int64(20), 201).
		WillReturnRows(replayRows().
			AddRow(1, "peer-1", "question.changed", 1, "not json").
			AddRow(2, "peer-1", string(KindQuestionChanged), 2, string(replayPayload(t, 2, "exam-1", "draft-7"))))
	rows, truncated, err := LoadHistory(context.Background(), db, "exam-1", 0, 20, 200)
	if !errors.Is(err, ErrUnparseableRow) {
		t.Fatalf("want ErrUnparseableRow, got %v (rows=%d truncated=%v)", err, len(rows), truncated)
	}
}

// TestLoadHistoryProvesTruncationWithOneExtraRow pins the over-fetch: a full
// bound plus one row means "more history exists", so the caller must snapshot
// instead of streaming a page that looks complete.
func TestLoadHistoryProvesTruncationWithOneExtraRow(t *testing.T) {
	db, mock := replayDB(t)
	rows := replayRows()
	for i := 0; i < 6; i++ {
		cursor := int64(100 + i)
		rows.AddRow(cursor, "peer-1", string(KindQuestionChanged), 1, string(replayPayload(t, cursor, "exam-1", "draft-7")))
	}
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(1), int64(200), 6).WillReturnRows(rows)
	loaded, truncated, err := LoadHistory(context.Background(), db, "exam-1", 1, 200, 5)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated {
		t.Fatal("six rows for a bound of five must report truncation")
	}
	if len(loaded) != 5 {
		t.Fatalf("truncated load must return exactly the bound, got %d", len(loaded))
	}
}

func TestClampReplayBound(t *testing.T) {
	if got := clampReplayBound(0); got != ReplayBound {
		t.Fatalf("zero means default, got %d", got)
	}
	if got := clampReplayBound(-5); got != ReplayBound {
		t.Fatalf("negative means default, got %d", got)
	}
	if got := clampReplayBound(9999); got != ReplayBound {
		t.Fatalf("oversized must clamp to %d, got %d", ReplayBound, got)
	}
	if got := clampReplayBound(25); got != 25 {
		t.Fatalf("a sane bound must pass through, got %d", got)
	}
}

// TestRetentionFloorIsGlobal pins the correction: the floor must be a GLOBAL
// watermark. A per-exam MIN would falsely report "purged" for an exam that
// simply had never emitted until a much later sequence.
func TestRetentionFloorIsGlobal(t *testing.T) {
	if contains(RetentionFloorSQL, "event_target_id") || contains(RetentionFloorSQL, "WHERE") {
		t.Fatalf("the floor must be a global MIN with no per-exam predicate: %s", RetentionFloorSQL)
	}
	if !contains(RetentionFloorSQL, "MIN(sequence_id)") {
		t.Fatalf("the floor must be MIN(sequence_id): %s", RetentionFloorSQL)
	}
}

func TestPlanReplaySnapshotWhenBelowFloor(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(900))
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	// lastSeen 40 < global floor 900: events 41..899 are definitely gone
	// (or never existed for this exam — either way we cannot prove continuity).
	plan, err := PlanReplay(context.Background(), db, b, 40, 950, 200)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.SnapshotRequired || plan.Reason != ReasonCursorTooOld {
		t.Fatalf("a cursor below the floor must require a snapshot: %+v", plan)
	}
	if len(plan.Rows) != 0 {
		t.Fatal("a snapshot decision must never carry partial rows")
	}
}

// TestPlanReplayDoesNotScanWhenBelowFloor pins that the floor check short-
// circuits before the history query runs.
func TestPlanReplayDoesNotScanWhenBelowFloor(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(500))
	// No ReplaySQL expectation is registered: a scan would fail the test.
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	if _, err := PlanReplay(context.Background(), db, b, 10, 600, 200); err != nil {
		t.Fatal(err)
	}
}

// TestPlanReplayAtFloorIsRecoverable pins the boundary: a cursor EQUAL to the
// floor is still replayable (the floor row itself is retained).
func TestPlanReplayAtFloorIsRecoverable(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(500))
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(500), int64(600), 201).
		WillReturnRows(replayRows().
			AddRow(501, "peer-1", string(KindQuestionChanged), 3, string(replayPayload(t, 501, "exam-1", "draft-7"))))
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	plan, err := PlanReplay(context.Background(), db, b, 500, 600, 200)
	if err != nil {
		t.Fatal(err)
	}
	if plan.SnapshotRequired {
		t.Fatal("a cursor at the floor must still replay")
	}
	if len(plan.Rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(plan.Rows))
	}
}

// TestPlanReplayTruncationForcesSnapshot pins the anti-partial-stream rule with
// its own truthful reason: a full page means more history exists, so the client
// gets a replay_too_large snapshot, not a stream that silently omits events.
func TestPlanReplayTruncationForcesSnapshot(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(1))
	rows := replayRows()
	for i := 0; i < 6; i++ {
		cursor := int64(100 + i)
		rows.AddRow(cursor, "peer-1", string(KindQuestionChanged), 1, string(replayPayload(t, cursor, "exam-1", "draft-7")))
	}
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(1), int64(200), 6).WillReturnRows(rows)
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	plan, err := PlanReplay(context.Background(), db, b, 1, 200, 5)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.SnapshotRequired || plan.Reason != ReasonReplayTooLarge {
		t.Fatalf("a full page must force a replay_too_large snapshot: %+v", plan)
	}
	if len(plan.Rows) != 0 {
		t.Fatal("a snapshot decision must never carry partial rows")
	}
}

// TestPlanReplayMalformedRowSnapshots pins that an unreadable retained row
// resolves to a snapshot with its own reason, never a silent skip.
func TestPlanReplayMalformedRowSnapshots(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(1), int64(200), 201).
		WillReturnRows(replayRows().AddRow(2, "peer-1", "question.changed", 1, "not json"))
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	plan, err := PlanReplay(context.Background(), db, b, 1, 200, 200)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.SnapshotRequired || plan.Reason != ReasonUnsupportedEvent {
		t.Fatalf("a malformed row must force an unsupported_event snapshot: %+v", plan)
	}
}

func TestPlanReplayReturnsRowsBelowBound(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(ReplaySQL)).WithArgs(BusEventKind, "exam-1", int64(1), int64(50), 201).
		WillReturnRows(replayRows().
			AddRow(2, "peer-1", string(KindQuestionChanged), 1, string(replayPayload(t, 2, "exam-1", "draft-7"))))
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	plan, err := PlanReplay(context.Background(), db, b, 1, 50, 200)
	if err != nil {
		t.Fatal(err)
	}
	if plan.SnapshotRequired || len(plan.Rows) != 1 {
		t.Fatalf("a short page is a complete answer: %+v", plan)
	}
}

// TestPlanReplayCursorAtBarrierIsNothingMissed pins that a cursor which is
// already current needs no queries at all: zero rows is a valid answer, not an
// error and not a snapshot.
func TestPlanReplayCursorAtBarrierIsNothingMissed(t *testing.T) {
	db, _ := replayDB(t)
	// No expectations registered: any SQL would fail the test.
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	plan, err := PlanReplay(context.Background(), db, b, 77, 77, 200)
	if err != nil {
		t.Fatal(err)
	}
	if plan.SnapshotRequired || len(plan.Rows) != 0 {
		t.Fatalf("a cursor at the barrier means nothing missed: %+v", plan)
	}
}

// TestPlanReplayFailsClosedOnDBError pins that a query failure is an error, not
// an empty history: pretending no events existed would silently drop durable
// rows.
func TestPlanReplayFailsClosedOnDBError(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(RetentionFloorSQL)).WillReturnError(errors.New("db down"))
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	if _, err := PlanReplay(context.Background(), db, b, 1, 50, 200); err == nil {
		t.Fatal("a floor query failure must surface as an error")
	}
}

func TestCurrentDraftID(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery("SELECT current_draft_version_id FROM exam_entities").WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"current_draft_version_id"}).AddRow("draft-7"))
	id, err := CurrentDraftID(context.Background(), db, "exam-1")
	if err != nil {
		t.Fatal(err)
	}
	if id != "draft-7" {
		t.Fatalf("want draft-7, got %q", id)
	}
}

// TestCurrentDraftIDNullIsEmptyNotError pins that a published exam (NULL
// pointer) is a legitimate state, not a failure.
func TestCurrentDraftIDNullIsEmptyNotError(t *testing.T) {
	db, mock := replayDB(t)
	mock.ExpectQuery("SELECT current_draft_version_id FROM exam_entities").WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"current_draft_version_id"}).AddRow(nil))
	id, err := CurrentDraftID(context.Background(), db, "exam-1")
	if err != nil {
		t.Fatal(err)
	}
	if id != "" {
		t.Fatalf("a NULL draft must be empty, got %q", id)
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
