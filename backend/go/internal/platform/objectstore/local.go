package objectstore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LocalStore is the durable single-node object store used when no external
// S3-compatible service is configured. Objects are published with an atomic
// rename so a reader can never observe a partially written upload.
type LocalStore struct {
	root string
}

// NewLocalStore creates a filesystem-backed store rooted at root. A relative
// root is intentionally resolved relative to the running process, matching
// the Go service's existing .data layout.
func NewLocalStore(root string) *LocalStore {
	if strings.TrimSpace(root) == "" {
		root = ".data/object-store"
	}
	return &LocalStore{root: filepath.Clean(root)}
}

func (s *LocalStore) Put(_ context.Context, key string, body []byte, _ string) error {
	path, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create object directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".object-upload-*")
	if err != nil {
		return fmt.Errorf("create temporary object: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o640); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("protect temporary object: %w", err)
	}
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write object: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("flush object: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close object: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("publish object: %w", err)
	}
	return nil
}

func (s *LocalStore) Get(_ context.Context, key string) ([]byte, error) {
	path, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

func (s *LocalStore) Delete(_ context.Context, key string) error {
	path, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// PresignedGet deliberately returns an error: local uploads and downloads
// must use the authenticated API routes, not an unauthenticated filesystem
// URL. The media service falls back to those routes on this error.
func (s *LocalStore) PresignedGet(_ context.Context, _ string) (string, error) {
	return "", errors.New("presigned URLs are not supported by the local object store")
}

func (s *LocalStore) path(key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" || strings.ContainsRune(key, 0) {
		return "", errors.New("object key is empty or contains a NUL byte")
	}
	root, err := filepath.Abs(s.root)
	if err != nil {
		return "", fmt.Errorf("resolve object root: %w", err)
	}
	path := filepath.Join(root, filepath.FromSlash(key))
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", errors.New("object key escapes the object store root")
	}
	return path, nil
}
