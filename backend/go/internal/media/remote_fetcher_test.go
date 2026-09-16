package media

import (
	"context"
	"crypto/tls"
	"fmt"
	"image"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (f resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return f(ctx, host)
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var out byteBuffer
	if err := png.Encode(&out, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	return out.bytes
}

type byteBuffer struct{ bytes []byte }

func (b *byteBuffer) Write(p []byte) (int, error) {
	b.bytes = append(b.bytes, p...)
	return len(p), nil
}

func newTestFetcher(t *testing.T, handler http.Handler) (RemoteImageFetcher, func()) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	resolver := resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
	dialer := &net.Dialer{}
	fetcher := NewHTTPRemoteImageFetcher(RemoteImageFetcherOptions{
		Resolver: resolver,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, server.Listener.Addr().String())
		},
		// #nosec G402 -- this test uses httptest's self-signed certificate.
		TLSConfig: &tls.Config{InsecureSkipVerify: true},
	})
	return fetcher, server.Close
}

func TestRemoteFetcherImportsBoundedHTTPSImage(t *testing.T) {
	body := pngBytes(t)
	fetcher, cleanup := newTestFetcher(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("authorization header must not be forwarded, got %q", got)
		}
		if got := r.Header.Get("Cookie"); got != "" {
			t.Errorf("cookie header must not be forwarded, got %q", got)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(body)
	}))
	defer cleanup()

	got, err := fetcher.Fetch(context.Background(), "https://cdn.example.test/diagram.png", int64(len(body)))
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if got.ContentType != "image/png" || got.FileName != "diagram.png" || string(got.Body) != string(body) {
		t.Fatalf("unexpected fetched image: %+v", got)
	}
}

func TestRemoteFetcherRejectsUnsafeURLsAndResolvedIPs(t *testing.T) {
	for _, rawURL := range []string{
		"http://example.test/image.png",
		"https://user:pass@example.test/image.png",
		"data:image/png;base64,AAAA",
	} {
		fetcher := NewHTTPRemoteImageFetcher(RemoteImageFetcherOptions{})
		if _, err := fetcher.Fetch(context.Background(), rawURL, 1024); err == nil {
			t.Fatalf("Fetch(%q) must reject unsafe URL", rawURL)
		}
	}

	for _, blocked := range []string{"127.0.0.1", "169.254.169.254", "10.0.0.1", "224.0.0.1", "100.100.100.200"} {
		fetcher := NewHTTPRemoteImageFetcher(RemoteImageFetcherOptions{
			Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
				return []net.IPAddr{{IP: net.ParseIP(blocked)}}, nil
			}),
			DialContext: func(context.Context, string, string) (net.Conn, error) {
				return nil, fmt.Errorf("dial must not run for %s", blocked)
			},
		})
		if _, err := fetcher.Fetch(context.Background(), "https://blocked.example.test/image.png", 1024); err == nil {
			t.Fatalf("Fetch() must reject resolved blocked IP %s", blocked)
		}
	}
}

func TestRemoteFetcherCapsChunkedResponses(t *testing.T) {
	fetcher, cleanup := newTestFetcher(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("0123456789"))
	}))
	defer cleanup()

	if _, err := fetcher.Fetch(context.Background(), "https://cdn.example.test/chunked.png", 5); err == nil {
		t.Fatal("Fetch() must reject a chunked response over the byte cap")
	}
}

func TestRemoteFetcherRejectsWrongResponseTypeAndTooManyRedirects(t *testing.T) {
	wrongType, cleanup := newTestFetcher(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>not an image</html>"))
	}))
	if _, err := wrongType.Fetch(context.Background(), "https://cdn.example.test/page", 1024); err == nil {
		t.Fatal("Fetch() must reject non-image response types")
	}
	cleanup()

	redirects, cleanup := newTestFetcher(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://cdn.example.test"+r.URL.Path)
		w.WriteHeader(http.StatusFound)
	}))
	defer cleanup()
	if _, err := redirects.Fetch(context.Background(), "https://cdn.example.test/redirect", 1024); err == nil {
		t.Fatal("Fetch() must reject redirect loops beyond the configured limit")
	}
}
