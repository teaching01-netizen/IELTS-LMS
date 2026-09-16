package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestMediaWriteRoutesAreMountedBehindSessionAuth(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v1/media/uploads"},
		{method: http.MethodPost, path: "/api/v1/media/import-url"},
		{method: http.MethodPut, path: "/api/v1/media/uploads/asset-1"},
		{method: http.MethodPost, path: "/api/v1/media/uploads/asset-1/complete"},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("media write route must be mounted and session-gated, got %d (%s)", rec.Code, rec.Body.String())
			}
		})
	}
}
