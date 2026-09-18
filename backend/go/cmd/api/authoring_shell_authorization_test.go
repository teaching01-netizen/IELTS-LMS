package main

// The shell routes are role-gated BEFORE the handler runs: the authz table
// maps GET /shell to read-staff and POST /shell to write-staff
// (internal/authz/table_fullpath.go), and internal/authz pins both entries.
//
// This is the permissions half of the shell lifecycle contract: the lifecycle
// states are only meaningful for a caller allowed to see them, and a denial
// must never be mistaken for one of those states. In particular a student must
// never be answered 404 on this route — that status is reserved for a missing
// exam — and must never reach a draft open.
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
)

func TestShellReadDeniesNonStaffRole(t *testing.T) {
	router := authzTestRouter()
	req := authedReq(http.MethodGet, "/api/v1/assessment-authoring/exams/exam-1/shell", "u1", auth.RoleStudent)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("student GET /shell must be 403, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "FORBIDDEN" {
		t.Fatalf("student GET /shell must render FORBIDDEN, got %q", code)
	}
	// A denial is not a lifecycle answer, and it must not be mistaken for one
	// (the old client read a 404 here as "no editable draft").
	if body := rec.Body.String(); body != "" {
		var envelope map[string]any
		if err := json.Unmarshal([]byte(body), &envelope); err != nil {
			t.Fatalf("denial body must be the error envelope, got %q", body)
		}
		if _, leaked := envelope["state"]; leaked {
			t.Fatalf("a denial must not carry a shell lifecycle state: %q", body)
		}
	}
}

func TestShellOpenIsRefusedBeforeTheHandler(t *testing.T) {
	router := authzTestRouter()
	req := authedReq(http.MethodPost, "/api/v1/assessment-authoring/exams/exam-1/shell", "u1", auth.RoleStudent)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("student POST /shell must be 403, got %d (%s)", rec.Code, rec.Body.String())
	}
	// Guard order, stated rather than assumed: an unsafe method must clear CSRF
	// before authz is consulted, so an unverifiable request is refused by CSRF
	// (403 CSRF_REJECTED) while the authz table would also refuse this role
	// (POST /shell is write-staff). Either way the draft-open handler never
	// runs, which is the property that matters: a non-writer cannot create a
	// draft through this route.
	code := decodeCode(t, rec)
	if code != "CSRF_REJECTED" && code != "FORBIDDEN" {
		t.Fatalf("student POST /shell must be refused by CSRF or authz, got %q", code)
	}
	var envelope map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("denial body must be the error envelope: %v", err)
	}
	if _, leaked := envelope["shell"]; leaked {
		t.Fatalf("a refused open must not return a shell: %s", rec.Body.String())
	}
}

// Anonymous callers are refused at the session gate, which keeps the route's
// 404 meaning intact: it can only ever mean "no such exam".
func TestShellRoutesDenyAnonymous(t *testing.T) {
	router := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/assessment-authoring/exams/exam-1/shell", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusNotFound {
		t.Fatalf("anonymous /shell must not be a 404: that status means the exam does not exist")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous /shell must be 401, got %d (%s)", rec.Code, rec.Body.String())
	}
}
