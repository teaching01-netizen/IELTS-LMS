package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpdflayout"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestSATExamPDFLayoutMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	examA, examB := uuid.NewString(), uuid.NewString()
	for _, examID := range []string{examA, examB} {
		if _, err := db.ExecContext(t.Context(), `INSERT INTO exam_entities
			(id,slug,title,provider_key,provider_exam_type,exam_type,status,visibility,organization_id,owner_id)
			VALUES (?,?,?,'sat','SAT','Academic','published','organization',?,'pdf-fixture')`,
			examID, examID, "Layout test", examID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = db.Exec("DELETE FROM sat_exam_pdf_assets WHERE exam_id=?", examID)
			_, _ = db.Exec("DELETE FROM exam_entities WHERE id=?", examID)
		})
	}
	store := objectstore.NewLocalStore(t.TempDir())
	app := &App{
		Exams:      exams.NewService(db, tx.NewRunner(db)),
		PDFLayouts: satpdflayout.New(db, store),
	}
	router := chi.NewRouter()
	router.Get("/{examID}/layout", satPDFLayoutHandler(app))
	router.Put("/{examID}/layout", satPDFLayoutHandler(app))
	router.Post("/{examID}/asset", satPDFAssetUploadHandler(app))
	router.Get("/{examID}/asset/{assetID}", satPDFAssetReadHandler(app))
	writer := &auth.Session{UserID: "pdf-editor-admin", Role: auth.RoleAdmin}
	observer := &auth.Session{UserID: "pdf-editor-observer", Role: auth.RoleAdminObserver}
	foreignBuilder := &auth.Session{UserID: "pdf-editor-builder", Role: auth.RoleBuilder, OrganizationID: &examB}
	student := &auth.Session{UserID: "pdf-editor-student", Role: auth.RoleStudent}
	call := func(method, path string, actor *auth.Session, body []byte, contentType string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, actor))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	check := func(rec *httptest.ResponseRecorder, status int) {
		t.Helper()
		if rec.Code != status {
			t.Fatalf("got %d want %d: %s", rec.Code, status, rec.Body)
		}
	}
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewNRGBA(image.Rect(0, 0, 17, 13))); err != nil {
		t.Fatal(err)
	}
	upload := "/" + examA + "/asset?purpose=slide&filename=Key-divider.png"
	check(call("POST", upload, writer, []byte("invalid image"), "image/png"), 422)
	check(call("POST", upload, foreignBuilder, pngBytes.Bytes(), "image/png"), 404)
	rec := call("POST", upload, writer, pngBytes.Bytes(), "image/png")
	check(rec, 201)
	var asset satpdflayout.Asset
	if err := json.Unmarshal(rec.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}
	imageA, imageB := "/"+examA+"/asset/"+asset.ID, "/"+examB+"/asset/"+asset.ID
	check(call("GET", imageA, student, nil, ""), 403)
	check(call("GET", imageA, observer, nil, ""), 404)
	check(call("GET", imageB, writer, nil, ""), 404)
	if image := call("GET", imageA, writer, nil, ""); image.Code != 200 || !bytes.Equal(image.Body.Bytes(), pngBytes.Bytes()) ||
		image.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("staged artwork was not returned privately: %d", image.Code)
	}
	key := satpdflayout.Target{Kind: "answerKey"}
	layout := satpdflayout.Layout{Slides: []satpdflayout.Slide{{
		ID: uuid.NewString(), AssetID: asset.ID, Target: key, Side: "before", Description: "Key divider",
	}}}
	request := func(revision int, layout satpdflayout.Layout) []byte {
		t.Helper()
		raw, err := json.Marshal(map[string]any{"expectedRevision": revision, "layout": layout})
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	pathA, pathB := "/"+examA+"/layout", "/"+examB+"/layout"
	check(call("PUT", pathB, writer, request(0, layout), "application/json"), 422)
	check(call("PUT", pathA, observer, request(0, layout), "application/json"), 403)
	check(call("PUT", pathA, writer, request(0, layout), "application/json"), 200)
	check(call("PUT", pathA, writer, request(0, layout), "application/json"), 200)
	check(call("GET", imageA, observer, nil, ""), 200)
	check(call("PUT", pathA, writer, request(0, satpdflayout.Layout{}), "application/json"), 409)
	if other, err := app.PDFLayouts.Read(t.Context(), examB); err != nil || other.Revision != 0 || len(other.Layout.Slides) != 0 {
		t.Fatalf("other exam %#v, %v", other, err)
	}
	var objectKey string
	if err := db.QueryRow("SELECT object_key FROM sat_exam_pdf_assets WHERE id=?", asset.ID).Scan(&objectKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(t.Context(), objectKey); err != nil {
		t.Fatal(err)
	}
	if hidden, err := app.PDFLayouts.ResolveSaved(t.Context(), examA, map[satpdflayout.Target]bool{}, nil); err != nil || hidden != nil {
		t.Fatalf("unauthorized target %#v, %v", hidden, err)
	}
	if _, err := app.PDFLayouts.ResolveSaved(t.Context(), examA, map[satpdflayout.Target]bool{key: true}, nil); err == nil {
		t.Fatal("visible missing slide must fail preparation")
	}
	if err := store.Put(t.Context(), objectKey, pngBytes.Bytes(), "image/png"); err != nil {
		t.Fatal(err)
	}
	visible, err := app.PDFLayouts.ResolveSaved(t.Context(), examA, map[satpdflayout.Target]bool{key: true}, nil)
	if err != nil || visible == nil || visible.Revision != 1 || len(visible.Images) != 1 {
		t.Fatalf("authorized target %#v, %v", visible, err)
	}
	left := request(1, satpdflayout.Layout{})
	rightLayout := satpdflayout.Layout{Slides: append([]satpdflayout.Slide{}, layout.Slides...)}
	rightLayout.Slides[0].Side = "after"
	right := request(1, rightLayout)
	results := make(chan int, 2)
	for _, body := range [][]byte{left, right} {
		go func() { results <- call(http.MethodPut, pathA, writer, body, "application/json").Code }()
	}
	first, second := <-results, <-results
	if !((first == 200 && second == 409) || (second == 200 && first == 409)) {
		t.Fatalf("concurrent saves returned %d and %d", first, second)
	}
}
