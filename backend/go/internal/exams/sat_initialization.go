package exams

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/tx"
)

type satInitialModule struct {
	key, title, role string
	duration         int
	questionCount    int
	tools            []string
}

type satInitialSection struct {
	key, title   string
	breakSeconds int
	modules      []satInitialModule
}

const (
	satInitialBaseRole   = "base"
	satInitialLowerRole  = "lower_branch"
	satInitialHigherRole = "higher_branch"
)

var satInitialBlueprint = []satInitialSection{
	{
		key:          "reading-writing",
		title:        "Reading & Writing",
		breakSeconds: 600,
		modules: []satInitialModule{
			{key: "rw-m1", title: "Module 1", role: satInitialBaseRole, duration: 32 * 60, questionCount: 27, tools: []string{}},
			{key: "rw-m2-lower", title: "Module 2 — Lower", role: satInitialLowerRole, duration: 32 * 60, questionCount: 27, tools: []string{}},
			{key: "rw-m2-higher", title: "Module 2 — Higher", role: satInitialHigherRole, duration: 32 * 60, questionCount: 27, tools: []string{}},
		},
	},
	{
		key:          "math",
		title:        "Math",
		breakSeconds: 0,
		modules: []satInitialModule{
			{key: "math-m1", title: "Module 1", role: satInitialBaseRole, duration: 35 * 60, questionCount: 22, tools: []string{"calculator", "reference_sheet"}},
			{key: "math-m2-lower", title: "Module 2 — Lower", role: satInitialLowerRole, duration: 35 * 60, questionCount: 22, tools: []string{"calculator", "reference_sheet"}},
			{key: "math-m2-higher", title: "Module 2 — Higher", role: satInitialHigherRole, duration: 35 * 60, questionCount: 22, tools: []string{"calculator", "reference_sheet"}},
		},
	},
}

const satInitialContent = `{"providerKey":"sat"}`

func satInitialConfig() (string, error) {
	value := map[string]any{
		"providerKey": "sat",
		"scoreKind":   "practice",
		"delivery": map[string]any{
			"launchMode":              "proctor_start",
			"transitionMode":          "auto_with_proctor_override",
			"allowedExtensionMinutes": []int{5, 10},
		},
		"progression": map[string]any{
			"autoSubmit":      true,
			"lockAfterSubmit": true,
			"allowPause":      true,
		},
		"security": map[string]any{
			"heartbeatIntervalSeconds":           15,
			"heartbeatMissThreshold":             3,
			"pauseOnOffline":                     true,
			"bufferAnswersOffline":               true,
			"requireDeviceContinuityOnReconnect": true,
		},
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode SAT draft configuration: %w", err)
	}
	return string(encoded), nil
}

func satPracticeScores(maxRaw int) map[string]int {
	scores := make(map[string]int, maxRaw+1)
	for raw := 0; raw <= maxRaw; raw++ {
		scores[fmt.Sprintf("%d", raw)] = 200 + (raw * 600 / maxRaw)
	}
	return scores
}

func satInitialScoringPolicy() (string, error) {
	value := map[string]any{
		"readingWriting": map[string]any{
			"lower":  satPracticeScores(27),
			"higher": satPracticeScores(27),
		},
		"math": map[string]any{
			"lower":  satPracticeScores(22),
			"higher": satPracticeScores(22),
		},
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode SAT scoring policy: %w", err)
	}
	return string(encoded), nil
}

// initializeSATDraftTx creates the complete editable SAT blueprint. This is
// part of exam creation so a new SAT can immediately open authoring, load the
// built-in sample, or accept a workbook without a second repair transaction.
func initializeSATDraftTx(ctx context.Context, q tx.Tx, examID, actorID string) (string, error) {
	var versionNumber int
	if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?", examID).Scan(&versionNumber); err != nil {
		return "", err
	}
	versionID := uuid.NewString()
	config, err := satInitialConfig()
	if err != nil {
		return "", err
	}
	if _, err := q.ExecContext(ctx, "INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_draft, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE, 0)", versionID, examID, versionNumber, satInitialContent, config, actorID); err != nil {
		return "", err
	}

	for sectionIndex, section := range satInitialBlueprint {
		sectionID := uuid.NewString()
		// The section's authored length is base + the longer branch (a candidate
		// sits Module 1 plus exactly one Module 2), not the sum of all three
		// authored modules — the runtime clocks the section from this value.
		durationByRole := make(map[string]int, len(section.modules))
		for _, module := range section.modules {
			durationByRole[module.role] = module.duration
		}
		sectionDuration := CandidateSectionSeconds(
			durationByRole[satInitialBaseRole],
			durationByRole[satInitialLowerRole],
			durationByRole[satInitialHigherRole],
		)
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", sectionID, versionID, section.key, section.title, sectionIndex, sectionDuration, section.breakSeconds, `{"version":1,"nodes":[]}`, `[]`); err != nil {
			return "", err
		}

		moduleIDs := make(map[string]string, len(section.modules))
		for moduleIndex, module := range section.modules {
			moduleID := uuid.NewString()
			moduleIDs[module.key] = moduleID
			tools, err := json.Marshal(module.tools)
			if err != nil {
				return "", err
			}
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", moduleID, sectionID, module.key, module.title, moduleIndex, module.duration, module.questionCount, module.role, `{"version":1,"nodes":[]}`, string(tools)); err != nil {
				return "", err
			}
		}

		baseID, baseOK := moduleIDs[section.modules[0].key]
		lowerID, lowerOK := moduleIDs[section.modules[1].key]
		higherID, higherOK := moduleIDs[section.modules[2].key]
		if !baseOK || !lowerOK || !higherOK {
			return "", fmt.Errorf("SAT blueprint section %q is missing an adaptive branch", section.key)
		}
		operational := section.modules[0].questionCount - 2
		threshold := operational/2 + 1
		policyConfig, err := json.Marshal(map[string]int{"minimumCorrectForHigher": threshold})
		if err != nil {
			return "", err
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config) VALUES (?, ?, ?, ?, ?, 'practice_threshold', ?)", uuid.NewString(), sectionID, baseID, lowerID, higherID, string(policyConfig)); err != nil {
			return "", err
		}
	}

	scoringPolicy, err := satInitialScoringPolicy()
	if err != nil {
		return "", err
	}
	if _, err := q.ExecContext(ctx, "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config) VALUES (?, ?, 'practice', ?)", uuid.NewString(), versionID, scoringPolicy); err != nil {
		return "", err
	}
	if _, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?", versionID, examID); err != nil {
		return "", err
	}
	return versionID, nil
}
