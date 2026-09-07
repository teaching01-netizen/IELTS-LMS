package httpx

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

type optionalDraft struct {
	QuestionType string `json:"questionType"`
}

// Regression: POST .../questions with no body must decode as the zero value
// instead of 400 "Invalid request body."; strictness for real bodies stays.
func TestDecodeLimitedOptionalAcceptsEmptyBody(t *testing.T) {
	for name, body := range map[string]string{
		"nil body":   "",
		"empty":      "",
		"whitespace": "  \n\t ",
	} {
		_ = name
		req := httptest.NewRequest("POST", "/x", strings.NewReader(body))
		if body == "" && name == "nil body" {
			req.Body = nil
		}
		var v optionalDraft
		if err := DecodeLimitedOptional(req, MaxAdminBodyBytes, &v); err != nil {
			t.Fatalf("%s: expected nil error, got %v", name, err)
		}
		if v.QuestionType != "" {
			t.Fatalf("%s: expected zero value, got %+v", name, v)
		}
	}
}

func TestDecodeLimitedOptionalRejectsUnknownFields(t *testing.T) {
	req := httptest.NewRequest("POST", "/x", strings.NewReader(`{"bogus":1}`))
	var v optionalDraft
	if err := DecodeLimitedOptional(req, MaxAdminBodyBytes, &v); err == nil {
		t.Fatal("unknown fields must still be rejected")
	}
}

func TestDecodeLimitedOptionalDecodesExplicitDraft(t *testing.T) {
	req := httptest.NewRequest("POST", "/x", strings.NewReader(`{"questionType":"single_choice"}`))
	var v optionalDraft
	if err := DecodeLimitedOptional(req, MaxAdminBodyBytes, &v); err != nil {
		t.Fatal(err)
	}
	if v.QuestionType != "single_choice" {
		t.Fatalf("draft = %+v", v)
	}
}

func TestDecodeLimitedOptionalRejectsGarbage(t *testing.T) {
	req := httptest.NewRequest("POST", "/x", io.NopCloser(strings.NewReader("{oops")))
	var v optionalDraft
	if err := DecodeLimitedOptional(req, MaxAdminBodyBytes, &v); err == nil {
		t.Fatal("malformed JSON must be rejected")
	}
}
