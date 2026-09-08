package main

// Plan C3: ?sinceRevision=N is the poll-cadence contract the 100k-poller
// simulation depends on. Missing = full view (nil); valid non-negative
// int64 passes through; negative / non-numeric / overflow render exactly
// one 400 and report false. Pure helper, no DB. RED: all shapes.
import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseSinceRevisionShapes(t *testing.T) {
	parse := func(q string) (*int64, bool, int) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime"+q, nil)
		rec := httptest.NewRecorder()
		rev, ok := parseSinceRevision(rec, req)
		return rev, ok, rec.Code
	}
	if rev, ok, _ := parse(""); !ok || rev != nil {
		t.Fatalf("missing must be full view (nil,true), got rev=%v ok=%v", rev, ok)
	}
	if rev, ok, _ := parse("?sinceRevision=12"); !ok || rev == nil || *rev != 12 {
		t.Fatalf("numeric must parse, got rev=%v ok=%v", rev, ok)
	}
	if rev, ok, _ := parse("?sinceRevision=0"); !ok || rev == nil || *rev != 0 {
		t.Fatalf("zero must parse (first poll), got rev=%v ok=%v", rev, ok)
	}
	if _, ok, code := parse("?sinceRevision=-1"); ok || code != http.StatusBadRequest {
		t.Fatalf("negative must 400+false, got ok=%v code=%d", ok, code)
	}
	if _, ok, code := parse("?sinceRevision=abc"); ok || code != http.StatusBadRequest {
		t.Fatalf("non-numeric must 400+false, got ok=%v code=%d", ok, code)
	}
	if _, ok, code := parse("?sinceRevision=9999999999999999999999"); ok || code != http.StatusBadRequest {
		t.Fatalf("int64 overflow must 400+false, got ok=%v code=%d", ok, code)
	}
	if rev, ok, _ := parse("?sinceRevision=+7"); !ok || rev == nil || *rev != 7 {
		t.Fatalf("leading-plus must parse (ParseInt), got rev=%v ok=%v", rev, ok)
	}
}
