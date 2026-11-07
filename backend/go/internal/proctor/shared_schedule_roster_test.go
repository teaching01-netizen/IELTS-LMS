package proctor

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// The roster/summary runtime projection used to trust the materialized
// current_section_key alone. The detail read already overlays the committed
// IELTS timetable (applySharedScheduleView), but loadSessionRuntimes — the
// path the proctor dashboard polls every 10s — did not, so a shared-schedule
// room whose section rows lagged behind the committed timetable reported
// LISTENING to staff while every student device was already working on the
// timetable's current section. These cases pin: the committed timetable is
// the read authority for LIVE shared-schedule rooms on every read path, and
// non-live or non-shared runtimes keep their materialized values.

const (
	sharedRostersSQL   = "FROM exam_session_runtimes WHERE schedule_id IN (?, ?)"
	sharedSectionsSQL  = "FROM exam_session_runtime_sections WHERE runtime_id IN (?)"
	sharedTimetableSQL = "SELECT id, ielts_shared_schedule FROM exam_session_runtimes WHERE id IN (?)"
)

func sharedStubDB(t *testing.T) (sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return mock, db
}

func sharedStubSchedule(id string) SessionSchedule {
	return SessionSchedule{ID: id, ExamID: "exam-1", ProviderKey: "ielts"}
}

// sharedTimetableWindows lays three gapless windows: listening 30m, reading
// 60m, writing 60m, each with a 10s save-only drain — the committed shape
// BuildIELTSSharedSchedule produces.
func sharedTimetableWindows(t *testing.T, base time.Time) []map[string]any {
	t.Helper()
	window := func(sectionKey string, order int, start, deadline time.Time) map[string]any {
		return map[string]any{
			"sectionKey": sectionKey,
			"order":      order,
			"startAt":    start.UTC().Format(time.RFC3339),
			"deadlineAt": deadline.UTC().Format(time.RFC3339),
			"saveUntil":  deadline.UTC().Add(10 * time.Second).Format(time.RFC3339),
		}
	}
	return []map[string]any{
		window("listening", 0, base, base.Add(30*time.Minute)),
		window("reading", 1, base.Add(30*time.Minute).Add(10*time.Second), base.Add(90*time.Minute).Add(10*time.Second)),
		window("writing", 2, base.Add(90*time.Minute).Add(20*time.Second), base.Add(150*time.Minute).Add(20*time.Second)),
	}
}

func sharedTimetableJSON(t *testing.T, base time.Time) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"schemaVersion":    1,
		"scheduleRevision": 3,
		"status":           "active",
		"windows":          sharedTimetableWindows(t, base),
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

var sharedRuntimeHeaderColumns = strings.Split(sessionRuntimeColumns, ", ")
var sharedSectionColumns = strings.Split(sessionRuntimeSectionColumns, ", ")

func sharedStubRuntimeRow(id string, status, timingModel string, actualStart time.Time, remaining int64) *sqlmock.Rows {
	return sqlmock.NewRows(sharedRuntimeHeaderColumns).AddRow(
		id, "sch-1", "exam-1", "ielts", status, nil, timingModel,
		actualStart, nil, "listening", "listening", remaining,
		false, false, 0, actualStart.Add(-time.Hour), actualStart, 7,
	)
}

type sharedSectionRow struct{ key string }

func sharedStubSections(id string, listeningStart time.Time) *sqlmock.Rows {
	return sqlmock.NewRows(sharedSectionColumns).
		AddRow("secL-1", id, "listening", "Listening", 0, 30, 0, "live", nil, listeningStart, nil, nil, 0, 0, nil, nil, nil).
		AddRow("secR-1", id, "reading", "Reading", 1, 60, 0, "locked", nil, nil, nil, nil, 0, 0, nil, nil, nil).
		AddRow("secW-1", id, "writing", "Writing", 2, 60, 0, "locked", nil, nil, nil, nil, 0, 0, nil, nil, nil)
}

func TestLoadSessionRuntimesAppliesCommittedIeltsTimetable(t *testing.T) {
	mock, db := sharedStubDB(t)
	base := time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC).UTC()
	// 91 minutes in: reading's drain is over and the committed timetable is
	// already working on writing, while the materialized row still says
	// listening (the lag the roster used to serve verbatim).
	now := base.Add(91 * time.Minute)
	timetable := sharedTimetableJSON(t, base)

	mock.ExpectQuery(regexp.QuoteMeta(sharedRostersSQL)).
		WithArgs("sch-1", "sch-2").
		WillReturnRows(sharedStubRuntimeRow("rt-1", "live", "ielts_shared_schedule_v1", base, 1800))
	mock.ExpectQuery(regexp.QuoteMeta(sharedSectionsSQL)).
		WithArgs("rt-1").
		WillReturnRows(sharedStubSections("rt-1", base))
	mock.ExpectQuery(regexp.QuoteMeta(sharedTimetableSQL)).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "ielts_shared_schedule"}).AddRow("rt-1", timetable))

	out, err := loadSessionRuntimes(context.Background(), db, []SessionSchedule{sharedStubSchedule("sch-1"), sharedStubSchedule("sch-2")}, now)
	if err != nil {
		t.Fatal(err)
	}

	if rt, ok := out["sch-1"]; !ok {
		t.Fatal("roster lost the live shared-schedule runtime")
	} else {
		if rt.CurrentSectionKey == nil || *rt.CurrentSectionKey != "writing" {
			got := "<nil>"
			if rt.CurrentSectionKey != nil {
				got = *rt.CurrentSectionKey
			}
			t.Fatalf("roster must report the committed timetable's working section, got %s (status %q, remaining %d)", got, rt.Status, rt.CurrentSectionRemainingSeconds)
		}
		if rt.ActiveSectionKey == nil || *rt.ActiveSectionKey != "writing" {
			t.Fatalf("roster must move the active section with the timetable, got %v", rt.ActiveSectionKey)
		}
		writingDeadline := base.Add(150 * time.Minute).Add(20 * time.Second)
		if rt.CurrentSectionDeadlineAt == nil || !rt.CurrentSectionDeadlineAt.Equal(writingDeadline) {
			t.Fatalf("roster clock must be the writing window deadline, got %v", rt.CurrentSectionDeadlineAt)
		}
		// 150m20s − 91m = 59m20s = 3560s of committed working time left.
		if rt.CurrentSectionRemainingSeconds != 3560 {
			t.Fatalf("roster clock must tick to the committed writing deadline, got %d", rt.CurrentSectionRemainingSeconds)
		}
		if rt.WaitingForNextSection {
			t.Fatal("a working window is not a between-sections gap")
		}
	}
	if rt, ok := out["sch-2"]; !ok || rt.Status != "not_started" {
		t.Fatalf("schedule without a runtime row keeps its not-started synthesis: %+v", rt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadSessionRuntimesLeavesPausedSharedRoomOnMaterializedRow(t *testing.T) {
	mock, db := sharedStubDB(t)
	base := time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC).UTC()
	now := base.Add(91 * time.Minute)
	timetable := sharedTimetableJSON(t, base)

	mock.ExpectQuery(regexp.QuoteMeta(sharedRostersSQL)).
		WithArgs("sch-1", "sch-2").
		WillReturnRows(sharedStubRuntimeRow("rt-1", "paused", "ielts_shared_schedule_v1", base, 1800))
	mock.ExpectQuery(regexp.QuoteMeta(sharedSectionsSQL)).
		WithArgs("rt-1").
		WillReturnRows(sharedStubSections("rt-1", base))
	mock.ExpectQuery(regexp.QuoteMeta(sharedTimetableSQL)).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "ielts_shared_schedule"}).AddRow("rt-1", timetable))

	out, err := loadSessionRuntimes(context.Background(), db, []SessionSchedule{sharedStubSchedule("sch-1"), sharedStubSchedule("sch-2")}, now)
	if err != nil {
		t.Fatal(err)
	}
	rt := out["sch-1"]
	// The read overlay mirrors the detail path: a paused room must not move
	// its section off the materialized row.
	if rt.CurrentSectionKey == nil || *rt.CurrentSectionKey != "listening" {
		t.Fatalf("paused shared room keeps its materialized section, got %v", rt.CurrentSectionKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadSessionRuntimesSkipsTimetableProbeForOtherModels(t *testing.T) {
	mock, db := sharedStubDB(t)
	base := time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC).UTC()
	now := base.Add(91 * time.Minute)

	// Personal-model IELTS room: attempt-owned timelines, no committed
	// timetable, so no probe and the hydrated row stands.
	mock.ExpectQuery(regexp.QuoteMeta(sharedRostersSQL)).
		WithArgs("sch-1", "sch-2").
		WillReturnRows(sharedStubRuntimeRow("rt-1", "live", "ielts_cohort_personal_v2", now.Add(-10*time.Minute), 1800))
	mock.ExpectQuery(regexp.QuoteMeta(sharedSectionsSQL)).
		WithArgs("rt-1").
		WillReturnRows(sharedStubSections("rt-1", now.Add(-10*time.Minute)))

	out, err := loadSessionRuntimes(context.Background(), db, []SessionSchedule{sharedStubSchedule("sch-1"), sharedStubSchedule("sch-2")}, now)
	if err != nil {
		t.Fatal(err)
	}
	rt := out["sch-1"]
	if rt.CurrentSectionKey == nil || *rt.CurrentSectionKey != "listening" {
		t.Fatalf("non-shared room keeps its materialized section, got %v", rt.CurrentSectionKey)
	}
	// started 10 minutes into a 30-minute window: 1200s left.
	if rt.CurrentSectionRemainingSeconds != 1200 {
		t.Fatalf("non-shared room keeps its computed clock, got %d", rt.CurrentSectionRemainingSeconds)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
