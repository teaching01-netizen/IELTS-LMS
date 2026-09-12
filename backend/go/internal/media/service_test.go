package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"hash/crc32"
	"image"
	"image/png"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// fakeStore is the in-test objectstore.Store: Put records, Get replays.
type fakeStore struct {
	putKey         string
	putBody        []byte
	putContentType string
	getBody        []byte
	getErr         error
	putErr         error
}

func (f *fakeStore) Put(_ context.Context, key string, body []byte, contentType string) error {
	if f.putErr != nil {
		return f.putErr
	}
	f.putKey = key
	f.putBody = append([]byte(nil), body...)
	f.putContentType = contentType
	return nil
}

func (f *fakeStore) Get(_ context.Context, _ string) ([]byte, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.getBody, nil
}

func (f *fakeStore) Delete(_ context.Context, _ string) error { return nil }

func (f *fakeStore) PresignedGet(_ context.Context, key string) (string, error) {
	return "https://objects.example/" + key, nil
}

func codeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func svcWith(db *sql.DB, store *fakeStore) (*Service, *fakeStore) {
	return NewService(db, tx.NewRunner(db), store), store
}

func begin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

// assetRow returns the 11-column assetColumns projection.
func assetRow(id, status, objectKey, contentType string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "owner_kind", "owner_id", "content_type", "file_name", "upload_status",
		"object_key", "size_bytes", "checksum_sha256", "upload_url", "download_url",
	}).AddRow(id, "assessment_question", "q-1", contentType, "pic.png", status, objectKey, nil, nil, "/uploads/"+objectKey, nil)
}

func assetRowWithMetadata(id, status, objectKey, contentType string, size int64, checksum string) *sqlmock.Rows {
	var sizeValue any
	if size != 0 {
		sizeValue = size
	}
	var checksumValue any
	if checksum != "" {
		checksumValue = checksum
	}
	return sqlmock.NewRows([]string{
		"id", "owner_kind", "owner_id", "content_type", "file_name", "upload_status",
		"object_key", "size_bytes", "checksum_sha256", "upload_url", "download_url",
	}).AddRow(id, "assessment_question", "q-1", contentType, "pic.png", status, objectKey, sizeValue, checksumValue, "/uploads/"+objectKey, nil)
}

// UploadBytes pending happy path: row locks FOR UPDATE, store.Put lands on
// the asset object key, tx commits.
func TestUploadBytesPendingHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ? FOR UPDATE")).
		WillReturnRows(assetRow("asset-1", StatusPending, "media/asset-1/pic.png", "image/png"))
	mock.ExpectCommit()
	// Honest 1x1 PNG: magic sniff + decoded-limits gate run before the tx.
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	body := encoded.Bytes()
	if err := s.UploadBytes(context.Background(), "asset-1", body, "image/png"); err != nil {
		t.Fatalf("UploadBytes pending happy path must succeed: %v", err)
	}
	if store.putKey != "media/asset-1/pic.png" {
		t.Fatalf("store.Put landed on wrong key: %q", store.putKey)
	}
	if string(store.putBody) != string(body) || store.putContentType != "image/png" {
		t.Fatalf("store.Put got wrong body/content-type: %q %q", store.putBody, store.putContentType)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes spoofed bytes (non-image masquerading as PNG) reject before
// any database work: no tx begins and the store is never touched.
func TestUploadBytesRejectsSpoofedMagicBeforeTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	if err := s.UploadBytes(context.Background(), "asset-1", []byte("MZ-executable-bytes"), "image/png"); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR on spoofed magic, got %v", err)
	}
	if store.putKey != "" {
		t.Fatalf("store.Put must not run on spoofed bytes, got key %q", store.putKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes rejects a header-claimed bomb (IHDR beyond the pixel/dimension
// caps) after the magic gate: no tx begins and the store is never touched.
func TestUploadBytesRejectsDecodedBombBeforeTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	// Honest 1x1 PNG with its IHDR width/height patched to 20000x20000 (CRC
	// recomputed): magic passes, headers parse, the decoded-limits gate
	// rejects before any database work.
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	body := encoded.Bytes()
	if len(body) < 33 {
		t.Fatalf("encoded PNG too short: %d bytes", len(body))
	}
	patched := append([]byte(nil), body...)
	for _, off := range []int{16, 20} {
		patched[off], patched[off+1], patched[off+2], patched[off+3] = 0x00, 0x00, 0x4E, 0x20
	}
	crc := crc32.ChecksumIEEE(patched[12:29])
	patched[29], patched[30], patched[31], patched[32] = byte(crc>>24), byte(crc>>16), byte(crc>>8), byte(crc)
	if err := s.UploadBytes(context.Background(), "asset-1", patched, "image/png"); codeOf(err) != apperrors.CodePayloadTooLarge {
		t.Fatalf("expected PAYLOAD_TOO_LARGE on decoded bomb, got %v", err)
	}
	if store.putKey != "" {
		t.Fatalf("store.Put must not run on decoded bomb, got key %q", store.putKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes rejects non-allowlisted types (SVG is active content) before
// any database work.
func TestUploadBytesRejectsSvgActiveContent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)
	if err := s.UploadBytes(context.Background(), "asset-1", svg, "image/svg+xml"); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR on SVG, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// CreateUpload rejects non-allowlisted content types at intent time.
func TestCreateUploadRejectsNonImageContentType(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	if _, err := s.CreateUpload(context.Background(), CreateRequest{OwnerKind: "assessment_question", OwnerID: "q-1", ContentType: "application/octet-stream", FileName: "evil.bin"}); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR on octet-stream, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes on a non-pending asset rejects with VALIDATION_ERROR and
// rolls back without touching the store.
func TestUploadBytesNonPendingValidationError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ? FOR UPDATE")).
		WillReturnRows(assetRow("asset-1", StatusFinalized, "media/asset-1/pic.png", "image/png"))
	mock.ExpectRollback()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	if err := s.UploadBytes(context.Background(), "asset-1", encoded.Bytes(), "image/png"); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR on non-pending upload, got %v", err)
	}
	if store.putKey != "" {
		t.Fatalf("store.Put must not run on non-pending asset, got key %q", store.putKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes with a nil store degrades to 503 SERVICE_UNAVAILABLE.
func TestUploadBytesNilStoreUnavailable(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db), nil)
	if err := s.UploadBytes(context.Background(), "asset-1", []byte("bytes"), "image/png"); codeOf(err) != apperrors.CodeServiceUnavailable {
		t.Fatalf("expected SERVICE_UNAVAILABLE on nil store, got %v", err)
	}
}

// UploadBytes rejects empty bodies before touching the database.
func TestUploadBytesEmptyBodyValidation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	if err := s.UploadBytes(context.Background(), "asset-1", nil, "image/png"); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR on empty body, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// UploadBytes rejects over-limit bodies before touching the database.
func TestUploadBytesOverLimitPayloadTooLarge(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{}
	s, _ := svcWith(db, store)
	big := make([]byte, MaxUploadBytes+1)
	if err := s.UploadBytes(context.Background(), "asset-1", big, "image/png"); codeOf(err) != apperrors.CodePayloadTooLarge {
		t.Fatalf("expected PAYLOAD_TOO_LARGE over 16MB, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteUploadVerifiesStoredObject(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	body := []byte("uploaded-bytes")
	digest := sha256.Sum256(body)
	checksum := fmt.Sprintf("%x", digest[:])
	store := &fakeStore{getBody: body}
	s, _ := svcWith(db, store)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ? FOR UPDATE")).
		WillReturnRows(assetRow("asset-1", StatusPending, "media/asset-1/pic.png", "image/png"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE media_assets SET upload_status = 'finalized'")).
		WithArgs(int64(len(body)), checksum, "/api/v1/media/assets/asset-1", "asset-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ?")).
		WillReturnRows(assetRowWithMetadata("asset-1", StatusFinalized, "media/asset-1/pic.png", "image/png", int64(len(body)), checksum))
	mock.ExpectCommit()
	asset, err := s.CompleteUpload(context.Background(), "asset-1", CompleteRequest{SizeBytes: int64(len(body)), Checksum: checksum})
	if err != nil {
		t.Fatalf("CompleteUpload() error = %v", err)
	}
	if asset.Status != StatusFinalized || asset.Checksum == nil || *asset.Checksum != checksum {
		t.Fatalf("unexpected finalized asset: %+v", asset)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompleteUploadRejectsStoredObjectMismatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{getBody: []byte("different-bytes")}
	s, _ := svcWith(db, store)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ? FOR UPDATE")).
		WillReturnRows(assetRow("asset-1", StatusPending, "media/asset-1/pic.png", "image/png"))
	mock.ExpectRollback()
	checksum := fmt.Sprintf("%x", sha256.Sum256([]byte("expected-bytes")))
	if _, err := s.CompleteUpload(context.Background(), "asset-1", CompleteRequest{SizeBytes: 14, Checksum: checksum}); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR for object mismatch, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ReadBytes finalized happy path: GetAsset replays the row, store.Get
// returns the bytes with the stored content type.
func TestReadBytesFinalizedHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{getBody: []byte("final-bytes")}
	s, _ := svcWith(db, store)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ?")).
		WillReturnRows(assetRow("asset-1", StatusFinalized, "media/asset-1/pic.png", "image/png"))
	contentType, body, err := s.ReadBytes(context.Background(), "asset-1")
	if err != nil {
		t.Fatalf("ReadBytes finalized happy path must succeed: %v", err)
	}
	if contentType != "image/png" || string(body) != "final-bytes" {
		t.Fatalf("unexpected read result: %q %q", contentType, body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ReadBytes on a pending asset returns NOT_FOUND (mirrors the
// finalized-only guard in read_local_object).
func TestReadBytesPendingNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &fakeStore{getBody: []byte("pending-bytes")}
	s, _ := svcWith(db, store)
	mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ?")).
		WillReturnRows(assetRow("asset-1", StatusPending, "media/asset-1/pic.png", "image/png"))
	if _, _, err := s.ReadBytes(context.Background(), "asset-1"); codeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND on pending read, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
