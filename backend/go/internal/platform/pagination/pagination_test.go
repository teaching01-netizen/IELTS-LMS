package pagination

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func parseCursorURL(t *testing.T, rawquery string) (Cursor, error) {
	t.Helper()
	r := httptest.NewRequest("GET", "/x?"+rawquery, nil)
	return ParseCursor(r)
}

func parsePageURL(t *testing.T, rawquery string) (Page, error) {
	t.Helper()
	r := httptest.NewRequest("GET", "/x?"+rawquery, nil)
	return ParsePage(r)
}

func fieldOf(t *testing.T, err error) FieldError {
	t.Helper()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var fe FieldError
	if !errors.As(err, &fe) {
		t.Fatalf("expected FieldError, got %T (%v)", err, err)
	}
	return fe
}

func TestParseCursorDefaults(t *testing.T) {
	c, err := parseCursorURL(t, "")
	if err != nil {
		t.Fatalf("ParseCursor() err = %v", err)
	}
	if DefaultCursorLimit != 100 {
		t.Fatalf("DefaultCursorLimit = %d, want 100", DefaultCursorLimit)
	}
	if c.Limit != 100 {
		t.Fatalf("Limit = %d, want 100", c.Limit)
	}
	if c.CursorUpdatedAt != "" || c.CursorID != "" {
		t.Fatalf("cursor = %+v, want empty", c)
	}
}

func TestParseCursorBlankLimitIsDefault(t *testing.T) {
	c, err := parseCursorURL(t, "limit=%20%20")
	if err != nil {
		t.Fatalf("ParseCursor() err = %v", err)
	}
	if c.Limit != 100 {
		t.Fatalf("Limit = %d, want 100", c.Limit)
	}
}

func TestParseCursorClamps(t *testing.T) {
	for q, want := range map[string]int{
		"limit=1":         1,
		"limit=500":       500,
		"limit=0":         1,
		"limit=-3":        1,
		"limit=501":       500,
		"limit=999999":    500,
		"limit=%20250%20": 250,
	} {
		c, err := parseCursorURL(t, q)
		if err != nil {
			t.Fatalf("ParseCursor(%q) err = %v", q, err)
		}
		if c.Limit != want {
			t.Fatalf("ParseCursor(%q).Limit = %d, want %d", q, c.Limit, want)
		}
	}
}

func TestParseCursorMalformedLimit(t *testing.T) {
	for _, q := range []string{"limit=abc", "limit=1.5", "limit=12x", "limit=--4", "limit=9999999999999999999999"} {
		_, err := parseCursorURL(t, q)
		fe := fieldOf(t, err)
		if fe.Field != "limit" {
			t.Fatalf("ParseCursor(%q) field = %q, want %q", q, fe.Field, "limit")
		}
	}
}

func TestParseCursorPassthrough(t *testing.T) {
	r := httptest.NewRequest("GET", "/x", nil)
	q := r.URL.Query()
	q.Set("limit", "10")
	q.Set("cursorUpdatedAt", "2024-05-01T12:00:00.123456789Z")
	q.Set("cursorID", "abc-123")
	r.URL.RawQuery = q.Encode()
	c, err := ParseCursor(r)
	if err != nil {
		t.Fatalf("ParseCursor() err = %v", err)
	}
	if c.Limit != 10 {
		t.Fatalf("Limit = %d, want 10", c.Limit)
	}
	if c.CursorUpdatedAt != "2024-05-01T12:00:00.123456789Z" {
		t.Fatalf("CursorUpdatedAt = %q", c.CursorUpdatedAt)
	}
	if c.CursorID != "abc-123" {
		t.Fatalf("CursorID = %q", c.CursorID)
	}
}

func TestParseCursorTimestampPassthroughOpaque(t *testing.T) {
	r := httptest.NewRequest("GET", "/x", nil)
	q := r.URL.Query()
	q.Set("cursorUpdatedAt", "2024-05-01T12:00:00.123456789Z")
	q.Set("cursorID", "  abc-123  ")
	r.URL.RawQuery = q.Encode()
	c, err := ParseCursor(r)
	if err != nil {
		t.Fatalf("ParseCursor() err = %v", err)
	}
	if c.CursorUpdatedAt != "2024-05-01T12:00:00.123456789Z" {
		t.Fatalf("CursorUpdatedAt = %q", c.CursorUpdatedAt)
	}
	if c.CursorID != "abc-123" {
		t.Fatalf("CursorID not trimmed: %q", c.CursorID)
	}
	// Malformed timestamps stay opaque (no FieldError); domain layers decide.
	r2 := httptest.NewRequest("GET", "/x", nil)
	q2 := r2.URL.Query()
	q2.Set("cursorUpdatedAt", "not-a-time")
	r2.URL.RawQuery = q2.Encode()
	c2, err := ParseCursor(r2)
	if err != nil {
		t.Fatalf("opaque cursor must not error, got %v", err)
	}
	if c2.CursorUpdatedAt != "not-a-time" {
		t.Fatalf("CursorUpdatedAt = %q", c2.CursorUpdatedAt)
	}
}

func TestParsePageDefaults(t *testing.T) {
	p, err := parsePageURL(t, "")
	if err != nil {
		t.Fatalf("ParsePage() err = %v", err)
	}
	if DefaultPageNumber != 1 {
		t.Fatalf("DefaultPageNumber = %d, want 1", DefaultPageNumber)
	}
	if DefaultPageSize != 50 {
		t.Fatalf("DefaultPageSize = %d, want 50", DefaultPageSize)
	}
	if p.Number != 1 {
		t.Fatalf("Number = %d, want 1", p.Number)
	}
	if p.Size != 50 {
		t.Fatalf("Size = %d, want 50", p.Size)
	}
}

func TestParsePageClampsAndFloors(t *testing.T) {
	for q, want := range map[string][2]int{
		"page=3&pageSize=25": {3, 25},
		"page=0":             {1, 50},
		"page=-7":            {1, 50},
		"pageSize=0":         {1, 1},
		"pageSize=-2":        {1, 1},
		"pageSize=201":       {1, 200},
		"pageSize=1000000":   {1, 200},
		"page=999999":        {999999, 50},
		"page=%204%20":       {4, 50},
		"pageSize=%2010%20":  {1, 10},
	} {
		p, err := parsePageURL(t, q)
		if err != nil {
			t.Fatalf("ParsePage(%q) err = %v", q, err)
		}
		if p.Number != want[0] || p.Size != want[1] {
			t.Fatalf("ParsePage(%q) = %+v, want {%d %d}", q, p, want[0], want[1])
		}
	}
}

func TestParsePageMalformedNamesField(t *testing.T) {
	_, err := parsePageURL(t, "page=oops")
	if got := fieldOf(t, err).Field; got != "page" {
		t.Fatalf("field = %q, want page", got)
	}
	_, err = parsePageURL(t, "pageSize=nope")
	if got := fieldOf(t, err).Field; got != "pageSize" {
		t.Fatalf("field = %q, want pageSize", got)
	}
	_, err = parsePageURL(t, "page=1.5")
	if got := fieldOf(t, err).Field; got != "page" {
		t.Fatalf("field = %q, want page", got)
	}
	_, err = parsePageURL(t, "pageSize=")
	if err != nil {
		t.Fatalf("blank pageSize must be default, got %v", err)
	}
	// Both malformed: page error wins (fail-closed, deterministic).
	_, err = parsePageURL(t, "page=bad&pageSize=bad")
	if got := fieldOf(t, err).Field; got != "page" {
		t.Fatalf("field = %q, want page", got)
	}
}

func TestFieldErrorShape(t *testing.T) {
	fe := FieldError{Field: "limit", Reason: "must be a base-10 integer"}
	if !strings.Contains(fe.Error(), "limit") {
		t.Fatalf("Error() = %q, must name the field", fe.Error())
	}
	d := fe.ToDetails()
	fields, ok := d["fields"].(map[string]string)
	if !ok {
		t.Fatalf("ToDetails() = %#v, want {fields: map}", d)
	}
	if fields["limit"] == "" {
		t.Fatalf("ToDetails() missing field reason: %#v", d)
	}
}

func TestCursorPageEnvelopeZeroValue(t *testing.T) {
	var pg CursorPage
	if pg.HasMore || pg.NextCursor != nil {
		t.Fatalf("zero CursorPage = %+v, want end-of-feed", pg)
	}
	pg = CursorPage{Rows: []string{"a"}, HasMore: true, NextCursor: &Cursor{Limit: 10, CursorID: "n"}}
	if !pg.HasMore || pg.NextCursor == nil || pg.NextCursor.CursorID != "n" {
		t.Fatalf("CursorPage = %+v", pg)
	}
}
