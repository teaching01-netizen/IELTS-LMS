package satpdflayout

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"maps"
	"slices"
	"strings"
	"unicode"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

type Asset struct {
	ID          string `json:"id"`
	Purpose     string `json:"purpose"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Bytes       int    `json:"bytes"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	key         string
	digest      string
}

const assetColumns = "id,purpose,filename,content_type,byte_count,width,height,object_key,sha256"

type scanner interface{ Scan(...any) error }

func scanAsset(row scanner) (Asset, error) {
	var a Asset
	err := row.Scan(&a.ID, &a.Purpose, &a.Filename, &a.ContentType, &a.Bytes, &a.Width, &a.Height, &a.key, &a.digest)
	return a, err
}

func assetsFor(ctx context.Context, q queryer, examID string, layout Layout, lock bool) ([]Asset, error) {
	kinds, err := layout.assetPurposes()
	if err != nil {
		return nil, err
	}
	ids := slices.Sorted(maps.Keys(kinds))
	out := make([]Asset, 0, len(ids))
	total := 0
	for _, id := range ids {
		stmt := "SELECT " + assetColumns + " FROM sat_exam_pdf_assets WHERE id=? AND exam_id=? AND state='ready' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(6))"
		if lock {
			stmt += " FOR UPDATE"
		}
		asset, err := scanAsset(q.QueryRowContext(ctx, stmt, id, examID))
		if errors.Is(err, sql.ErrNoRows) || (err == nil && asset.Purpose != kinds[id]) {
			issue := validation("A selected image is unavailable. Replace or remove it.")
			issue.Details = map[string]any{"assetId": id}
			return nil, issue
		}
		if err != nil {
			return nil, err
		}
		total += asset.Bytes
		if total > MaxLayoutBytes {
			return nil, apperrors.New(apperrors.CodePayloadTooLarge, "This layout exceeds 6 MiB of images.")
		}
		out = append(out, asset)
	}
	return out, nil
}

func Limit(purpose string) int {
	switch purpose {
	case "slide":
		return MaxSlideBytes
	case "logo":
		return MaxLogoBytes
	default:
		return 0
	}
}

func inspectImage(purpose, filename, contentType string, data []byte) (Asset, error) {
	limit := Limit(purpose)
	if limit == 0 {
		return Asset{}, validation("Choose a slide or logo image.")
	}
	if len(data) > limit {
		return Asset{}, apperrors.New(apperrors.CodePayloadTooLarge, "The image exceeds the size limit.")
	}
	filename = strings.TrimSpace(filename)
	if filename == "" || len(filename) > 255 || strings.ContainsAny(filename, "/\\") || strings.ContainsFunc(filename, unicode.IsControl) {
		return Asset{}, validation("Choose a file with a valid name.")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || contentType != "image/"+format {
		return Asset{}, validation("Choose a valid PNG or JPEG image.")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 ||
		config.Width*config.Height > 12_000_000 {
		return Asset{}, apperrors.New(apperrors.CodePayloadTooLarge, "The image dimensions exceed the limit.")
	}
	if format == "png" && animatedPNG(data) {
		return Asset{}, validation("Choose a single-frame PNG or JPEG.")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return Asset{}, validation("This image could not be decoded.")
	}
	digest := sha256.Sum256(data)
	id := uuid.NewString()
	return Asset{ID: id, Purpose: purpose, Filename: filename, ContentType: contentType, Bytes: len(data),
		Width: config.Width, Height: config.Height, key: "sat-pdf-layout/" + id, digest: hex.EncodeToString(digest[:])}, nil
}

func animatedPNG(data []byte) bool {
	for offset := 8; offset+12 <= len(data); {
		length := uint64(binary.BigEndian.Uint32(data[offset : offset+4]))
		if length > uint64(len(data)-offset-12) {
			return false
		}
		kind := string(data[offset+4 : offset+8])
		if kind == "acTL" {
			return true
		}
		if kind == "IEND" {
			return false
		}
		offset += 12 + int(length)
	}
	return false
}

func (s *Service) Upload(ctx context.Context, examID string, organization *string, purpose, filename, contentType string, data []byte) (Asset, error) {
	a, err := inspectImage(purpose, filename, contentType, data)
	if err != nil {
		return Asset{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback()
	if err := lockExam(ctx, tx, examID, organization); err != nil {
		return Asset{}, err
	}
	var count, total int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(byte_count),0) FROM sat_exam_pdf_assets
		WHERE exam_id=? AND state IN ('pending','ready') AND expires_at > UTC_TIMESTAMP(6)`, examID).Scan(&count, &total); err != nil {
		return Asset{}, err
	}
	if count >= 48 || total+a.Bytes > 48<<20 {
		return Asset{}, apperrors.New(apperrors.CodeRateLimited, "This exam has reached its temporary image limit. Save your selected images or try again later.")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO sat_exam_pdf_assets
		(id,exam_id,purpose,object_key,filename,content_type,byte_count,sha256,width,height,state,expires_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,'pending',UTC_TIMESTAMP(6)+INTERVAL 24 HOUR)`,
		a.ID, examID, a.Purpose, a.key, a.Filename, a.ContentType, a.Bytes, a.digest, a.Width, a.Height); err != nil {
		return Asset{}, err
	}
	if err := tx.Commit(); err != nil {
		return Asset{}, err
	}
	if err := s.store.Put(ctx, a.key, data, a.ContentType); err != nil {
		return Asset{}, apperrors.New(apperrors.CodeServiceUnavailable, "The image could not be stored. Try again.")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE sat_exam_pdf_assets SET state='ready'
		WHERE id=? AND exam_id=? AND state='pending' AND expires_at > UTC_TIMESTAMP(6)`, a.ID, examID)
	if err != nil {
		return Asset{}, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return Asset{}, err
	}
	if n != 1 {
		return Asset{}, validation("The image upload expired. Choose the image again.")
	}
	return a, nil
}

func (s *Service) ReadAsset(ctx context.Context, examID, id string, writer bool) (Asset, []byte, error) {
	stmt := "SELECT " + assetColumns + " FROM sat_exam_pdf_assets WHERE id=? AND exam_id=? AND state='ready'"
	if writer {
		stmt += " AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(6))"
	} else {
		stmt += " AND expires_at IS NULL"
	}
	a, err := scanAsset(s.db.QueryRowContext(ctx, stmt, id, examID))
	if errors.Is(err, sql.ErrNoRows) {
		return Asset{}, nil, apperrors.New(apperrors.CodeNotFound, "Image not found.")
	}
	if err != nil {
		return Asset{}, nil, err
	}
	data, err := s.readObject(ctx, a)
	return a, data, err
}

func (s *Service) readObject(ctx context.Context, asset Asset) ([]byte, error) {
	data, err := s.store.Get(ctx, asset.key)
	if err == nil && len(data) == asset.Bytes {
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) == asset.digest {
			return data, nil
		}
	}
	return nil, apperrors.New(apperrors.CodeServiceUnavailable, "A PDF image could not be loaded. Try again.")
}

func (s *Service) Cleanup(ctx context.Context) (int, error) {
	if _, err := s.db.ExecContext(ctx, `UPDATE sat_exam_pdf_assets
		SET expires_at=UTC_TIMESTAMP(6) WHERE exam_id IS NULL AND expires_at IS NULL LIMIT 100`); err != nil {
		return 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,object_key FROM sat_exam_pdf_assets
		WHERE expires_at < UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE ORDER BY expires_at,id LIMIT 100`)
	if err != nil {
		return 0, err
	}
	var expired []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.key); err != nil {
			_ = rows.Close()
			return 0, err
		}
		expired = append(expired, a)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	count := 0
	var cleanupErr error
	for _, asset := range expired {
		// Idempotent claim. The predicate is rechecked under the UPDATE lock.
		result, err := s.db.ExecContext(ctx, `UPDATE sat_exam_pdf_assets SET state='deleting'
			WHERE id=? AND state<>'deleting' AND expires_at < UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE`, asset.ID)
		if err != nil {
			return count, err
		}
		if n, err := result.RowsAffected(); err != nil {
			return count, err
		} else if n == 0 {
			var state string
			if s.db.QueryRowContext(ctx, "SELECT state FROM sat_exam_pdf_assets WHERE id=?", asset.ID).Scan(&state) != nil || state != "deleting" {
				continue
			}
		}
		if err := s.store.Delete(ctx, asset.key); err != nil {
			cleanupErr = err
			continue
		}
		if _, err := s.db.ExecContext(ctx, "DELETE FROM sat_exam_pdf_assets WHERE id=? AND state='deleting'", asset.ID); err != nil {
			return count, err
		}
		count++
	}
	return count, cleanupErr
}
