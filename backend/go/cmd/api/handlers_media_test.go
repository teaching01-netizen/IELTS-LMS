package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/media"
)

// A figure still downloading when the server-wide WriteTimeout passes must be
// delivered, not cut: the content route gets its own write window.
func TestWithWriteWindowOutlastsServerWriteTimeout(t *testing.T) {
	slow := func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(150 * time.Millisecond)
		_, _ = w.Write([]byte("figure"))
	}
	srv := httptest.NewUnstartedServer(withWriteWindow(slow))
	srv.Config.WriteTimeout = 50 * time.Millisecond
	srv.Start()
	defer srv.Close()

	res, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("response was cut at the server WriteTimeout: %v", err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("body was cut at the server WriteTimeout: %v", err)
	}
	if res.StatusCode != http.StatusOK || string(body) != "figure" {
		t.Fatalf("got %d %q, want 200 \"figure\"", res.StatusCode, body)
	}
}

type closeTracker struct {
	*bytes.Reader
	closed bool
}

func (c *closeTracker) Close() error { c.closed = true; return nil }

// Figures stream with a length (and resume via Range) instead of being held
// whole in memory; the student confidentiality headers survive streaming.
func TestServeMediaContentStreamsWithLengthAndRange(t *testing.T) {
	serve := func(rangeHeader string) (*httptest.ResponseRecorder, *closeTracker) {
		body := &closeTracker{Reader: bytes.NewReader([]byte("0123456789"))}
		req := httptest.NewRequest(http.MethodGet, "/api/v1/media/asset-1/content", nil)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		rec := httptest.NewRecorder()
		rec.Header().Set("Cache-Control", "private, no-store")
		rec.Header().Set("X-Content-Type-Options", "nosniff")
		serveMediaContent(rec, req, media.Content{ContentType: "image/png", Body: body})
		return rec, body
	}
	rec, body := serve("")
	if rec.Code != http.StatusOK || rec.Body.String() != "0123456789" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Length"); got != "10" {
		t.Fatalf("Content-Length = %q, want 10", got)
	}
	if rec.Header().Get("Content-Type") != "image/png" ||
		rec.Header().Get("Cache-Control") != "private, no-store" ||
		rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers lost while streaming: %v", rec.Header())
	}
	if !body.closed {
		t.Fatalf("object body must be closed after serving")
	}
	rec, _ = serve("bytes=4-")
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "456789" {
		t.Fatalf("range: got %d %q, want 206 \"456789\"", rec.Code, rec.Body.String())
	}
}
