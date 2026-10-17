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
