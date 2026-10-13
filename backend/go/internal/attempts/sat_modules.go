package attempts

// Single owner of the SAT module lifecycle rule: which stored module states may
// a SAT attempt be finished on, and which module shape must exist when it is.
//
// internal/sat (which imports this package) delegates its finalization check to
// SATModuleTerminal instead of restating it, and the SQL that filters terminal
// modules is built from these constants instead of the literals — so the rule
// has one Go implementation and one vocabulary.
import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpublish"
)

const (
	// Terminal states for assessment_module_attempts accepted at completion.
	SATModuleSubmitted = "submitted"
	SATModuleLocked    = "locked"

	// Section keys owned by the SAT provider.
	SATSectionReadingWriting = satpublish.SectionReadingWriting
	SATSectionMath           = satpublish.SectionMath
)

// SATModuleTerminal reports whether a stored module state is one the SAT
// completion path accepts as done.
func SATModuleTerminal(state string) bool {
	switch state {
	case SATModuleSubmitted, SATModuleLocked:
		return true
	default:
		return false
	}
}

// SATModuleRequiredSections is the section set a full SAT sitting holds. A run
// narrowed by a Student Access link declares a subset instead (see
// satRequiredSectionsTx), which is the only reason this is a variable and not a
// literal inside Validate.
var SATModuleRequiredSections = []string{SATSectionReadingWriting, SATSectionMath}

// SATModuleTopology is the module shape observed for one attempt under its row
// lock.
type SATModuleTopology struct {
	// Terminal counts rows in a terminal state; Unfinished counts the rest.
	Terminal   int
	Unfinished int
	// Unresolved counts rows whose module/section could not be resolved, so a
	// row the joins cannot see is refused rather than ignored.
	Unresolved int
	// Sections maps section key -> terminal module count.
	Sections map[string]int
}

// Validate refuses every shape the SAT completion path cannot finish. A SAT
// attempt may be finished only when it holds at least one module attempt in
// each required section and every row is terminal, so completion cannot block
// further work while required answers are still writable.
//
// required is the section set the run declared; no arguments means the full SAT
// pair, which is what an unscoped run holds. A narrowed run passes its subset,
// and every other rule (terminal rows only, no unresolved rows, at least one
// module) still applies unchanged.
func (t SATModuleTopology) Validate(required ...string) error {
	if len(required) == 0 {
		required = SATModuleRequiredSections
	}
	if t.Terminal+t.Unfinished+t.Unresolved == 0 {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "The SAT attempt has no module submissions.", HTTPStatus: 409}
	}
	if t.Unresolved > 0 {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "The SAT attempt has module submissions outside any assessment section.", HTTPStatus: 409, Details: map[string]any{"unresolvedModules": t.Unresolved}}
	}
	if t.Unfinished > 0 {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "All SAT modules must be submitted before the exam can be submitted.", HTTPStatus: 409, Details: map[string]any{"unfinishedModules": t.Unfinished}}
	}
	var missing []string
	for _, section := range required {
		if t.Sections[section] == 0 {
			missing = append(missing, section)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return &apperrors.Error{
			Code:       apperrors.CodeConflict,
			Message:    fmt.Sprintf("The SAT attempt is missing required section modules: %s.", strings.Join(missing, ", ")),
			HTTPStatus: 409,
			Details:    map[string]any{"missingSections": missing},
		}
	}
	return nil
}

// ensureSATModuleTopologyTx loads the attempt's module topology and validates
// it. Called from submitInTx while the caller holds the attempt row lock.
//
// Read-only, no FOR UPDATE: module mutations take the attempt row lock first
// (StartModule/SubmitModule run ensureAttemptCanWorkTx before touching
// assessment_module_attempts) and this check runs under that same lock, so no
// module can leave the terminal set between this read and the commit. A module
// INSERT racing the commit is rejected by the now-terminal attempt row instead
// of being created under it. The joins are LEFT joins so an orphaned module row
// still appears (as Unresolved) rather than hiding behind a join.
func ensureSATModuleTopologyTx(ctx context.Context, q tx.Tx, attemptID string) error {
	required, err := satRequiredSectionsTx(ctx, q, attemptID)
	if err != nil {
		return err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT COALESCE(sch.sat_session_mode, 'practice') = 'classroom', COALESCE(s.section_key, ''), ma.state, COALESCE(m.adaptive_role, ''), COALESCE(m.id, ''),
			COALESCE(d.selected_module_id, ''), COALESCE(CAST(v.sat_classroom_plan AS CHAR), '')
		FROM assessment_module_attempts ma
		LEFT JOIN student_attempts a ON a.id = ma.attempt_id
		LEFT JOIN exam_schedules sch ON sch.id = a.schedule_id
		LEFT JOIN assessment_modules m ON m.id = ma.module_id
		LEFT JOIN assessment_sections s ON s.id = m.section_id
		LEFT JOIN exam_versions v ON v.id = s.exam_version_id
		LEFT JOIN assessment_route_decisions d ON d.attempt_id = ma.attempt_id AND d.section_id = m.section_id
		WHERE ma.attempt_id = ?`, attemptID)
	if err != nil {
		return err
	}
	defer rows.Close()
	topology := SATModuleTopology{Sections: map[string]int{}}
	var modules []satModuleRow
	for rows.Next() {
		var row satModuleRow
		var state string
		if err := rows.Scan(&row.classroom, &row.section, &state, &row.role, &row.moduleID, &row.selected, &row.plan); err != nil {
			return err
		}
		if row.section == "" {
			topology.Unresolved++
			continue
		}
		modules = append(modules, row)
		if !SATModuleTerminal(state) {
			topology.Unfinished++
			continue
		}
		topology.Terminal++
		topology.Sections[row.section]++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := topology.Validate(required...); err != nil {
		return err
	}
	awaiting, err := AwaitingStaffRouteTx(ctx, q, attemptID)
	if err != nil {
		return err
	}
	if awaiting {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "The SAT attempt is waiting for staff to assign Module 2.", HTTPStatus: 409}
	}
	if err := satExpectedSequence(modules, required); err != nil {
		return err
	}
	return nil
}

type satModuleRow struct {
	classroom                               bool
	section, role, moduleID, selected, plan string
}

// satExpectedSequence enforces docs/sat_newmode.md 5.5: every module row is one
// the section's shape admits. A base-entry section holds its Module 1 and, once
// a route decision exists, exactly the decided Module 2 (a branch the plan
// uses). A standalone Module 2 section holds only its configured branch.
func satExpectedSequence(modules []satModuleRow, required []string) error {
	unexpected := &apperrors.Error{Code: apperrors.CodeConflict, Message: "The SAT attempt holds modules outside its expected sequence.", HTTPStatus: 409}
	if len(modules) == 0 {
		return nil // SATModuleTopology.Validate reports the empty attempt first.
	}
	classroom := modules[0].classroom
	for _, row := range modules {
		if row.classroom != classroom {
			return unexpected
		}
	}
	// Standard Practice keeps its historical completion gate. Classroom
	// sessions enforce the immutable module plan and the committed route.
	if !classroom {
		return nil
	}
	if len(required) == 0 {
		required = SATModuleRequiredSections
	}
	inScope := map[string]bool{}
	for _, key := range required {
		inScope[key] = true
	}
	bySection := map[string][]satModuleRow{}
	for _, row := range modules {
		bySection[row.section] = append(bySection[row.section], row)
	}
	for section, sectionRows := range bySection {
		if !inScope[section] {
			return unexpected
		}
		plan, err := satpublish.ParsePlan(sectionRows[0].plan)
		if err != nil {
			return err
		}
		entry := plan.ShapeFor(section).EntryRole()
		if entry != satpublish.RoleBase {
			// Standalone M2 has exactly its configured entry module and no route
			// decision, because there is no M1 attempt to route from.
			if len(sectionRows) != 1 || sectionRows[0].role != entry || sectionRows[0].selected != "" {
				return unexpected
			}
			continue
		}
		// Every M1-based classroom plan requires M1 plus exactly one selected
		// branch. A terminal M1 with no route is incomplete, even when the
		// session policy is adaptive or forced.
		if len(sectionRows) != 2 {
			return unexpected
		}
		var base, branch *satModuleRow
		for i := range sectionRows {
			row := &sectionRows[i]
			if row.role == satpublish.RoleBase {
				if base != nil {
					return unexpected
				}
				base = row
			} else if row.role == satpublish.RoleLower || row.role == satpublish.RoleHigher {
				if branch != nil {
					return unexpected
				}
				branch = row
			} else {
				return unexpected
			}
		}
		if base == nil || branch == nil || base.selected == "" || base.selected != branch.moduleID || branch.selected != base.selected || !plan.Uses(section, branch.role) {
			return unexpected
		}
	}
	return nil
}

// AwaitingStaffRouteTx reports a staff_selects attempt whose Module 1 is
// terminal but has no route decision yet: it holds no Module 2 and is not
// complete. The waiting state is derived, not stored (docs/sat_newmode.md 5.3).
func AwaitingStaffRouteTx(ctx context.Context, q interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, attemptID string) (bool, error) {
	var awaiting bool
	err := q.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM assessment_module_attempts ma
			JOIN assessment_modules m ON m.id = ma.module_id AND m.adaptive_role = 'base'
			JOIN student_attempts sa ON sa.id = ma.attempt_id
			JOIN exam_schedules sch ON sch.id = sa.schedule_id AND sch.sat_route_policy = 'staff_selects'
			WHERE ma.attempt_id = ? AND ma.state IN ('submitted', 'locked')
			AND NOT EXISTS (SELECT 1 FROM assessment_route_decisions d WHERE d.attempt_id = ma.attempt_id AND d.section_id = m.section_id))`,
		attemptID).Scan(&awaiting)
	return awaiting, err
}

// EnsureSATModuleTopologyTx exposes the shared SAT terminal gate to the
// compatibility completion service. It must be called while the attempt row
// is locked in the same transaction that seals the attempt.
func EnsureSATModuleTopologyTx(ctx context.Context, q tx.Tx, attemptID string) error {
	return ensureSATModuleTopologyTx(ctx, q, attemptID)
}

// satRequiredSectionsTx resolves the section set this run declared. It is the
// same release-and-link scope delivery seeds from (exams.AttemptSectionScope),
// so a Math-only release requires only Math even with no link narrowing; an
// unscoped run declares the full SAT pair.
func satRequiredSectionsTx(ctx context.Context, q tx.Tx, attemptID string) ([]string, error) {
	scope, err := examdomain.AttemptSectionScope(ctx, q, attemptID)
	if err != nil {
		return nil, err
	}
	return examdomain.SectionScopeKeys(scope), nil
}
