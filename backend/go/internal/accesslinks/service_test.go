package accesslinks

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func codeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func svc(db *sql.DB) *Service { return NewService(db, tx.NewRunner(db)) }

func begin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

// linkRow returns the 26-column link_selectSQL() projection.
func linkRow(live bool) *sqlmock.Rows {
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
		"published_version_id", "version_number", "publish_scope", "schedule_id", "name", "enabled_sections",
		"audience_type", "audience_label", "access_mode", "availability_type",
		"opens_at", "closes_at", "lifecycle_state", "revision", "created_at", "updated_at",
		"selected_student_count", "registered_count", "started_count", "submitted_count",
		"is_current_release", "has_participation",
	}).AddRow(
		"link-1", "exam-1", "IELTS Mock", "ielts",
		"ver-1", 3, "full", "sched-1", "Saturday Class", nil,
		"anyone", nil, "student_code", "scheduled",
		opens, closes, "active", 2, now, now,
		0, 1, 1, 0,
		1, 1,
	)
}

// linkLockRow returns the pinned release and link scope under the edit lock.
func linkLockRow(participation int, enabledSections any, pin ...string) *sqlmock.Rows {
	providerKey, publishScope := "ielts", "full"
	if len(pin) > 0 {
		providerKey = pin[0]
	}
	if len(pin) > 1 {
		publishScope = pin[1]
	}
	return sqlmock.NewRows([]string{"schedule_id", "lifecycle_state", "revision", "enabled_sections", "has_participation", "provider_key", "sat_publish_scope"}).
		AddRow("sched-1", "active", 4, enabledSections, participation, providerKey, publishScope)
}

// expectLinkSelect stubs the post-commit re-read in s.Get.
func expectLinkSelect(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l")).WillReturnRows(rows)
}

// create happy path covers the tx query shape: version pin (FOR UPDATE on
// exam_entities + exam_versions), backing schedule INSERT, link INSERT,
// member DELETE with empty roster, then the re-read.
func TestCreateHappyPathQueryShape(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	opens := time.Now().UTC().Add(-time.Hour)
	closes := time.Now().UTC().Add(time.Hour)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"title", "provider_key", "organization_id", "current_published_version_id"}).
			AddRow("IELTS Mock", "ielts", nil, "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"is_published", "sat_publish_scope"}).AddRow(true, "full"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_access_links")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM assessment_access_link_members")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	expectLinkSelect(mock, linkRow(true))
	got, err := s.Create(context.Background(), "exam-1", "actor-1", CreateRequest{
		Name:             "Saturday Class",
		AudienceType:     AudienceAnyone,
		AccessMode:       ModeStudentCode,
		AvailabilityType: AvailabilityScheduled,
		OpensAt:          &opens,
		ClosesAt:         &closes,
	})
	if err != nil {
		t.Fatalf("Create happy path must succeed: %v", err)
	}
	if got.ID != "link-1" || got.Revision != 2 {
		t.Fatalf("unexpected link projection: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// create with no exam id fails before touching the database.
func TestCreateEmptyExamValidation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	if _, err := s.Create(context.Background(), "  ", "actor-1", CreateRequest{
		Name:             "Saturday Class",
		AudienceType:     AudienceAnyone,
		AccessMode:       ModeStudentCode,
		AvailabilityType: AvailabilityAnytime,
	}); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on empty exam id, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// selected-student links must require a student code (no SQL issued).
func TestCreateSelectedStudentsRequiresCodeMode(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	label := "Class A"
	code := "W123456"
	if _, err := s.Create(context.Background(), "exam-1", "actor-1", CreateRequest{
		Name:             "Class A",
		AudienceType:     AudienceSelectedStudents,
		AudienceLabel:    &label,
		AccessMode:       ModeOpen,
		AvailabilityType: AvailabilityAnytime,
		SelectedStudents: []MemberInput{{StudentCode: code}},
	}); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on open selected-student link, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// get on a missing row maps sql.ErrNoRows to NOT_FOUND.
func TestGetNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_links l")).WillReturnError(sql.ErrNoRows)
	if _, err := s.Get(context.Background(), "missing"); codeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// get happy path returns the scanned projection with derived live status.
func TestGetHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	expectLinkSelect(mock, linkRow(true))
	got, err := s.Get(context.Background(), "link-1")
	if err != nil {
		t.Fatalf("Get must succeed: %v", err)
	}
	if got.Status != StatusLive {
		t.Fatalf("expected live status, got %q", got.Status)
	}
	if got.VersionNumber != 3 || got.ScheduleID != "sched-1" {
		t.Fatalf("unexpected projection: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// list_for_exam returns rows ordered by the explicit query shape.
func TestListForExamHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE l.exam_id")).WillReturnRows(linkRow(true))
	got, err := s.ListForExam(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("ListForExam must succeed: %v", err)
	}
	if len(got) != 1 || got[0].ExamID != "exam-1" {
		t.Fatalf("unexpected list result: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// set_lifecycle with an unknown state fails validation before SQL.
func TestSetLifecycleBadStateValidation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	if _, err := s.SetLifecycle(context.Background(), "link-1", SetLifecycleRequest{
		Revision: 1,
		State:    LifecycleState("archived"),
	}); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on unknown lifecycle state, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// set_lifecycle on a stale revision conflicts after locking (FOR UPDATE)
// and rolls back.
func TestSetLifecycleStaleRevisionConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("assessment_access_links.id = ? FOR UPDATE")).WillReturnRows(linkLockRow(0, nil))
	mock.ExpectRollback()
	if _, err := s.SetLifecycle(context.Background(), "link-1", SetLifecycleRequest{
		Revision: 1,
		State:    LifecyclePaused,
	}); codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on stale revision, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// deriveStatus keeps the Rust boundary semantics (revoked/paused first,
// anytime live, upcoming before opens, ended at closes).
func TestDeriveStatusBoundaries(t *testing.T) {
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)
	if got := deriveStatus(LifecyclePaused, AvailabilityAnytime, nil, nil, now); got != StatusPaused {
		t.Fatalf("paused must win over anytime, got %q", got)
	}
	if got := deriveStatus(LifecycleRevoked, AvailabilityScheduled, &past, &future, now); got != StatusRevoked {
		t.Fatalf("revoked must win over window, got %q", got)
	}
	if got := deriveStatus(LifecycleActive, AvailabilityAnytime, nil, nil, now); got != StatusLive {
		t.Fatalf("active anytime must be live, got %q", got)
	}
	opens := now.Add(time.Second)
	if got := deriveStatus(LifecycleActive, AvailabilityScheduled, &opens, &future, now); got != StatusUpcoming {
		t.Fatalf("future opens must be upcoming, got %q", got)
	}
	closes := now
	if got := deriveStatus(LifecycleActive, AvailabilityScheduled, &past, &closes, now); got != StatusEnded {
		t.Fatalf("closes == now must be ended, got %q", got)
	}
}

// enum parsers reject unknown values with BAD_REQUEST.
func TestParseEnumsRejectUnknown(t *testing.T) {
	if _, err := ParseAudienceType("everyone"); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on audience, got %v", err)
	}
	if _, err := ParseMode("magic"); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on mode, got %v", err)
	}
	if _, err := ParseAvailabilityType("sometimes"); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on availability, got %v", err)
	}
	if _, err := ParseLifecycleState("archived"); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on lifecycle, got %v", err)
	}
}
