package answeredpdf

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"unicode"
	"unicode/utf16"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/satpdflayout"
	"example.com/ielts-proctoring/internal/satpublish"
	"example.com/ielts-proctoring/internal/satwordvault"
)

// BuildPayload loads only figures in the already-authorized projection. The
// caller selects OpenDelivery for students and OpenFinalized for staff.
func BuildPayload(ctx context.Context, exam *delivery.AnsweredExam, view json.RawMessage, load func(context.Context, string) (media.Content, error)) ([]byte, error) {
	return BuildAttemptPayload(ctx, exam, view, load, nil, nil)
}

func BuildAttemptPayload(ctx context.Context, exam *delivery.AnsweredExam, view json.RawMessage, load func(context.Context, string) (media.Content, error), layout *satpdflayout.Resolved, words []satwordvault.PrintedEntry) ([]byte, error) {
	figures := map[string]string{}
	contents := make([]json.RawMessage, 0)
	for _, section := range exam.Sections {
		for _, module := range section.Modules {
			for _, q := range module.Questions {
				contents = append(contents, q.Stimulus, q.Prompt, q.Answer)
			}
		}
	}
	if err := loadFigures(ctx, contents, load, figures); err != nil {
		return nil, err
	}
	return BuildPostedAttemptPayload(ctx, exam, view, figures, load, layout, words)
}

// BuildPostedAttemptPayload adds authorized explanation figures that the
// legacy client cannot load from its answer-only projection.
func BuildPostedAttemptPayload(ctx context.Context, exam *delivery.AnsweredExam, view json.RawMessage, figures map[string]string, load func(context.Context, string) (media.Content, error), layout *satpdflayout.Resolved, words []satwordvault.PrintedEntry) ([]byte, error) {
	if exam.AnswerKey != nil && exam.AnswerKey.Available {
		explanations := make([]json.RawMessage, 0, len(exam.AnswerKey.Entries))
		for _, entry := range exam.AnswerKey.Entries {
			explanations = append(explanations, entry.Explanation)
		}
		if figures == nil {
			figures = map[string]string{}
		}
		if err := loadFigures(ctx, explanations, load, figures); err != nil {
			return nil, err
		}
	}
	return MarshalAttemptPayload(exam, view, figures, layout, words)
}

func loadFigures(ctx context.Context, contents []json.RawMessage, load func(context.Context, string) (media.Content, error), figures map[string]string) error {
	total := 0
	for _, encoded := range figures {
		total += len(encoded)
	}
	for _, raw := range contents {
		for _, ref := range satpublish.CollectRichContentAssetReferences(string(raw), "", "") {
			if _, ok := figures[ref.AssetID]; ok {
				continue
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			content, err := load(ctx, ref.AssetID)
			if err != nil {
				return ErrNotPrintable
			}
			data, err := io.ReadAll(io.LimitReader(content.Body, media.MaxUploadBytes+1))
			_ = content.Body.Close()
			if err != nil || len(data) == 0 || len(data) > media.MaxUploadBytes || !strings.HasPrefix(content.ContentType, "image/") {
				return ErrNotPrintable
			}
			encoded := "data:" + content.ContentType + ";base64," + base64.StdEncoding.EncodeToString(data)
			total += len(encoded)
			if total > 32<<20 {
				return ErrNotPrintable
			}
			figures[ref.AssetID] = encoded
		}
	}
	return ctx.Err()
}

func MarshalPayload(exam *delivery.AnsweredExam, view json.RawMessage, figures map[string]string, layout *satpdflayout.Resolved) ([]byte, error) {
	return MarshalAttemptPayload(exam, view, figures, layout, nil)
}

func MarshalAttemptPayload(exam *delivery.AnsweredExam, view json.RawMessage, figures map[string]string, layout *satpdflayout.Resolved, words []satwordvault.PrintedEntry) ([]byte, error) {
	return marshalPayload(exam, view, figures, layout, nil, false, words)
}

func MarshalSectionSample(exam *delivery.AnsweredExam, view json.RawMessage, layout *satpdflayout.Resolved, section satpdflayout.Target) ([]byte, error) {
	return marshalPayload(exam, view, map[string]string{}, layout, &section, false, nil)
}

func MarshalSampleBook(exam *delivery.AnsweredExam, view json.RawMessage, layout *satpdflayout.Resolved) ([]byte, error) {
	return marshalPayload(exam, view, map[string]string{}, layout, nil, true, nil)
}

func marshalPayload(exam *delivery.AnsweredExam, view json.RawMessage, figures map[string]string, layout *satpdflayout.Resolved, section *satpdflayout.Target, sampleBook bool, words []satwordvault.PrintedEntry) ([]byte, error) {
	return json.Marshal(struct {
		Exam          *delivery.AnsweredExam      `json:"exam"`
		View          json.RawMessage             `json:"view"`
		Media         map[string]string           `json:"media"`
		Layout        *satpdflayout.Resolved      `json:"layout,omitempty"`
		SectionSample *satpdflayout.Target        `json:"sectionSample,omitempty"`
		SampleBook    bool                        `json:"sampleBook,omitempty"`
		WordVault     []satwordvault.PrintedEntry `json:"wordVault,omitempty"`
	}{exam, view, figures, layout, section, sampleBook, words})
}

// Filename preserves the browser's existing sanitization and UTF-16 length bound.
func Filename(candidate, exam string, scored bool) string {
	name, title := filenamePart(candidate), filenamePart(exam)
	if title == "" {
		title = "Digital SAT"
	}
	suffix := "Answered exam"
	if scored {
		suffix = "Score report and exam review"
	}
	parts := []string{}
	if name != "" {
		parts = append(parts, name)
	}
	return strings.Join(append(parts, title, suffix), " - ") + ".pdf"
}

// ExampleFilename names the authoring download so it can never be mistaken for
// a real student's report.
func ExampleFilename(exam string) string {
	title := filenamePart(exam)
	if title == "" {
		title = "Digital SAT"
	}
	return title + " - Score report example.pdf"
}

func filenamePart(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	units := utf16.Encode([]rune(s))
	if len(units) > 80 {
		s = string(utf16.Decode(units[:80]))
	}
	return strings.TrimRight(s, ". ")
}
