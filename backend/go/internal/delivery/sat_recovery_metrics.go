package delivery

import (
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

type satBoundaryTransition struct {
	from string
	to   string
}

func recordSATRecoveryBoundaryTransition(transition satBoundaryTransition) {
	var event string
	switch transition {
	case satBoundaryTransition{from: "working", to: "collecting"}:
		event = "opened"
	case satBoundaryTransition{from: "collecting", to: "settled"}:
		event = "settled"
	case satBoundaryTransition{from: "working", to: "blocked"},
		satBoundaryTransition{from: "collecting", to: "blocked"}:
		event = "expired"
	case satBoundaryTransition{from: "preparing", to: "blocked"}:
		event = "entry_expired"
	case satBoundaryTransition{from: "blocked", to: "working"}:
		event = "entry_resolved"
	case satBoundaryTransition{from: "blocked", to: "settled"}:
		event = "resolved"
	default:
		return
	}
	telemetry.IncCounter(telemetry.MSATRecoveryBoundaryTotal, "event", event)
}

func recordSATRecoveryResolution(receipt *SATRecoveryResolutionReceipt, deadline *time.Time) {
	if receipt == nil {
		return
	}
	action := receipt.Action
	if action != "continue_confirmed" && action != "activate_entry" {
		action = "other"
	}
	actor := receipt.ActorType
	if actor != "student" && actor != "staff" {
		actor = "other"
	}
	outcome := "committed"
	if receipt.Replayed {
		outcome = "replayed"
	}
	telemetry.IncCounter(telemetry.MSATRecoveryResolutionTotal,
		"action", action, "actor", actor, "outcome", outcome)
	if !receipt.Replayed && deadline != nil {
		telemetry.ObserveSeconds(telemetry.MSATRecoveryExceptionAge,
			receipt.ResolvedAt.Sub(*deadline).Seconds(), "action", action, "actor", actor)
	}
}

func recordSATRecoveryRegistration(outcome string) {
	switch outcome {
	case "registered", "replayed", "expired":
	default:
		outcome = "other"
	}
	telemetry.IncCounter(telemetry.MSATRecoveryRegistrationTotal, "outcome", outcome)
}
