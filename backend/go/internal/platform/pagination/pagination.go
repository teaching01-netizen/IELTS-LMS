// Package pagination standardizes query pagination parsing (WS-13).
//
// Two shapes are supported:
//
//   - Feeds (keyset/cursor): ParseCursor reads ?limit (default 100, clamp
//     1..500) plus opaque ?cursorUpdatedAt / ?cursorID passthrough strings.
//     Feed results are wrapped in CursorPage{Rows, HasMore, NextCursor}.
//   - Admin lists (offset): ParsePage reads ?page (default 1, min 1) and
//     ?pageSize (default 50, clamp 1..200) into Page{Number, Size}.
//
// Fail-closed: absent or blank numerics yield defaults; present-but-malformed
// numerics return a FieldError value naming the offending field so handlers
// can render 400 with an RFC-9457-style details.fields payload via ToDetails:
//
//	if err := ...; err != nil {
//		var fe pagination.FieldError
//		if errors.As(err, &fe) {
//			appErr := apperrors.New(apperrors.CodeBadRequest, "Invalid query parameter.")
//			appErr.Details = fe.ToDetails()
//			httpx.WriteError(w, r, appErr)
//			return
//		}
//	}
//
// Error mapping (checked against internal/platform/apperrors/errors.go):
// apperrors.CodeBadRequest ("BAD_REQUEST") maps to HTTP 400, which fits
// malformed query numerics, so no new error code is needed. This package
// stays stdlib-only (net/http, strconv, strings) so the leaf parser carries
// no internal coupling and no new external dependencies; the handler snippet
// above is the documented mapping instead of an import.
//
// Naming note: the plan text calls both the offset request and the cursor
// envelope "Page"; Go needs two names, so the offset request keeps Page
// (matching ParsePage's name, mirroring how ParseCursor returns Cursor) and
// the cursor envelope is CursorPage.
//
// Cursor timestamps stay opaque strings here: each endpoint validates/parses
// the format (e.g. RFC3339Nano) per its domain rules, including whether a
// cursor ID is required alongside a timestamp. Numeric values that parse but
// fall outside the range floor/ceiling to the nearest bound (they are not
// malformed); this differs deliberately from the legacy domainQueryInt
// fallback-to-default behavior this package will eventually replace.
package pagination

import (
	"net/http"
	"strconv"
	"strings"
)

const (
	// DefaultCursorLimit is the feed ?limit= default.
	DefaultCursorLimit = 100
	// MinCursorLimit floors feed ?limit=.
	MinCursorLimit = 1
	// MaxCursorLimit caps feed ?limit=.
	MaxCursorLimit = 500

	// DefaultPageNumber is the admin-list ?page= default (1-based).
	DefaultPageNumber = 1
	// MinPageNumber floors admin-list ?page=.
	MinPageNumber = 1

	// DefaultPageSize is the admin-list ?pageSize= default.
	DefaultPageSize = 50
	// MinPageSize floors admin-list ?pageSize=.
	MinPageSize = 1
	// MaxPageSize caps admin-list ?pageSize=.
	MaxPageSize = 200
)

// Cursor is a parsed feed (keyset) request. CursorUpdatedAt and CursorID are
// opaque trimmed passthrough strings; empty means "first page".
type Cursor struct {
	Limit           int
	CursorUpdatedAt string
	CursorID        string
}

// Page is a parsed offset request for admin lists.
type Page struct {
	Number int
	Size   int
}

// CursorPage is the feed response envelope. A nil NextCursor marks the end
// of the feed (equivalently, HasMore == false).
type CursorPage struct {
	Rows       any
	HasMore    bool
	NextCursor *Cursor
}

// FieldError reports one malformed query parameter. Handlers should render
// it fail-closed as 400 (apperrors.CodeBadRequest) with ToDetails() as the
// Details payload.
type FieldError struct {
	Field  string
	Reason string
}

// Error implements error.
func (e FieldError) Error() string {
	return "invalid query parameter " + strconv.Quote(e.Field) + ": " + e.Reason
}

// ToDetails renders the RFC-9457-style details payload:
//
//	{"fields": {<field>: <reason>}}
func (e FieldError) ToDetails() map[string]any {
	return map[string]any{"fields": map[string]string{e.Field: e.Reason}}
}

// parseIntParam reads one integer query param: absent/blank yields
// present=false; present-but-malformed yields a FieldError naming key.
func parseIntParam(r *http.Request, key string) (n int, present bool, err error) {
	s := strings.TrimSpace(r.URL.Query().Get(key))
	if s == "" {
		return 0, false, nil
	}
	n, aerr := strconv.Atoi(s)
	if aerr != nil {
		return 0, true, FieldError{Field: key, Reason: "must be a base-10 integer"}
	}
	return n, true, nil
}

func clamp(n, min, max int) int {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

// ParseCursor parses feed pagination: ?limit (default 100, clamp 1..500)
// plus opaque ?cursorUpdatedAt / ?cursorID passthrough.
func ParseCursor(r *http.Request) (Cursor, error) {
	limit := DefaultCursorLimit
	if n, present, err := parseIntParam(r, "limit"); err != nil {
		return Cursor{}, err
	} else if present {
		limit = clamp(n, MinCursorLimit, MaxCursorLimit)
	}
	q := r.URL.Query()
	return Cursor{
		Limit:           limit,
		CursorUpdatedAt: strings.TrimSpace(q.Get("cursorUpdatedAt")),
		CursorID:        strings.TrimSpace(q.Get("cursorID")),
	}, nil
}

// ParsePage parses offset pagination: ?page (default 1, min 1) and ?pageSize
// (default 50, clamp 1..200). When both params are malformed the ?page=
// error is returned first.
func ParsePage(r *http.Request) (Page, error) {
	number := DefaultPageNumber
	if n, present, err := parseIntParam(r, "page"); err != nil {
		return Page{}, err
	} else if present && n < MinPageNumber {
		number = MinPageNumber
	} else if present {
		number = n
	}
	size := DefaultPageSize
	if n, present, err := parseIntParam(r, "pageSize"); err != nil {
		return Page{}, err
	} else if present {
		size = clamp(n, MinPageSize, MaxPageSize)
	}
	return Page{Number: number, Size: size}, nil
}
