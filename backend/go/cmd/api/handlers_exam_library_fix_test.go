package main

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
)

func TestParseRequiredRevisionRejectsMalformed(t *testing.T) {
	cases := []struct {
		name    string
		value   any
		present bool
		wantErr bool
		want    int
	}{
		{"missing", nil, false, true, 0},
		{"null", nil, true, true, 0},
		{"string", "1", true, true, 0},
		{"bool", true, true, true, 0},
		{"fractional", 1.5, true, true, 0},
		{"negative", float64(-1), true, true, 0},
		{"overflow", float64(1 << 40), true, true, 0},
		{"nan", math.NaN(), true, true, 0},
		{"valid zero", float64(0), true, false, 0},
		{"valid int", float64(3), true, false, 3},
	}
	for _, tc := range cases {
		got, err := parseRequiredRevision(tc.value, tc.present)
		if tc.wantErr && err == nil {
			t.Errorf("%s: expected error", tc.name)
		}
		if !tc.wantErr {
			if err != nil {
				t.Errorf("%s: unexpected error %v", tc.name, err)
			} else if got != tc.want {
				t.Errorf("%s: got %d want %d", tc.name, got, tc.want)
			}
		}
		// Missing/null/fractional/negative/overflow must never mutate a revision-0 folder.
	}

	// Query revisions: malformed query/body defaults to error, never 0.
	for _, q := range []string{"1.5", "-1", "abc", "01", "+1", " 1.0 "} {
		if _, has, err := parseQueryRevision(q); !has || err == nil {
			t.Errorf("query %q must be rejected", q)
		}
	}
	if n, has, err := parseQueryRevision("0"); err != nil || !has || n != 0 {
		t.Errorf("query 0 must parse: %v %v %d", has, err, n)
	}
	if n, has, err := parseQueryRevision("12"); err != nil || !has || n != 12 {
		t.Errorf("query 12 must parse: %v %v %d", has, err, n)
	}
	if _, has, _ := parseQueryRevision(""); has {
		t.Error("empty query must be absent, not zero")
	}
}

func TestFolderHandlersRejectInvalidWritesBeforeMutation(t *testing.T) {
	cases := []struct {
		method string
		path   string
		body   string
		move   bool
	}{
		{http.MethodPatch, "/folders/f", `{"name":"Math"}`, false},
		{http.MethodPatch, "/folders/f", `{"name":"Math","revision":null}`, false},
		{http.MethodPatch, "/folders/f", `{"parentId":null,"revision":0.5}`, false},
		{http.MethodPatch, "/folders/f", `{"name":"Math","revision":-1}`, false},
		{http.MethodDelete, "/folders/f?revision=bogus", "", false},
		{http.MethodDelete, "/folders/f", `{"revision":0.5}`, false},
		{http.MethodDelete, "/folders/f", "", false},
		{http.MethodPost, "/move-exams", `{"items":[{"examId":"e","revision":0}]}`, true},
		{http.MethodPost, "/move-exams", `{"items":[{"examId":"e","revision":0}],"folderId":12}`, true},
		{http.MethodPost, "/move-exams", `{"items":[{"examId":"e"}],"folderId":null}`, true},
		{http.MethodPost, "/move-exams", `{"items":[{"examId":"e","revision":0.5}],"folderId":null}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "writer", Role: auth.RoleAdmin}))
			rec := httptest.NewRecorder()
			// No service: invalid input must be rejected before any mutation.
			if tc.move {
				examLibraryMoveHandler(&App{})(rec, req)
			} else {
				examLibraryFolderHandler(&App{})(rec, req)
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}
