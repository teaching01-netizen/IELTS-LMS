package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// The start-with-code body is a string code plus a nonnegative epoch and
// nothing else: a numeric code would silently lose leading zeros, and an
// attempt/module selector would let the client choose what starts.
func TestDecodeStartWithCodeBodyContract(t *testing.T) {
	for _, tc := range []struct {
		body string
		code apperrors.Code
		want string
	}{
		{`{"code":"004827","controlEpoch":3}`, "", "004827"},
		{`{"code":"004827","controlEpoch":0}`, "", "004827"},
		{`{"code":4827,"controlEpoch":3}`, apperrors.CodeStartCodeFormatInvalid, ""},
		{`{"code":null,"controlEpoch":3}`, apperrors.CodeStartCodeFormatInvalid, ""},
		{`{"controlEpoch":3}`, apperrors.CodeStartCodeFormatInvalid, ""},
		{`{"code":"004827"}`, apperrors.CodeBadRequest, ""},
		{`{"code":"004827","controlEpoch":-1}`, apperrors.CodeBadRequest, ""},
		{`{"code":"004827","controlEpoch":1.5}`, apperrors.CodeBadRequest, ""},
		{`{"code":"004827","controlEpoch":3,"moduleId":"m-2"}`, apperrors.CodeBadRequest, ""},
		{`{"code":"004827","controlEpoch":3,"attemptId":"other"}`, apperrors.CodeBadRequest, ""},
	} {
		req := httptest.NewRequest(http.MethodPost, "/start-with-code", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		got, err := decodeStartWithCodeBody(req)
		if tc.code == "" {
			if err != nil || got.Code != tc.want {
				t.Errorf("%s: got %+v %v", tc.body, got, err)
			}
			continue
		}
		appErr, ok := apperrors.As(err)
		if !ok || appErr.Code != tc.code {
			t.Errorf("%s: want %s, got %v", tc.body, tc.code, err)
		}
	}
}
