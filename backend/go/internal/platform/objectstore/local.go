package objectstore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LocalStore is the filesystem-backed object store. Objects are published
// with an atomic rename so readers never observe a partial upload.
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

func (s *LocalStore) Put(ctx context.Context, key string, body []byte, _ string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
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

func (s *LocalStore) Get(ctx context.Context, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

func (s *LocalStore) Stat(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.path(key)
	if err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("object is not a regular file")
	}
	return nil
}

func (s *LocalStore) Check(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if filepath.IsAbs(s.root) {
		info, err := os.Stat(s.root)
		if err != nil {
			return fmt.Errorf("configured object storage root is unavailable: %w", err)
		}
		if !info.IsDir() {
			return errors.New("configured object storage root is not a directory")
		}
	} else if err := os.MkdirAll(s.root, 0o750); err != nil {
		return err
	}
	probe, err := os.CreateTemp(s.root, ".storage-ready-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err := probe.Write([]byte("ready")); err != nil {
		_ = probe.Close()
		return err
	}
	if err := probe.Sync(); err != nil {
		_ = probe.Close()
		return err
	}
	return probe.Close()
}

func (s *LocalStore) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
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
