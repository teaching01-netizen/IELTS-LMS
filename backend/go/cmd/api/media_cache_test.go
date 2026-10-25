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

// Staff read the original and may share it through caches; a student reads
// the delivery rendition (its type is how this test tells the copies apart:
// WebP renders to PNG), which no shared cache may hand to staff.
func TestMediaDownloadEmitsImmutableCacheControl(t *testing.T) {
	for _, test := range []struct {
		role         string
		contentType  string
		cacheControl string
	}{
		{role: auth.RoleBuilder, contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable"},
		{role: auth.RoleStudent, contentType: "image/png", cacheControl: "private, max-age=31536000, immutable"},
	} {
		t.Run(test.role, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			// Every key answers, so the rendition counts as rendered.
			svc := media.NewService(db, tx.NewRunner(db), stubStore{body: []byte("figure-bytes")})
			// The SAT-protection probe runs first: an IELTS exam asset is public.
			mock.ExpectQuery("FROM media_assets m").
				WithArgs("asset-1").
				WillReturnRows(sqlmock.NewRows([]string{"protected"}).AddRow(false))
			mock.ExpectQuery("FROM media_assets WHERE id").
				WillReturnRows(sqlmock.NewRows([]string{"id", "owner_kind", "owner_id", "content_type", "file_name", "upload_status", "object_key", "size_bytes", "checksum_sha256", "upload_url", "download_url"}).
					AddRow("asset-1", "assessment_exam", "exam-1", "image/webp", "map.webp", "finalized", "media/asset-1/map.webp", 12, "abc", "http://u", "http://d"))
			app := &App{Media: svc, DB: db}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/media/asset-1/content", nil)
			req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: "u1", Role: test.role}))
			rec := httptest.NewRecorder()
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("assetID", "asset-1")
			mediaDownloadHandler(app)(rec, req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx)))
			res := rec.Result()
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				t.Fatalf("download must 200, got %d", res.StatusCode)
			}
			if got := res.Header.Get("Content-Type"); got != test.contentType {
				t.Fatalf("Content-Type = %q, want %q", got, test.contentType)
			}
			if got := res.Header.Get("Cache-Control"); got != test.cacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, test.cacheControl)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
