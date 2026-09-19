package exams

// Student Access link section scope.
//
// A Student Access link can be narrowed to a subset of the exam's sections
// (assessment_access_links.enabled_sections, migration 0066). Three packages
// need the same vocabulary and the same fail-open read:
//
//   - internal/accesslinks  writes and validates the operator's selection,
//   - internal/schedules    intersects the runtime plan with it (runtimePlanIn),
//   - internal/delivery     seeds/returns only the scoped sections.
//
// Owning it here keeps one definition of "which sections", one canonical
// order, and one answer to "what does a NULL/empty/malformed column mean".

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Section keys a Student Access link may be scoped to. SAT-only by decision:
// the toggle UI and the validators hardcode the pair, and every other provider
// leaves enabled_sections NULL (all sections).
const (
	LinkSectionReadingWriting = "reading-writing"
	LinkSectionMath           = "math"
)

// linkSectionOrder is the canonical storage/render order, so a link's scope is
// stable regardless of the order the client sent its toggles in.
var linkSectionOrder = []string{LinkSectionReadingWriting, LinkSectionMath}

// NormalizeSectionScope validates and canonicalizes an operator's section
// selection. An empty selection normalizes to nil, meaning "all sections".
// Unknown or blank keys are an error rather than a silent drop: a typo must not
// scope a link to a different sitting than the operator picked.
func NormalizeSectionScope(sections []string) ([]string, error) {
	if len(sections) == 0 {
		return nil, nil
	}
	selected := make(map[string]bool, len(sections))
	for _, raw := range sections {
		key := strings.TrimSpace(raw)
		if key == "" {
			return nil, fmt.Errorf("Every section in a Student Link scope needs a section key.")
		}
		if key != LinkSectionReadingWriting && key != LinkSectionMath {
			return nil, fmt.Errorf("Unknown section for a Student Link scope: %s.", key)
		}
		selected[key] = true
	}
	out := make([]string, 0, len(selected))
	for _, key := range linkSectionOrder {
		if selected[key] {
			out = append(out, key)
		}
	}
	return out, nil
}

// EqualSectionScopes reports whether two normalized scopes describe the same
// selection. nil/empty is NOT equal to an explicit all-sections list: they
// describe the same run but different stored shapes, and an explicit list is a
// real narrowing request the runtime seam has to intersect.
func EqualSectionScopes(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ParseStoredSectionScope decodes a link's stored scope into a membership set of
// RECOGNIZED section keys. NULL, an empty array, malformed JSON, or a value with
// nothing recognizable left all mean "no narrowing": the fail-open default that
// matches every pre-migration link. Unrecognized keys are dropped rather than
// honored, because honoring one would admit no real section and hand the run an
// empty plan — a link that cannot start at all.
func ParseStoredSectionScope(raw string) map[string]bool {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var keys []string
	if err := json.Unmarshal([]byte(raw), &keys); err != nil {
		return nil
	}
	allowed := make(map[string]bool, len(keys))
	for _, key := range keys {
		trimmed := strings.TrimSpace(key)
		if trimmed == LinkSectionReadingWriting || trimmed == LinkSectionMath {
			allowed[trimmed] = true
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	return allowed
}

// AllowsSection reports whether a parsed scope admits a section key. A nil
// scope (no link, or an unscoped link) admits everything.
func AllowsSection(allowed map[string]bool, sectionKey string) bool {
	return allowed == nil || allowed[sectionKey]
}

// SectionScopeKeys returns a scope's keys in canonical order, for rendering and
// for building parameterized IN clauses. Keys outside the section vocabulary
// are dropped: the vocabulary is fixed, so an unrecognized key is corruption,
// and honoring it would scope a link to a section that cannot exist. A nil
// scope (all sections) AND a scope with nothing recognizable left both return
// nil, so callers know to omit the clause entirely rather than enumerate every
// section key.
func SectionScopeKeys(allowed map[string]bool) []string {
	if allowed == nil {
		return nil
	}
	keys := make([]string, 0, len(allowed))
	for _, key := range linkSectionOrder {
		if allowed[key] {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	return keys
}
