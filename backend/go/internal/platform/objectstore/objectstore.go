// Package objectstore abstracts MinIO-compatible media storage (plan: media).
package objectstore

import "context"

// Store is the minimal object interface used by media/assessment flows.
type Store interface {
	Put(ctx context.Context, key string, body []byte, contentType string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
	PresignedGet(ctx context.Context, key string) (string, error)
}
