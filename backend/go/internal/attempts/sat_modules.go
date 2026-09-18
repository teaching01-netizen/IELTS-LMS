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
	"fmt"
	"sort"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

const (
	// Terminal states for assessment_module_attempts accepted at completion.
	SATModuleSubmitted = "submitted"
	SATModuleLocked    = "locked"

	// Section keys owned by the SAT provider.
	SATSectionReadingWriting = "reading-writing"
	SATSectionMath           = "math"
)

// SATModuleTerminal reports whether a stored module state is one the SAT
// completion path accepts as done. Every place that needs to know — the
// provisional submit gate here, sat.scoreAndPersist, sat.repairOne — asks this
// function.
func SATModuleTerminal(state string) bool {
	switch state {
	case SATModuleSubmitted, SATModuleLocked:
		return true
	default:
		return false
	}
}

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
// each required section and every row is terminal: the claim that follows
// blocks further module work and answer writes, the finalizer refuses partial
// topologies, and the provisional reconciler skips attempts that do not match
// this shape — so an attempt admitted here with anything less would strand.
func (t SATModuleTopology) Validate() error {
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
	for _, section := range []string{SATSectionReadingWriting, SATSectionMath} {
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
	rows, err := q.QueryContext(ctx, `
		SELECT COALESCE(s.section_key, ''), ma.state
		FROM assessment_module_attempts ma
		LEFT JOIN assessment_modules m ON m.id = ma.module_id
		LEFT JOIN assessment_sections s ON s.id = m.section_id
		WHERE ma.attempt_id = ?`, attemptID)
	if err != nil {
		return err
	}
	defer rows.Close()
	topology := SATModuleTopology{Sections: map[string]int{}}
	for rows.Next() {
		var sectionKey, state string
		if err := rows.Scan(&sectionKey, &state); err != nil {
			return err
		}
		if sectionKey == "" {
			topology.Unresolved++
			continue
		}
		if !SATModuleTerminal(state) {
			topology.Unfinished++
			continue
		}
		topology.Terminal++
		topology.Sections[sectionKey]++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return topology.Validate()
}
