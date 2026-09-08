package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// D1 RED: matching If-None-Match renders 304 with the ETag header and no
// body; mismatch passes through (caller assembles the payload).
func TestETagNotModified(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", `W/"vv-1-7"`)
	rec := httptest.NewRecorder()
	if !writeETagOrNotModified(rec, req, `W/"vv-1-7"`) {
		t.Fatalf("exact weak etag must 304")
	}
	if rec.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", rec.Code)
	}
	if rec.Header().Get("ETag") != `W/"vv-1-7"` {
		t.Fatalf("ETag header must echo, got %q", rec.Header().Get("ETag"))
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 must have empty body")
	}
}

func TestETagMismatchPassesThrough(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", `W/"vv-1-6"`)
	rec := httptest.NewRecorder()
	if writeETagOrNotModified(rec, req, `W/"vv-1-7"`) {
		t.Fatalf("stale etag must not 304")
	}
	if rec.Header().Get("ETag") != `W/"vv-1-7"` {
		t.Fatalf("ETag header must be set for the 200 path, got %q", rec.Header().Get("ETag"))
	}
}

func TestETagWildcardMatches(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", `*`)
	rec := httptest.NewRecorder()
	if !writeETagOrNotModified(rec, req, `W/"vv-1-7"`) {
		t.Fatalf("* must 304")
	}
}
