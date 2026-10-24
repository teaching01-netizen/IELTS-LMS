package definition

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// Answers is the canonical stored answer object: field ID -> string or
// float64. Optional unanswered fields are omitted.
type Answers map[string]any

// ValidateAnswers checks a raw answer object against the applicable fields of
// a sitting. Unknown and inapplicable keys, wrong types, nonfinite numbers,
// unknown options and missing required values fail with field-keyed errors.
// The returned map is canonical (trimmed text, float64 numbers).
func ValidateAnswers(applicable []Field, raw json.RawMessage) (Answers, map[string]string) {
	errs := map[string]string{}
	if len(raw) > MaxAnswerBytes {
		errs[""] = fmt.Sprintf("Answers must be at most %d bytes.", MaxAnswerBytes)
		return nil, errs
	}
	in := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(raw)) > 0 && string(bytes.TrimSpace(raw)) != "null" {
		if err := json.Unmarshal(raw, &in); err != nil {
			errs[""] = "Answers must be an object keyed by question ID."
			return nil, errs
		}
	}
	byID := make(map[string]Field, len(applicable))
	for _, fd := range applicable {
		byID[fd.ID] = fd
	}
	for key := range in {
		if _, ok := byID[key]; !ok {
			errs[key] = "This question is not part of this form."
		}
	}
	out := Answers{}
	for _, fd := range applicable {
		value, present := in[fd.ID]
		if present && string(bytes.TrimSpace(value)) == "null" {
			present = false
		}
		if !present {
			if fd.Required {
				errs[fd.ID] = "This question is required."
			}
			continue
		}
		v, msg := validateValue(fd, value)
		if msg != "" {
			errs[fd.ID] = msg
			continue
		}
		if v == nil {
			if fd.Required {
				errs[fd.ID] = "This question is required."
			}
			continue
		}
		out[fd.ID] = v
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return out, nil
}

func validateValue(fd Field, raw json.RawMessage) (any, string) {
	switch fd.Type {
	case TypeText:
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, "Enter text."
		}
		s = strings.TrimSpace(s)
		if s == "" {
			return nil, ""
		}
		if strings.ContainsFunc(s, func(r rune) bool { return isControl(r) && r != '\n' && r != '\t' }) {
			return nil, "Remove control characters."
		}
		if utf8.RuneCountInString(s) > fd.MaxLength {
			return nil, fmt.Sprintf("Use at most %d characters.", fd.MaxLength)
		}
		return s, ""
	case TypeNumber:
		var n float64
		if err := json.Unmarshal(raw, &n); err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, "Enter a number."
		}
		if fd.Integer && n != math.Trunc(n) {
			return nil, "Enter a whole number."
		}
		if fd.Min != nil && n < *fd.Min {
			return nil, fmt.Sprintf("Enter %s or more.", formatNumber(*fd.Min))
		}
		if fd.Max != nil && n > *fd.Max {
			return nil, fmt.Sprintf("Enter %s or less.", formatNumber(*fd.Max))
		}
		return n, ""
	case TypeSingleChoice:
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, "Select an option."
		}
		if s == "" {
			return nil, ""
		}
		for _, opt := range fd.Options {
			if opt.ID == s {
				return s, ""
			}
		}
		return nil, "Select one of the listed options."
	}
	return nil, "Unsupported question type."
}

func formatNumber(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}
