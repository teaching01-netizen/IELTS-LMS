package satpublish

import "fmt"

// Scope is the canonical SAT release scope. An empty value is accepted only
// at request boundaries and normalizes to full for backward compatibility.
type Scope string

// Section keys owned by the SAT provider; other packages alias these.
const (
	SectionReadingWriting = "reading-writing"
	SectionMath           = "math"
)

const (
	ScopeFull           Scope = "full"
	ScopeReadingWriting Scope = SectionReadingWriting
	ScopeMath           Scope = SectionMath
)

func NormalizeScope(scope Scope) (Scope, error) {
	if scope == "" {
		return ScopeFull, nil
	}
	switch scope {
	case ScopeFull, ScopeReadingWriting, ScopeMath:
		return scope, nil
	default:
		return "", fmt.Errorf("unknown SAT publish scope: %s", scope)
	}
}

// SectionKeys returns the section keys validated and included by the scope.
func (scope Scope) SectionKeys() ([]string, error) {
	normalized, err := NormalizeScope(scope)
	if err != nil {
		return nil, err
	}
	switch normalized {
	case ScopeFull:
		return []string{SectionReadingWriting, SectionMath}, nil
	case ScopeReadingWriting:
		return []string{SectionReadingWriting}, nil
	case ScopeMath:
		return []string{SectionMath}, nil
	default:
		return nil, fmt.Errorf("unknown SAT publish scope: %s", scope)
	}
}
