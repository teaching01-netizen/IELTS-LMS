package main

// Step 7: finalized media bytes are immutable (pending -> finalized once,
// never back), so the download handler must emit a long-lived immutable
// Cache-Control. RED: Cache-Control present on 200 bytes.
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type stubStore struct{ body []byte }

func (s stubStore) Put(_ context.Context, _ string, _ []byte, _ string) error {
	return nil
}
func (s stubStore) Get(_ context.Context, _ string) ([]byte, error) { return s.body, nil }
func (s stubStore) Stat(_ context.Context, _ string) error          { return nil }
func (s stubStore) Delete(_ context.Context, _ string) error        { return nil }

func TestMediaDownloadEmitsImmutableCacheControl(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := media.NewService(db, tx.NewRunner(db), stubStore{body: []byte("audio-bytes")})
	mock.ExpectQuery("FROM media_assets WHERE id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_kind", "owner_id", "content_type", "file_name", "upload_status", "object_key", "size_bytes", "checksum_sha256", "upload_url", "download_url"}).
			AddRow("asset-1", "assessment_exam", "exam-1", "audio/mpeg", "part1.mp3", "finalized", "media/asset-1/part1.mp3", 11, "abc", "http://u", "http://d"))
	app := &App{Media: svc}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/assets/asset-1", nil)
	req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: "u1", Role: auth.RoleStudent}))
	rec := httptest.NewRecorder()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("assetID", "asset-1")
	mediaDownloadHandler(app)(rec, req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx)))
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("download must 200, got %d", res.StatusCode)
	}
	if got := res.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control must be immutable, got %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
