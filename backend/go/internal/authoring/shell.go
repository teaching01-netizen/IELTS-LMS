package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// ShellState is the explicit lifecycle answer of the authoring shell read.
//
// It exists so the read can distinguish "this exam exists but nobody has
// opened an editable draft yet" from "there is no such exam" WITHOUT
// overloading an HTTP status. Both cases used to answer 404 NOT_FOUND, so
// every client had to guess what a 404 meant — in production a normal
// pre-draft exam therefore surfaced as a failed request (ApiClientError,
// React Query error state, console stack) and the UI inferred "no editable
// draft" from the status code alone.
type ShellState string

const (
	// ShellStateReady: the exam has a current editable draft, returned in
	// ShellResult.Shell.
	ShellStateReady ShellState = "READY"
	// ShellStateNoDraft: the exam exists and carries no draft pointer. This is
	// a legitimate domain state reported as 200 with a null shell, never an
	// error. Refreshing must never create a draft: only the explicit
	// POST /shell command (OpenShell) moves this state to READY.
	ShellStateNoDraft ShellState = "NO_DRAFT"
)

// ShellResult is the wire shape of
// GET /v1/assessment-authoring/exams/{examId}/shell.
//
// `shell` is serialized even when null so a client can read `state` without
// probing for a field's presence.
type ShellResult struct {
	State ShellState `json:"state"`
	Shell *Shell     `json:"shell"`
}

// examNotFoundError reports a missing exam row. It is deliberately NOT the
// generic notFoundError: on this route a 404 has exactly one meaning, and a
// distinct code keeps that meaning machine-readable for clients and
// telemetry.
func examNotFoundError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeExamNotFound, msg)
}

// draftIntegrityError reports a dangling current_draft_version_id: the exam
// row names a version that is absent, owned by another exam, or not a draft.
//
// This must never collapse into NO_DRAFT. NO_DRAFT means "no draft pointer",
// which is a state a user can legitimately open from; a dangling pointer means
// the exam's own pointer disagrees with the version table, which no user
// action can repair. Details carry the identifiers so the failure is
// actionable in operational telemetry without logging question content.
func draftIntegrityError(examID, draftVersionID string) *apperrors.Error {
	err := apperrors.New(apperrors.CodeDraftIntegrity, fmt.Sprintf(
		"Exam %s references draft version %s, which is missing, owned by another exam, or not a draft.",
		examID, draftVersionID,
	))
	err.Details = map[string]any{"examId": examID, "draftVersionId": draftVersionID}
	return err
}

// ShellLifecycle is the authoring shell READ contract. It answers the
// lifecycle question explicitly instead of making the client interpret a
// status code:
//
//	exam row absent                    -> EXAM_NOT_FOUND (404)
//	draft pointer NULL/empty           -> NO_DRAFT       (200, shell null)
//	pointer set, version unusable      -> DRAFT_INTEGRITY_VIOLATION (500)
//	valid current draft                -> READY         (200)
//
// It is a pure read: it never creates a draft, takes no write transaction and
// no row lock, so a refresh (or a refetch storm) can never change the answer's
// meaning. Opening a draft stays an explicit command (OpenShell).
func (s *Service) ShellLifecycle(ctx context.Context, examID string) (ShellResult, error) {
	return s.bulkShell(ctx, examID)
}

// ValidateExam runs the SAT four-rule publish-content gate when the exam
// provider is sat and a light structural gate otherwise. A mid-check draft
// revision move is a CONFLICT (mirrors validate()).
func (s *Service) ValidateExam(ctx context.Context, examID string) (ValidationReport, error) {
	shell, err := s.Shell(ctx, examID)
	if err != nil {
		return ValidationReport{}, err
	}
	rep := ValidationReport{ExamID: examID, VersionID: shell.VersionID, VersionRevision: shell.VersionRevision, Errors: []ValidationIssue{}, Warnings: []ValidationIssue{}}
	if shell.ProviderKey != "sat" {
		for _, sec := range shell.Sections {
			if len(sec.Modules) == 0 {
				rep.Errors = append(rep.Errors, ValidationIssue{Path: sec.SectionKey, Message: "Section must contain at least one module.", Blocking: true})
			}
		}
		rep.Valid = len(rep.Errors) == 0
		return rep, nil
	}
	return s.validateSATExam(ctx, shell, rep)
}

type sectionQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Service) loadSections(ctx context.Context, q sectionQuerier, versionID string) ([]Section, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, revision FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order ASC", versionID)
	if err != nil {
		if isMissingTable(err) {
			return []Section{}, nil
		}
		return nil, err
	}
	type secRow struct {
		id, key, title       string
		order, dur, brk, rev int
	}
	secs := []secRow{}
	for rows.Next() {
		var r secRow
		if err := rows.Scan(&r.id, &r.key, &r.title, &r.order, &r.dur, &r.brk, &r.rev); err != nil {
			rows.Close()
			return nil, err
		}
		secs = append(secs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Section, 0, len(secs))
	for _, sr := range secs {
		mods, err := s.loadModules(ctx, q, sr.id)
		if err != nil {
			return nil, err
		}
		rp, err := s.loadRouting(ctx, q, sr.id)
		if err != nil {
			return nil, err
		}
		deriveRoutingOperational(rp, sr.key, mods)
		out = append(out, Section{ID: sr.id, SectionKey: sr.key, Title: sr.title, DisplayOrder: sr.order, DurationSeconds: sr.dur, BreakAfterSecs: sr.brk, Revision: sr.rev, RoutingPolicy: rp, Modules: mods})
	}
	return out, nil
}

func (s *Service) loadModules(ctx context.Context, q sectionQuerier, sectionID string) ([]Module, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, tool_policy, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order ASC", sectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Module{}
	for rows.Next() {
		var m Module
		var tool sql.NullString
		if err := rows.Scan(&m.ID, &m.ModuleKey, &m.Title, &m.DisplayOrder, &m.DurationSeconds, &m.TargetQuestionCount, &m.AdaptiveRole, &tool, &m.Revision); err != nil {
			return nil, err
		}
		if tool.Valid && strings.TrimSpace(tool.String) != "" {
			m.ToolPolicy = json.RawMessage(tool.String)
		} else {
			m.ToolPolicy = json.RawMessage("{}")
		}
		qs, err := s.loadSummaries(ctx, q, m.ID)
		if err != nil {
			return nil, err
		}
		m.Questions = qs
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) loadSummaries(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, moduleID string) ([]QuestionSummary, error) {
	rows, err := loadQuestionValidationRows(ctx, q, moduleID)
	if err != nil {
		return nil, err
	}
	out := make([]QuestionSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.summary())
	}
	return out, nil
}

func (s *Service) loadRouting(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, sectionID string) (*RoutingPolicy, error) {
	var rp RoutingPolicy
	var cfg string
	err := q.QueryRowContext(ctx, "SELECT id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?", sectionID).Scan(&rp.ID, &rp.BaseModuleID, &rp.LowerModuleID, &rp.HigherModuleID, &rp.PolicyKey, &cfg, &rp.Revision)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(cfg), &parsed); err == nil {
		if v, ok := parsed["minimumCorrectForHigher"].(float64); ok {
			rp.MinimumCorrectForHigher = int(v)
		}
		// NOTE: operationalQuestionCount is NOT parsed from policy_config
		// (see assembleShellTree): real rows are threshold-only, so parsing
		// projected 0 and stuck the release page at 1. The nested path is
		// only used by buildShellTx and the equivalence harness; both set it
		// via deriveRoutingOperational below.
	}
	return &rp, nil
}

// deriveRoutingOperational sets rp.OperationalCount from the live base module
// shape (see derivedOperationalCount in bulk_read.go). Callers that assemble
// a Section outside assembleShellTree must call this so both read paths
// project the same derived value.
func deriveRoutingOperational(rp *RoutingPolicy, sectionKey string, mods []Module) {
	if rp == nil {
		return
	}
	for _, m := range mods {
		if m.ID != rp.BaseModuleID {
			continue
		}
		pretest := 0
		for _, qs := range m.Questions {
			if qs.IsPretest {
				pretest++
			}
		}
		rp.OperationalCount = derivedOperationalCount(sectionKey, m.ModuleKey, m.TargetQuestionCount, pretest)
		return
	}
	rp.OperationalCount = 1
}
