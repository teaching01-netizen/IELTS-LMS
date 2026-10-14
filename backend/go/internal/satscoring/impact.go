package satscoring

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satpublish"
)

const (
	impactBatch   = 1000
	impactTimeout = 45 * time.Second
	impactTopN    = 50
)

// SectionImpact summarizes one subject.
type SectionImpact struct {
	Considered         int  `json:"considered"`
	Changed            int  `json:"changed"`
	Unchanged          int  `json:"unchanged"`
	BecomesUnavailable int  `json:"becomesUnavailable"`
	BecomesAvailable   int  `json:"becomesAvailable"`
	MinDelta           *int `json:"minDelta"`
	MaxDelta           *int `json:"maxDelta"`
}

// ImpactChange is one distinct (section, route, raw scores) whose displayed
// score would change.
type ImpactChange struct {
	Section  string            `json:"section"`
	Topology string            `json:"topology"`
	M1       int               `json:"m1"`
	M2       *int              `json:"m2"`
	Count    int               `json:"count"`
	OldScore *satconvert.Score `json:"oldScore"`
	NewScore *satconvert.Score `json:"newScore"`
}

// ImpactReport compares what is displayed now against a draft.
type ImpactReport struct {
	DraftID           string                    `json:"draftId"`
	ActiveRevisionID  *string                   `json:"activeRevisionId"`
	GeneratedAt       time.Time                 `json:"generatedAt"`
	ResultsConsidered int                       `json:"resultsConsidered"`
	Sections          map[string]*SectionImpact `json:"sections"`
	TopChanges        []ImpactChange            `json:"topChanges"`
}

type impactKey struct {
	section, topo string
	m1, m1Ops     int
	m2, m2Ops     int
	oldOK         bool // legacy stored score (only when no revision is active)
	oldLow        int
	oldHigh       int
}

// Impact compares the current display with a stored revision (usually a draft)
// over every released SAT result. The scan streams keyset batches of the
// persisted classroomRaw module scores - the same source the overlay reads, so
// the report and the later display agree - and keeps only a histogram keyed by
// (section, route, Module 1 raw, Module 2 raw), so memory and output are
// bounded by the number of table cells, not by the number of attempts.
func (s *Service) Impact(ctx context.Context, draftID string) (*ImpactReport, error) {
	candidate, err := s.GetRevision(ctx, draftID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, impactTimeout)
	defer cancel()
	active, err := ActiveRevision(ctx, s.db)
	if err != nil {
		return nil, err
	}
	hist := map[impactKey]int{}
	considered := 0
	cursor := ""
	for {
		rows, err := s.db.QueryContext(ctx, `
			SELECT ar.id, CAST(JSON_EXTRACT(ar.score_payload, '$.classroomRaw.sections') AS CHAR)
			FROM assessment_results ar
			WHERE ar.provider_key = 'sat' AND ar.release_status = 'released' AND ar.id > ?
			  AND JSON_EXTRACT(ar.score_payload, '$.classroomRaw.sections') IS NOT NULL
			ORDER BY ar.id LIMIT ?`, cursor, impactBatch)
		if err != nil {
			return nil, impactError(ctx, err)
		}
		n := 0
		for rows.Next() {
			var id, sectionsJSON string
			if err := rows.Scan(&id, &sectionsJSON); err != nil {
				rows.Close()
				return nil, err
			}
			cursor = id
			n++
			var sections []map[string]any
			// A JSON null (or an empty list) is not a report: it must not inflate the count.
			if json.Unmarshal([]byte(sectionsJSON), &sections) != nil || len(sections) == 0 {
				continue
			}
			considered++
			for _, section := range sections {
				key, _ := section["sectionKey"].(string)
				mods, ok := sectionModules(section)
				if !ok {
					continue
				}
				roles := make([]string, len(mods))
				for i, m := range mods {
					roles[i] = m.Role
				}
				topo, ok := satconvert.TopologyOf(roles)
				if !ok {
					continue
				}
				k := impactKey{section: key, topo: string(topo)}
				for _, m := range mods {
					if m.Role == satpublish.RoleBase {
						k.m1, k.m1Ops = m.Raw, m.Ops
					} else {
						k.m2, k.m2Ops = m.Raw, m.Ops
					}
				}
				if active == nil && section["conversionStatus"] == "converted" {
					if sc, ok := section["scaled"].(map[string]any); ok {
						low, okLow := toInt(sc["low"])
						high, okHigh := toInt(sc["high"])
						k.oldOK, k.oldLow, k.oldHigh = okLow && okHigh, low, high
					}
				}
				hist[k]++
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, impactError(ctx, err)
		}
		rows.Close()
		if n < impactBatch {
			break
		}
	}

	report := &ImpactReport{
		DraftID: draftID, GeneratedAt: time.Now().UTC(), ResultsConsidered: considered,
		Sections: map[string]*SectionImpact{}, TopChanges: []ImpactChange{},
	}
	if active != nil {
		id := active.ID
		report.ActiveRevisionID = &id
	}
	var changes []ImpactChange
	for k, count := range hist {
		sec := report.Sections[k.section]
		if sec == nil {
			sec = &SectionImpact{}
			report.Sections[k.section] = sec
		}
		var oldScore, newScore *satconvert.Score
		if active != nil {
			if sc, ok := active.Content.Resolve(k.section, satconvert.Topology(k.topo), k.m1, k.m1Ops, k.m2, k.m2Ops); ok {
				oldScore = &sc
			}
		} else if k.oldOK {
			oldScore = &satconvert.Score{Low: k.oldLow, High: k.oldHigh}
		}
		if sc, ok := candidate.Content.Resolve(k.section, satconvert.Topology(k.topo), k.m1, k.m1Ops, k.m2, k.m2Ops); ok {
			newScore = &sc
		}
		sec.Considered += count
		switch {
		case oldScore == nil && newScore == nil:
			sec.Unchanged += count
		case oldScore != nil && newScore == nil:
			sec.BecomesUnavailable += count
		case oldScore == nil && newScore != nil:
			sec.BecomesAvailable += count
		case *oldScore == *newScore:
			sec.Unchanged += count
		default:
			sec.Changed += count
			delta := newScore.Low - oldScore.Low
			if sec.MinDelta == nil || delta < *sec.MinDelta {
				sec.MinDelta = &delta
			}
			if sec.MaxDelta == nil || delta > *sec.MaxDelta {
				sec.MaxDelta = &delta
			}
		}
		if (oldScore == nil) != (newScore == nil) || (oldScore != nil && *oldScore != *newScore) {
			m2 := k.m2
			m1 := k.m1
			if satconvert.Topology(k.topo) == satconvert.M2LowerOnly || satconvert.Topology(k.topo) == satconvert.M2HigherOnly {
				m1 = 0
			}
			changes = append(changes, ImpactChange{Section: k.section, Topology: k.topo, M1: m1, M2: &m2, Count: count, OldScore: oldScore, NewScore: newScore})
		}
	}
	sort.Slice(changes, func(i, j int) bool {
		a, b := changes[i], changes[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		if a.Section != b.Section {
			return a.Section < b.Section
		}
		if a.Topology != b.Topology {
			return a.Topology < b.Topology
		}
		if a.M1 != b.M1 {
			return a.M1 < b.M1
		}
		return *a.M2 < *b.M2
	})
	if len(changes) > impactTopN {
		changes = changes[:impactTopN]
	}
	if changes != nil {
		report.TopChanges = changes
	}
	return report, nil
}

func impactError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return &apperrors.Error{Code: apperrors.CodeServiceUnavailable, Message: "The impact report took too long. Try again outside exam hours.", HTTPStatus: 503, Retryable: true}
	}
	return err
}
