package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/auth"
)

func TestLinkDeleteRequiresRevisionEvenWhenZeroIsValid(t *testing.T) {
	app := &App{AccessLinks: &accesslinks.Service{}}
	request := httptest.NewRequest(http.MethodDelete, "/v1/assessment-access/links/link-1", strings.NewReader(`{}`))
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("linkID", "link-1")
	ctx := sessionCtx(request.Context(), &auth.Session{UserID: "builder-1", Role: auth.RoleBuilder})
	request = request.WithContext(context.WithValue(ctx, chi.RouteCtxKey, routeContext))
	recorder := httptest.NewRecorder()

	linkDelete(app)(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing revision must return 400 before reaching the delete service; got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "revision is required") {
		t.Fatalf("missing revision response should explain the requirement, got %s", recorder.Body.String())
	}
}
