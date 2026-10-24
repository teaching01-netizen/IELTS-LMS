package attempts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const (
	SATRecoveryPolicyV1       = "sat_recovery_v1"
	SATRecoverySecondsV1      = 120
	SATEntryRecoverySecondsV1 = 120
	SATLateAnswerPolicyV1     = "frozen_arrival_window"
	SATPersonalTimingModelV1  = "sat_personal_v1"
)

// SATDeliveryPolicy is immutable schedule configuration. A missing JSON value
// keeps the schedule on its pre-existing delivery behavior.
type SATDeliveryPolicy struct {
	Version              string `json:"version"`
	RecoverySeconds      int    `json:"recoverySeconds"`
	EntryRecoverySeconds int    `json:"entryRecoverySeconds"`
	LateAnswerPolicy     string `json:"lateAnswerPolicy"`
}

// ParseSATDeliveryPolicy rejects unknown or malformed contracts instead of
// silently treating them as legacy. Version 1 intentionally has one bounded
// recovery window and one admission rule so retries cannot extend either.
func ParseSATDeliveryPolicy(raw []byte, timingModel string) (*SATDeliveryPolicy, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var policy SATDeliveryPolicy
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&policy); err != nil {
		return nil, fmt.Errorf("invalid SAT delivery policy: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("invalid SAT delivery policy: trailing JSON value")
		}
		return nil, fmt.Errorf("invalid SAT delivery policy: %w", err)
	}
	if strings.TrimSpace(timingModel) != SATPersonalTimingModelV1 {
		return nil, fmt.Errorf("SAT recovery policy requires %s timing", SATPersonalTimingModelV1)
	}
	if policy.Version != SATRecoveryPolicyV1 ||
		policy.RecoverySeconds != SATRecoverySecondsV1 ||
		policy.EntryRecoverySeconds != SATEntryRecoverySecondsV1 ||
		policy.LateAnswerPolicy != SATLateAnswerPolicyV1 {
		return nil, fmt.Errorf("unsupported SAT delivery policy contract")
	}
	return &policy, nil
}
