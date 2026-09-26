package objectstore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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
	if err := store.Stat(ctx, key); err != nil {
		t.Fatalf("Stat() existing object: %v", err)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Get(ctx, key); err == nil {
		t.Fatal("Get() after Delete() unexpectedly succeeded")
	}
	if err := store.Stat(ctx, key); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat() deleted object error = %v, want os.ErrNotExist", err)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete() should be idempotent: %v", err)
	}
}

func TestLocalStoreBytesSurviveStoreRecreation(t *testing.T) {
	root := t.TempDir()
	if err := NewLocalStore(root).Put(context.Background(), "media/asset-1/image.png", []byte("image-bytes"), "image/png"); err != nil {
		t.Fatal(err)
	}
	body, err := NewLocalStore(root).Get(context.Background(), "media/asset-1/image.png")
	if err != nil || string(body) != "image-bytes" {
		t.Fatalf("reopened store read = %q, %v", body, err)
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
}

func TestLocalStoreCheckWritesAndCleansProbe(t *testing.T) {
	root := t.TempDir()
	store := NewLocalStore(root)
	if err := store.Check(context.Background()); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("readiness probe was not removed: %v", entries)
	}
}

func TestLocalStoreCheckFailsWhenAbsoluteRootIsMissing(t *testing.T) {
	store := NewLocalStore(filepath.Join(t.TempDir(), "not-mounted"))
	if err := store.Check(context.Background()); err == nil {
		t.Fatal("Check() should fail when the configured absolute storage path is missing")
	}
}
