package delivery

import "testing"

func TestPublishedAudioRevisionUsesPinnedMediaAndPersonalPlayback(t *testing.T) {
	content := `{"listening":{"parts":[{"id":"part-1","audioUrl":"media://asset-v1"}]}}`
	rev, err := publishedAudioRevision(content, `{"sections":{"listening":{"audioPlaybackEnabled":true}}}`, "part-1")
	if err != nil || len(rev) != 64 {
		t.Fatalf("revision=%s err=%v", rev, err)
	}
	changed, err := publishedAudioRevision(`{"listening":{"parts":[{"id":"part-1","audioUrl":"media://asset-v2"}]}}`, `{}`, "part-1")
	if err != nil || changed == rev {
		t.Fatal("changed media reused checkpoint identity")
	}
	if _, err := publishedAudioRevision(content, `{"sections":{"listening":{"audioPlaybackEnabled":false}}}`, "part-1"); err == nil {
		t.Fatal("shared audio accepted a personal checkpoint")
	}
	if _, err := publishedAudioRevision(content, `{}`, "part-other"); err == nil {
		t.Fatal("unpublished part accepted")
	}
}
