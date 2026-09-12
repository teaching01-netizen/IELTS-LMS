package main

// Invite-code-required student entry (closed-by-default, no schema change).
//
// verifyDirectEntryCode gates link-less schedule entry behind a live
// invite code BEFORE any user/registration/attempt mint: the wcode is
// verified through the existing accesslinks service (ResolveEntry) as a
// selected-student code on a LIVE access link for the schedule (locked
// lifecycle + schedule-window + roster/identity gate). Empty/unknown
// codes, expired/paused/upcoming links, and identity mismatches all
// 404-collapse ("Resource not found.", same envelope as the proctor
// live-assignment miss) so wrong-code and unknown-schedule are
// indistinguishable.
//
// Link-backed entry (accessLinkId != "") verifies via
// AccessLinks.ResolveEntry inside the handler (the ONLY open-entry path:
// ModeOpen links admit without a per-student code). ResolveEntry errors
// 404-collapse in both branches.
//
// All tests here are sqlmock-scoped (no TEST_MYSQL_DSN needed) and strict:
// the ResolveEntry mock is a *sql.DB mock, so the gate must drive exactly
// the issuance reads (link-ID lookup + ResolveEntry's Get + locked tx) and
// any pre-mint write (user lookup/mint, registration, attempt) fails
// ExpectationsWereMet.
import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
)

// linkIDsPattern matches the single issuance read verifyDirectEntryCode
// issues itself (active link IDs for the schedule; the code is verified
// through AccessLinks.ResolveEntry, never inline).
const linkIDsPattern = `FROM assessment_access_links WHERE schedule_id`

func expectLinkIDs(mock sqlmock.Sqlmock, scheduleID string, ids ...string) {
	rows := sqlmock.NewRows([]string{"id"})
	for _, id := range ids {
		rows.AddRow(id)
	}
	mock.ExpectQuery(regexp.QuoteMeta(linkIDsPattern)).
		WithArgs(scheduleID).
		WillReturnRows(rows)
}

// resolveLinkRow returns the 24-column link_selectSQL() projection for a
// live (or ended, when live=false) scheduled link bound to sched-1.
func resolveLinkRow(live bool) *sqlmock.Rows {
	var opens, closes any
	now := time.Now().UTC()
	if live {
		opens = now.Add(-time.Hour)
		closes = now.Add(time.Hour)
	} else {
		opens = now.Add(-3 * time.Hour)
		closes = now.Add(-time.Hour)
	}
	return sqlmock.NewRows([]string{
		"id", "exam_id", "exam_title", "provider_key",
		"published_version_id", "version_number", "schedule_id", "name",
		"audience_type", "audience_label", "access_mode", "availability_type",
		"opens_at", "closes_at", "lifecycle_state", "revision", "created_at", "updated_at",
		"selected_student_count", "registered_count", "started_count", "submitted_count",
		"is_current_release", "has_participation",
	}).AddRow(
		"link-1", "exam-1", "IELTS Mock", "ielts",
		"ver-1", 3, "sched-1", "Saturday Class",
		"selected_students", nil, "student_code", "scheduled",
		opens, closes, "active", 2, now, now,
		1, 0, 0, 0,
		1, 0,
	)
}

// expectResolveEntrySuccess stubs a full ResolveEntry pass for link-1:
// existence precheck (Get) + locked tx (link+sched FOR UPDATE, roster
// member, schedule window) + commit. The member row binds code ALICE-01
// to Ada <ada@x.y>; ResolveEntry enforces the identity match itself.
func expectResolveEntrySuccess(mock sqlmock.Sqlmock, memberName, memberEmail any) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l")).
		WillReturnRows(resolveLinkRow(true))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l JOIN exam_entities e")).
		WillReturnRows(sqlmock.NewRows([]string{
			"schedule_id", "provider_key", "access_mode", "audience_type",
			"lifecycle_state", "availability_type", "opens_at", "closes_at",
		}).AddRow("sched-1", "ielts", "student_code", "selected_students", "active", "scheduled", time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour)))
	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id")).
		WillReturnRows(sqlmock.NewRows([]string{"start_time", "end_time"}).
			AddRow(now.Add(-time.Hour), now.Add(time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
		WillReturnRows(sqlmock.NewRows([]string{"student_name", "student_email"}).
			AddRow(memberName, memberEmail))
	mock.ExpectCommit()
}

func asAppError(t *testing.T, err error) *apperrors.Error {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected *apperrors.Error, got %T (%v)", err, err)
	}
	return appErr
}

func gateTestApp(t *testing.T, db *sql.DB) *App {
	t.Helper()
	cfg := config.Load()
	cfg.EntryGateEnabled = false
	return BuildApp(cfg, db)
}

func TestVerifyDirectEntryCode(t *testing.T) {
	t.Parallel()
	// Authorized: live link resolves the code (unbound member row binds
	// nothing, so any identity passes — same as ResolveEntry).
	t.Run("authorized code resolves via live link", func(t *testing.T) {
		t.Parallel()
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		app := gateTestApp(t, db)
		expectLinkIDs(mock, "sched-1", "link-1")
		expectResolveEntrySuccess(mock, nil, nil)
		if err := verifyDirectEntryCode(context.Background(), app, "sched-1", "alice-01", "Ada", "ada@x.y"); err != nil {
			t.Fatalf("authorized code must verify, got: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	// Bound identity admits case-insensitively (ResolveEntry enforces).
	t.Run("bound identity admits case-insensitively", func(t *testing.T) {
		t.Parallel()
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		app := gateTestApp(t, db)
		expectLinkIDs(mock, "sched-1", "link-1")
		expectResolveEntrySuccess(mock, "Ada Lovelace", "ada@x.y")
		if err := verifyDirectEntryCode(context.Background(), app, "sched-1", "alice-01", "ada lovelace", "ADA@X.Y"); err != nil {
			t.Fatalf("bound identity must admit case-insensitively, got: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	// Unknown code: no live link resolves it (empty link list) → 404.
	t.Run("unknown code collapses to 404", func(t *testing.T) {
		t.Parallel()
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		app := gateTestApp(t, db)
		expectLinkIDs(mock, "sched-1")
		err = verifyDirectEntryCode(context.Background(), app, "sched-1", "WRONG-CODE", "Ada", "ada@x.y")
		appErr := asAppError(t, err)
		if appErr.Code != apperrors.CodeNotFound || appErr.Message != "Resource not found." {
			t.Fatalf("must 404-collapse, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	// Synthetic OPEN- key never resolves on the direct path → 404.
	t.Run("synthetic OPEN- key collapses to 404", func(t *testing.T) {
		t.Parallel()
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		app := gateTestApp(t, db)
		expectLinkIDs(mock, "sched-1")
		err = verifyDirectEntryCode(context.Background(), app, "sched-1", "OPEN-ABCDEF123456", "Ada", "ada@x.y")
		appErr := asAppError(t, err)
		if appErr.Code != apperrors.CodeNotFound {
			t.Fatalf("synthetic key must 404-collapse, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	// Identity mismatch: ResolveEntry rejects (member binds another
	// student) → the link is skipped → 404 (no code sharing).
	t.Run("identity mismatch collapses to 404", func(t *testing.T) {
		t.Parallel()
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		app := gateTestApp(t, db)
		expectLinkIDs(mock, "sched-1", "link-1")
		// ResolveEntry's tx rolls back on the identity mismatch.
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l")).
			WillReturnRows(resolveLinkRow(true))
		mock.ExpectBegin()
		mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l JOIN exam_entities e")).
			WillReturnRows(sqlmock.NewRows([]string{
				"schedule_id", "provider_key", "access_mode", "audience_type",
				"lifecycle_state", "availability_type", "opens_at", "closes_at",
			}).AddRow("sched-1", "ielts", "student_code", "selected_students", "active", "scheduled", time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour)))
		now := time.Now().UTC()
		mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id")).
			WillReturnRows(sqlmock.NewRows([]string{"start_time", "end_time"}).
				AddRow(now.Add(-time.Hour), now.Add(time.Hour)))
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
			WillReturnRows(sqlmock.NewRows([]string{"student_name", "student_email"}).
				AddRow("Ada Lovelace", "ada@x.y"))
		mock.ExpectRollback()
		err = verifyDirectEntryCode(context.Background(), app, "sched-1", "alice-01", "Mallory", "ada@x.y")
		appErr := asAppError(t, err)
		if appErr.Code != apperrors.CodeNotFound || appErr.Message != "Resource not found." {
			t.Fatalf("identity mismatch must 404-collapse, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestVerifyDirectEntryCodeNormalizesWcode(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := gateTestApp(t, db)
	// Lowercase legacy code still reaches ResolveEntry uppercased: the
	// link-ID lookup is schedule-scoped (no code arg), and ResolveEntry
	// normalizes internally — an empty link list proves the gate ran.
	expectLinkIDs(mock, "sched-1")
	err = verifyDirectEntryCode(context.Background(), app, "sched-1", "w123456", "Ada", "ada@x.y")
	appErr := asAppError(t, err)
	if appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown code must 404-collapse, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDirectEntryCodeEmptyCollapsesPreDB(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := gateTestApp(t, db)
	// No expectations: empty/blank codes (and empty schedule) must
	// 404-collapse before touching the DB.
	for _, wcode := range []string{"", "   "} {
		err := verifyDirectEntryCode(context.Background(), app, "sched-1", wcode, "Ada", "ada@x.y")
		appErr := asAppError(t, err)
		if appErr.Code != apperrors.CodeNotFound || appErr.Message != "Resource not found." {
			t.Fatalf("empty wcode %q must 404-collapse, got %v", wcode, err)
		}
	}
	err = verifyDirectEntryCode(context.Background(), app, "", "alice-01", "Ada", "ada@x.y")
	if appErr := asAppError(t, err); appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("empty schedule must 404-collapse, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("empty codes must burn zero DB: %v", err)
	}
}

func TestVerifyDirectEntryCodeFailsClosed(t *testing.T) {
	t.Parallel()
	// Nil app never authorizes (fail closed, never mint).
	if err := verifyDirectEntryCode(context.Background(), nil, "sched-1", "alice-01", "Ada", "ada@x.y"); err == nil {
		t.Fatal("nil app must deny entry")
	} else if appErr := asAppError(t, err); appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("nil app must 503 (fail closed), got %v", err)
	}
	// Nil AccessLinks (unwired service) denies entry without minting.
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	bare := &App{}
	if err := verifyDirectEntryCode(context.Background(), bare, "sched-1", "alice-01", "Ada", "ada@x.y"); err == nil {
		t.Fatal("missing services must deny entry")
	} else if appErr := asAppError(t, err); appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("missing services must 503 (fail closed), got %v", err)
	}
}

// TestStudentEntryWrongInviteCode404sPreMint pins the handler gate
// end-to-end on the direct path: a wrong invite code 404-collapses with the
// exact collapse envelope and the ONLY expectation (link-ID lookup)
// satisfied — no user lookup/mint, no registration, no attempt.
func TestStudentEntryWrongInviteCode404sPreMint(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := gateTestApp(t, db)
	expectLinkIDs(mock, "sched-1")
	body := `{"scheduleId":"sched-1","wcode":"WRONG-CODE","email":"invite-wrong-code-1@x.y","studentName":"Ada"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/student/entry", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// Fixed RemoteAddr + unique email keep the 30/min email+IP bucket cold
	// so the invite-code gate (not 429) decides.
	req.RemoteAddr = "10.44.44.44:1234"
	rec := httptest.NewRecorder()
	studentEntryHandler(app).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("wrong invite code must 404-collapse, got %d: %s", rec.Code, rec.Body.String())
	}
	var wire map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &wire); err != nil {
		t.Fatal(err)
	}
	if wire["code"] != string(apperrors.CodeNotFound) || wire["message"] != "Resource not found." {
		t.Fatalf("wrong-code envelope must 404-collapse exactly, got: %s", rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("wrong code must stop before user lookup/mint: %v", err)
	}
}
