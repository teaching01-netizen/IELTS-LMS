package satpublish

import "fmt"

// Scope is the canonical SAT release scope. An empty value is accepted only
// at request boundaries and normalizes to full for backward compatibility.
type Scope string

const (
	ScopeFull           Scope = "full"
	ScopeReadingWriting Scope = "reading-writing"
	ScopeMath           Scope = "math"
)

func NormalizeScope(scope Scope) (Scope, error) {
	if scope == "" {
		return ScopeFull, nil
	}
	switch scope {
	case ScopeFull, ScopeReadingWriting, ScopeMath:
		return scope, nil
	default:
		return "", fmt.Errorf("Unknown SAT publish scope: %s.", scope)
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
		return []string{"reading-writing", "math"}, nil
	case ScopeReadingWriting:
		return []string{"reading-writing"}, nil
	case ScopeMath:
		return []string{"math"}, nil
	default:
		return nil, fmt.Errorf("Unknown SAT publish scope: %s.", scope)
	}
}
