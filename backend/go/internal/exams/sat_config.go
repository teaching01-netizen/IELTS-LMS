package exams

import (
	"fmt"
	"sort"
	"strings"
)

// SATSectionConfig is the exam-level delivery configuration of one SAT section,
// in the units staff think in (minutes). It is the single source of truth for
// both the creation defaults and creation-time validation: every value here is
// later editable through the revision-fenced delivery-settings command, which
// enforces the same bounds.
type SATSectionConfig struct {
	Module1Minutes          int `json:"module1Minutes"`
	Module2LowerMinutes     int `json:"module2LowerMinutes"`
	Module2HigherMinutes    int `json:"module2HigherMinutes"`
	BreakAfterMinutes       int `json:"breakAfterMinutes"`
	MinimumCorrectForHigher int `json:"minimumCorrectForHigher"`
}

// SATExamConfig is the typed configuration accepted when a SAT exam is created.
// Sections that are absent keep the server defaults; a present section must be
// complete. Per-room choices (route policy, audience, window) are NOT exam
// configuration and are deliberately not accepted here.
type SATExamConfig struct {
	Sections map[string]SATSectionConfig `json:"sections"`
	// ShowClassroomScoreReport releases the score report on Classroom completion.
	ShowClassroomScoreReport *bool `json:"showClassroomScoreReport,omitempty"`
}

// SATConfigLimits are the bounds the server enforces, published with the
// defaults so a client never hardcodes them.
type SATConfigLimits struct {
	MinModuleMinutes int `json:"minModuleMinutes"`
	MaxModuleMinutes int `json:"maxModuleMinutes"`
	MaxBreakMinutes  int `json:"maxBreakMinutes"`
	// OperationalQuestions is the per-section ceiling of the higher-route
	// threshold: every question of the base module is scored.
	OperationalQuestions map[string]int `json:"operationalQuestions"`
}

// SATConfigDefaults is the response of the defaults endpoint.
type SATConfigDefaults struct {
	Preset                   string          `json:"preset"`
	Config                   SATExamConfig   `json:"config"`
	Limits                   SATConfigLimits `json:"limits"`
	ClassroomCreationEnabled bool            `json:"classroomCreationEnabled"`
}

const (
	satMinModuleMinutes = 1
	satMaxModuleMinutes = 600
	satMaxBreakMinutes  = 240
)

// DefaultSATExamConfig derives the standard configuration from the blueprint, so
// the defaults a staff member sees are exactly what an unconfigured create
// produces.
func DefaultSATExamConfig() SATExamConfig {
	cfg := SATExamConfig{Sections: make(map[string]SATSectionConfig, len(satInitialBlueprint))}
	for _, section := range satInitialBlueprint {
		durations := map[string]int{}
		for _, module := range section.modules {
			durations[module.role] = module.duration / 60
		}
		cfg.Sections[section.key] = SATSectionConfig{
			Module1Minutes:          durations[satInitialBaseRole],
			Module2LowerMinutes:     durations[satInitialLowerRole],
			Module2HigherMinutes:    durations[satInitialHigherRole],
			BreakAfterMinutes:       section.breakSeconds / 60,
			MinimumCorrectForHigher: satDefaultThreshold(section),
		}
	}
	scoreReport := false
	cfg.ShowClassroomScoreReport = &scoreReport
	return cfg
}

// SATConfigDefaultsPayload is DefaultSATExamConfig plus its limits and the
// effective SAT Classroom creation capability.
func SATConfigDefaultsPayload(classroomCreationEnabled bool) SATConfigDefaults {
	limits := SATConfigLimits{
		MinModuleMinutes:     satMinModuleMinutes,
		MaxModuleMinutes:     satMaxModuleMinutes,
		MaxBreakMinutes:      satMaxBreakMinutes,
		OperationalQuestions: make(map[string]int, len(satInitialBlueprint)),
	}
	for _, section := range satInitialBlueprint {
		limits.OperationalQuestions[section.key] = section.modules[0].questionCount
	}
	return SATConfigDefaults{
		Preset:                   "standard_sat",
		Config:                   DefaultSATExamConfig(),
		Limits:                   limits,
		ClassroomCreationEnabled: classroomCreationEnabled,
	}
}

// satDefaultThreshold mirrors the long-standing default: half of the operational
// (scored, non-pretest) base-module questions, rounded up past the midpoint.
func satDefaultThreshold(section satInitialSection) int {
	operational := section.modules[0].questionCount - 2
	return operational/2 + 1
}

// Validate rejects unknown sections and out-of-range values with one message
// per offending field, so a form can show every problem at once.
func (c SATExamConfig) Validate() error {
	var problems []string
	known := make(map[string]satInitialSection, len(satInitialBlueprint))
	for _, section := range satInitialBlueprint {
		known[section.key] = section
	}
	keys := make([]string, 0, len(c.Sections))
	for key := range c.Sections {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		section, ok := known[key]
		if !ok {
			problems = append(problems, fmt.Sprintf("Unknown SAT section %q.", key))
			continue
		}
		cfg := c.Sections[key]
		label := section.title
		for _, field := range []struct {
			name  string
			value int
		}{
			{"Module 1 duration", cfg.Module1Minutes},
			{"Module 2 (lower) duration", cfg.Module2LowerMinutes},
			{"Module 2 (higher) duration", cfg.Module2HigherMinutes},
		} {
			if field.value < satMinModuleMinutes || field.value > satMaxModuleMinutes {
				problems = append(problems, fmt.Sprintf("%s %s must be between %d and %d minutes.", label, field.name, satMinModuleMinutes, satMaxModuleMinutes))
			}
		}
		if cfg.BreakAfterMinutes < 0 || cfg.BreakAfterMinutes > satMaxBreakMinutes {
			problems = append(problems, fmt.Sprintf("%s break must be between 0 and %d minutes.", label, satMaxBreakMinutes))
		}
		operational := section.modules[0].questionCount
		if cfg.MinimumCorrectForHigher < 1 || cfg.MinimumCorrectForHigher > operational {
			problems = append(problems, fmt.Sprintf("%s higher-route threshold must be between 1 and %d correct answers.", label, operational))
		}
	}
	if len(problems) > 0 {
		return validationError(strings.Join(problems, " "))
	}
	return nil
}

// apply overlays the configuration on a copy of the blueprint. The package-level
// blueprint is never mutated: concurrent creates must not see each other's
// overrides.
func (c *SATExamConfig) apply(base []satInitialSection) ([]satInitialSection, map[string]int) {
	out := make([]satInitialSection, len(base))
	thresholds := make(map[string]int, len(base))
	for i, section := range base {
		copySection := section
		copySection.modules = append([]satInitialModule(nil), section.modules...)
		thresholds[section.key] = satDefaultThreshold(section)
		if c != nil {
			if cfg, ok := c.Sections[section.key]; ok {
				copySection.breakSeconds = cfg.BreakAfterMinutes * 60
				thresholds[section.key] = cfg.MinimumCorrectForHigher
				for m := range copySection.modules {
					switch copySection.modules[m].role {
					case satInitialBaseRole:
						copySection.modules[m].duration = cfg.Module1Minutes * 60
					case satInitialLowerRole:
						copySection.modules[m].duration = cfg.Module2LowerMinutes * 60
					case satInitialHigherRole:
						copySection.modules[m].duration = cfg.Module2HigherMinutes * 60
					}
				}
			}
		}
		out[i] = copySection
	}
	return out, thresholds
}
