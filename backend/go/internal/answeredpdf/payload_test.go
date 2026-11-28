package answeredpdf

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/satlearning"
)

type imageBody struct{ *bytes.Reader }

func (imageBody) Close() error { return nil }

func TestServerPayloadLoadsOnlyReferencedFiguresOnce(t *testing.T) {
	var fixture struct {
		Exam delivery.AnsweredExam
		View json.RawMessage
	}
	if err := json.Unmarshal(fullExamPayload(t), &fixture); err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	payload, err := BuildPayload(t.Context(), &fixture.Exam, nil, func(ctx context.Context, id string) (media.Content, error) {
		seen[id]++
		return media.Content{ContentType: "image/png", Body: imageBody{bytes.NewReader([]byte("figure"))}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(seen) != 2 || seen["png"] != 1 || seen["jpeg"] != 1 {
		t.Fatalf("figure reads: %v", seen)
	}
	var decoded struct {
		Media map[string]string
		Exam  delivery.AnsweredExam
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Media["png"] != "data:image/png;base64,ZmlndXJl" || decoded.Exam.CandidateName != fixture.Exam.CandidateName {
		t.Fatal("payload changed")
	}
	_, err = BuildPayload(t.Context(), &fixture.Exam, nil, func(context.Context, string) (media.Content, error) { return media.Content{}, io.ErrUnexpectedEOF })
	if !errors.Is(err, ErrNotPrintable) {
		t.Fatalf("missing figure must fail closed: %v", err)
	}
}

func TestPostedPayloadLoadsAuthorizedExplanationFigures(t *testing.T) {
	exam := &delivery.AnsweredExam{AnswerKey: &delivery.AnsweredExamAnswerKey{
		Available: true,
		Entries: []delivery.AnsweredExamKeyEntry{{
			Explanation: json.RawMessage(`{"version":2,"document":{"type":"doc","content":[{"type":"image","attrs":{"assetId":"explanation-figure"}}]}}`),
		}},
	}}
	reads := 0
	payload, err := BuildPostedAttemptPayload(t.Context(), exam, nil, nil, func(_ context.Context, id string) (media.Content, error) {
		if id != "explanation-figure" {
			t.Fatalf("unexpected figure: %s", id)
		}
		reads++
		return media.Content{ContentType: "image/png", Body: imageBody{bytes.NewReader([]byte("figure"))}}, nil
	}, nil, nil)
	if err != nil || reads != 1 || !bytes.Contains(payload, []byte("data:image/png;base64,ZmlndXJl")) {
		t.Fatalf("expected one inline explanation figure, got %d reads: %v", reads, err)
	}
}

func TestDownloadFilenameMatchesExistingNames(t *testing.T) {
	for _, tc := range []struct{ name, title, want string }{
		{"Mina Chen", "SAT Practice 04", "Mina Chen - SAT Practice 04 - Score report and exam review.pdf"},
		{"  มินา  เฉิน  ", "SAT: Practice / 04?", "มินา เฉิน - SAT Practice 04 - Score report and exam review.pdf"},
		{"", "", "Digital SAT - Score report and exam review.pdf"},
	} {
		if got := Filename(tc.name, tc.title, true); got != tc.want {
			t.Fatalf("got %q want %q", got, tc.want)
		}
	}
}

func TestServerPayloadKeepsOnlyTheAuthorizedKeyVariant(t *testing.T) {
	exam := delivery.AnsweredExam{AttemptID: "a", VersionID: "v"}
	answerOnly, err := BuildPayload(t.Context(), &exam, nil, func(context.Context, string) (media.Content, error) {
		return media.Content{}, errors.New("unexpected figure")
	})
	if err != nil {
		t.Fatal(err)
	}
	exam.AnswerKey = &delivery.AnsweredExamAnswerKey{
		Available: true, PolicyRevision: 3, VersionID: "v",
		Entries: []delivery.AnsweredExamKeyEntry{{
			ModuleID: "m", ExamQuestionID: "q",
			CorrectAnswers: []satlearning.AnswerKeyAnswer{{Label: "B", Text: "Beta"}},
			Result:         "correct",
		}},
	}
	keyed, err := BuildPayload(t.Context(), &exam, nil, func(context.Context, string) (media.Content, error) {
		return media.Content{}, errors.New("unexpected figure")
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(answerOnly) == string(keyed) {
		t.Fatal("keyed and answer-only payloads must have different identity")
	}
	var decoded struct {
		Exam delivery.AnsweredExam `json:"exam"`
	}
	if err := json.Unmarshal(keyed, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Exam.AnswerKey == nil || !decoded.Exam.AnswerKey.Available ||
		len(decoded.Exam.AnswerKey.Entries) != 1 || decoded.Exam.AnswerKey.Entries[0].CorrectAnswers[0].Label != "B" {
		t.Fatalf("keyed payload lost authorization data: %+v", decoded.Exam.AnswerKey)
	}
	var plain struct {
		Exam delivery.AnsweredExam `json:"exam"`
	}
	if err := json.Unmarshal(answerOnly, &plain); err != nil {
		t.Fatal(err)
	}
	if plain.Exam.AnswerKey != nil {
		t.Fatalf("answer-only payload carried keys: %+v", plain.Exam.AnswerKey)
	}
}

func TestExampleFilenameIsAnExample(t *testing.T) {
	for _, tc := range []struct{ title, want string }{
		{"SAT: Practice / 04?", "SAT Practice 04 - Score report example.pdf"},
		{"  ", "Digital SAT - Score report example.pdf"},
	} {
		if got := ExampleFilename(tc.title); got != tc.want {
			t.Fatalf("got %q want %q", got, tc.want)
		}
	}
}
