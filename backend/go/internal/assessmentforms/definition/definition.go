// Package definition owns the versioned SAT form vocabulary stored under
// exam_versions.config_snapshot.forms: registration questions and the Eva SIM
// mode (native questionnaire or embedded external URL). It is pure: no
// storage, no schedule/runtime imports and no network access to configured
// URLs (docs/plans/SAT-configurable-forms-and-eva-sim.md §2.1).
package definition

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// SnapshotKey is the config_snapshot property owned by this package.
const SnapshotKey = "forms"

const SchemaVersion = 1
const SchemaVersionSections = 2

// Field types.
const (
	TypeText         = "text"
	TypeNumber       = "number"
	TypeSingleChoice = "single_choice"
)

// Field applicability against the attempt's effective sections.
const (
	ScopeAll            = "all"
	ScopeMath           = "math"
	ScopeReadingWriting = "reading-writing"
)

// Eva SIM modes.
const (
	ModeNative = "native"
	ModeEmbed  = "embed"
)

// Form keys stored in assessment_form_responses.form_key.
const (
	FormRegistration = "registration"
	FormEvaSim       = "eva_sim"
	FormVerbalEntry  = "verbal_entry"
	FormMathEntry    = "math_entry"
)

// Section keys (mirrors exams.LinkSection*; kept literal to stay import-free).
const (
	SectionMath           = "math"
	SectionReadingWriting = "reading-writing"
)

// Operational limits. offcut: tunable constants, not production claims;
// check against the real questionnaire before activation.
const (
	MaxFields          = 50
	MaxOptions         = 50
	MaxLabelChars      = 200
	MaxHelpChars       = 300
	MaxTextAnswerChars = 4000
	MaxDefinitionBytes = 64 << 10
	MaxAnswerBytes     = 32 << 10
	MaxURLChars        = 2048
)

type Option struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Field is one question. Type-specific properties are validated by type; a
// property that does not belong to the type is rejected rather than ignored.
type Field struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Label     string   `json:"label"`
	Help      string   `json:"help,omitempty"`
	Required  bool     `json:"required"`
	Scope     string   `json:"scope,omitempty"`
	MaxLength int      `json:"maxLength,omitempty"`
	Integer   bool     `json:"integer,omitempty"`
	Min       *float64 `json:"min,omitempty"`
	Max       *float64 `json:"max,omitempty"`
	Options   []Option `json:"options,omitempty"`
}

type Registration struct {
	Fields []Field `json:"fields"`
}

// SectionEntry keeps questions when staff disables collection. Missing enabled
// preserves previously captured v2 forms, which collected whenever nonempty.
type SectionEntry struct {
	Enabled *bool   `json:"enabled,omitempty"`
	Fields  []Field `json:"fields"`
}

// EvaSim stores only the selected branch: Fields for native, URL for embed.
type EvaSim struct {
	Enabled bool    `json:"enabled"`
	Mode    string  `json:"mode"`
	Fields  []Field `json:"fields,omitempty"`
	URL     string  `json:"url,omitempty"`
}

type Forms struct {
	SchemaVersion int                     `json:"schemaVersion"`
	Registration  Registration            `json:"registration"`
	SectionEntry  map[string]SectionEntry `json:"sectionEntry,omitempty"`
	EvaSim        EvaSim                  `json:"evaSim"`
}

// Issue is one validation finding keyed by a JSON-ish path, e.g.
// "registration.fields[2].label" or "evaSim.url".
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// Parse decodes a stored or submitted forms value strictly. Unknown keys and
// unsupported schema versions are errors: present-but-malformed config is
// never equivalent to disabled.
func Parse(raw []byte) (*Forms, []Issue) {
	if len(raw) > MaxDefinitionBytes {
		return nil, []Issue{{Path: "", Message: fmt.Sprintf("Form definitions must be at most %d bytes.", MaxDefinitionBytes)}}
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var f Forms
	if err := dec.Decode(&f); err != nil {
		return nil, []Issue{{Path: "", Message: "Form definitions are malformed."}}
	}
	if dec.More() {
		return nil, []Issue{{Path: "", Message: "Form definitions are malformed."}}
	}
	if issues := f.Validate(); len(issues) > 0 {
		return nil, issues
	}
	return &f, nil
}

// Validate checks structure and the save-time URL rule (a nonblank URL must
// be safe). It does not require completeness; see ReadinessIssues.
func (f *Forms) Validate() []Issue {
	var issues []Issue
	if f.SchemaVersion != SchemaVersion && f.SchemaVersion != SchemaVersionSections {
		issues = append(issues, Issue{Path: "schemaVersion", Message: "Unsupported form schema version."})
	}
	if f.SchemaVersion == SchemaVersionSections {
		if len(f.SectionEntry) != 2 {
			issues = append(issues, Issue{Path: "sectionEntry", Message: "Provide separate Verbal and Math forms."})
		}
		for _, key := range []string{SectionReadingWriting, SectionMath} {
			form, ok := f.SectionEntry[key]
			if !ok {
				issues = append(issues, Issue{Path: "sectionEntry." + key, Message: "Section form is missing."})
			}
			issues = append(issues, validateSectionFields("sectionEntry."+key+".fields", form.Fields)...)
		}
		issues = append(issues, validateSectionFields("registration.fields", f.Registration.Fields)...)
	} else {
		if f.SectionEntry != nil {
			issues = append(issues, Issue{Path: "sectionEntry", Message: "Section entry requires schema version 2."})
		}
		issues = append(issues, validateFields("registration.fields", f.Registration.Fields, true)...)
	}
	switch f.EvaSim.Mode {
	case ModeNative:
		if f.EvaSim.URL != "" {
			issues = append(issues, Issue{Path: "evaSim.url", Message: "A native Eva SIM form cannot also have an external URL."})
		}
		if f.SchemaVersion == SchemaVersionSections {
			issues = append(issues, validateSectionFields("evaSim.fields", f.EvaSim.Fields)...)
		} else {
			issues = append(issues, validateFields("evaSim.fields", f.EvaSim.Fields, false)...)
		}
	case ModeEmbed:
		if len(f.EvaSim.Fields) > 0 {
			issues = append(issues, Issue{Path: "evaSim.fields", Message: "An embedded Eva SIM form cannot also have native questions."})
		}
		if strings.TrimSpace(f.EvaSim.URL) != "" {
			if _, err := CanonicalEmbedURL(f.EvaSim.URL); err != nil {
				issues = append(issues, Issue{Path: "evaSim.url", Message: err.Error()})
			}
		}
	default:
		issues = append(issues, Issue{Path: "evaSim.mode", Message: "Eva SIM mode must be native or embed."})
	}
	return issues
}

// ReadinessIssues are the additional rules a version must satisfy before a
// room can capture it: enabled native mode needs questions, enabled embed
// mode needs a URL.
func (f *Forms) ReadinessIssues() []Issue {
	if !f.EvaSim.Enabled {
		return nil
	}
	switch f.EvaSim.Mode {
	case ModeNative:
		if len(f.EvaSim.Fields) == 0 {
			return []Issue{{Path: "evaSim.fields", Message: "Add at least one Eva SIM question or disable Eva SIM."}}
		}
	case ModeEmbed:
		if strings.TrimSpace(f.EvaSim.URL) == "" {
			return []Issue{{Path: "evaSim.url", Message: "Enter the Eva SIM form URL or disable Eva SIM."}}
		}
	}
	return nil
}

func validateFields(path string, fields []Field, allowScope bool) []Issue {
	var issues []Issue
	if len(fields) > MaxFields {
		return []Issue{{Path: path, Message: fmt.Sprintf("A form can have at most %d questions.", MaxFields)}}
	}
	seen := map[string]bool{}
	for i, fd := range fields {
		p := fmt.Sprintf("%s[%d]", path, i)
		if !idPattern.MatchString(fd.ID) {
			issues = append(issues, Issue{Path: p + ".id", Message: "Question IDs use lowercase letters, digits, - or _."})
		} else if seen[fd.ID] {
			issues = append(issues, Issue{Path: p + ".id", Message: "Question IDs must be unique."})
		}
		seen[fd.ID] = true
		if issue := checkLabel(p+".label", fd.Label, MaxLabelChars); issue != nil {
			issues = append(issues, *issue)
		}
		if utf8.RuneCountInString(fd.Help) > MaxHelpChars {
			issues = append(issues, Issue{Path: p + ".help", Message: fmt.Sprintf("Help text must be at most %d characters.", MaxHelpChars)})
		}
		switch fd.Scope {
		case ScopeAll, ScopeMath:
		case ScopeReadingWriting:
			if !allowScope {
				issues = append(issues, Issue{Path: p + ".scope", Message: "Eva SIM questions apply after Math."})
			}
		default:
			issues = append(issues, Issue{Path: p + ".scope", Message: "Applicability must be all, math or reading-writing."})
		}
		switch fd.Type {
		case TypeText:
			if fd.MaxLength < 1 || fd.MaxLength > MaxTextAnswerChars {
				issues = append(issues, Issue{Path: p + ".maxLength", Message: fmt.Sprintf("Text limit must be between 1 and %d characters.", MaxTextAnswerChars)})
			}
			if fd.Integer || fd.Min != nil || fd.Max != nil || len(fd.Options) > 0 {
				issues = append(issues, Issue{Path: p, Message: "Text questions only support a character limit."})
			}
		case TypeNumber:
			if fd.MaxLength != 0 || len(fd.Options) > 0 {
				issues = append(issues, Issue{Path: p, Message: "Number questions only support integer and bounds."})
			}
			if (fd.Min != nil && !finite(*fd.Min)) || (fd.Max != nil && !finite(*fd.Max)) {
				issues = append(issues, Issue{Path: p, Message: "Number bounds must be finite."})
			} else if fd.Min != nil && fd.Max != nil && *fd.Min > *fd.Max {
				issues = append(issues, Issue{Path: p + ".min", Message: "Minimum cannot exceed maximum."})
			}
		case TypeSingleChoice:
			if fd.MaxLength != 0 || fd.Integer || fd.Min != nil || fd.Max != nil {
				issues = append(issues, Issue{Path: p, Message: "Single-choice questions only support options."})
			}
			if len(fd.Options) == 0 {
				issues = append(issues, Issue{Path: p + ".options", Message: "Add at least one option."})
			} else if len(fd.Options) > MaxOptions {
				issues = append(issues, Issue{Path: p + ".options", Message: fmt.Sprintf("A question can have at most %d options.", MaxOptions)})
			}
			optSeen := map[string]bool{}
			for j, opt := range fd.Options {
				op := fmt.Sprintf("%s.options[%d]", p, j)
				if !idPattern.MatchString(opt.ID) {
					issues = append(issues, Issue{Path: op + ".id", Message: "Option IDs use lowercase letters, digits, - or _."})
				} else if optSeen[opt.ID] {
					issues = append(issues, Issue{Path: op + ".id", Message: "Option IDs must be unique."})
				}
				optSeen[opt.ID] = true
				if issue := checkLabel(op+".label", opt.Label, MaxLabelChars); issue != nil {
					issues = append(issues, *issue)
				}
			}
		default:
			issues = append(issues, Issue{Path: p + ".type", Message: "Question type must be text, number or single_choice."})
		}
	}
	return issues
}

func checkLabel(path, label string, max int) *Issue {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		return &Issue{Path: path, Message: "A label is required."}
	}
	if utf8.RuneCountInString(trimmed) > max {
		return &Issue{Path: path, Message: fmt.Sprintf("Labels must be at most %d characters.", max)}
	}
	if strings.ContainsFunc(label, isControl) {
		return &Issue{Path: path, Message: "Labels cannot contain control characters."}
	}
	return nil
}

func isControl(r rune) bool { return r < 0x20 || r == 0x7f }

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// Applies reports whether a field scope applies to a sitting. sections nil
// means an unrestricted (full) sitting.
func Applies(scope string, sections map[string]bool) bool {
	switch scope {
	case "", ScopeAll:
		return true
	case ScopeMath:
		return sections == nil || sections[SectionMath]
	case ScopeReadingWriting:
		return sections == nil || sections[SectionReadingWriting]
	}
	return false
}

// ApplicableFields filters fields to a sitting, preserving order.
func ApplicableFields(fields []Field, sections map[string]bool) []Field {
	out := make([]Field, 0, len(fields))
	for _, fd := range fields {
		if Applies(fd.Scope, sections) {
			out = append(out, fd)
		}
	}
	return out
}

// IncludesMath reports whether a sitting includes the Math section.
func IncludesMath(sections map[string]bool) bool {
	return sections == nil || sections[SectionMath]
}

// DefaultSATForms is the standard configuration seeded into new SAT drafts:
// three registration questions; Eva disabled in native mode with no fields.
func DefaultSATForms() Forms {
	minYear, maxYear := 1000.0, 9999.0
	return Forms{
		SchemaVersion: SchemaVersion,
		Registration: Registration{Fields: []Field{
			{ID: "sat_admission_year", Type: TypeNumber, Label: "Admission year (ค.ศ.)", Help: "Expected university admission year, e.g. 2027.", Required: true, Scope: ScopeAll, Integer: true, Min: &minYear, Max: &maxYear},
			{ID: "sat_seat_number", Type: TypeText, Label: "Seat number", Help: "Enter the seat assigned by your proctor, e.g. A-007.", Required: true, Scope: ScopeAll, MaxLength: 255},
			{ID: "sat_expected_class", Type: TypeSingleChoice, Label: "Expected Class", Required: true, Scope: ScopeMath, Options: []Option{
				{ID: "unenroll", Label: "Unenroll"},
				{ID: "rank_4", Label: "Rank 4"},
				{ID: "rank_3", Label: "Rank 3"},
				{ID: "rank_2", Label: "Rank 2"},
				{ID: "rank_1", Label: "Rank 1"},
			}},
		}},
		EvaSim: EvaSim{Enabled: false, Mode: ModeNative},
	}
}

// FromSnapshot extracts the forms subtree of a config_snapshot. Absent (or
// JSON null) is legacy: (nil, nil). Present but invalid is an error.
func FromSnapshot(snapshot []byte) (*Forms, error) {
	if len(bytes.TrimSpace(snapshot)) == 0 {
		return nil, nil
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(snapshot, &top); err != nil {
		return nil, fmt.Errorf("config snapshot is not an object: %w", err)
	}
	raw, ok := top[SnapshotKey]
	if !ok || string(bytes.TrimSpace(raw)) == "null" {
		return nil, nil
	}
	f, issues := Parse(raw)
	if len(issues) > 0 {
		return nil, fmt.Errorf("stored forms are invalid: %s %s", issues[0].Path, issues[0].Message)
	}
	return f, nil
}

// Version 2 assigns timing to the form, never to an individual question.
func validateSectionFields(path string, fields []Field) []Issue {
	normalized := append([]Field(nil), fields...)
	var issues []Issue
	for i := range normalized {
		if normalized[i].Scope != "" {
			issues = append(issues, Issue{Path: fmt.Sprintf("%s[%d].scope", path, i), Message: "Version 2 questions inherit their form timing."})
		}
		normalized[i].Scope = ScopeAll
	}
	return append(issues, validateFields(path, normalized, true)...)
}

func SectionFormKey(section string) string {
	switch section {
	case SectionReadingWriting:
		return FormVerbalEntry
	case SectionMath:
		return FormMathEntry
	}
	return ""
}

func (f *Forms) SectionFields(section string) []Field {
	if f == nil || f.SchemaVersion != SchemaVersionSections {
		return nil
	}
	form := f.SectionEntry[section]
	if form.Enabled != nil && !*form.Enabled {
		return nil
	}
	return form.Fields
}

// UpgradeSectionForms returns an independent draft; published forms are never changed.
func UpgradeSectionForms(f Forms) Forms {
	raw, _ := json.Marshal(f)
	var out Forms
	_ = json.Unmarshal(raw, &out)
	if out.SchemaVersion == SchemaVersionSections {
		return out
	}
	out.SchemaVersion = SchemaVersionSections
	out.SectionEntry = map[string]SectionEntry{SectionReadingWriting: {Fields: []Field{}}, SectionMath: {Fields: []Field{}}}
	sourceFields := out.Registration.Fields
	out.Registration.Fields = []Field{}
	for _, field := range sourceFields {
		scope := field.Scope
		field.Scope = ""
		if scope == ScopeAll {
			out.Registration.Fields = append(out.Registration.Fields, field)
		} else {
			form := out.SectionEntry[scope]
			form.Fields = append(form.Fields, field)
			out.SectionEntry[scope] = form
		}
	}
	for i := range out.EvaSim.Fields {
		out.EvaSim.Fields[i].Scope = ""
	}
	return out
}

func DefaultSectionSATForms() Forms { return UpgradeSectionForms(DefaultSATForms()) }
