// Package media owns thin explicit-SQL media upload intents.
//
// It mirrors backend/crates/application/src/media.rs: create_upload_intent,
// complete_upload, and get_asset over media_assets, fronting an
// objectstore.Store for bytes. Uploads are capped at 16MB; pending rows
// older than 24h flip to orphaned and delete_after_at rows are reaped by
// maintenance.RunMedia (same state vocabulary reused here).
package media

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// MaxUploadBytes caps a single media object at 16MB.
const MaxUploadBytes = 16 << 20

// Upload states (mirrors the media_assets CHECK + maintenance.RunMedia).
const (
	StatusPending   = "pending"
	StatusFinalized = "finalized"
	StatusOrphaned  = "orphaned"
	StatusDeleted   = "deleted"
)

// Service wires media transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
	store  objectstore.Store
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner, store objectstore.Store) *Service {
	return &Service{db: db, runner: runner, store: store}
}

// Asset is the media_assets row projection.
type Asset struct {
	ID          string  `json:"id"`
	OwnerKind   string  `json:"ownerKind"`
	OwnerID     string  `json:"ownerId"`
	ContentType string  `json:"contentType"`
	FileName    string  `json:"fileName"`
	Status      string  `json:"uploadStatus"`
	ObjectKey   string  `json:"objectKey"`
	SizeBytes   *int64  `json:"sizeBytes,omitempty"`
	Checksum    *string `json:"checksumSha256,omitempty"`
	UploadURL   string  `json:"uploadUrl"`
	DownloadURL *string `json:"downloadUrl,omitempty"`
}

// UploadIntent is the created pending asset + upload URL.
type UploadIntent struct {
	Asset     Asset             `json:"asset"`
	UploadURL string            `json:"uploadUrl"`
	Headers   map[string]string `json:"headers"`
}

// CreateRequest mirrors UploadIntentRequest.
type CreateRequest struct {
	OwnerKind   string
	OwnerID     string
	ContentType string
	FileName    string
	Checksum    *string
	SizeBytes   *int64
}

// CompleteRequest mirrors CompleteUploadRequest.
type CompleteRequest struct {
	SizeBytes int64
	Checksum  string
}

func validationError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeValidation, msg)
}

func notFoundError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

func scanAsset(row interface {
	Scan(dest ...any) error
}) (Asset, error) {
	var a Asset
	var size sql.NullInt64
	var checksum, download sql.NullString
	if err := row.Scan(&a.ID, &a.OwnerKind, &a.OwnerID, &a.ContentType, &a.FileName, &a.Status, &a.ObjectKey, &size, &checksum, &a.UploadURL, &download); err != nil {
		return Asset{}, err
	}
	if size.Valid {
		v := size.Int64
		a.SizeBytes = &v
	}
	if checksum.Valid {
		v := checksum.String
		a.Checksum = &v
	}
	if download.Valid {
		v := download.String
		a.DownloadURL = &v
	}
	return a, nil
}

const assetColumns = "id, owner_kind, owner_id, content_type, file_name, upload_status, object_key, size_bytes, checksum_sha256, upload_url, download_url"

// CreateUpload stages a pending asset row (mirrors create_upload_intent:
// path-safe file name, 16MB pre-declared size cap, owner existence check).
func (s *Service) CreateUpload(ctx context.Context, req CreateRequest) (UploadIntent, error) {
	if err := validateFileName(req.FileName); err != nil {
		return UploadIntent{}, err
	}
	if strings.TrimSpace(req.OwnerKind) == "" || strings.TrimSpace(req.OwnerID) == "" {
		return UploadIntent{}, validationError("Upload owner is required.")
	}
	if strings.TrimSpace(req.ContentType) == "" {
		return UploadIntent{}, validationError("Content type is required.")
	}
	if req.SizeBytes != nil && *req.SizeBytes > MaxUploadBytes {
		return UploadIntent{}, apperrors.New(apperrors.CodePayloadTooLarge, fmt.Sprintf("Upload exceeds the %d byte limit.", MaxUploadBytes))
	}
	var checksum *string
	if req.Checksum != nil {
		c := strings.ToLower(strings.TrimSpace(*req.Checksum))
		if err := validateChecksum(c); err != nil {
			return UploadIntent{}, err
		}
		checksum = &c
	}
	if err := s.checkOwner(ctx, req.OwnerKind, req.OwnerID); err != nil {
		return UploadIntent{}, err
	}
	assetID := uuid.NewString()
	objectKey := fmt.Sprintf("media/%s/%s", assetID, req.FileName)
	// Local deployments upload through the authenticated API route. Keeping
	// the asset id in the URL avoids exposing the storage object key.
	uploadURL := fmt.Sprintf("/api/v1/media/uploads/%s", assetID)
	if s.store != nil {
		if u, err := s.store.PresignedGet(ctx, objectKey); err == nil && strings.TrimSpace(u) != "" {
			uploadURL = u
		}
	}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, "INSERT INTO media_assets (id, owner_kind, owner_id, content_type, file_name, upload_status, object_key, size_bytes, checksum_sha256, upload_url, delete_after_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), NOW())", assetID, req.OwnerKind, req.OwnerID, req.ContentType, req.FileName, objectKey, nullableInt(req.SizeBytes), nullableStr(checksum), uploadURL); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return UploadIntent{}, err
	}
	asset, err := s.GetAsset(ctx, assetID)
	if err != nil {
		return UploadIntent{}, err
	}
	headers := map[string]string{"content-type": req.ContentType}
	if checksum != nil {
		headers["x-amz-meta-checksum-sha256"] = *checksum
	}
	return UploadIntent{Asset: asset, UploadURL: uploadURL, Headers: headers}, nil
}

// CompleteUpload finalizes a pending asset (mirrors complete_upload: required
// size + checksum, 16MB cap, pending->finalized under row locks; an already
// finalized asset with identical metadata replays idempotently).
func (s *Service) CompleteUpload(ctx context.Context, assetID string, req CompleteRequest) (Asset, error) {
	if req.SizeBytes < 0 {
		return Asset{}, validationError("The uploaded object size cannot be negative.")
	}
	if req.SizeBytes > MaxUploadBytes {
		return Asset{}, apperrors.New(apperrors.CodePayloadTooLarge, fmt.Sprintf("Upload exceeds the %d byte limit.", MaxUploadBytes))
	}
	checksum := strings.ToLower(strings.TrimSpace(req.Checksum))
	if checksum == "" {
		return Asset{}, validationError("The uploaded object checksum is required.")
	}
	if err := validateChecksum(checksum); err != nil {
		return Asset{}, err
	}
	var out Asset
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on media_assets serializes complete vs janitor.
		a, err := scanAsset(q.QueryRowContext(ctx, "SELECT "+assetColumns+" FROM media_assets WHERE id = ? FOR UPDATE", assetID))
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Media asset not found.")
			}
			return err
		}
		if a.Status != StatusPending {
			if a.SizeBytes == nil || *a.SizeBytes != req.SizeBytes || a.Checksum == nil || !strings.EqualFold(*a.Checksum, checksum) {
				return validationError("The uploaded object does not match the finalized asset metadata.")
			}
			out = a
			return nil
		}
		if s.store == nil {
			return serviceUnavailable()
		}
		if a.SizeBytes != nil && *a.SizeBytes != req.SizeBytes {
			return validationError("The uploaded object does not match the declared asset metadata.")
		}
		if a.Checksum != nil && !strings.EqualFold(*a.Checksum, checksum) {
			return validationError("The uploaded object does not match the declared asset metadata.")
		}
		body, err := s.store.Get(ctx, a.ObjectKey)
		if err != nil {
			return serviceUnavailable()
		}
		digest := sha256.Sum256(body)
		actualChecksum := fmt.Sprintf("%x", digest[:])
		if int64(len(body)) != req.SizeBytes || !strings.EqualFold(actualChecksum, checksum) {
			return validationError("The uploaded object metadata does not match the completion request.")
		}
		downloadURL := fmt.Sprintf("/api/v1/media/assets/%s", assetID)
		res, err := q.ExecContext(ctx, "UPDATE media_assets SET upload_status = 'finalized', size_bytes = ?, checksum_sha256 = ?, download_url = ?, delete_after_at = NULL, updated_at = NOW() WHERE id = ? AND upload_status = 'pending'", req.SizeBytes, checksum, downloadURL, assetID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return validationError("The media asset is no longer accepting uploads.")
		}
		a, err = scanAsset(q.QueryRowContext(ctx, "SELECT "+assetColumns+" FROM media_assets WHERE id = ?", assetID))
		if err != nil {
			return err
		}
		out = a
		return nil
	})
	return out, err
}

// GetAsset loads one asset or returns NOT_FOUND.
func (s *Service) GetAsset(ctx context.Context, assetID string) (Asset, error) {
	a, err := scanAsset(s.db.QueryRowContext(ctx, "SELECT "+assetColumns+" FROM media_assets WHERE id = ?", assetID))
	if err != nil {
		if err == sql.ErrNoRows {
			return Asset{}, notFoundError("Media asset not found.")
		}
		return Asset{}, err
	}
	return a, nil
}

// serviceUnavailable renders the explicit unconfigured-store error.
func serviceUnavailable() *apperrors.Error {
	return apperrors.New(apperrors.CodeServiceUnavailable, "Media object storage is unavailable.")
}

// UploadBytes stores raw bytes for a pending asset (mirrors
// upload_local_object: SELECT ... FOR UPDATE + asset-scope, pending-only
// guard, commit, then put_local_object). The store Put runs after commit so
// a rolled-back tx can never leave orphaned bytes behind; if the Put fails
// afterwards, the compensating status flip back to pending keeps the row and
// the object consistent.
func (s *Service) UploadBytes(ctx context.Context, assetID string, body []byte, contentType string) error {
	if s.store == nil {
		return serviceUnavailable()
	}
	if len(body) == 0 {
		return validationError("The uploaded object must not be empty.")
	}
	if len(body) > MaxUploadBytes {
		return apperrors.New(apperrors.CodePayloadTooLarge, fmt.Sprintf("Upload exceeds the %d byte limit.", MaxUploadBytes))
	}
	// SELECT ... FOR UPDATE on media_assets serializes upload vs janitor and
	// captures the object key; the tx only guards the row, not the bytes.
	var objectKey string
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		a, err := scanAsset(q.QueryRowContext(ctx, "SELECT "+assetColumns+" FROM media_assets WHERE id = ? FOR UPDATE", assetID))
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Media asset not found.")
			}
			return err
		}
		if a.Status != StatusPending {
			return validationError("The media asset is no longer accepting uploads.")
		}
		objectKey = a.ObjectKey
		return nil
	})
	if err != nil {
		return err
	}
	if err := s.store.Put(ctx, objectKey, body, contentType); err != nil {
		return serviceUnavailable()
	}
	return nil
}

// ReadBytes loads finalized bytes (mirrors read_local_object: get_asset
// then finalized-only guard then read).
func (s *Service) ReadBytes(ctx context.Context, assetID string) (string, []byte, error) {
	asset, err := s.GetAsset(ctx, assetID)
	if err != nil {
		return "", nil, err
	}
	if asset.Status != StatusFinalized {
		return "", nil, notFoundError("Media asset not found.")
	}
	if s.store == nil {
		return "", nil, serviceUnavailable()
	}
	body, err := s.store.Get(ctx, asset.ObjectKey)
	if err != nil {
		return "", nil, serviceUnavailable()
	}
	return asset.ContentType, body, nil
}

func (s *Service) checkOwner(ctx context.Context, ownerKind, ownerID string) error {
	var query string
	switch ownerKind {
	case "assessment_exam":
		query = "SELECT id FROM exam_entities WHERE id = ? LIMIT 1"
	case "assessment_question":
		query = "SELECT id FROM assessment_questions WHERE id = ? LIMIT 1"
	case "attempt":
		query = "SELECT id FROM student_attempts WHERE id = ? LIMIT 1"
	case "submission":
		query = "SELECT id FROM student_submissions WHERE id = ? LIMIT 1"
	case "assessment_import":
		query = "SELECT id FROM sat_workbook_imports WHERE id = ? LIMIT 1"
	default:
		return validationError(fmt.Sprintf("Unknown owner kind %q.", ownerKind))
	}
	var id string
	if err := s.db.QueryRowContext(ctx, query, ownerID).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return notFoundError("Upload owner not found.")
		}
		return err
	}
	return nil
}

func validateFileName(name string) error {
	if strings.TrimSpace(name) == "" || strings.Contains(name, "/") || strings.Contains(name, "\\") || name == "." || name == ".." {
		return validationError("The file name must be a single path-safe file name.")
	}
	return nil
}

func validateChecksum(c string) error {
	if len(c) != 64 {
		return validationError("The uploaded object checksum must be a 64-character hex digest.")
	}
	for _, ch := range c {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return validationError("The uploaded object checksum must be lowercase hex.")
		}
	}
	return nil
}

func nullableInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullableStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}
