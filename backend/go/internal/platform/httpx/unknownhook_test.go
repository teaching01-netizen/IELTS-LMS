package httpx

// Plan E-honesty, round 74: WriteError must surface unknown (raw) errors
// to operators instead of swallowing them into a silent 500. The hook
// fires exactly once per unknown error, never for typed apperrors.
import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestWriteErrorUnknownFiresHook(t *testing.T) {
	calls := 0
	var got error
	restore := SetUnknownHook(func(r *http.Request, err error) { calls++; got = err })
	defer restore()
	raw := errors.New("Error 1054: Unknown column 'x'")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	WriteError(rec, req, raw)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unknown must still render 500, got %d", rec.Code)
	}
	if calls != 1 || got != raw {
		t.Fatalf("hook must fire once with the raw error, got %d calls", calls)
	}
}

func TestWriteErrorTypedNeverFiresHook(t *testing.T) {
	calls := 0
	restore := SetUnknownHook(func(r *http.Request, err error) { calls++ })
	defer restore()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	WriteError(rec, req, apperrors.New(apperrors.CodeBadRequest, "bad."))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("typed must render 400, got %d", rec.Code)
	}
	if calls != 0 {
		t.Fatalf("typed error must not fire hook, got %d calls", calls)
	}
}
