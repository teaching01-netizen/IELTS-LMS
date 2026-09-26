// Package media owns thin explicit-SQL media upload intents.
//
// It mirrors backend/crates/application/src/media.rs: create_upload_intent,
// complete_upload, and get_asset over media_assets, fronting an
// objectstore.Store for bytes. New uploads are capped at 10 MiB; pending rows
// older than 24h flip to orphaned and delete_after_at rows are reaped by
// maintenance.RunMedia (same state vocabulary reused here).
package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"strings"

	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// MaxUploadBytes caps a new media object at 10 MiB.
const MaxUploadBytes = 10 << 20

// Decoded-image limits bound decompression cost: magic bytes prove the file
// TYPE, not its pixel cost. DecodeConfig reads headers only (no full decode).
const (
	maxDecodedPixels  = 25_000_000
	maxImageDimension = 8192
)

const (
	unsupportedImageTypeMessage = "Only PNG, JPEG, GIF, or WebP images can be uploaded."
	imageMagicMismatchMessage   = "The uploaded bytes do not match the declared image type."
	imageIntentMismatchMessage  = "The uploaded content type does not match the upload intent."
	imageChecksumMismatchMsg    = "The uploaded object checksum does not match the completion request."
	imageFinalSizeMismatchMsg   = "The uploaded object size does not match the completion request."
)

// Upload states (mirrors the media_assets CHECK + maintenance.RunMedia).
const (
	StatusPending   = "pending"
	StatusFinalized = "finalized"
	StatusOrphaned  = "orphaned"
	StatusDeleted   = "deleted"
)

// Service wires media transitions explicitly.
type Service struct {
	db            *sql.DB
	runner        *tx.Runner
	store         objectstore.Store
	remoteFetcher RemoteImageFetcher
}

// NewService wires the core media dependencies. URL imports remain disabled
// unless the composition root supplies a RemoteImageFetcher.
func NewService(db *sql.DB, runner *tx.Runner, store objectstore.Store) *Service {
	return NewServiceWithRemoteFetcher(db, runner, store, nil)
}

// NewServiceWithRemoteFetcher is the composition seam for bounded HTTPS image
// imports. Production callers should pass NewHTTPRemoteImageFetcher here;
// tests can inject a deterministic fake.
func NewServiceWithRemoteFetcher(
	db *sql.DB,
	runner *tx.Runner,
	store objectstore.Store,
	fetcher RemoteImageFetcher,
) *Service {
	return &Service{db: db, runner: runner, store: store, remoteFetcher: fetcher}
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

// ImportURLRequest describes a remote image that must become a managed asset.
type ImportURLRequest struct {
	OwnerKind string
	OwnerID   string
	URL       string
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
// path-safe file name, 10 MiB pre-declared size cap, owner existence check).
func (s *Service) CreateUpload(ctx context.Context, req CreateRequest) (UploadIntent, error) {
	if err := validateFileName(req.FileName); err != nil {
		return UploadIntent{}, err
	}
	if strings.TrimSpace(req.OwnerKind) == "" || strings.TrimSpace(req.OwnerID) == "" {
		return UploadIntent{}, validationError("Upload owner is required.")
	}
	contentType := normalizeContentType(req.ContentType)
	if err := validateImageContentType(contentType); err != nil {
		return UploadIntent{}, err
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
	// Uploads always use the authenticated API route. A signed GET is never a
	// valid upload URL, even when the configured store supports presigning.
	uploadURL := fmt.Sprintf("/api/v1/media/uploads/%s", assetID)
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, "INSERT INTO media_assets (id, owner_kind, owner_id, content_type, file_name, upload_status, object_key, size_bytes, checksum_sha256, upload_url, delete_after_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), NOW())", assetID, req.OwnerKind, req.OwnerID, contentType, req.FileName, objectKey, nullableInt(req.SizeBytes), nullableStr(checksum), uploadURL); err != nil {
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
	headers := map[string]string{"content-type": contentType}
	if checksum != nil {
		headers["x-amz-meta-checksum-sha256"] = *checksum
	}
	return UploadIntent{Asset: asset, UploadURL: uploadURL, Headers: headers}, nil
}

// CompleteUpload finalizes a pending asset (mirrors complete_upload: required
// size + checksum, 10 MiB cap, pending->finalized under row locks; an already
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
		body, err := s.store.Get(ctx, a.ObjectKey)
		if err != nil {
			return serviceUnavailable()
		}
		if len(body) > MaxUploadBytes {
			return uploadTooLargeError()
		}
		contentType := normalizeContentType(a.ContentType)
		if err := validateImageContentType(contentType); err != nil {
			return err
		}
		if err := validateImageMagic(body, contentType); err != nil {
			return err
		}
		if err := validateDecodedImageLimits(body, contentType); err != nil {
			return err
		}
		if a.SizeBytes != nil && *a.SizeBytes != req.SizeBytes {
			return validationError(imageFinalSizeMismatchMsg)
		}
		if a.Checksum != nil && !strings.EqualFold(*a.Checksum, checksum) {
			return validationError(imageChecksumMismatchMsg)
		}
		digest := sha256.Sum256(body)
		actualChecksum := fmt.Sprintf("%x", digest[:])
		if int64(len(body)) != req.SizeBytes {
			return validationError(imageFinalSizeMismatchMsg)
		}
		if !strings.EqualFold(actualChecksum, checksum) {
			return validationError(imageChecksumMismatchMsg)
		}
		downloadURL := fmt.Sprintf("/api/v1/media/%s/content", assetID)
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

// ImportURL fetches an HTTPS image through the SSRF-safe network port and
// routes the bytes through the same MIME, magic, dimension, checksum, and
// finalization path as a browser upload.
func (s *Service) ImportURL(ctx context.Context, req ImportURLRequest) (Asset, error) {
	ownerKind := strings.TrimSpace(req.OwnerKind)
	ownerID := strings.TrimSpace(req.OwnerID)
	if ownerKind == "" || ownerID == "" {
		return Asset{}, validationError("Upload owner is required.")
	}
	if s.store == nil {
		return Asset{}, serviceUnavailable()
	}
	if err := s.checkOwner(ctx, ownerKind, ownerID); err != nil {
		return Asset{}, err
	}
	if s.remoteFetcher == nil {
		return Asset{}, serviceUnavailable()
	}
	fetched, err := s.remoteFetcher.Fetch(ctx, req.URL, MaxUploadBytes)
	if err != nil {
		return Asset{}, validationError("The remote image could not be imported.")
	}
	contentType := strings.ToLower(strings.TrimSpace(fetched.ContentType))
	if err := validateImageContentType(contentType); err != nil {
		return Asset{}, err
	}
	if len(fetched.Body) == 0 {
		return Asset{}, validationError("The remote image must not be empty.")
	}
	if len(fetched.Body) > MaxUploadBytes {
		return Asset{}, apperrors.New(apperrors.CodePayloadTooLarge, fmt.Sprintf("Upload exceeds the %d byte limit.", MaxUploadBytes))
	}
	if err := validateImageMagic(fetched.Body, contentType); err != nil {
		return Asset{}, err
	}
	if err := validateDecodedImageLimits(fetched.Body, contentType); err != nil {
		return Asset{}, err
	}
	fileName := strings.TrimSpace(fetched.FileName)
	if err := validateFileName(fileName); err != nil {
		return Asset{}, err
	}
	digest := sha256.Sum256(fetched.Body)
	checksum := fmt.Sprintf("%x", digest[:])
	sizeBytes := int64(len(fetched.Body))
	intent, err := s.CreateUpload(ctx, CreateRequest{
		OwnerKind:   ownerKind,
		OwnerID:     ownerID,
		ContentType: contentType,
		FileName:    fileName,
		Checksum:    &checksum,
		SizeBytes:   &sizeBytes,
	})
	if err != nil {
		return Asset{}, err
	}
	if err := s.UploadBytes(ctx, intent.Asset.ID, fetched.Body, contentType); err != nil {
		return Asset{}, err
	}
	return s.CompleteUpload(ctx, intent.Asset.ID, CompleteRequest{
		SizeBytes: sizeBytes,
		Checksum:  checksum,
	})
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
		return uploadTooLargeError()
	}
	normalizedContentType := normalizeContentType(contentType)
	// Magic-byte sniff runs before any persistence: the declared MIME must
	// match the actual bytes, so a renamed .exe/.svg/.html can never pass as
	// an image. Active image formats (SVG) and non-image content are rejected.
	if err := validateImageContentType(normalizedContentType); err != nil {
		return err
	}
	if err := validateImageMagic(body, normalizedContentType); err != nil {
		return err
	}
	if err := validateDecodedImageLimits(body, normalizedContentType); err != nil {
		return err
	}
	// SELECT ... FOR UPDATE on media_assets serializes upload vs janitor and
	// captures the object key; the tx only guards the row, not the bytes.
	var objectKey, intentContentType string
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
		intentContentType = normalizeContentType(a.ContentType)
		if intentContentType != normalizedContentType {
			return validationError(imageIntentMismatchMessage)
		}
		objectKey = a.ObjectKey
		return nil
	})
	if err != nil {
		return err
	}
	if err := s.store.Put(ctx, objectKey, body, intentContentType); err != nil {
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

// allowedImageTypes is the raster allowlist for question images. SVG is
// deliberately excluded: it is active XML content, not a passive raster, and
// has no audited sanitization path in this release.
var allowedImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

func validateImageContentType(contentType string) error {
	if !allowedImageTypes[normalizeContentType(contentType)] {
		return validationError(unsupportedImageTypeMessage)
	}
	return nil
}

// validateImageMagic matches the declared image MIME against the actual file
// signature so extension/MIME spoofing cannot smuggle executables, HTML, or
// SVG through the upload path.
func validateImageMagic(body []byte, contentType string) error {
	switch normalizeContentType(contentType) {
	case "image/png":
		if len(body) >= 8 && body[0] == 0x89 && body[1] == 'P' && body[2] == 'N' && body[3] == 'G' && body[4] == 0x0D && body[5] == 0x0A && body[6] == 0x1A && body[7] == 0x0A {
			return nil
		}
	case "image/jpeg":
		if len(body) >= 3 && body[0] == 0xFF && body[1] == 0xD8 && body[2] == 0xFF {
			return nil
		}
	case "image/gif":
		if len(body) >= 6 && body[0] == 'G' && body[1] == 'I' && body[2] == 'F' && body[3] == '8' && (body[4] == '7' || body[4] == '9') && body[5] == 'a' {
			return nil
		}
	case "image/webp":
		if len(body) >= 12 && body[0] == 'R' && body[1] == 'I' && body[2] == 'F' && body[3] == 'F' && body[8] == 'W' && body[9] == 'E' && body[10] == 'B' && body[11] == 'P' {
			return nil
		}
	}
	return validationError(imageMagicMismatchMessage)
}

// validateDecodedImageLimits rejects decompression bombs whose headers
// claim more than maxDecodedPixels or an 8192px side. Header-only decode:
// no pixel buffer is allocated. Unknown/truncated headers fail closed.
func validateDecodedImageLimits(body []byte, contentType string) error {
	config, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		return validationError("The image headers could not be read.")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImageDimension || config.Height > maxImageDimension {
		return apperrors.New(apperrors.CodePayloadTooLarge, "The image dimensions exceed the supported limit.")
	}
	if uint64(config.Width)*uint64(config.Height) > maxDecodedPixels {
		return apperrors.New(apperrors.CodePayloadTooLarge, "The image pixel count exceeds the supported limit.")
	}
	return nil
}

func normalizeContentType(contentType string) string {
	trimmed := strings.TrimSpace(contentType)
	if mediaType, _, err := mime.ParseMediaType(trimmed); err == nil {
		return strings.ToLower(mediaType)
	}
	return strings.ToLower(trimmed)
}

func uploadTooLargeError() *apperrors.Error {
	return apperrors.New(apperrors.CodePayloadTooLarge, fmt.Sprintf("Upload exceeds the %d byte limit.", MaxUploadBytes))
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
