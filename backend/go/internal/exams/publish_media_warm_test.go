package exams

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"example.com/ielts-proctoring/internal/media"
)

type recordingVerifier struct {
	calls [][]string
	err   error
}

func (v *recordingVerifier) VerifyRenderableAssets(_ context.Context, ids []string) ([]media.AssetIssue, error) {
	v.calls = append(v.calls, ids)
	return nil, v.err
}

func TestWarmPublishedMediaKicksURLReferencedFigures(t *testing.T) {
	verifier := &recordingVerifier{}
	s := (&Service{}).SetMediaVerifier(verifier)
	content := json.RawMessage(`{"passages":[{"image":"/api/v1/media/fig-1/content"},{"html":"<img src='/api/v1/media/fig-2/content'>"}]}`)
	s.warmPublishedMedia(context.Background(), Version{ID: "v1", ExamID: "e1", Content: content})
	if want := [][]string{{"fig-1", "fig-2"}}; !reflect.DeepEqual(verifier.calls, want) {
		t.Fatalf("warm calls = %v, want %v", verifier.calls, want)
	}
}

func TestWarmPublishedMediaSkipsContentWithoutFiguresAndIgnoresErrors(t *testing.T) {
	verifier := &recordingVerifier{err: errors.New("db down")}
	s := (&Service{}).SetMediaVerifier(verifier)
	s.warmPublishedMedia(context.Background(), Version{Content: json.RawMessage(`{"providerKey":"sat"}`)})
	if len(verifier.calls) != 0 {
		t.Fatalf("warm called for content without figures: %v", verifier.calls)
	}
	// A verifier failure is logged, never surfaced: publish already committed.
	s.warmPublishedMedia(context.Background(), Version{Content: json.RawMessage(`"/api/v1/media/x/content"`)})
	(&Service{}).warmPublishedMedia(context.Background(), Version{Content: json.RawMessage(`"/api/v1/media/x/content"`)})
}
