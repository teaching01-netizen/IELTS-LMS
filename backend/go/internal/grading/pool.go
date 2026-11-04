package grading

import "strings"

// answerPool is the one-shot shared "accept any key" pool for sentence and note
// completion blanks that accept any key. Each entry keeps both normal forms so
// consumption is per key, not per folded value: matching a blank under one
// strictness must never consume a case-variant sibling another blank may still
// need (pool ["Garden", "garden"] still satisfies both blanks).
type answerPool struct {
	entries []answerPoolEntry
}

type answerPoolEntry struct {
	exact  string
	folded string
	used   bool
}

// newAnswerPool builds the pool from accepted keys, dropping blank keys and
// keeping case-distinct keys as separate entries in their original order.
func newAnswerPool(values []string) *answerPool {
	pool := &answerPool{entries: make([]answerPoolEntry, 0, len(values))}
	for _, value := range values {
		exact := normalizeAnswer(value)
		if exact == "" {
			continue
		}
		pool.entries = append(pool.entries, answerPoolEntry{exact: exact, folded: strings.ToLower(exact)})
	}
	return pool
}

// consume marks exactly one unused entry as used when the student answer
// matches it, and reports whether it did. A strict blank compares the cleaned
// exact form (IELTS default); an explicit `caseSensitive: false` opt-out
// compares the folded form. Blank-order consumption lives in the caller: it
// walks the blanks in order and calls consume once per answered blank.
func (pool *answerPool) consume(student string, caseSensitive bool) bool {
	if pool == nil {
		return false
	}
	exact := normalizeAnswer(student)
	if exact == "" {
		return false
	}
	folded := strings.ToLower(exact)
	for index := range pool.entries {
		entry := &pool.entries[index]
		if entry.used {
			continue
		}
		if caseSensitive {
			if entry.exact == exact {
				entry.used = true
				return true
			}
			continue
		}
		if entry.folded == folded {
			entry.used = true
			return true
		}
	}
	return false
}
