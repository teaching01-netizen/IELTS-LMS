package main

import (
	"net/http"
	"strings"
)

// writeETagOrNotModified implements the plan-D1 conditional read: it always
// sets the ETag response header; when If-None-Match matches the ETag (exact
// weak match or *) it renders 304 with an empty body and reports true (the
// caller must not assemble the payload). Otherwise it reports false and the
// caller proceeds to the 200 path (ETag already set).
func writeETagOrNotModified(w http.ResponseWriter, r *http.Request, etag string) bool {
	w.Header().Set("ETag", etag)
	inm := strings.TrimSpace(r.Header.Get("If-None-Match"))
	if inm == "" {
		return false
	}
	if inm == "*" {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	for _, candidate := range strings.Split(inm, ",") {
		if strings.TrimSpace(candidate) == etag {
			w.WriteHeader(http.StatusNotModified)
			return true
		}
	}
	return false
}
