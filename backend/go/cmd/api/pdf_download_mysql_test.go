package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
	"github.com/go-chi/chi/v5"
)

func TestPreparedPDFRoutesMySQL(t *testing.T) {
	dist := os.Getenv("ANSWEREDPDF_DIST")
	if dist == "" {
		t.Skip("ANSWEREDPDF_DIST not set; requires built frontend and Chromium")
	}
	f := newSATV2CompletionFixture(t)
	if err := f.submit(t.Context()); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.ExecContext(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("UPDATE exam_schedules SET sat_session_mode='classroom' WHERE id=?", f.scheduleID)
	exec("UPDATE exam_entities SET sat_score_report_enabled=TRUE WHERE id=(SELECT exam_id FROM student_attempts WHERE id=?)", f.attemptID)
	// Well-formed printable content independent of the completion fixture's
	// intentionally minimal scoring revisions.
	exec(`UPDATE assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id=qr.id JOIN assessment_modules m ON m.id=eq.module_id JOIN assessment_sections s ON s.id=m.section_id SET qr.prompt='{"version":1,"nodes":[{"type":"paragraph","id":"prompt","text":"Select an answer."}]}', qr.answer_definition='{"kind":"single_choice","correctOptionId":"B","options":[{"id":"A","content":{"version":1,"nodes":[{"type":"paragraph","id":"a","text":"First"}]}},{"id":"B","content":{"version":1,"nodes":[{"type":"paragraph","id":"b","text":"Second"}]}}]}' WHERE s.exam_version_id=(SELECT published_version_id FROM student_attempts WHERE id=?)`, f.attemptID)
	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	cfg.CookieSecure = true
	runner := tx.NewRunner(f.db)
	store := objectstore.NewLocalStore(t.TempDir())
	app := &App{Config: cfg, DB: f.db, Delivery: delivery.NewService(f.db, runner), Results: results.NewService(f.db), Media: media.NewService(f.db, runner, store), PDFExports: answeredpdf.NewExports(f.db, store), AnsweredPDF: answeredpdf.New(frontendHandler(dist), 1)}
	router := chi.NewRouter()
	router.Post("/api/v1/sat-answered-pdf/schedules/{scheduleID}/prepare", prepareAnsweredPDFHandler(app, true))
	router.Post("/api/v1/sat-answered-pdf/attempts/{attemptID}/prepare", prepareAnsweredPDFHandler(app, false))
	router.Get("/api/v1/sat-answered-pdf/downloads/{exportID}", downloadAnsweredPDFHandler(app))
	router.Head("/api/v1/sat-answered-pdf/downloads/{exportID}", downloadAnsweredPDFHandler(app))
	credentialAt := time.Now().UTC()
	staff := &auth.Session{ID: "staff-session", UserID: "staff-user", Role: auth.RoleAdmin,
		Proof: auth.SessionProof{Source: auth.SessionSourceAccount}, ExpiresAt: credentialAt.Add(time.Hour),
		CredentialAuthenticatedAt: &credentialAt, ValidatedAt: credentialAt}
	request := func(method, path, body string, cookie *http.Cookie, staffSession bool, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if method == http.MethodPost {
			req.Header.Set("Authorization", "Bearer "+f.bearer)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if staffSession {
			req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, staff))
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
		return rec
	}
	prepare := func(staffSession bool) (answeredpdf.PreparedExport, *http.Cookie) {
		t.Helper()
		path := "/api/v1/sat-answered-pdf/schedules/" + f.scheduleID + "/prepare"
		if staffSession {
			path = "/api/v1/sat-answered-pdf/attempts/" + f.attemptID + "/prepare"
		}
		rec := request("POST", path, `{"view":null}`, nil, staffSession, 200)
		var prepared answeredpdf.PreparedExport
		if err := json.Unmarshal(rec.Body.Bytes(), &prepared); err != nil {
			t.Fatal(err)
		}
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("missing binding cookie %v", cookies)
		}
		cookie := cookies[0]
		if cookie.Path != prepared.DownloadURL || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || len(cookie.Value) != 64 || cookie.MaxAge > 300 || cookie.MaxAge < 295 {
			t.Fatalf("unsafe cookie %+v", cookie)
		}
		if prepared.SizeBytes <= 0 || !strings.HasSuffix(prepared.Filename, " - Answered exam.pdf") || strings.Contains(prepared.DownloadURL, f.bearer) || time.Until(prepared.ExpiresAt) > 5*time.Minute {
			t.Fatalf("bad metadata %+v", prepared)
		}
		return prepared, cookie
	}
	prepared, cookie := prepare(false)
	request("GET", prepared.DownloadURL, "", nil, false, 404)
	downloaded := request("GET", prepared.DownloadURL, "", cookie, false, 200)
	if !bytes.HasPrefix(downloaded.Body.Bytes(), []byte("%PDF")) || int64(downloaded.Body.Len()) != prepared.SizeBytes || downloaded.Header().Get("Content-Length") != strconv.FormatInt(prepared.SizeBytes, 10) {
		t.Fatal("incomplete download")
	}
	head := request("HEAD", prepared.DownloadURL, "", cookie, false, 200)
	if head.Body.Len() != 0 {
		t.Fatal("HEAD transferred a body")
	}
	again := request("GET", prepared.DownloadURL, "", cookie, false, 200)
	if !bytes.Equal(downloaded.Body.Bytes(), again.Body.Bytes()) {
		t.Fatal("repeated download changed")
	}
	// Re-check the original entitlement and attempt session on each read.
	exec("UPDATE exam_entities SET sat_score_report_enabled=FALSE WHERE id=(SELECT exam_id FROM student_attempts WHERE id=?)", f.attemptID)
	request("GET", prepared.DownloadURL, "", cookie, false, 403)
	exec("UPDATE exam_entities SET sat_score_report_enabled=TRUE WHERE id=(SELECT exam_id FROM student_attempts WHERE id=?)", f.attemptID)
	exec("UPDATE attempt_sessions SET revoked_at=UTC_TIMESTAMP(6) WHERE attempt_id=?", f.attemptID)
	request("GET", prepared.DownloadURL, "", cookie, false, 404)
	exec("UPDATE attempt_sessions SET revoked_at=NULL WHERE attempt_id=?", f.attemptID)
	replacement, replacementCookie := prepare(false)
	request("GET", prepared.DownloadURL, "", cookie, false, 404)
	if _, err := app.PDFExports.Cleanup(t.Context(), 100); err != nil {
		t.Fatal(err)
	}
	request("GET", replacement.DownloadURL, "", replacementCookie, false, 200)
	exec("UPDATE sat_pdf_exports SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE attempt_id=?", f.attemptID)
	request("GET", replacement.DownloadURL, "", replacementCookie, false, 404)
	if _, err := app.PDFExports.Cleanup(t.Context(), 100); err != nil {
		t.Fatal(err)
	}
	staffPrepared, staffCookie := prepare(true)
	request("GET", staffPrepared.DownloadURL, "", staffCookie, false, 401)
	request("GET", staffPrepared.DownloadURL, "", staffCookie, true, 200)
	var objectKey string
	if err := f.db.QueryRow("SELECT object_key FROM sat_pdf_exports WHERE attempt_id=?", f.attemptID).Scan(&objectKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(t.Context(), objectKey); err != nil {
		t.Fatal(err)
	}
	request("GET", staffPrepared.DownloadURL, "", staffCookie, true, 404)
	// Missing media must leave no usable new grant or partial file.
	exec(`UPDATE assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id=qr.id JOIN assessment_modules m ON m.id=eq.module_id JOIN assessment_sections s ON s.id=m.section_id SET qr.prompt='{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"image","attrs":{"assetId":"missing-asset","alt":"Missing"}}]}}' WHERE s.exam_version_id=(SELECT published_version_id FROM student_attempts WHERE id=?)`, f.attemptID)
	// A fresh service sees the changed fixture rather than its immutable version cache.
	app.Delivery = delivery.NewService(f.db, runner)
	failed := request("POST", "/api/v1/sat-answered-pdf/attempts/"+f.attemptID+"/prepare", `{"view":null}`, nil, true, 422)
	if len(failed.Result().Cookies()) != 0 {
		t.Fatal("incomplete paper issued a cookie")
	}
	var ready int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM sat_pdf_exports WHERE attempt_id=? AND expires_at>UTC_TIMESTAMP(6)", f.attemptID).Scan(&ready); err != nil || ready != 0 {
		t.Fatalf("incomplete paper left a current export: %d %v", ready, err)
	}
	if _, err := app.PDFExports.Cleanup(t.Context(), 100); err != nil {
		t.Fatal(err)
	}
}
