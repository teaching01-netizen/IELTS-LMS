package main

import (
	"context"
	"testing"
)

func TestCollectIELTSOfflineMediaListsAudioAndRichTextImages(t *testing.T) {
	content := map[string]any{
		"listening": map[string]any{"parts": []any{
			map[string]any{"id": "p1", "audioUrl": "https://cdn.example/a.mp3"},
			map[string]any{"id": "p2", "audioUrl": "https://cdn.example/a.mp3"},
		}},
		"reading": map[string]any{"passages": []any{
			map[string]any{"content": `<p>x</p><img alt="d" src="/api/v1/media/m1/content"><img src='data:image/png;base64,AA'>`},
		}},
		"writing": map[string]any{"task1ImageUrl": "https://cdn.example/chart.png"},
	}
	media := collectIELTSOfflineMedia(content, true)
	kinds := map[string]int{}
	for _, m := range media {
		kinds[m.Kind]++
		if m.Kind == "audio" && (m.PartID == nil || m.MediaRevision != mediaRevisionFor("https://cdn.example/a.mp3")) {
			t.Fatalf("audio identity must match the checkpoint revision rule: %+v", m)
		}
	}
	// Each part binds its own checkpoint identity even when files repeat.
	if kinds["audio"] != 2 || kinds["image"] != 2 {
		t.Fatalf("media = %+v", media)
	}
	if got := collectIELTSOfflineMedia(content, false); len(got) != 2 {
		t.Fatalf("classroom audio must not be packaged: %+v", got)
	}
}

func TestBuildIELTSOfflineManifestIsSharedModelOnly(t *testing.T) {
	m, err := buildIELTSOfflineManifest(context.Background(), nil, map[string]any{"timingModel": "legacy_section_v1"}, map[string]any{}, "a", "c", 1)
	if err != nil || m != nil {
		t.Fatalf("non-shared room received a manifest: %+v %v", m, err)
	}
}
