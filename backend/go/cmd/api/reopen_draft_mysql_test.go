package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
)

// A clone-database exam that was published keeps a long version history with
// large snapshots (the production IELTS placement test carries ~380KB per
// version across dozens of versions). Resolving the newest surviving version
// with the payloads inside the ordered statement overflowed the server sort
// buffer ("Error 1038: Out of sort memory"), so POST /exams/{id}/draft/reopen
// and GET /exams/{id}/versions both answered 500 to the builder. This drives
// the real handlers on that history.
func TestReopenDraftAndListVersionsSurvivePayloadHeavyHistoryMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)

	// ~380KB JSON per snapshot, mirroring the placement-test shape.
	blob := strings.Repeat("x", 380<<10)
	content := fmt.Sprintf(`{"title":"heavy placement test","sections":[{"key":"reading","body":%q}]}`, blob)
	config := `{"general":{"title":"heavy placement test"}}`

	var versionNumber, seededVersions int
	if err := h.db.QueryRow("SELECT COALESCE(MAX(version_number), 0), COUNT(*) FROM exam_versions WHERE exam_id = ?", h.examID).Scan(&versionNumber, &seededVersions); err != nil {
		t.Fatal(err)
	}
	newestVersionID := ""
	for i := 0; i < 40; i++ {
		versionNumber++
		id := uuid.NewString()
		if _, err := h.db.Exec(
			"INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, TRUE, 1)",
			id, h.examID, versionNumber, content, config, h.actor,
		); err != nil {
			t.Fatal(err)
		}
		newestVersionID = id
	}
	// MySQL canonicalizes JSON on storage (spaces after ':' and ','), so compare
	// against the read-back the service seeds from rather than the literal Go
	// string. The HTTP encoder compacts payloads again on the way out, so the
	// comparisons below are semantic.
	var publishedSnapshot string
	if err := h.db.QueryRow("SELECT CAST(content_snapshot AS CHAR) FROM exam_versions WHERE id = ?", newestVersionID).Scan(&publishedSnapshot); err != nil {
		t.Fatal(err)
	}
	// Seal the draft: a published exam without an editable draft pointer is
	// exactly the state the builder heals on save.
	if _, err := h.db.Exec("UPDATE exam_entities SET status = 'published', current_published_version_id = ?, current_draft_version_id = NULL WHERE id = ?", newestVersionID, h.examID); err != nil {
		t.Fatal(err)
	}

	app := &App{DB: h.db, Exams: h.exams}
	router := chi.NewRouter()
	router.Post("/exams/{id}/draft/reopen", examsDraftReopenHandler(app))
	router.Get("/exams/{id}/versions", examsVersionsHandler(app))
	session := &auth.Session{UserID: h.actor, Role: auth.RoleAdmin}
	do := func(method, path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, session))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	rec := do(http.MethodPost, "/exams/"+h.examID+"/draft/reopen")
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST draft/reopen = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	var healed exams.Version
	if err := json.Unmarshal(rec.Body.Bytes(), &healed); err != nil {
		t.Fatal(err)
	}
	if !healed.IsDraft || healed.IsPublished {
		t.Fatalf("healed version is not a draft: %+v", healed)
	}
	if healed.ParentVersion == nil || *healed.ParentVersion != newestVersionID {
		t.Fatalf("healed draft parent = %v, want newest surviving version %s", healed.ParentVersion, newestVersionID)
	}
	if len(healed.Content) < 300<<10 {
		t.Fatalf("healed draft seeded %d bytes, want the heavy surviving snapshot", len(healed.Content))
	}
	if !sameJSON(t, string(healed.Content), publishedSnapshot) {
		t.Fatalf("healed draft seeded %d bytes, want the newest surviving snapshot (%d bytes)", len(healed.Content), len(publishedSnapshot))
	}

	rec = do(http.MethodGet, "/exams/"+h.examID+"/versions")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET versions = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var versions []exams.Version
	if err := json.Unmarshal(rec.Body.Bytes(), &versions); err != nil {
		t.Fatal(err)
	}
	if want := seededVersions + 41; len(versions) != want {
		t.Fatalf("listed %d versions, want %d", len(versions), want)
	}
	if versions[0].ID != healed.ID {
		t.Fatalf("newest version = %s, want the healed draft %s", versions[0].ID, healed.ID)
	}
	for i := 1; i < len(versions); i++ {
		if versions[i-1].VersionNumber <= versions[i].VersionNumber {
			t.Fatalf("versions not newest-first at %d: %d then %d", i, versions[i-1].VersionNumber, versions[i].VersionNumber)
		}
	}
	if !sameJSON(t, string(versions[0].Content), publishedSnapshot) {
		t.Fatalf("listed payloads lost their snapshot text")
	}
}

// sameJSON compares two JSON documents by value: MySQL's canonical spacing and
// the Go encoder's compaction differ byte-for-byte on identical payloads.
func sameJSON(t *testing.T, a, b string) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal([]byte(a), &av); err != nil {
		t.Fatalf("payload is not JSON: %v", err)
	}
	if err := json.Unmarshal([]byte(b), &bv); err != nil {
		t.Fatalf("snapshot is not JSON: %v", err)
	}
	return reflect.DeepEqual(av, bv)
}
