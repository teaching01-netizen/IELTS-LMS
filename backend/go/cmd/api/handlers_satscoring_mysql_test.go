package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satscoring"
)

// HTTP contract of the global score-conversion endpoints against the real
// store: the optimistic lock headers, the 422 issue details, STALE_BASE, and
// the blueprint seeded into the settings response.
func TestSATScoreConversionHandlersMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	app := &App{DB: db, SatScoring: satscoring.NewService(db, tx.NewRunner(db))}
	resetPointer := func() {
		_, _ = db.ExecContext(context.Background(), "UPDATE sat_score_conversion_active SET revision_id = NULL, activated_at = NULL, activated_by = NULL WHERE id = 1")
		satscoring.ResetCacheForTest()
	}
	resetPointer()
	t.Cleanup(resetPointer)

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin})))
		})
	})
	r.Get("/settings", satScoringSettingsHandler(app))
	r.Get("/revisions", satScoringRevisionsHandler(app))
	r.Get("/revisions/{id}", satScoringRevisionHandler(app))
	r.Post("/drafts", satScoringCreateDraftHandler(app))
	r.Put("/drafts/{id}", satScoringSaveDraftHandler(app))
	r.Post("/drafts/{id}/validate", satScoringValidateHandler(app))
	r.Post("/lookup-preview", satScoringLookupHandler(app))
	r.Post("/drafts/{id}/impact", satScoringImpactHandler(app))
	r.Post("/drafts/{id}/publish", satScoringPublishHandler(app))

	call := func(method, path string, body any, headers map[string]string) (int, map[string]any) {
		t.Helper()
		var rd *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		} else {
			rd = bytes.NewReader(nil)
		}
		req := httptest.NewRequest(method, path, rd)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	// Settings: blueprint operational counts come from the authoring blueprint
	// (27 - 2 pretest, 22 - 2 pretest), not from the doc's 28x28 / 23x23.
	status, settings := call("GET", "/settings", nil, nil)
	if status != 200 || settings["active"] != nil {
		t.Fatalf("settings = %d %+v", status, settings)
	}
	bp := settings["blueprint"].(map[string]any)
	if bp["reading-writing"].(map[string]any)["m1Operational"] != float64(25) || bp["math"].(map[string]any)["m2Operational"] != float64(20) {
		t.Fatalf("blueprint = %+v", bp)
	}

	status, draft := call("POST", "/drafts", nil, nil)
	if status != 201 || draft["status"] != "draft" || draft["version"] != float64(1) {
		t.Fatalf("create draft = %d %+v", status, draft)
	}
	id := draft["id"].(string)

	cells := [][]*int{{new(200), new(210)}, {new(210), nil}} // incomplete on purpose
	content := satconvert.EmptyContent()
	content.Sections[satconvert.SectionMath].Tables["t"] = &satconvert.PolicyTable{Kind: satconvert.KindMatrix, M1Operational: 1, M2Operational: 1, Cells: cells}
	content.Sections[satconvert.SectionMath].Assign["full_lower"] = []string{"t"}
	save := map[string]any{"content": content, "calibrationSource": "test", "note": ""}

	if status, body := call("PUT", "/drafts/"+id, save, nil); status != 428 || body["code"] != "PRECONDITION_REQUIRED" {
		t.Fatalf("PUT without If-Match = %d %+v", status, body)
	}
	if status, body := call("PUT", "/drafts/"+id, save, map[string]string{"If-Match": "abc"}); status != 400 {
		t.Fatalf("PUT with a bad If-Match = %d %+v", status, body)
	}
	if status, body := call("PUT", "/drafts/"+id, save, map[string]string{"If-Match": `"7"`}); status != 412 || body["code"] != "PRECONDITION_FAILED" {
		t.Fatalf("PUT with a stale version = %d %+v", status, body)
	}
	status, saved := call("PUT", "/drafts/"+id, save, map[string]string{"If-Match": `"1"`})
	if status != 200 || saved["version"] != float64(2) {
		t.Fatalf("PUT = %d %+v", status, saved)
	}

	// The incomplete cell is reported at its address and blocks publish.
	status, validation := call("POST", "/drafts/"+id+"/validate", nil, nil)
	issues, _ := validation["errors"].([]any)
	if status != 200 || validation["valid"] != false || len(issues) != 1 || issues[0].(map[string]any)["path"] != "sections.math.tables.t.cells[1][1]" {
		t.Fatalf("validate = %d %+v", status, validation)
	}
	status, body := call("POST", "/drafts/"+id+"/publish", nil, nil)
	details, _ := body["details"].(map[string]any)
	if status != 422 || body["code"] != "VALIDATION_ERROR" || len(details["errors"].([]any)) != 1 {
		t.Fatalf("publish incomplete = %d %+v", status, body)
	}

	// Complete it and publish.
	cells[1][1] = new(220)
	save["content"] = content
	call("PUT", "/drafts/"+id, save, map[string]string{"If-Match": "2"})
	status, published := call("POST", "/drafts/"+id+"/publish", nil, nil)
	rev, _ := published["revision"].(map[string]any)
	if status != 200 || published["alreadyActive"] != false || rev["revisionNumber"] == nil || rev["active"] != true {
		t.Fatalf("publish = %d %+v", status, published)
	}
	if status, again := call("POST", "/drafts/"+id+"/publish", nil, nil); status != 200 || again["alreadyActive"] != true {
		t.Fatalf("publish retry = %d %+v", status, again)
	}
	if status, body := call("PUT", "/drafts/"+id, save, map[string]string{"If-Match": "3"}); status != 409 || body["code"] != "NOT_A_DRAFT" {
		t.Fatalf("PUT on a published revision = %d %+v", status, body)
	}

	// A draft based on nothing is stale once v1 is active.
	// (Created before v1 by a second admin in this scenario.)
	staleID := uuid.NewString()
	if _, err := db.ExecContext(context.Background(), `INSERT INTO sat_score_conversion_revisions (id, status, base_revision_id, content, created_by) VALUES (?, 'draft', NULL, ?, 'admin-2')`, staleID, mustCanonical(t, content)); err != nil {
		t.Fatal(err)
	}
	if status, body := call("POST", "/drafts/"+staleID+"/publish", nil, nil); status != 409 || body["code"] != "STALE_BASE" {
		t.Fatalf("stale publish = %d %+v", status, body)
	}

	status, lookup := call("POST", "/lookup-preview", map[string]any{"revisionId": id, "section": "math", "topology": "full_lower", "m1": 1, "m2": 1}, nil)
	scaled, _ := lookup["scaled"].(map[string]any)
	if status != 200 || lookup["status"] != "converted" || scaled["low"] != float64(220) {
		t.Fatalf("lookup = %d %+v", status, lookup)
	}
	if status, _ := call("POST", "/lookup-preview", map[string]any{"section": "math", "topology": "full_lower", "m1": 1}, nil); status != 400 {
		t.Fatalf("lookup without an id = %d", status)
	}
	status, impact := call("POST", "/drafts/"+id+"/impact", nil, nil)
	if status != 200 || impact["resultsConsidered"] == nil || impact["topChanges"] == nil {
		t.Fatalf("impact = %d %+v", status, impact)
	}
	if status, list := call("GET", "/revisions", nil, nil); status != 200 || len(list["revisions"].([]any)) == 0 {
		t.Fatalf("revisions = %d %+v", status, list)
	}
	if status, body := call("GET", "/revisions/does-not-exist", nil, nil); status != 404 {
		t.Fatalf("missing revision = %d %+v", status, body)
	}
}

func mustCanonical(t *testing.T, c *satconvert.Content) string {
	t.Helper()
	b, err := c.Canonical()
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
