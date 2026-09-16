package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/httpx"
)

var loopbackTrustedProxyCIDRs = []string{"127.0.0.0/8", "::1/128"}

func setTrustedProxiesForTest(t *testing.T, cidrs []string) {
	t.Helper()
	if err := httpx.SetTrustedProxies(cidrs); err != nil {
		t.Fatalf("set trusted proxies: %v", err)
	}
	t.Cleanup(func() {
		if err := httpx.SetTrustedProxies(loopbackTrustedProxyCIDRs); err != nil {
			t.Fatalf("restore trusted proxies: %v", err)
		}
	})
}

func TestTrustedProxyUsesLeftMostForwardedFor(t *testing.T) {
	setTrustedProxiesForTest(t, []string{"10.0.0.0/8"})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.1.2.3:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.1.2.3")

	if got := httpx.ClientIPKey(req); got != "ip:203.0.113.7" {
		t.Fatalf("configured proxy must use left-most XFF, got %q", got)
	}
}

func TestUntrustedPeerIgnoresForwardedFor(t *testing.T) {
	setTrustedProxiesForTest(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")

	if got := httpx.ClientIPKey(req); got != "ip:198.51.100.9" {
		t.Fatalf("untrusted peer must use direct peer IP, got %q", got)
	}
}

func TestEmptyTrustedProxyConfigDoesNotTrustRFC1918Peer(t *testing.T) {
	setTrustedProxiesForTest(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.7:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")

	if got := httpx.ClientIPKey(req); got != "ip:192.168.1.7" {
		t.Fatalf("empty proxy config must not trust RFC1918 peer, got %q", got)
	}
}

func TestSetTrustedProxiesRejectsInvalidCIDR(t *testing.T) {
	setTrustedProxiesForTest(t, []string{"10.0.0.0/8"})
	if err := httpx.SetTrustedProxies([]string{"not-a-cidr"}); err == nil {
		t.Fatal("invalid trusted proxy CIDR must return an error")
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.1.2.3:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	if got := httpx.ClientIPKey(req); got != "ip:203.0.113.7" {
		t.Fatalf("invalid update must preserve prior proxy configuration, got %q", got)
	}
}
