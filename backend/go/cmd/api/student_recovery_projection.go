package main

import (
	examdomain "example.com/ielts-proctoring/internal/exams"
	"time"
)

// applyStudentRecoveryContext narrows the ordinary student read model using
// the same attempt-owned focus the transactional save gate consumes.
func applyStudentRecoveryContext(view, attempt map[string]any) {
	recovery, ok := attempt["recoveryControl"].(map[string]any)
	if !ok {
		return
	}
	if recovery["phase"] != "working" {
		view["version"] = nil
		return
	}
	target, ok := recovery["target"].(examdomain.RecoveryTarget)
	if !ok {
		return
	}
	version, _ := view["version"].(map[string]any)
	content, _ := version["contentSnapshot"].(map[string]any)
	for _, section := range []string{"listening", "reading", "writing", "speaking", "science"} {
		if section != target.SectionKey {
			delete(content, section)
		}
	}
	if sections, ok := content["sections"].([]any); ok {
		kept := []any{}
		for _, item := range sections {
			section, ok := item.(map[string]any)
			if !ok || snapshotStringField(section, "sectionKey", "section_key") != target.SectionKey {
				continue
			}
			if modules, ok := section["modules"].([]any); ok && target.ModuleID != "" {
				focused := []any{}
				for _, entry := range modules {
					module, ok := entry.(map[string]any)
					if ok && snapshotStringField(module, "id", "moduleId", "module_id") == target.ModuleID {
						focused = append(focused, entry)
					}
				}
				section["modules"] = focused
			}
			kept = append(kept, item)
		}
		content["sections"] = kept
	}
	runtime, _ := view["runtime"].(map[string]any)
	if runtime == nil {
		return
	}
	// Preserve room pause/administrative completion. Natural room expiry does
	// not override the individual recovery deadline.
	if runtime["status"] == "completed" && runtime["completionReason"] != "time_expired" {
		return
	}
	runtime["activeSectionKey"] = target.SectionKey
	runtime["currentSectionKey"] = target.SectionKey
	runtime["currentSectionDeadlineAt"] = recovery["focusDeadlineAt"]
	runtime["waitingForNextSection"] = false
	if deadline, ok := recovery["focusDeadlineAt"].(*time.Time); ok && deadline != nil {
		if raw, ok := runtime["serverNow"].(string); ok {
			if now, err := time.Parse(time.RFC3339Nano, raw); err == nil {
				runtime["currentSectionTimeRemainingSeconds"] = max(0, int(deadline.Sub(now).Seconds()))
			}
		}
		if runtime["status"] == "completed" {
			runtime["status"] = "live"
		}
	}
}
