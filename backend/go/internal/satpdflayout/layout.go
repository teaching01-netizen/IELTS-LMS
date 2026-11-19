// Package satpdflayout owns saved SAT PDF layouts and their private artwork.
package satpdflayout

import (
	"cmp"
	"slices"
	"strings"
	"unicode/utf8"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

const (
	MaxSlides      = 8
	MaxSlideBytes  = 4 << 20
	MaxLogoBytes   = 1 << 20
	MaxLayoutBytes = 6 << 20
)

type Target struct {
	Kind       string `json:"kind"`
	SectionKey string `json:"sectionKey,omitempty"`
	ModuleKey  string `json:"moduleKey,omitempty"`
}

type Option struct {
	Target Target `json:"target"`
	Label  string `json:"label"`
}

type Slide struct {
	ID          string `json:"id"`
	AssetID     string `json:"assetId"`
	Target      Target `json:"target"`
	Side        string `json:"side"`
	Description string `json:"description"`
}

type Logo struct {
	AssetID     string `json:"assetId"`
	Description string `json:"description,omitempty"`
}

type Logos struct {
	Cover          *Logo `json:"cover"`
	LeftWatermark  *Logo `json:"leftWatermark"`
	RightWatermark *Logo `json:"rightWatermark"`
}

type Layout struct {
	Slides []Slide `json:"slides"`
	Logos  Logos   `json:"logos"`
}

type Snapshot struct {
	Revision int64  `json:"revision"`
	Layout   Layout `json:"layout"`
}

type Editor struct {
	Snapshot
	Targets []Option `json:"targets"`
	Assets  []Asset  `json:"assets"`
}

type Resolved struct {
	Snapshot
	Images map[string]string `json:"images"`
}

func validation(message string) *apperrors.Error {
	return apperrors.New(apperrors.CodeValidation, message)
}

func slideIssue(slideID, message string) *apperrors.Error {
	err := validation(message)
	err.Details = map[string]any{"slideId": slideID}
	return err
}

func isID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id && parsed != uuid.Nil
}

func validDescription(value string) bool {
	return value != "" && utf8.RuneCountInString(value) <= 240
}

func (t Target) valid() bool {
	switch t.Kind {
	case "cover", "scoreReport", "answerSummary", "answerKey", "examReview":
		return t.SectionKey == "" && t.ModuleKey == ""
	case "reviewSubject":
		return t.SectionKey != "" && len(t.SectionKey) <= 100 && t.ModuleKey == ""
	case "reviewModule":
		return t.SectionKey != "" && len(t.SectionKey) <= 100 && t.ModuleKey != "" && len(t.ModuleKey) <= 255
	default:
		return false
	}
}

func (l Layout) normalize() (Layout, error) {
	if len(l.Slides) > MaxSlides {
		return Layout{}, validation("Add at most 8 slide pages.")
	}
	l.Slides = append([]Slide{}, l.Slides...)
	ids := make(map[string]bool, len(l.Slides))
	for index := range l.Slides {
		slide := &l.Slides[index]
		slide.Description = strings.TrimSpace(slide.Description)
		if !isID(slide.ID) || ids[slide.ID] {
			return Layout{}, validation("Slide identifiers must be unique.")
		}
		ids[slide.ID] = true
		if !isID(slide.AssetID) || !slide.Target.valid() || (slide.Side != "before" && slide.Side != "after") {
			return Layout{}, slideIssue(slide.ID, "Choose a valid image and placement.")
		}
		if !validDescription(slide.Description) {
			return Layout{}, slideIssue(slide.ID, "Enter an image description of up to 240 characters.")
		}
	}
	slices.SortStableFunc(l.Slides, func(a, b Slide) int {
		return cmp.Or(cmp.Compare(a.Target.Kind, b.Target.Kind), cmp.Compare(a.Target.SectionKey, b.Target.SectionKey),
			cmp.Compare(a.Target.ModuleKey, b.Target.ModuleKey), cmp.Compare(a.Side, b.Side))
	})
	for slot, logo := range []*Logo{l.Logos.Cover, l.Logos.LeftWatermark, l.Logos.RightWatermark} {
		if logo == nil {
			continue
		}
		if !isID(logo.AssetID) {
			return Layout{}, validation("Choose a valid logo image.")
		}
		if slot == 0 {
			desc := strings.TrimSpace(logo.Description)
			if !validDescription(desc) {
				return Layout{}, validation("Enter a cover logo description of up to 240 characters.")
			}
			l.Logos.Cover = &Logo{AssetID: logo.AssetID, Description: desc}
		} else if logo.Description != "" {
			return Layout{}, validation("Watermarks do not use descriptions.")
		}
	}
	_, err := l.assetPurposes()
	return l, err
}

func (l Layout) assetPurposes() (map[string]string, error) {
	assets := make(map[string]string)
	for _, slide := range l.Slides {
		assets[slide.AssetID] = "slide"
	}
	for _, logo := range []*Logo{l.Logos.Cover, l.Logos.LeftWatermark, l.Logos.RightWatermark} {
		if logo == nil {
			continue
		}
		if assets[logo.AssetID] == "slide" {
			return nil, validation("Use a logo upload for branding.")
		}
		assets[logo.AssetID] = "logo"
	}
	return assets, nil
}

func (l Layout) visible(targets map[Target]bool) Layout {
	visible := l
	visible.Slides = make([]Slide, 0, len(l.Slides))
	for _, slide := range l.Slides {
		if targets[slide.Target] {
			visible.Slides = append(visible.Slides, slide)
		}
	}
	return visible
}

func (l Layout) empty() bool {
	return len(l.Slides) == 0 && l.Logos == (Logos{})
}

func baseOptions() []Option {
	return []Option{
		{Target: Target{Kind: "cover"}, Label: "Cover"},
		{Target: Target{Kind: "scoreReport"}, Label: "Score report"},
		{Target: Target{Kind: "answerSummary"}, Label: "Answer summary"},
		{Target: Target{Kind: "answerKey"}, Label: "Answer key"},
		{Target: Target{Kind: "examReview"}, Label: "Exam review"},
	}
}
