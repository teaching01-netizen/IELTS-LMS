// Command e2e_seed creates the disposable fixtures consumed by the Playwright
// backend suite. It intentionally uses the Go services and auth boundary so
// the browser tests exercise the same contracts as a deployed Go instance.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/google/uuid"
)

const (
	builderEmail          = "e2e.builder@example.com"
	builderName           = "E2E Builder"
	studentEmail          = "e2e.student@example.com"
	studentName           = "Alice Candidate"
	studentCandidateID    = "alice"
	unregisteredEmail     = "e2e.unregistered.student@example.com"
	unregisteredName      = "Bob Candidate"
	unregisteredCode      = "W250334"
	adminOperatorEmail    = "e2e.admin.operator@example.com"
	adminOperatorName     = "E2E Admin Operator"
	lifecycleAdminEmail   = "e2e.admin@example.com"
	lifecycleAdminName    = "E2E Admin"
	activationPassword    = "Password123!"
	resetPassword         = "Password456!"
	builderSlug           = "e2e-builder-backend-draft"
	builderDurabilitySlug = "e2e-builder-draft-durability"
	studentSlug           = "e2e-student-backend-live"
	actStudentSlug        = "e2e-act-science-backend"
	expectedAnswer        = "seeded answer"
	actQuestionID         = "act-science-q1"
	actExpectedAnswer     = "A"
	listeningQuestionID   = "listening-q1"
	listeningQuestion2    = "listening-q2"
	listeningQuestion3    = "listening-q3"
	readingQuestionID     = "reading-q1"
)

type seedArgs struct {
	manifestPath            string
	builderStoragePath      string
	studentStoragePath      string
	unregisteredStoragePath string
	adminStoragePath        string
	frontendOrigin          string
}

type manifest struct {
	FrontendOrigin   string               `json:"frontendOrigin"`
	GeneratedAt      string               `json:"generatedAt"`
	Builder          builderManifest      `json:"builder"`
	Student          studentManifest      `json:"student"`
	ACT              actManifest          `json:"act"`
	StudentSelfPaced selfPacedManifest    `json:"studentSelfPaced"`
	Unregistered     unregisteredManifest `json:"unregisteredStudent"`
	Auth             authManifest         `json:"auth"`
}

type authManifest struct {
	AdminLifecycle lifecycleManifest `json:"adminLifecycle"`
}

type lifecycleManifest struct {
	Email                 string `json:"email"`
	ActivationToken       string `json:"activationToken"`
	ActivationPassword    string `json:"activationPassword"`
	PasswordResetToken    string `json:"passwordResetToken"`
	PasswordResetPassword string `json:"passwordResetPassword"`
}

type builderManifest struct {
	ExamID                string `json:"examId"`
	ExamSlug              string `json:"examSlug"`
	DraftDurabilityExamID string `json:"draftDurabilityExamId"`
	DraftVersionID        string `json:"draftVersionId"`
	InitialRevision       int    `json:"initialRevision"`
	InitialVersionCount   int    `json:"initialVersionCount"`
	StorageStatePath      string `json:"storageStatePath"`
}

type studentManifest struct {
	ExamID                    string `json:"examId"`
	ExamSlug                  string `json:"examSlug"`
	PublishedVersionID        string `json:"publishedVersionId"`
	ScheduleID                string `json:"scheduleId"`
	PrecheckScheduleID        string `json:"precheckScheduleId"`
	ProctorWorkflowScheduleID string `json:"proctorWorkflowScheduleId"`
	FlushScheduleID           string `json:"flushScheduleId"`
	SubmissionScheduleID      string `json:"submissionScheduleId"`
	LifecycleScheduleID       string `json:"lifecycleScheduleId"`
	CandidateID               string `json:"candidateId"`
	QuestionID                string `json:"questionId"`
	ExpectedAnswer            string `json:"expectedAnswer"`
	StorageStatePath          string `json:"storageStatePath"`
}

type actManifest struct {
	ExamID             string `json:"examId"`
	ExamSlug           string `json:"examSlug"`
	PublishedVersionID string `json:"publishedVersionId"`
	ScheduleID         string `json:"scheduleId"`
	CandidateID        string `json:"candidateId"`
	QuestionID         string `json:"questionId"`
	ExpectedAnswer     string `json:"expectedAnswer"`
}

type selfPacedManifest struct {
	ExamID             string `json:"examId"`
	ExamSlug           string `json:"examSlug"`
	PublishedVersionID string `json:"publishedVersionId"`
	ScheduleID         string `json:"scheduleId"`
}

type unregisteredManifest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	CandidateID      string `json:"candidateId"`
	StorageStatePath string `json:"storageStatePath"`
}

type authFixture struct {
	userID  string
	session string
	csrf    string
}

func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "e2e_seed: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	args, err := parseArgs()
	if err != nil {
		return err
	}
	for _, path := range []string{args.manifestPath, args.builderStoragePath, args.studentStoragePath, args.unregisteredStoragePath, args.adminStoragePath} {
		if err := ensureParent(path); err != nil {
			return err
		}
	}

	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}
	db, err := platformdb.Open(cfg)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err := cleanup(ctx, db); err != nil {
		return fmt.Errorf("cleanup: %w", err)
	}

	builder, err := createUser(ctx, db, cfg, auth.RoleBuilder, builderEmail, builderName, "", true)
	if err != nil {
		return err
	}
	student, err := createUser(ctx, db, cfg, auth.RoleStudent, studentEmail, studentName, studentCandidateID, true)
	if err != nil {
		return err
	}
	unregistered, err := createUser(ctx, db, cfg, auth.RoleStudent, unregisteredEmail, unregisteredName, unregisteredCode, true)
	if err != nil {
		return err
	}
	adminOperator, err := createUser(ctx, db, cfg, auth.RoleAdmin, adminOperatorEmail, adminOperatorName, "", true)
	if err != nil {
		return err
	}
	lifecycle, err := createLifecycleAdmin(ctx, db, lifecycleAdminEmail, lifecycleAdminName)
	if err != nil {
		return err
	}

	runner := tx.NewRunner(db)
	examService := exams.NewService(db, runner)
	scheduleService := schedules.NewService(db, runner)
	builderFixture, err := seedBuilder(ctx, examService, builder.userID)
	if err != nil {
		return fmt.Errorf("seed builder fixture: %w", err)
	}
	studentFixture, err := seedStudent(ctx, db, examService, scheduleService, builder.userID, student.userID, adminOperator.userID)
	if err != nil {
		return fmt.Errorf("seed student fixture: %w", err)
	}
	actFixture, err := seedACT(ctx, db, examService, scheduleService, builder.userID, student.userID, adminOperator.userID)
	if err != nil {
		return fmt.Errorf("seed ACT fixture: %w", err)
	}

	if err := writeStorageState(args.builderStoragePath, args.frontendOrigin, cfg, builder); err != nil {
		return err
	}
	if err := writeStorageState(args.studentStoragePath, args.frontendOrigin, cfg, student); err != nil {
		return err
	}
	if err := writeStorageState(args.unregisteredStoragePath, args.frontendOrigin, cfg, unregistered); err != nil {
		return err
	}
	if err := writeStorageState(args.adminStoragePath, args.frontendOrigin, cfg, adminOperator); err != nil {
		return err
	}

	out := manifest{
		FrontendOrigin: args.frontendOrigin,
		GeneratedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Builder: builderManifest{
			ExamID: builderFixture.examID, ExamSlug: builderSlug, DraftVersionID: builderFixture.draftID,
			DraftDurabilityExamID: builderFixture.draftDurabilityExamID,
			InitialRevision:       builderFixture.revision, InitialVersionCount: builderFixture.versionCount,
			StorageStatePath: args.builderStoragePath,
		},
		Student: studentManifest{
			ExamID: studentFixture.examID, ExamSlug: studentSlug, PublishedVersionID: studentFixture.publishedVersionID,
			ScheduleID: studentFixture.liveScheduleID, ProctorWorkflowScheduleID: studentFixture.proctorWorkflowScheduleID,
			PrecheckScheduleID:   studentFixture.precheckScheduleID,
			FlushScheduleID:      studentFixture.flushScheduleID,
			SubmissionScheduleID: studentFixture.submissionScheduleID, LifecycleScheduleID: studentFixture.lifecycleScheduleID,
			CandidateID: studentCandidateID, QuestionID: listeningQuestionID,
			ExpectedAnswer: expectedAnswer, StorageStatePath: args.studentStoragePath,
		},
		ACT: actManifest{
			ExamID: actFixture.examID, ExamSlug: actStudentSlug,
			PublishedVersionID: actFixture.publishedVersionID, ScheduleID: actFixture.scheduleID,
			CandidateID: studentCandidateID, QuestionID: actQuestionID, ExpectedAnswer: actExpectedAnswer,
		},
		StudentSelfPaced: selfPacedManifest{
			ExamID: studentFixture.examID, ExamSlug: studentSlug, PublishedVersionID: studentFixture.publishedVersionID,
			ScheduleID: studentFixture.selfPacedScheduleID,
		},
		Unregistered: unregisteredManifest{
			Email: unregisteredEmail, Password: activationPassword, CandidateID: unregisteredCode,
			StorageStatePath: args.unregisteredStoragePath,
		},
		Auth: authManifest{AdminLifecycle: lifecycleManifest{
			Email: lifecycle.email, ActivationToken: lifecycle.activationToken, ActivationPassword: activationPassword,
			PasswordResetToken: lifecycle.resetToken, PasswordResetPassword: resetPassword,
		}},
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(args.manifestPath, append(encoded, '\n'), 0o600); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}
	fmt.Printf("Seeded backend E2E fixtures: builder exam %s, student schedule %s\n", out.Builder.ExamID, out.Student.ScheduleID)
	return nil
}

func parseArgs() (seedArgs, error) {
	var out seedArgs
	flag.StringVar(&out.manifestPath, "manifest", "", "manifest output path")
	flag.StringVar(&out.builderStoragePath, "builder-storage", "", "builder Playwright storage state path")
	flag.StringVar(&out.studentStoragePath, "student-storage", "", "student Playwright storage state path")
	flag.StringVar(&out.unregisteredStoragePath, "unregistered-student-storage", "", "unregistered student storage state path")
	flag.StringVar(&out.adminStoragePath, "admin-storage", "", "admin Playwright storage state path")
	flag.StringVar(&out.frontendOrigin, "frontend-origin", "http://localhost:3000", "frontend origin")
	flag.Parse()
	for name, value := range map[string]string{
		"--manifest":                     out.manifestPath,
		"--builder-storage":              out.builderStoragePath,
		"--student-storage":              out.studentStoragePath,
		"--unregistered-student-storage": out.unregisteredStoragePath,
		"--admin-storage":                out.adminStoragePath,
	} {
		if strings.TrimSpace(value) == "" {
			return seedArgs{}, fmt.Errorf("%s is required", name)
		}
	}
	return out, nil
}

func cleanup(ctx context.Context, db *sql.DB) error {
	txn, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = txn.Rollback() }()

	// Terminalizations intentionally use NO ACTION FKs so a schedule cannot be
	// removed while its durable finalization record is still present.
	if _, err := txn.ExecContext(ctx, `
		DELETE FROM attempt_terminalizations
		WHERE schedule_id IN (
			SELECT id FROM exam_schedules WHERE exam_id IN (
			SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)
			)
		)`, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
		return err
	}
	if _, err := txn.ExecContext(ctx, `
		DELETE FROM exam_schedules
		WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?))`, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
		return err
	}
	if _, err := txn.ExecContext(ctx, `
		DELETE FROM exam_events
		WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?))`, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
		return err
	}
	if _, err := txn.ExecContext(ctx, "DELETE FROM exam_entities WHERE slug IN (?, ?, ?, ?)", builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
		return err
	}
	if _, err := txn.ExecContext(ctx, `
		DELETE FROM users
		WHERE email IN (?, ?, ?, ?, ?)`, builderEmail, studentEmail, unregisteredEmail, adminOperatorEmail, lifecycleAdminEmail); err != nil {
		return err
	}
	return txn.Commit()
}

func createUser(ctx context.Context, db *sql.DB, cfg config.Config, role, email, displayName, studentID string, withSession bool) (authFixture, error) {
	id := uuid.NewString()
	now := time.Now().UTC()
	hash, err := auth.HashPassword(activationPassword)
	if err != nil {
		return authFixture{}, err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, display_name, role, state, organization_id, failed_login_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'active', 'e2e-org', 0, ?, ?)`, id, strings.ToLower(email), displayName, role, now, now); err != nil {
		return authFixture{}, fmt.Errorf("insert %s user: %w", email, err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO user_password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)`, id, hash, now); err != nil {
		return authFixture{}, err
	}
	if role == auth.RoleStudent {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO student_profiles (user_id, student_id, full_name, email, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`, id, studentID, displayName, strings.ToLower(email), now, now); err != nil {
			return authFixture{}, err
		}
	} else if _, err := db.ExecContext(ctx, `
		INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`, id, displayName, strings.ToLower(email), now, now); err != nil {
		return authFixture{}, err
	}
	fixture := authFixture{userID: id}
	if withSession {
		_, fixture.session, fixture.csrf, err = auth.CreateSession(ctx, db, cfg, id, role, nil, nil, now)
		if err != nil {
			return authFixture{}, err
		}
	}
	return fixture, nil
}

type lifecycleFixture struct {
	email, activationToken, resetToken string
}

func createLifecycleAdmin(ctx context.Context, db *sql.DB, email, displayName string) (lifecycleFixture, error) {
	id := uuid.NewString()
	now := time.Now().UTC()
	hash, err := auth.HashPassword(activationPassword)
	if err != nil {
		return lifecycleFixture{}, err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, display_name, role, state, organization_id, failed_login_count, created_at, updated_at)
		VALUES (?, ?, ?, 'admin', 'pending_activation', 'e2e-org', 0, ?, ?)`, id, email, displayName, now, now); err != nil {
		return lifecycleFixture{}, err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO user_password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)`, id, hash, now); err != nil {
		return lifecycleFixture{}, err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, id, displayName, email, now, now); err != nil {
		return lifecycleFixture{}, err
	}
	activation, err := insertToken(ctx, db, "account_activation_tokens", id, 30*time.Minute)
	if err != nil {
		return lifecycleFixture{}, err
	}
	reset, err := insertToken(ctx, db, "password_reset_tokens", id, 30*time.Minute)
	if err != nil {
		return lifecycleFixture{}, err
	}
	return lifecycleFixture{email: email, activationToken: activation, resetToken: reset}, nil
}

func insertToken(ctx context.Context, db *sql.DB, table, userID string, lifetime time.Duration) (string, error) {
	token, err := auth.RandomToken(32)
	if err != nil {
		return "", err
	}
	query := fmt.Sprintf("INSERT INTO %s (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))", table)
	if _, err := db.ExecContext(ctx, query, uuid.NewString(), userID, auth.SHA256Hex(token), time.Now().UTC().Add(lifetime)); err != nil {
		return "", err
	}
	return token, nil
}

type builderFixture struct {
	examID, draftID, draftDurabilityExamID string
	revision, versionCount                 int
}

func seedBuilder(ctx context.Context, service *exams.Service, ownerID string) (builderFixture, error) {
	fixture, err := seedBuilderExam(ctx, service, ownerID, builderSlug, "Builder Backend E2E Draft")
	if err != nil {
		return builderFixture{}, err
	}
	durability, err := seedBuilderExam(ctx, service, ownerID, builderDurabilitySlug, "Builder Draft Durability E2E")
	if err != nil {
		return builderFixture{}, err
	}
	fixture.draftDurabilityExamID = durability.examID
	return fixture, nil
}

func seedBuilderExam(ctx context.Context, service *exams.Service, ownerID, slug, title string) (builderFixture, error) {
	exam, err := service.Create(ctx, exams.CreateRequest{
		Slug: slug, Title: title, ExamType: exams.ExamTypeAcademic,
		Visibility: exams.VisibilityOrganization, OrganizationID: stringPtr("e2e-org"), OwnerID: ownerID,
	})
	if err != nil {
		return builderFixture{}, err
	}
	draft, err := service.SaveDraft(ctx, exam.ID, ownerID, exams.SaveDraftRequest{
		Content: mustJSON(minimalExamContent(title, slug+"-passage-1", slug+"-q1", "Builder prompt", "builder-correct")),
		Config:  mustJSON(minimalConfig(title)), Revision: exam.Revision,
	})
	if err != nil {
		return builderFixture{}, err
	}
	updated, err := service.Get(ctx, exam.ID)
	if err != nil {
		return builderFixture{}, err
	}
	versions, err := service.ListVersions(ctx, exam.ID)
	if err != nil {
		return builderFixture{}, err
	}
	return builderFixture{examID: exam.ID, draftID: draft.ID, revision: updated.Revision, versionCount: len(versions)}, nil
}

type studentFixture struct {
	examID, publishedVersionID, liveScheduleID, precheckScheduleID, proctorWorkflowScheduleID, flushScheduleID, submissionScheduleID, lifecycleScheduleID, selfPacedScheduleID string
}

func seedStudent(ctx context.Context, db *sql.DB, examService *exams.Service, scheduleService *schedules.Service, ownerID, studentID, proctorID string) (studentFixture, error) {
	exam, err := examService.Create(ctx, exams.CreateRequest{
		Slug: studentSlug, Title: "Student Backend E2E Delivery", ExamType: exams.ExamTypeAcademic,
		Visibility: exams.VisibilityOrganization, OrganizationID: stringPtr("e2e-org"), OwnerID: ownerID,
	})
	if err != nil {
		return studentFixture{}, err
	}
	if _, err := examService.SaveDraft(ctx, exam.ID, ownerID, exams.SaveDraftRequest{
		Content: mustJSON(minimalExamContent("Student Backend E2E Delivery", "student-passage-1", readingQuestionID, "Write the missing word from the passage.", expectedAnswer)),
		Config:  mustJSON(minimalConfig("Student Backend E2E Delivery")), Revision: exam.Revision,
	}); err != nil {
		return studentFixture{}, err
	}
	updated, err := examService.Get(ctx, exam.ID)
	if err != nil {
		return studentFixture{}, err
	}
	published, err := examService.Publish(ctx, exam.ID, ownerID, exams.PublishRequest{PublishNotes: stringPtr("published for Go backend E2E"), Revision: updated.Revision})
	if err != nil {
		return studentFixture{}, err
	}
	start := time.Now().UTC().Add(-5 * time.Minute)
	end := start.Add(3 * time.Hour)
	common := schedules.CreateRequest{
		ExamID: exam.ID, PublishedVersionID: published.ID, CohortName: "Backend E2E Cohort",
		ProctorDisplayName: exam.Title, GradingDisplayName: exam.Title, Institution: stringPtr("Codex IELTS Lab"),
		StartTime: start, EndTime: end, CreatedBy: ownerID,
	}
	createAssignedSchedule := func(cohortName string, startRuntime bool) (schedules.Schedule, error) {
		req := common
		req.CohortName = cohortName
		created, createErr := scheduleService.Create(ctx, req)
		if createErr != nil {
			return schedules.Schedule{}, createErr
		}
		if _, assignErr := db.ExecContext(ctx, `
			INSERT INTO schedule_staff_assignments
			  (id, schedule_id, actor_id, role, granted_by, created_at, user_id)
			VALUES (?, ?, ?, 'proctor', ?, UTC_TIMESTAMP(6), ?)`,
			uuid.NewString(), created.ID, proctorID, proctorID, proctorID); assignErr != nil {
			return schedules.Schedule{}, fmt.Errorf("assign e2e proctor: %w", assignErr)
		}
		if startRuntime {
			if _, startErr := scheduleService.ApplyRuntimeCommand(ctx, created.ID, schedules.RuntimeCommand{Action: schedules.CommandStart, Reason: stringPtr("seed Go backend student workflow")}); startErr != nil {
				return schedules.Schedule{}, startErr
			}
		}
		return created, nil
	}
	live, err := createAssignedSchedule("Backend E2E Cohort", true)
	if err != nil {
		return studentFixture{}, err
	}
	if _, err := scheduleService.CreateRegistration(ctx, live.ID, schedules.RegistrationRequest{
		Wcode: studentCandidateID, Email: studentEmail, StudentName: studentName, UserID: studentID,
	}); err != nil {
		return studentFixture{}, err
	}
	precheck, err := createAssignedSchedule("Backend E2E Precheck", false)
	if err != nil {
		return studentFixture{}, err
	}
	proctorWorkflow, err := createAssignedSchedule("Backend E2E Proctor Workflow", true)
	if err != nil {
		return studentFixture{}, err
	}
	if _, err := scheduleService.CreateRegistration(ctx, proctorWorkflow.ID, schedules.RegistrationRequest{
		Wcode: studentCandidateID, Email: studentEmail, StudentName: studentName, UserID: studentID,
	}); err != nil {
		return studentFixture{}, err
	}
	flush, err := createAssignedSchedule("Backend E2E Flush", false)
	if err != nil {
		return studentFixture{}, err
	}
	submission, err := createAssignedSchedule("Backend E2E Submission", false)
	if err != nil {
		return studentFixture{}, err
	}
	lifecycle, err := createAssignedSchedule("Backend E2E Lifecycle", false)
	if err != nil {
		return studentFixture{}, err
	}
	selfPacedRequest := common
	selfPacedRequest.CohortName = "Backend E2E Self-paced"
	selfPaced, err := scheduleService.Create(ctx, selfPacedRequest)
	if err != nil {
		return studentFixture{}, err
	}
	return studentFixture{
		examID: exam.ID, publishedVersionID: published.ID, liveScheduleID: live.ID,
		precheckScheduleID:        precheck.ID,
		proctorWorkflowScheduleID: proctorWorkflow.ID,
		flushScheduleID:           flush.ID, submissionScheduleID: submission.ID,
		lifecycleScheduleID: lifecycle.ID, selfPacedScheduleID: selfPaced.ID,
	}, nil
}

type actFixture struct {
	examID, publishedVersionID, scheduleID string
}

func seedACT(ctx context.Context, db *sql.DB, examService *exams.Service, scheduleService *schedules.Service, ownerID, studentID, proctorID string) (actFixture, error) {
	exam, err := examService.Create(ctx, exams.CreateRequest{
		Slug: actStudentSlug, Title: "ACT Science Backend E2E", ExamType: exams.ExamTypeACT,
		Visibility: exams.VisibilityOrganization, OrganizationID: stringPtr("e2e-org"), OwnerID: ownerID,
		ProviderKey: stringPtr(exams.ProviderACT), ProviderExamType: stringPtr("ACT"),
	})
	if err != nil {
		return actFixture{}, err
	}
	if _, err := examService.SaveDraft(ctx, exam.ID, ownerID, exams.SaveDraftRequest{
		Content: mustJSON(minimalACTExamContent("ACT Science Backend E2E", actQuestionID)),
		Config:  mustJSON(minimalACTConfig("ACT Science Backend E2E")), Revision: exam.Revision,
	}); err != nil {
		return actFixture{}, err
	}
	draft, err := examService.Get(ctx, exam.ID)
	if err != nil {
		return actFixture{}, err
	}
	published, err := examService.Publish(ctx, exam.ID, ownerID, exams.PublishRequest{
		PublishNotes: stringPtr("published for ACT Go backend E2E"), Revision: draft.Revision,
	})
	if err != nil {
		return actFixture{}, err
	}
	start := time.Now().UTC().Add(-5 * time.Minute)
	schedule, err := scheduleService.Create(ctx, schedules.CreateRequest{
		ExamID: exam.ID, PublishedVersionID: published.ID, CohortName: "ACT Science Backend E2E",
		ProctorDisplayName: exam.Title, GradingDisplayName: exam.Title, Institution: stringPtr("Codex IELTS Lab"),
		StartTime: start, EndTime: start.Add(3 * time.Hour), CreatedBy: ownerID,
	})
	if err != nil {
		return actFixture{}, err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO schedule_staff_assignments
		  (id, schedule_id, actor_id, role, granted_by, created_at, user_id)
		VALUES (?, ?, ?, 'proctor', ?, UTC_TIMESTAMP(6), ?)`,
		uuid.NewString(), schedule.ID, proctorID, proctorID, proctorID); err != nil {
		return actFixture{}, fmt.Errorf("assign ACT e2e proctor: %w", err)
	}
	if _, err := scheduleService.ApplyRuntimeCommand(ctx, schedule.ID, schedules.RuntimeCommand{
		Action: schedules.CommandStart, Reason: stringPtr("seed ACT Go backend student workflow"),
	}); err != nil {
		return actFixture{}, err
	}
	if _, err := scheduleService.CreateRegistration(ctx, schedule.ID, schedules.RegistrationRequest{
		Wcode: studentCandidateID, Email: studentEmail, StudentName: studentName, UserID: studentID,
	}); err != nil {
		return actFixture{}, err
	}
	return actFixture{examID: exam.ID, publishedVersionID: published.ID, scheduleID: schedule.ID}, nil
}

type storageState struct {
	Cookies []storageCookie `json:"cookies"`
	Origins []any           `json:"origins"`
}

type storageCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

func writeStorageState(path, frontendOrigin string, cfg config.Config, fixture authFixture) error {
	u, err := url.Parse(frontendOrigin)
	if err != nil || u.Hostname() == "" {
		return fmt.Errorf("invalid frontend origin %q", frontendOrigin)
	}
	expires, _ := auth.SessionExpiry(cfg, auth.RoleStudent, time.Now().UTC())
	state := storageState{
		Cookies: []storageCookie{
			{Name: cfg.EffectiveSessionCookieName(), Value: fixture.session, Domain: u.Hostname(), Path: "/", Expires: float64(expires.Unix()), HTTPOnly: true, Secure: cfg.CookieSecure, SameSite: "Lax"},
			{Name: cfg.EffectiveCsrfCookieName(), Value: fixture.csrf, Domain: u.Hostname(), Path: "/", Expires: float64(expires.Unix()), HTTPOnly: false, Secure: cfg.CookieSecure, SameSite: "Lax"},
		},
		Origins: []any{},
	}
	encoded, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
		return fmt.Errorf("write storage state %s: %w", path, err)
	}
	return nil
}

func ensureParent(path string) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", parent, err)
	}
	return nil
}

func stringPtr(value string) *string { return &value }

func mustJSON(value any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}

func minimalExamContent(title, passageID, questionID, prompt, correctAnswer string) map[string]any {
	audioURL := "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
	question := func(id, questionPrompt string) map[string]any {
		return map[string]any{"id": id, "prompt": questionPrompt, "correctAnswer": correctAnswer, "answerRule": "ONE_WORD"}
	}
	return map[string]any{
		"title": title, "type": "Academic", "providerKey": "ielts", "activeModule": "listening",
		"activePassageId": passageID, "activeListeningPartId": "listening-part-1",
		"reading": map[string]any{"passages": []any{map[string]any{
			"id": passageID, "title": "Backend E2E Passage",
			"content": "This seeded passage exists so the browser flow can validate, persist, and submit a real backend-backed answer.",
			"blocks":  []any{map[string]any{"id": "reading-block-1", "type": "SHORT_ANSWER", "instruction": "Answer using one word.", "questions": []any{question(questionID, prompt)}}},
		}}},
		"listening": map[string]any{"parts": []any{map[string]any{
			"id": "listening-part-1", "title": "Backend E2E Listening Part 1", "audioUrl": audioURL,
			"transcript": "The seeded listening transcript provides a scrollable reference for viewport acceptance.", "pins": []any{},
			"blocks": []any{map[string]any{"id": "listening-block-1", "type": "SHORT_ANSWER", "instruction": "Answer using one word.", "questions": []any{
				question(listeningQuestionID, "What is the seeded listening answer?"),
				question(listeningQuestion2, "What is the second seeded listening answer?"),
				question(listeningQuestion3, "What is the third seeded listening answer?"),
			}}},
		}}},
		"writing": map[string]any{"task1Prompt": "Task 1: Summarise the information by selecting and reporting the main features.", "task2Prompt": "Task 2: Discuss both views and give your own opinion.", "tasks": []any{
			map[string]any{"taskId": "task1", "prompt": "Task 1: Summarise the information by selecting and reporting the main features."},
			map[string]any{"taskId": "task2", "prompt": "Task 2: Discuss both views and give your own opinion."},
		}},
		"speaking": map[string]any{"part1Topics": []any{}, "cueCard": "", "part3Discussion": []any{}},
	}
}

func minimalConfig(title string) map[string]any {
	section := func(label string, duration, order int, enabled bool) map[string]any {
		return map[string]any{"enabled": enabled, "label": label, "duration": duration, "order": order, "gapAfterMinutes": 0, "allowedQuestionTypes": []string{"SHORT_ANSWER", "TFNG", "CLOZE", "MATCHING", "MAP", "MULTI_MCQ"}}
	}
	return map[string]any{
		"general": map[string]any{"preset": "Academic", "type": "Academic", "title": title, "summary": "Seeded Go backend E2E exam", "instructions": "Answer the seeded questions."},
		"sections": map[string]any{
			"listening": section("Listening", 30, 0, true),
			"reading":   section("Reading", 60, 1, true),
			"writing":   section("Writing", 60, 2, true),
			"speaking":  section("Speaking", 15, 3, false),
		},
		"progression": map[string]any{"autoSubmit": true, "lockAfterSubmit": true, "allowPause": false, "showWarnings": true, "warningThreshold": 3},
		"delivery":    map[string]any{"launchMode": "proctor_start", "transitionMode": "auto_with_proctor_override", "allowedExtensionMinutes": []int{5, 10}},
		"scoring":     map[string]any{"overallRounding": "nearest-0.5"},
		"security":    map[string]any{"requireFullscreen": true, "tabSwitchRule": "warn", "heartbeatIntervalSeconds": 15, "heartbeatMissThreshold": 3, "bufferAnswersOffline": true, "allowSafariWithAcknowledgement": true},
	}
}

func minimalACTExamContent(title, questionID string) map[string]any {
	return map[string]any{
		"title": title, "type": "ACT", "providerKey": "act", "activeModule": "science",
		"activePassageId": "", "activeListeningPartId": "", "activeScienceStimulusId": "act-stimulus-1",
		"reading":   map[string]any{"passages": []any{}},
		"listening": map[string]any{"parts": []any{}},
		"writing":   map[string]any{"task1Prompt": "", "task2Prompt": "", "tasks": []any{}},
		"speaking":  map[string]any{"part1Topics": []any{}, "cueCard": "", "part3Discussion": []any{}},
		"science": map[string]any{"stimuli": []any{map[string]any{
			"id": "act-stimulus-1", "title": "Seeded ecology experiment", "content": "Researchers measured plant growth under four light conditions over six weeks.",
			"blocks": []any{map[string]any{
				"id": "act-science-block-1", "type": "SINGLE_MCQ", "instruction": "Use the experiment data to answer the question.",
				"stem": "Which condition produced the greatest plant growth?",
				"questions": []any{map[string]any{
					"id": questionID, "stem": "Which condition produced the greatest plant growth?", "skillCategory": "interpretation_of_data",
					"options": []any{
						map[string]any{"id": "A", "text": "High light", "isCorrect": true},
						map[string]any{"id": "B", "text": "Low light", "isCorrect": false},
						map[string]any{"id": "C", "text": "No light", "isCorrect": false},
						map[string]any{"id": "D", "text": "Variable light", "isCorrect": false},
					},
				}},
			}},
			"images": []any{}, "wordCount": 13,
		}}},
	}
}

func minimalACTConfig(title string) map[string]any {
	section := func(label string, duration, order int, enabled bool, allowed []string) map[string]any {
		return map[string]any{"enabled": enabled, "label": label, "duration": duration, "order": order, "gapAfterMinutes": 0, "allowedQuestionTypes": allowed}
	}
	return map[string]any{
		"general": map[string]any{"preset": "ACT Science", "type": "ACT", "title": title, "summary": "Seeded ACT Science E2E exam", "instructions": "Use the stimulus data to answer each question."},
		"sections": map[string]any{
			"listening": section("Listening", 1, 1, false, []string{}),
			"reading":   section("Reading", 1, 2, false, []string{}),
			"writing":   section("Writing", 1, 3, false, []string{}),
			"speaking":  section("Speaking", 1, 4, false, []string{}),
			"science":   section("Science", 1, 0, true, []string{"SINGLE_MCQ"}),
		},
		"progression": map[string]any{"autoSubmit": true, "lockAfterSubmit": true, "allowPause": false, "showWarnings": true, "warningThreshold": 3},
		"delivery":    map[string]any{"launchMode": "proctor_start", "transitionMode": "auto_with_proctor_override", "allowedExtensionMinutes": []int{5, 10}},
		"scoring":     map[string]any{"overallRounding": "nearest-0.5"},
		"security":    map[string]any{"tabSwitchRule": "warn", "detectSecondaryScreen": false, "blockClipboard": false, "antiScreenshotGuardEnabled": false, "preventAutofill": false, "preventAutocorrect": false, "preventTranslation": false, "heartbeatIntervalSeconds": 15, "heartbeatMissThreshold": 3, "bufferAnswersOffline": true, "allowSafariWithAcknowledgement": true, "proctoringFlags": map[string]any{"webcam": false, "audio": false, "screen": false}},
	}
}
