// Package objectstore abstracts the media object storage.
package objectstore

import (
	"context"
	"io"
)

// Store is the minimal object interface used by media/assessment flows.
type Store interface {
	Put(ctx context.Context, key string, body []byte, contentType string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Stat(ctx context.Context, key string) error
	Delete(ctx context.Context, key string) error
}

// ReadinessStore can confirm the configured bucket or local root is usable.
type ReadinessStore interface {
	Check(ctx context.Context) error
}

// Opener is implemented by stores that can stream an object instead of
// buffering it whole; callers fall back to Get otherwise.
type Opener interface {
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
}
