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
	"example.com/ielts-proctoring/internal/satpublish"
)

// BuildPayload loads only figures in the already-authorized projection. The
// caller selects OpenDelivery for students and OpenFinalized for staff.
func BuildPayload(ctx context.Context, exam *delivery.AnsweredExam, view json.RawMessage, load func(context.Context, string) (media.Content, error)) ([]byte, error) {
	figures := map[string]string{}
	total := 0
	for _, section := range exam.Sections {
		for _, module := range section.Modules {
			for _, q := range module.Questions {
				for _, raw := range []json.RawMessage{q.Stimulus, q.Prompt, q.Answer} {
					for _, ref := range satpublish.CollectRichContentAssetReferences(string(raw), "", q.ExamQuestionID) {
						if _, ok := figures[ref.AssetID]; ok {
							continue
						}
						if err := ctx.Err(); err != nil {
							return nil, err
						}
						content, err := load(ctx, ref.AssetID)
						if err != nil {
							return nil, ErrNotPrintable
						}
						data, err := io.ReadAll(io.LimitReader(content.Body, media.MaxUploadBytes+1))
						_ = content.Body.Close()
						if err != nil || len(data) == 0 || len(data) > media.MaxUploadBytes || !strings.HasPrefix(content.ContentType, "image/") {
							return nil, ErrNotPrintable
						}
						encoded := "data:" + content.ContentType + ";base64," + base64.StdEncoding.EncodeToString(data)
						total += len(encoded)
						if total > 32<<20 {
							return nil, ErrNotPrintable
						}
						figures[ref.AssetID] = encoded
					}
				}
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Exam  *delivery.AnsweredExam `json:"exam"`
		View  json.RawMessage        `json:"view"`
		Media map[string]string      `json:"media"`
	}{exam, view, figures})
}

// Filename preserves the browser's existing sanitization and UTF-16 length bound.
func Filename(candidate, exam string, scored bool) string {
	part := func(s string) string {
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
	name, title := part(candidate), part(exam)
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
