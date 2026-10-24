package definition

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"unicode/utf8"
)

// CanonicalEmbedURL validates an external Eva SIM URL without resolving or
// fetching it: absolute HTTPS, a public-looking hostname, no credentials, no
// control characters, bounded length. Provider query parameters are kept.
// Callers additionally reject the application's own host (SameHost).
func CanonicalEmbedURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("Enter the form URL.")
	}
	if utf8.RuneCountInString(raw) > MaxURLChars {
		return "", errors.New("The URL must be at most 2,048 characters.")
	}
	if strings.ContainsFunc(raw, func(r rune) bool { return isControl(r) || r == ' ' || r == '<' || r == '>' || r == '"' }) {
		return "", errors.New("Enter a URL, not HTML or text with spaces.")
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() {
		return "", errors.New("Enter an absolute https:// URL.")
	}
	if !strings.EqualFold(u.Scheme, "https") {
		return "", errors.New("The URL must use https://.")
	}
	if u.User != nil {
		return "", errors.New("The URL cannot contain a username or password.")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" {
		return "", errors.New("The URL needs a hostname.")
	}
	if port := u.Port(); port != "" && port != "443" {
		return "", errors.New("The URL must use the standard HTTPS port.")
	}
	if ip, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		if !publicAddr(ip) {
			return "", errors.New("The URL cannot point to a private or local address.")
		}
	} else {
		if !strings.Contains(host, ".") || net.ParseIP(host) != nil {
			return "", errors.New("The URL needs a public hostname.")
		}
		for _, suffix := range []string{".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"} {
			if host == strings.TrimPrefix(suffix, ".") || strings.HasSuffix(host, suffix) {
				return "", errors.New("The URL needs a public hostname.")
			}
		}
	}
	u.Scheme = "https"
	u.Host = strings.ToLower(u.Host)
	return u.String(), nil
}

func publicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!netip.MustParsePrefix("100.64.0.0/10").Contains(ip) && !netip.MustParsePrefix("fc00::/7").Contains(ip)
}

// EmbedHost returns the display hostname of a validated URL.
func EmbedHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// SameHost reports whether a URL targets one of the application's own hosts
// (host[:port] values such as the request Host header).
func SameHost(raw string, appHosts ...string) bool {
	host := EmbedHost(raw)
	if host == "" {
		return false
	}
	for _, h := range appHosts {
		h = strings.ToLower(strings.TrimSpace(h))
		if hn, _, err := net.SplitHostPort(h); err == nil {
			h = hn
		}
		if h != "" && h == host {
			return true
		}
	}
	return false
}
