package grading

// This file owns the one answer-cleaning rule shared by the Go grader and the
// website grader. The same fixture (testdata/objective-grading-parity/
// answer-cleaning.json) is read by both test suites, so a change on one side
// cannot silently drift from the other.
//
// Steps, in order:
//  1. Unicode NFKC (full-width letters become normal ones).
//  2. Remove invisible characters U+200B-U+200D, U+2060, U+FEFF, U+00AD.
//  3. Turn curly quotes and dash variants into plain ones.
//  4. Strip the punctuation set the website removes.
//  5. Collapse whitespace runs and trim.
//
// Default policy: exact case required (IELTS). Opt-out only with explicit
// `caseSensitive: false`, which uses the case-folded form.

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// normalizeAnswer applies steps 1-5. The result keeps its original case so
// case-sensitive comparisons (override exclusions) and display keys can use it.
func normalizeAnswer(value string) string {
	value = norm.NFKC.String(value)
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		switch r {
		case '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF', '\u00AD':
			continue
		case '\u2018', '\u2019', '\u201A', '\u201B', '\u0060', '\u00B4':
			r = '\''
		case '\u201C', '\u201D', '\u201E', '\u201F':
			r = '"'
		case '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '-':
			r = ' '
		}
		if r == '\'' {
			// The website drops apostrophes rather than turning them into a space.
			continue
		}
		if isWebsitePunctuation(r) {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// isWebsitePunctuation mirrors [.,;:!?/\\()[\]{}"] from acceptedAnswers.ts.
func isWebsitePunctuation(r rune) bool {
	switch r {
	case '.', ',', ';', ':', '!', '?', '/', '\\', '(', ')', '[', ']', '{', '}', '"':
		return true
	default:
		return false
	}
}

// answersMatch is the default-policy grading comparison: exact case required
// (IELTS). An empty student answer never matches, even when the key is also
// empty. Steps 1-5 apply; case-fold deliberately does not.
func answersMatch(student, key string) bool {
	return answersMatchCaseExact(student, key)
}

// answersMatchCaseExact is used for grading and teacher exclusions: steps 1-5
// only, so "urwin" does not match "Urwin" and excluding "28 june" does not
// reject the key's "28 June".
func answersMatchCaseExact(student, excluded string) bool {
	normalizedStudent := normalizeAnswer(student)
	if normalizedStudent == "" {
		return false
	}
	return normalizedStudent == normalizeAnswer(excluded)
}

// foldAnswerCase is the one opt-out case fold. It is the Go equivalent of the
// website's foldCaseForMatching: Unicode simple lowercase mapping (JavaScript
// pre-collapses its two full-mapping divergences to match this).
func foldAnswerCase(value string) string {
	return strings.ToLower(value)
}

// normalizeComparable exposes the case-folded form to tests that assert
// idempotence and equality without duplicating the folding rule.
func normalizeComparable(value string) string {
	return answerDedupeKey(normalizeAnswer(value), false)
}

// answerDedupeKey is the one strictness-aware de-duplication key shared by
// every accepted-answer list and answer pool: strict keys keep their cleaned
// case so "Garden" and "garden" are two keys, and an explicit
// `caseSensitive: false` opt-out folds them into one. Callers pass an already
// normalized answer.
func answerDedupeKey(normalized string, caseSensitive bool) string {
	if caseSensitive {
		return normalized
	}
	return foldAnswerCase(normalized)
}
