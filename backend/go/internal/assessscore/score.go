// Package assessscore owns provider-neutral, read-path scoring helpers shared
// by the results detail surface.
//
// It carries the two scoring semantics already used at seal time, factored
// out of their write-path owners so detail endpoints can replay the exact
// same verdict without importing a write-path service package:
//
//   - SAT: response_is_correct over assessment answer_definition JSON
//     (mirrors delivery.responseIsCorrect / score_scoring_rows).
//   - ACT science: answers_equal over the sealed content key
//     (mirrors act.answersEqual / ComputeScienceScore).
//
// The package is intentionally dependency-free (stdlib only): it must stay
// importable from results, delivery, sat, and act without creating a cycle.
package assessscore

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// SATResponseCorrect reports whether one SAT response is correct under the
// sealed answer definition. Semantics mirror delivery.responseIsCorrect
// (Rust assessment_delivery.rs:2969): only a JSON string response can be
// correct; a malformed definition, a missing key, or a non-string response
// counts as incorrect. Callers decide the null-vs-incorrect display rule
// (pretest / unanswered / missing key render as null, never incorrect).
func SATResponseCorrect(answerJSON string, responseValid bool, responseRaw string) bool {
	if !responseValid || strings.TrimSpace(responseRaw) == "" {
		return false
	}
	var respStr string
	if err := json.Unmarshal([]byte(responseRaw), &respStr); err != nil {
		return false
	}
	if strings.TrimSpace(answerJSON) == "" {
		return false
	}
	var def map[string]json.RawMessage
	if err := json.Unmarshal([]byte(answerJSON), &def); err != nil {
		return false
	}
	var kind string
	if raw, ok := def["kind"]; ok {
		_ = json.Unmarshal(raw, &kind)
	}
	switch kind {
	case "single_choice":
		raw, ok := answerField(def, "correctOptionId", "correct_option_id")
		if !ok || string(raw) == "null" {
			return false
		}
		var correct string
		if err := json.Unmarshal(raw, &correct); err != nil {
			return false
		}
		return correct == respStr
	case "student_produced_response":
		var accepted []string
		if raw, ok := answerField(def, "acceptedResponses", "accepted_responses"); ok {
			_ = json.Unmarshal(raw, &accepted)
		}
		normalizeFraction := answerBool(def, "normalizeFraction", "normalize_fraction")
		normalizeDecimal := answerBool(def, "normalizeDecimal", "normalize_decimal")
		var tolerance *string
		if raw, ok := answerField(def, "numericTolerance", "numeric_tolerance"); ok && string(raw) != "null" {
			var tol string
			if err := json.Unmarshal(raw, &tol); err == nil {
				tolerance = &tol
			}
		}
		for _, a := range accepted {
			if responseMatches(a, respStr, normalizeFraction, normalizeDecimal, tolerance) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// SATCorrectAnswer extracts the displayable correct answer from a sealed SAT
// answer definition: the single-choice option id, or the first accepted
// student-produced response. ok=false when the definition carries no key.
func SATCorrectAnswer(answerJSON string) (correct any, ok bool) {
	if strings.TrimSpace(answerJSON) == "" {
		return nil, false
	}
	var def map[string]json.RawMessage
	if err := json.Unmarshal([]byte(answerJSON), &def); err != nil {
		return nil, false
	}
	var kind string
	if raw, ok := def["kind"]; ok {
		_ = json.Unmarshal(raw, &kind)
	}
	switch kind {
	case "single_choice":
		raw, ok := answerField(def, "correctOptionId", "correct_option_id")
		if !ok || string(raw) == "null" {
			return nil, false
		}
		var correctID string
		if err := json.Unmarshal(raw, &correctID); err != nil {
			return nil, false
		}
		return correctID, true
	case "student_produced_response":
		var accepted []string
		if raw, ok := answerField(def, "acceptedResponses", "accepted_responses"); ok {
			_ = json.Unmarshal(raw, &accepted)
		}
		if len(accepted) == 0 {
			return nil, false
		}
		return accepted[0], true
	default:
		return nil, false
	}
}

// SATHasKey reports whether a sealed SAT answer definition carries a usable
// key (a single-choice option id or at least one accepted response).
func SATHasKey(answerJSON string) bool {
	_, ok := SATCorrectAnswer(answerJSON)
	return ok
}

func answerField(def map[string]json.RawMessage, camel, snake string) (json.RawMessage, bool) {
	if raw, ok := def[camel]; ok {
		return raw, true
	}
	raw, ok := def[snake]
	return raw, ok
}

func answerBool(def map[string]json.RawMessage, camel, snake string) bool {
	raw, ok := answerField(def, camel, snake)
	if !ok {
		return false
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		return false
	}
	return b
}

// responseMatches mirrors response_matches (Rust
// assessment_delivery.rs:2994): numeric comparison with tolerance when
// either normalization is on and both sides parse, otherwise ASCII
// case-insensitive trimmed equality.
func responseMatches(accepted, response string, normalizeFraction, normalizeDecimal bool, tolerance *string) bool {
	if normalizeFraction || normalizeDecimal {
		if a, ok := parseNumericResponse(accepted, normalizeFraction); ok {
			if r, ok := parseNumericResponse(response, normalizeFraction); ok {
				explicit := 0.0
				if tolerance != nil {
					if t, err := strconv.ParseFloat(*tolerance, 64); err == nil && !math.IsNaN(t) && !math.IsInf(t, 0) && t >= 0 {
						explicit = t
					}
				}
				scale := math.Max(math.Abs(a), math.Abs(r))
				if scale < 1.0 {
					scale = 1.0
				}
				floor := (math.Nextafter(1, 2) - 1) * scale * 8.0
				bound := explicit
				if floor > bound {
					bound = floor
				}
				return math.Abs(a-r) <= bound
			}
		}
	}
	return asciiEqualFold(strings.TrimSpace(accepted), strings.TrimSpace(response))
}

// parseNumericResponse mirrors parse_numeric_response (Rust
// assessment_delivery.rs:3019).
func parseNumericResponse(value string, allowFraction bool) (float64, bool) {
	v := strings.TrimSpace(value)
	if allowFraction {
		if idx := strings.IndexByte(v, '/'); idx >= 0 {
			numStr, denStr := v[:idx], v[idx+1:]
			if strings.Contains(denStr, "/") {
				return 0, false
			}
			n, errNum := strconv.ParseFloat(numStr, 64)
			d, errDen := strconv.ParseFloat(denStr, 64)
			if errNum != nil || errDen != nil {
				return 0, false
			}
			if math.IsNaN(n) || math.IsInf(n, 0) || math.IsNaN(d) || math.IsInf(d, 0) || d == 0 {
				return 0, false
			}
			return n / d, true
		}
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

// asciiEqualFold is ASCII-only case-insensitive equality (Rust
// eq_ignore_ascii_case).
func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

// ACTAnswersEqual mirrors act.answersEqual: canonical-JSON equality with a
// case-insensitive single-token string fallback for science answers.
func ACTAnswersEqual(given, accepted any) bool {
	gn, _ := json.Marshal(given)
	an, _ := json.Marshal(accepted)
	if string(gn) == string(an) {
		return true
	}
	gs, gok := given.(string)
	as, aok := accepted.(string)
	if gok && aok {
		return strings.EqualFold(strings.TrimSpace(gs), strings.TrimSpace(as))
	}
	return false
}

// ACTResponsePresent reports whether a sealed ACT answer value counts as
// answered (non-null, non-blank). Missing keys surface as unanswered.
func ACTResponsePresent(value any, present bool) bool {
	if !present || value == nil {
		return false
	}
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return true
}
