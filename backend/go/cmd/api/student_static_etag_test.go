package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStudentStaticETagTracksAssignedModules(t *testing.T) {
	version := `W/"vv-1-7"`
	before := staticETagForOpenedModules(version, map[string]bool{"base": true})
	higher := staticETagForOpenedModules(version, map[string]bool{"base": true, "higher": true})
	lower := staticETagForOpenedModules(version, map[string]bool{"base": true, "lower": true})
	if before == higher || higher == lower {
		t.Fatalf("distinct assignments must have distinct validators: %q %q %q", before, higher, lower)
	}
	if higher != staticETagForOpenedModules(version, map[string]bool{"higher": true, "base": true}) {
		t.Fatal("module map iteration order must not affect the validator")
	}
	request := httptest.NewRequest(http.MethodGet, "/static", nil)
	request.Header.Set("If-None-Match", before)
	recorder := httptest.NewRecorder()
	if writeETagOrNotModified(recorder, request, higher) {
		t.Fatal("a pre-routing validator must not suppress the newly assigned branch")
	}
	if recorder.Header().Get("ETag") != higher {
		t.Fatal("the response must advertise the current assignment validator")
	}
}
