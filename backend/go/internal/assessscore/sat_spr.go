package assessscore

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

const SATSPRStrictV1 = "strict_v1"
const SATSPRPolicyConfigKey = "satStudentResponseScoring"
const SATSPRMaxKeyCharacters = 256

var satSPRNumber = regexp.MustCompile(`^-?(?:[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$`)

// SATSPRPolicy resolves only the server-owned published configuration.
func SATSPRPolicy(config string) string {
	if strings.TrimSpace(config) == "" {
		return ""
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(config), &fields) != nil {
		return "invalid"
	}
	raw, exists := fields[SATSPRPolicyConfigKey]
	if !exists {
		return ""
	}
	var policy string
	if json.Unmarshal(raw, &policy) != nil || policy != SATSPRStrictV1 {
		return "invalid"
	}
	return policy
}

func parseSATSPR(value string, student bool) (*big.Rat, bool) {
	value = strings.TrimSpace(value)
	limit := SATSPRMaxKeyCharacters
	if student {
		limit = 5
		if strings.HasPrefix(value, "-") {
			limit++
		}
	}
	if len(value) == 0 || len(value) > limit || !satSPRNumber.MatchString(value) {
		return nil, false
	}
	number, ok := new(big.Rat).SetString(value)
	return number, ok
}

// ValidateSATSPRKey permits canonical keys longer than the student's entry
// budget, but only if at least one exact or SAT decimal response fits.
func ValidateSATSPRKey(value string) error {
	key, ok := parseSATSPR(value, false)
	if !ok {
		return fmt.Errorf("Use a numeric integer, decimal, or fraction with a nonzero denominator (up to %d characters).", SATSPRMaxKeyCharacters)
	}
	if _, ok := parseSATSPR(key.RatString(), true); ok {
		return nil
	}
	if exactSATDecimalFits(key) || len(satSPRDecimalForms(key)) > 0 {
		return nil
	}
	return fmt.Errorf("The answer has no SAT representation within 5 characters (6 with a leading minus).")
}

// ValidateSATSPRDefinition is shared by publishing and strict grading so an
// invalid key cannot partially grant credit through another accepted entry.
func ValidateSATSPRDefinition(answerJSON string) error {
	var def map[string]json.RawMessage
	if json.Unmarshal([]byte(answerJSON), &def) != nil {
		return fmt.Errorf("The answer definition must be a JSON object.")
	}
	return validateStrictSPRDefinition(def)
}

func validateStrictSPRDefinition(def map[string]json.RawMessage) error {
	var kind string
	if json.Unmarshal(def["kind"], &kind) != nil || kind != "student_produced_response" {
		return fmt.Errorf("Use a student-produced response answer definition.")
	}
	var accepted []string
	raw, ok := answerField(def, "acceptedResponses", "accepted_responses")
	if !ok || json.Unmarshal(raw, &accepted) != nil || len(accepted) == 0 {
		return fmt.Errorf("At least one numeric accepted response is required.")
	}
	for _, value := range accepted {
		if err := ValidateSATSPRKey(value); err != nil {
			return err
		}
	}
	for _, names := range [][2]string{{"normalizeFraction", "normalize_fraction"}, {"normalizeDecimal", "normalize_decimal"}} {
		if raw, exists := answerField(def, names[0], names[1]); exists {
			var enabled bool
			if json.Unmarshal(raw, &enabled) != nil || !enabled {
				return fmt.Errorf("Enable %s for strict SAT grading.", names[0])
			}
		}
	}
	if raw, exists := answerField(def, "numericTolerance", "numeric_tolerance"); exists && strings.TrimSpace(string(raw)) != "null" {
		return fmt.Errorf("Remove numericTolerance; strict SAT grading uses exact equivalence and SAT decimal forms.")
	}
	return nil
}

func strictSPRCorrect(def map[string]json.RawMessage, response string) bool {
	given, ok := parseSATSPR(response, true)
	if !ok || validateStrictSPRDefinition(def) != nil {
		return false
	}
	var accepted []string
	raw, _ := answerField(def, "acceptedResponses", "accepted_responses")
	_ = json.Unmarshal(raw, &accepted)
	for _, value := range accepted {
		key, _ := parseSATSPR(value, false)
		if key.Cmp(given) == 0 {
			return true
		}
		// A rounded decimal may be an integer (e.g. 9.9999 -> 10).
		// Fractions always express an exact value, never an approximation.
		if !strings.Contains(response, "/") && !exactSATDecimalFits(key) {
			for _, form := range satSPRDecimalForms(key) {
				value, _ := parseSATSPR(form, true)
				if given.Cmp(value) == 0 {
					return true
				}
			}
		}
	}
	return false
}

func exactSATDecimalFits(key *big.Rat) bool {
	for places := 0; places <= 4; places++ {
		scaled := new(big.Rat).Mul(key, new(big.Rat).SetInt(pow10(places)))
		if !scaled.IsInt() {
			continue
		}
		text := key.FloatString(places)
		if strings.Contains(text, ".") {
			text = strings.TrimRight(strings.TrimRight(text, "0"), ".")
		}
		if _, ok := parseSATSPR(text, true); ok {
			return true
		}
		text = withoutLeadingZero(text)
		if _, ok := parseSATSPR(text, true); ok {
			return true
		}
	}
	return false
}

func pow10(places int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(places)), nil)
}

func withoutLeadingZero(value string) string {
	if strings.HasPrefix(value, "0.") {
		return value[1:]
	}
	if strings.HasPrefix(value, "-0.") {
		return "-" + value[2:]
	}
	return value
}

// Generate discrete SAT entry forms instead of accepting a neighborhood of
// unequal values. Integer digits consume the same five-character budget.
func satSPRDecimalForms(key *big.Rat) []string {
	if key.Sign() == 0 {
		return nil
	}
	magnitude := new(big.Rat).Abs(key)
	integer := new(big.Int).Quo(magnitude.Num(), magnitude.Denom())
	places := 4 - len(integer.String())
	if places < 0 {
		places = 0
	}
	precisions := []int{places}
	if integer.Sign() == 0 {
		precisions = []int{3, 4}
	}
	forms := []string{}
	for _, precision := range precisions {
		scale := pow10(precision)
		truncated := new(big.Int).Quo(new(big.Int).Mul(magnitude.Num(), scale), magnitude.Denom())
		if key.Sign() < 0 {
			truncated.Neg(truncated)
		}
		candidates := []string{new(big.Rat).SetFrac(truncated, scale).FloatString(precision), key.FloatString(precision)}
		for _, candidate := range candidates {
			// A carry can add an integer digit; redundant trailing decimal
			// zeros may be removed without changing the rounded value.
			if strings.Contains(candidate, ".") {
				candidate = strings.TrimRight(strings.TrimRight(candidate, "0"), ".")
			}
			for _, text := range []string{candidate, withoutLeadingZero(candidate)} {
				if value, ok := parseSATSPR(text, true); ok && value.Sign() == key.Sign() {
					forms = append(forms, text)
				}
			}
		}
	}
	return forms
}
