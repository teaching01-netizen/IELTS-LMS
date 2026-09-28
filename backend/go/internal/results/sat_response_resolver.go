package results

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var errMalformedSATResponse = errors.New("malformed SAT response")

type resolvedSATResponse struct {
	Answer          json.RawMessage
	HasAnswer       bool
	MarkedForReview bool
	SavedAt         sql.NullTime
}

// resolveSATResponse applies the V2-first durability rule shared by SAT
// answer reads and compatibility exports. Presence of a V2 row is
// authoritative even when its payload cannot be used; legacy data is never
// allowed to resurrect an older answer in that case.
func resolveSATResponse(
	v2Present bool,
	v2Canonical sql.NullString,
	v2SavedAt sql.NullTime,
	legacy sql.NullString,
	legacyMarked sql.NullBool,
	legacySavedAt sql.NullTime,
) (resolvedSATResponse, error) {
	if v2Present {
		if !v2Canonical.Valid || strings.TrimSpace(v2Canonical.String) == "" {
			return resolvedSATResponse{}, errMalformedSATResponse
		}
		var envelope map[string]json.RawMessage
		if err := json.Unmarshal([]byte(v2Canonical.String), &envelope); err != nil || envelope == nil {
			return resolvedSATResponse{}, errMalformedSATResponse
		}
		answer, ok := envelope["answer"]
		if !ok || len(answer) == 0 {
			return resolvedSATResponse{}, errMalformedSATResponse
		}
		var marked bool
		if raw, ok := envelope["markedForReview"]; ok {
			if err := json.Unmarshal(raw, &marked); err != nil {
				return resolvedSATResponse{}, errMalformedSATResponse
			}
		}
		out := resolvedSATResponse{MarkedForReview: marked, SavedAt: v2SavedAt}
		if strings.TrimSpace(string(answer)) == "null" {
			return out, nil
		}
		var value any
		if err := json.Unmarshal(answer, &value); err != nil {
			return resolvedSATResponse{}, errMalformedSATResponse
		}
		normalized, err := json.Marshal(value)
		if err != nil {
			return resolvedSATResponse{}, errMalformedSATResponse
		}
		out.Answer = normalized
		out.HasAnswer = true
		return out, nil
	}

	out := resolvedSATResponse{MarkedForReview: legacyMarked.Valid && legacyMarked.Bool}
	if !legacy.Valid || strings.TrimSpace(legacy.String) == "" {
		return out, nil
	}
	var value any
	if err := json.Unmarshal([]byte(legacy.String), &value); err != nil {
		return resolvedSATResponse{}, errMalformedSATResponse
	}
	if value == nil {
		return out, nil
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return resolvedSATResponse{}, errMalformedSATResponse
	}
	out.Answer = normalized
	out.HasAnswer = true
	out.SavedAt = legacySavedAt
	return out, nil
}

func latestSavedAt(current *time.Time, candidate sql.NullTime) *time.Time {
	if !candidate.Valid || (current != nil && !candidate.Time.After(*current)) {
		return current
	}
	value := candidate.Time
	return &value
}
