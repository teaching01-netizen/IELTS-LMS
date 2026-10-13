package satpublish

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Shape is a Classroom module configuration for one section. A section with no
// shape is the standard full adaptive structure (M1 plus both M2 branches).
type Shape string

const (
	ShapeM1Easy Shape = "m1_easy"
	ShapeM1Hard Shape = "m1_hard"
	ShapeM2Easy Shape = "m2_easy"
	ShapeM2Hard Shape = "m2_hard"
)

// Adaptive roles, as stored in assessment_modules.adaptive_role.
const (
	RoleBase   = "base"
	RoleLower  = "lower_branch"
	RoleHigher = "higher_branch"
)

var allRoles = []string{RoleBase, RoleLower, RoleHigher}

// Roles are the module slots students can receive under this shape.
func (s Shape) Roles() []string {
	switch s {
	case ShapeM1Easy:
		return []string{RoleBase, RoleLower}
	case ShapeM1Hard:
		return []string{RoleBase, RoleHigher}
	case ShapeM2Easy:
		return []string{RoleLower}
	case ShapeM2Hard:
		return []string{RoleHigher}
	}
	return allRoles
}

// EntryRole is the module a student opens first in the section.
func (s Shape) EntryRole() string {
	switch s {
	case ShapeM2Easy:
		return RoleLower
	case ShapeM2Hard:
		return RoleHigher
	}
	return RoleBase
}

// ForcedBranch is the only Module 2 an M1-based single-branch shape allows, or
// "" when the shape does not fix one.
func (s Shape) ForcedBranch() string {
	switch s {
	case ShapeM1Easy:
		return RoleLower
	case ShapeM1Hard:
		return RoleHigher
	}
	return ""
}

// Plan maps section keys to a Shape. A nil plan is a standard SAT version.
type Plan map[string]Shape

// ParsePlan decodes the stored JSON. Empty and "null" mean no plan; an unknown
// section or shape is an error so a malformed plan can never publish.
func ParsePlan(raw string) (Plan, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil, nil
	}
	var plan Plan
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		return nil, fmt.Errorf("invalid SAT classroom plan: %w", err)
	}
	if len(plan) == 0 {
		return nil, nil
	}
	for section, shape := range plan {
		if section != SectionReadingWriting && section != SectionMath {
			return nil, fmt.Errorf("unknown SAT section in classroom plan: %s", section)
		}
		switch shape {
		case ShapeM1Easy, ShapeM1Hard, ShapeM2Easy, ShapeM2Hard:
		default:
			return nil, fmt.Errorf("unknown SAT classroom shape: %s", shape)
		}
	}
	return plan, nil
}

// ShapeFor returns the section's shape ("" = full adaptive).
func (p Plan) ShapeFor(section string) Shape { return p[section] }

// Uses reports whether students can receive the role in the section.
func (p Plan) Uses(section, role string) bool {
	for _, r := range p.ShapeFor(section).Roles() {
		if r == role {
			return true
		}
	}
	return false
}

// RoleOfModuleKey maps a blueprint module key (rw-m1, math-m2-lower, ...) to
// its adaptive role; "" for a key outside the blueprint.
func RoleOfModuleKey(key string) string {
	switch {
	case strings.HasSuffix(key, "-m1"):
		return RoleBase
	case strings.HasSuffix(key, "-m2-lower"):
		return RoleLower
	case strings.HasSuffix(key, "-m2-higher"):
		return RoleHigher
	}
	return ""
}

// LoadPlan reads the classroom plan stored on a version.
func LoadPlan(ctx context.Context, q Queryer, versionID string) (Plan, error) {
	rows, err := q.QueryContext(ctx, "SELECT CAST(sat_classroom_plan AS CHAR) FROM exam_versions WHERE id = ?", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var raw *string
	if rows.Next() {
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	return ParsePlan(*raw)
}
