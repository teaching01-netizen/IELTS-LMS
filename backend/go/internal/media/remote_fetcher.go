package media

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	remoteFetchTimeout = 10 * time.Second
	maxRemoteRedirects = 5
)

// FetchedImage is the bounded, still-unpersisted result of an HTTPS image
// fetch. The service validates its bytes again before creating a managed
// asset, so this type is not a persistence escape hatch.
type FetchedImage struct {
	ContentType string
	FileName    string
	Body        []byte
}

// RemoteImageFetcher is the network boundary for URL imports. Keeping it as
// a port lets media tests use deterministic resolvers and dialers without
// weakening the production SSRF policy.
type RemoteImageFetcher interface {
	Fetch(ctx context.Context, rawURL string, maxBytes int64) (FetchedImage, error)
}

type remoteIPResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

// RemoteImageFetcherOptions contains only infrastructure seams. Zero values
// select the production resolver, dialer, and TLS configuration.
type RemoteImageFetcherOptions struct {
	Resolver    remoteIPResolver
	DialContext func(context.Context, string, string) (net.Conn, error)
	TLSConfig   *tls.Config
}

type httpRemoteImageFetcher struct {
	resolver    remoteIPResolver
	dialContext func(context.Context, string, string) (net.Conn, error)
	tlsConfig   *tls.Config
}

// NewHTTPRemoteImageFetcher builds the SSRF-safe production fetcher.
func NewHTTPRemoteImageFetcher(options RemoteImageFetcherOptions) RemoteImageFetcher {
	resolver := options.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	dialContext := options.DialContext
	if dialContext == nil {
		dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
		dialContext = dialer.DialContext
	}
	return &httpRemoteImageFetcher{
		resolver:    resolver,
		dialContext: dialContext,
		tlsConfig:   options.TLSConfig,
	}
}

func (f *httpRemoteImageFetcher) Fetch(ctx context.Context, rawURL string, maxBytes int64) (FetchedImage, error) {
	if maxBytes <= 0 {
		return FetchedImage{}, errors.New("remote image size limit is invalid")
	}
	u, err := parseRemoteURL(rawURL)
	if err != nil {
		return FetchedImage{}, err
	}

	fetchCtx, cancel := context.WithTimeout(ctx, remoteFetchTimeout)
	defer cancel()

	tlsConfig := f.tlsConfig
	if tlsConfig != nil {
		tlsConfig = tlsConfig.Clone()
	}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           f.safeDialContext,
		TLSClientConfig:       tlsConfig,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          2,
		MaxIdleConnsPerHost:   1,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: remoteFetchTimeout,
		DisableCompression:    true,
		DisableKeepAlives:     true,
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRemoteRedirects {
				return errors.New("remote image redirect limit exceeded")
			}
			if _, err := parseRemoteURL(req.URL.String()); err != nil {
				return err
			}
			// The import endpoint never accepts caller headers, and redirect
			// requests are rebuilt without Cookie or Authorization state.
			req.Header = make(http.Header)
			return nil
		},
	}

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return FetchedImage{}, errors.New("remote image URL is invalid")
	}
	resp, err := client.Do(req)
	if err != nil {
		return FetchedImage{}, errors.New("remote image request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return FetchedImage{}, errors.New("remote image request returned a non-success status")
	}

	contentType, err := responseImageContentType(resp.Header.Get("Content-Type"))
	if err != nil {
		return FetchedImage{}, err
	}
	if resp.ContentLength > maxBytes {
		return FetchedImage{}, fmt.Errorf("remote image exceeds the %d byte limit", maxBytes)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return FetchedImage{}, errors.New("remote image response could not be read")
	}
	if int64(len(body)) > maxBytes {
		return FetchedImage{}, fmt.Errorf("remote image exceeds the %d byte limit", maxBytes)
	}

	return FetchedImage{
		ContentType: contentType,
		FileName:    imageFileName(resp.Request.URL, contentType),
		Body:        body,
	}, nil
}

func parseRemoteURL(rawURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return nil, errors.New("remote image URL must be HTTPS without user information")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, errors.New("remote image URL port is invalid")
		}
	}
	return u, nil
}

func (f *httpRemoteImageFetcher) safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("remote image address is invalid")
	}

	var addresses []net.IPAddr
	if literal := net.ParseIP(host); literal != nil {
		addresses = []net.IPAddr{{IP: literal}}
	} else {
		addresses, err = f.resolver.LookupIPAddr(ctx, host)
		if err != nil || len(addresses) == 0 {
			return nil, errors.New("remote image host could not be resolved")
		}
	}
	for _, candidate := range addresses {
		if !isSafeRemoteIP(candidate.IP) {
			return nil, errors.New("remote image host resolves to a blocked address")
		}
	}

	var lastErr error
	for _, candidate := range addresses {
		conn, dialErr := f.dialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr != nil {
		return nil, errors.New("remote image host could not be reached")
	}
	return nil, errors.New("remote image host could not be reached")
}

func isSafeRemoteIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	for _, blocked := range []string{
		"100.100.100.200", // Alibaba ECS metadata.
		"168.63.129.16",   // Azure WireServer/metadata.
		"169.254.169.254", // AWS/GCP/Azure metadata.
		"169.254.170.2",   // ECS task metadata.
		"fd00:ec2::254",   // AWS IPv6 metadata.
	} {
		if ip.Equal(net.ParseIP(blocked)) {
			return false
		}
	}
	return ip.IsGlobalUnicast()
}

func responseImageContentType(raw string) (string, error) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("remote image content type is invalid")
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if err := validateImageContentType(mediaType); err != nil {
		return "", errors.New("remote response is not an allowed image type")
	}
	return mediaType, nil
}

func imageFileName(u *url.URL, contentType string) string {
	name := ""
	if u != nil {
		name, _ = url.PathUnescape(path.Base(u.Path))
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == "/" {
		name = "image." + imageExtension(contentType)
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == '/' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." {
		return "image." + imageExtension(contentType)
	}
	if len(name) > 120 {
		name = name[:120]
	}
	return name
}

func imageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return "jpg"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	default:
		return "png"
	}
}
