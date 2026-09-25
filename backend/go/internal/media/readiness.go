package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

const objectCheckTimeout = 3 * time.Second

type AssetIssue struct {
	AssetID           string
	Reason            string
	StorageErrorClass string
}

type assetRecord struct {
	status, contentType, objectKey string
}

func (s *Service) CheckStorage(ctx context.Context) error {
	if s == nil || s.store == nil {
		return errors.New("media object storage is not configured")
	}
	checker, ok := s.store.(objectStoreReadiness)
	if !ok {
		return errors.New("media object storage readiness is unavailable")
	}
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return checker.Check(checkCtx)
}

type objectStoreReadiness interface {
	Check(context.Context) error
}

// VerifyRenderableAssets requires each referenced image to be finalized and
// its object to exist as a readable file before an SAT version is published.
func (s *Service) VerifyRenderableAssets(ctx context.Context, assetIDs []string) ([]AssetIssue, error) {
	ids := uniqueAssetIDs(assetIDs)
	if len(ids) == 0 {
		return nil, nil
	}
	if s.db == nil {
		return nil, errors.New("media database is unavailable")
	}

	records := make(map[string]assetRecord, len(ids))
	for start := 0; start < len(ids); start += 500 {
		end := min(start+500, len(ids))
		batch := ids[start:end]
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")
		args := make([]any, len(batch))
		for i, id := range batch {
			args[i] = id
		}
		rows, err := s.db.QueryContext(ctx, "SELECT id, upload_status, content_type, object_key FROM media_assets WHERE id IN ("+placeholders+")", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var record assetRecord
			if err := rows.Scan(&id, &record.status, &record.contentType, &record.objectKey); err != nil {
				rows.Close()
				return nil, err
			}
			records[id] = record
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	issues := make([]AssetIssue, 0)
	for _, id := range ids {
		record, ok := records[id]
		switch {
		case !ok:
			issues = append(issues, AssetIssue{AssetID: id, Reason: "missing_asset"})
		case record.status != StatusFinalized:
			issues = append(issues, AssetIssue{AssetID: id, Reason: "not_finalized"})
		case validateImageContentType(record.contentType) != nil:
			issues = append(issues, AssetIssue{AssetID: id, Reason: "unsupported_content_type"})
		case s.store == nil:
			issues = append(issues, AssetIssue{AssetID: id, Reason: "storage_unavailable", StorageErrorClass: "unconfigured"})
		default:
			checkCtx, cancel := context.WithTimeout(ctx, objectCheckTimeout)
			err := s.store.Stat(checkCtx, record.objectKey)
			cancel()
			if err != nil {
				issues = append(issues, AssetIssue{AssetID: id, Reason: "object_unreadable", StorageErrorClass: classifyStorageError(err)})
			}
		}
	}
	sort.Slice(issues, func(i, j int) bool { return issues[i].AssetID < issues[j].AssetID })
	return issues, nil
}

func uniqueAssetIDs(assetIDs []string) []string {
	seen := make(map[string]struct{}, len(assetIDs))
	ids := make([]string, 0, len(assetIDs))
	for _, value := range assetIDs {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func classifyStorageError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, os.ErrNotExist):
		return "missing"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		return fmt.Sprintf("%T", err)
	}
}
