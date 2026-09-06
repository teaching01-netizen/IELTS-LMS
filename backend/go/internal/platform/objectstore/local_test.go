package objectstore

import (
	"context"
	"testing"
)

func TestLocalStorePublishesReadsAndDeletesAtomically(t *testing.T) {
	store := NewLocalStore(t.TempDir())
	ctx := context.Background()
	key := "media/asset-1/image.png"
	body := []byte("image-bytes")

	if err := store.Put(ctx, key, body, "image/png"); err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	got, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if string(got) != string(body) {
		t.Fatalf("Get() = %q, want %q", got, body)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Get(ctx, key); err == nil {
		t.Fatal("Get() after Delete() unexpectedly succeeded")
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete() should be idempotent: %v", err)
	}
}

func TestLocalStoreRejectsEscapingKeys(t *testing.T) {
	store := NewLocalStore(t.TempDir())
	ctx := context.Background()
	for _, key := range []string{"", "../outside", "media/../../outside", "media/\x00bad"} {
		if err := store.Put(ctx, key, []byte("bytes"), "application/octet-stream"); err == nil {
			t.Fatalf("Put(%q) unexpectedly succeeded", key)
		}
	}
	if _, err := store.PresignedGet(ctx, "media/asset-1/file"); err == nil {
		t.Fatal("PresignedGet() unexpectedly succeeded for local storage")
	}
}
