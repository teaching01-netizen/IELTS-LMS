package accesslinks

// Student Access section scope (migration 0066): a link may be narrowed to a
// subset of the exam's sections. These cases pin the validator, the stored
// shape, the public projection, the "sections may only change until the first
// student participates" gate, and that a duplicate carries the scope across.

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// An empty selection means "all sections" and is stored as NULL, which is
// exactly what every pre-migration link holds.
func TestNormalizeEnabledSections(t *testing.T) {
	cases := []struct {
		name    string
		in      []string
		want    []string
		wantErr bool
	}{
		{name: "nil is all sections", in: nil, want: nil},
		{name: "empty is all sections", in: []string{}, want: nil},
		{name: "verbal only", in: []string{"reading-writing"}, want: []string{"reading-writing"}},
		{name: "math only", in: []string{"math"}, want: []string{"math"}},
		{name: "canonical order regardless of input order", in: []string{"math", "reading-writing"}, want: []string{"reading-writing", "math"}},
		{name: "duplicates collapse", in: []string{"math", "math"}, want: []string{"math"}},
		{name: "whitespace trims", in: []string{" math "}, want: []string{"math"}},
		{name: "unknown key fails closed", in: []string{"science"}, wantErr: true},
		{name: "blank key fails closed", in: []string{"  "}, wantErr: true},
		{name: "one good key does not excuse a bad one", in: []string{"math", "listening"}, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeEnabledSections(tc.in)
			if tc.wantErr {
				if codeOf(err) != apperrors.CodeBadRequest {
					t.Fatalf("expected BAD_REQUEST, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

// The stored JSON is a scope; a malformed or empty value fails open to "all
// sections" rather than stranding the link with no sections at all.
func TestParseEnabledSectionsFailsOpen(t *testing.T) {
	cases := []struct {
		name string
		raw  sql.NullString
		want []string
	}{
		{name: "NULL column", raw: sql.NullString{}, want: nil},
		{name: "empty value", raw: sql.NullString{String: "", Valid: true}, want: nil},
		{name: "empty array", raw: sql.NullString{String: "[]", Valid: true}, want: nil},
		{name: "malformed json", raw: sql.NullString{String: "{oops", Valid: true}, want: nil},
		{name: "unknown keys", raw: sql.NullString{String: `["science"]`, Valid: true}, want: nil},
		{name: "reading-writing", raw: sql.NullString{String: `["reading-writing"]`, Valid: true}, want: []string{"reading-writing"}},
		{name: "both in canonical order", raw: sql.NullString{String: `["math","reading-writing"]`, Valid: true}, want: []string{"reading-writing", "math"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseEnabledSections(tc.raw)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
	if enabledSectionsJSON(nil) != nil {
		t.Fatal("an unscoped link must store NULL, not a JSON null")
	}
	if got := enabledSectionsJSON([]string{"reading-writing"}); got != `["reading-writing"]` {
		t.Fatalf("unexpected stored scope %v", got)
	}
}

func TestHasEffectiveSectionsTreatsUnscopedFullSATAsAllSections(t *testing.T) {
	cases := []struct {
		name          string
		provider      string
		publishScope  examdomain.SATPublishScope
		enabled       []string
		wantEffective bool
	}{
		{name: "full release and unscoped link", provider: "sat", publishScope: examdomain.SATPublishScopeFull, wantEffective: true},
		{name: "single-section release and unscoped link", provider: "sat", publishScope: examdomain.SATPublishScopeReadingWriting, wantEffective: true},
		{name: "empty explicit intersection", provider: "sat", publishScope: examdomain.SATPublishScopeReadingWriting, enabled: []string{SectionMath}},
		{name: "non-SAT ignores link scope", provider: "ielts", enabled: []string{SectionMath}, wantEffective: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasEffectiveSections(tc.provider, tc.publishScope, tc.enabled); got != tc.wantEffective {
				t.Fatalf("hasEffectiveSections() = %t, want %t", got, tc.wantEffective)
			}
		})
	}
}

// The admin projection and the public entry payload both carry the scope, so the
// UI can badge it and the student can be told before committing.
func TestLinkProjectionCarriesEnabledSections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	rows := linkRow(true)
	rows = sqlmock.NewRows(linkColumns()).AddRow(
		"link-1", "exam-1", "SAT Mock", "sat",
		"ver-1", 3, "reading-writing", "sched-1", "Verbal only", `["reading-writing"]`,
		"anyone", nil, "student_code", "scheduled",
		time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour), "active", 2, time.Now().UTC(), time.Now().UTC(),
		0, 1, 1, 0,
		1, 1,
	)
	expectLinkSelect(mock, rows)
	link, err := s.Get(context.Background(), "link-1")
	if err != nil {
		t.Fatalf("Get must succeed: %v", err)
	}
	if len(link.EnabledSections) != 1 || link.EnabledSections[0] != SectionReadingWriting {
		t.Fatalf("expected the verbal-only scope, got %v", link.EnabledSections)
	}
	if link.PublishScope != examdomain.SATPublishScopeReadingWriting {
		t.Fatalf("expected the pinned Reading & Writing release scope, got %q", link.PublishScope)
	}
	expectLinkSelect(mock, sqlmock.NewRows(linkColumns()).AddRow(
		"link-1", "exam-1", "SAT Mock", "sat",
		"ver-1", 3, "reading-writing", "sched-1", "Verbal only", `["reading-writing"]`,
		"anyone", nil, "student_code", "scheduled",
		time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour), "active", 2, time.Now().UTC(), time.Now().UTC(),
		0, 1, 1, 0,
		1, 1,
	))
	public, err := s.PublicLink(context.Background(), "link-1")
	if err != nil {
		t.Fatalf("PublicLink must succeed: %v", err)
	}
	if len(public.EnabledSections) != 1 || public.EnabledSections[0] != SectionReadingWriting {
		t.Fatalf("public payload must carry the scope, got %v", public.EnabledSections)
	}
	if public.PublishScope != examdomain.SATPublishScopeReadingWriting {
		t.Fatalf("public payload must carry pinned release scope, got %q", public.PublishScope)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// linkColumns is the link_selectSQL() column list, shared by the scope tests so
// a projection change cannot silently shift a column.
func linkColumns() []string {
	return []string{
		"id", "exam_id", "exam_title", "provider_key",
		"published_version_id", "version_number", "publish_scope", "schedule_id", "name", "enabled_sections",
		"audience_type", "audience_label", "access_mode", "availability_type",
		"opens_at", "closes_at", "lifecycle_state", "revision", "created_at", "updated_at",
		"selected_student_count", "registered_count", "started_count", "submitted_count",
		"is_current_release", "has_participation",
	}
}

// Once a student has joined, the scope is frozen: runtime sections are built at
// proctor start, so a later edit would silently change (or fail to change) the
// sitting that student was told to expect.
func TestUpdateRejectsSectionChangeAfterParticipation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("assessment_access_links.id = ? FOR UPDATE")).
		WillReturnRows(linkLockRow(1, `["reading-writing"]`))
	mock.ExpectRollback()
	requested := []string{SectionReadingWriting, SectionMath}
	_, err = s.Update(context.Background(), "link-1", UpdateRequest{
		Revision: 4, Name: "Class A", AudienceType: AudienceAnyone,
		AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
		EnabledSections: &requested,
	})
	if codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on a section change after participation, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Before any participation the scope may change, and the new scope is what gets
// written.
func TestUpdateAllowsSectionChangeBeforeParticipation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("assessment_access_links.id = ? FOR UPDATE")).
		WillReturnRows(linkLockRow(0, `["reading-writing"]`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
		WillReturnRows(sqlmock.NewRows([]string{"student_code", "student_name", "student_email"}))
	mock.ExpectQuery(regexp.QuoteMeta("planned_duration_minutes, revision FROM exam_schedules")).
		WillReturnRows(sqlmock.NewRows([]string{"planned_duration_minutes", "revision"}).AddRow(1, 2))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET cohort_name")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_access_links SET name = ?")).
		WithArgs("Class A", `["reading-writing","math"]`, "anyone", nil, "student_code", "anytime", nil, nil, "link-1", 4).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM assessment_access_link_members")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	expectLinkSelect(mock, linkRow(true))
	requested := []string{SectionMath, SectionReadingWriting}
	if _, err := s.Update(context.Background(), "link-1", UpdateRequest{
		Revision: 4, Name: "Class A", AudienceType: AudienceAnyone,
		AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
		EnabledSections: &requested,
	}); err != nil {
		t.Fatalf("Update before participation must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An update that omits enabledSections keeps the stored scope (pointer nil means
// "omitted", never "cleared").
func TestUpdateWithoutScopeKeepsStoredScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("assessment_access_links.id = ? FOR UPDATE")).
		WillReturnRows(linkLockRow(1, `["math"]`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
		WillReturnRows(sqlmock.NewRows([]string{"student_code", "student_name", "student_email"}))
	mock.ExpectQuery(regexp.QuoteMeta("planned_duration_minutes, revision FROM exam_schedules")).
		WillReturnRows(sqlmock.NewRows([]string{"planned_duration_minutes", "revision"}).AddRow(1, 2))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET cohort_name")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_access_links SET name = ?")).
		WithArgs("Class A", `["math"]`, "anyone", nil, "student_code", "anytime", nil, nil, "link-1", 4).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM assessment_access_link_members")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	expectLinkSelect(mock, linkRow(true))
	if _, err := s.Update(context.Background(), "link-1", UpdateRequest{
		Revision: 4, Name: "Class A", AudienceType: AudienceAnyone,
		AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
	}); err != nil {
		t.Fatalf("Update must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Create persists the operator's selection through the link INSERT.
func TestCreatePersistsEnabledSections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"title", "provider_key", "organization_id", "current_published_version_id"}).
			AddRow("SAT Mock", "sat", nil, "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"is_published", "sat_publish_scope"}).AddRow(true, "full"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_schedules")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?")).
		WithArgs("sat_personal_v1", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_access_links")).
		WithArgs(sqlmock.AnyArg(), "exam-1", "ver-1", sqlmock.AnyArg(), "Verbal only", `["reading-writing"]`, "anyone", nil, "student_code", "anytime", nil, nil, "actor-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM assessment_access_link_members")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	expectLinkSelect(mock, linkRow(true))
	if _, err := s.Create(context.Background(), "exam-1", "actor-1", CreateRequest{
		Name: "Verbal only", EnabledSections: []string{SectionReadingWriting},
		AudienceType: AudienceAnyone, AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
	}); err != nil {
		t.Fatalf("Create must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRejectsScopeOutsidePinnedRelease(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"title", "provider_key", "organization_id", "current_published_version_id"}).
			AddRow("SAT Mock", "sat", nil, "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"is_published", "sat_publish_scope"}).AddRow(true, "reading-writing"))
	mock.ExpectRollback()
	_, err = s.Create(context.Background(), "exam-1", "actor-1", CreateRequest{
		Name: "Math only", EnabledSections: []string{SectionMath},
		AudienceType: AudienceAnyone, AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
	})
	if codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST for an empty release/link intersection, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateRejectsPreexistingEmptyScopeIntersection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("assessment_access_links.id = ? FOR UPDATE")).
		WillReturnRows(linkLockRow(0, `["math"]`, "sat", "reading-writing"))
	mock.ExpectRollback()
	_, err = s.Update(context.Background(), "link-1", UpdateRequest{
		Revision: 4, Name: "Math only", AudienceType: AudienceAnyone,
		AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
	})
	if codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST when keeping an empty pinned scope, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An unknown section key is refused before any SQL is issued.
func TestCreateRejectsUnknownSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	if _, err := s.Create(context.Background(), "exam-1", "actor-1", CreateRequest{
		Name: "Science only", EnabledSections: []string{"science"},
		AudienceType: AudienceAnyone, AccessMode: ModeStudentCode, AvailabilityType: AvailabilityAnytime,
	}); codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on an unknown section, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A duplicate copies the source scope onto the new link.
func TestDuplicateCopiesEnabledSections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	now := time.Now().UTC()
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("revision FROM assessment_access_links WHERE id = ? FOR UPDATE")).WillReturnRows(
		sqlmock.NewRows([]string{"exam_id", "published_version_id", "name", "enabled_sections", "audience_type", "audience_label", "access_mode", "availability_type", "opens_at", "closes_at", "revision"}).
			AddRow("exam-1", "ver-1", "Verbal only", `["reading-writing"]`, "anyone", nil, "student_code", "anytime", nil, nil, 2))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
		WillReturnRows(sqlmock.NewRows([]string{"student_code", "student_name", "student_email"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"title", "provider_key", "organization_id", "current_published_version_id"}).
			AddRow("SAT Mock", "sat", nil, "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"is_published", "sat_publish_scope"}).AddRow(true, "full"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_schedules")).
		WithArgs(sqlmock.AnyArg(), "exam-1", "sat", nil, "SAT Mock", "SAT Mock", "SAT Mock", "ver-1", "Verbal only Copy", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "actor-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?")).
		WithArgs("sat_personal_v1", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_access_links")).
		WithArgs(sqlmock.AnyArg(), "exam-1", "ver-1", sqlmock.AnyArg(), "Verbal only Copy", `["reading-writing"]`, "anyone", nil, "student_code", "anytime", nil, nil, "actor-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM assessment_access_link_members")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	expectLinkSelect(mock, linkRow(true))
	if _, err := s.Duplicate(context.Background(), "link-1", "actor-1", DuplicateRequest{Revision: 2, ReleaseTarget: ReleaseTargetSource}); err != nil {
		t.Fatalf("Duplicate must succeed: %v", err)
	}
	_ = now
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDuplicateRejectsScopeOutsideTargetRelease(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := svc(db)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("revision FROM assessment_access_links WHERE id = ? FOR UPDATE")).WillReturnRows(
		sqlmock.NewRows([]string{"exam_id", "published_version_id", "name", "enabled_sections", "audience_type", "audience_label", "access_mode", "availability_type", "opens_at", "closes_at", "revision"}).
			AddRow("exam-1", "ver-1", "Math only", `["math"]`, "anyone", nil, "student_code", "anytime", nil, nil, 2))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_access_link_members WHERE link_id")).
		WillReturnRows(sqlmock.NewRows([]string{"student_code", "student_name", "student_email"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"title", "provider_key", "organization_id", "current_published_version_id"}).
			AddRow("SAT Mock", "sat", nil, "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"is_published", "sat_publish_scope"}).AddRow(true, "reading-writing"))
	mock.ExpectRollback()
	_, err = s.Duplicate(context.Background(), "link-1", "actor-1", DuplicateRequest{
		Revision: 2, ReleaseTarget: ReleaseTargetSource,
	})
	if codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST for an empty duplicated scope, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
