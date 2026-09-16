package httpx

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"github.com/google/uuid"
)

// Middleware execution order (spec): panic recovery > request id > trace >
// security headers > body limit > pre-auth IP guard > auth > CSRF > rate limit >
// authorization > handler > access log. Recovery/RequestID/SecurityHeaders/
// AccessLog/BodyLimit live here; the pre-auth guard, auth, CSRF, and
// authorization are wired by cmd/api.

type ctxKey string

const (
	// CtxRequestID carries the request id for downstream handlers.
	CtxRequestID ctxKey = "request_id"
	// CtxRouteTemplate carries the matched route template for access logs.
	CtxRouteTemplate ctxKey = "route"
	// CtxActorClass carries a coarse actor label (auth middleware sets it).
	CtxActorClass ctxKey = "actor_class"
	// CtxRouteHolder carries the back-report channel an outer AccessLog
	// installs so an inner WithRoute can publish its template outward.
	CtxRouteHolder ctxKey = "route_holder"
)

// RequestID ensures every request has an id, echoes it, and stores it in ctx.
// It reuses WithRequestID's header contract (X-Request-Id). Client-supplied
// values are validated (printable ASCII, max 128 chars) and sanitized;
// anything else is replaced with a server-minted UUID so a verbatim
// attacker header can never inject log/response-header content.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := sanitizeRequestID(r.Header.Get(RequestIDHeader))
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set(RequestIDHeader, id)
		r.Header.Set(RequestIDHeader, id)
		ctx := context.WithValue(r.Context(), CtxRequestID, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sanitizeRequestID validates a client-supplied request id: printable
// ASCII (0x20-0x7E), max 128 chars. Invalid input yields "" (caller mints).
func sanitizeRequestID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > 128 {
		return ""
	}
	for i := 0; i < len(v); i++ {
		if v[i] < 0x20 || v[i] > 0x7E {
			return ""
		}
	}
	return v
}

// RequestIDFrom returns the request id from ctx, header, or "".
func RequestIDFrom(ctx context.Context, r *http.Request) string {
	if v, ok := ctx.Value(CtxRequestID).(string); ok && v != "" {
		return v
	}
	if r != nil {
		if v := r.Header.Get(RequestIDHeader); v != "" {
			return v
		}
	}
	return ""
}

// Recovery converts panics into 500 INTERNAL envelopes without crashing the
// server. Only the panic itself is recovered; user errors never panic.
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf(`{"level":"error","msg":"panic recovered","request_id":%q,"panic":%q}`,
					RequestIDFrom(r.Context(), r), sanitizePanic(rec))
				_ = r.Body.Close()
				WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Internal server error."))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func sanitizePanic(rec any) string {
	switch v := rec.(type) {
	case string:
		return v
	case error:
		return v.Error()
	default:
		return "panic"
	}
}

// Trace annotates the request with a trace id (falls back to request id) so
// logs can correlate across services. Kept minimal: no external propagator.
func Trace(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-Id")
		if strings.TrimSpace(traceID) == "" {
			traceID = RequestIDFrom(r.Context(), r)
			if traceID == "" {
				traceID = uuid.NewString()
			}
		}
		w.Header().Set("X-Trace-Id", traceID)
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the status code for access logs.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

// Unwrap keeps optional ResponseWriter capabilities discoverable through the
// standard response controller. WebSocket upgrades also need the direct
// Hijacker method below because gorilla/websocket checks that interface
// explicitly.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("http.Hijacker is unavailable: %w", http.ErrNotSupported)
	}
	return hijacker.Hijack()
}

func (s *statusRecorder) Flush() {
	flusher, ok := s.ResponseWriter.(http.Flusher)
	if ok {
		flusher.Flush()
	}
}

func (s *statusRecorder) ReadFrom(src io.Reader) (int64, error) {
	if !s.wrote {
		s.WriteHeader(http.StatusOK)
	}
	if readerFrom, ok := s.ResponseWriter.(io.ReaderFrom); ok {
		return readerFrom.ReadFrom(src)
	}
	return io.Copy(s.ResponseWriter, src)
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status = code
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wrote {
		s.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(b)
}

// AccessLog emits one JSON line per request with
// request_id, route, method, status, latency and actor. It never logs
// secrets, bearer tokens, answers or writing bodies — only metadata.
// It also feeds the Prometheus HTTP series (plan 69): requests_total +
// duration + in-flight, labelled by low-cardinality route template +
// method + status class (never raw IDs; routeOf emits the fixed
// "unknown" label when no WithRoute template is set, so unannotated
// paths can never become unbounded series).
// httpInFlight tracks live requests process-wide. The telemetry Registry
// only exposes SetGauge (no Inc/Dec), so SetGauge(1)/SetGauge(0) per
// request clobbers under concurrency; the atomic counter here restores
// Inc/Dec semantics while staying within this file's ownership.
var httpInFlight atomic.Int64

// routeHolder lets an inner WithRoute report its template back out to an
// outer AccessLog: WithRoute sets its template on a derived request that
// never propagates back up, so without this holder the outer logger falls
// back to the raw path (high cardinality) and template-filtered alerts
// silently stop firing. AccessLog installs the holder; WithRoute fills it.
type routeHolder struct{ template string }

func AccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		method := r.Method
		holder := &routeHolder{}
		ctx := context.WithValue(r.Context(), CtxRouteHolder, holder)
		telemetry.DefaultRegistry.SetGauge(telemetry.MHTTPInFlight, float64(httpInFlight.Add(1)), "route", "global")
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r.WithContext(ctx))
		route := holder.template
		if route == "" {
			route = routeOf(r)
		}
		actor := "-"
		if v, ok := r.Context().Value(CtxActorClass).(string); ok && v != "" {
			actor = v
		}
		line, _ := json.Marshal(map[string]any{
			"level":      "info",
			"msg":        "request",
			"request_id": RequestIDFrom(r.Context(), r),
			"route":      route,
			"method":     r.Method,
			"status":     rec.status,
			"latency_ms": time.Since(start).Milliseconds(),
			"actor":      actor,
		})
		log.Println(string(line))
		telemetry.DefaultRegistry.IncCounter(telemetry.MHTTPRequestsTotal, "route", route, "method", method, "status", statusClass(rec.status))
		// Plan E3 dashboards: per-endpoint latency signal (p50/p99 source).
		// Gauge holds last-observed seconds; Prometheus scrapes derive
		// quantiles over time. Route template keeps cardinality low (I5).
		telemetry.DefaultRegistry.SetGauge(telemetry.MHTTPRequestDur, time.Since(start).Seconds(), "route", route, "method", method, "status", statusClass(rec.status))
		telemetry.DefaultRegistry.SetGauge(telemetry.MHTTPInFlight, float64(httpInFlight.Add(-1)), "route", "global")
	})
}

// statusClass buckets a status code to its 1xx..5xx class label.
func statusClass(code int) string {
	switch {
	case code >= 100 && code < 200:
		return "1xx"
	case code >= 200 && code < 300:
		return "2xx"
	case code >= 300 && code < 400:
		return "3xx"
	case code >= 400 && code < 500:
		return "4xx"
	default:
		return "5xx"
	}
}

// routeOf resolves the low-cardinality route label. An unannotated path
// (missed WithRoute, static/probe fallback) emits the fixed "unknown"
// label — never the raw URL, whose attacker-shaped 404 segments would
// become unbounded metric series.
func routeOf(r *http.Request) string {
	if v, ok := r.Context().Value(CtxRouteTemplate).(string); ok && v != "" {
		return v
	}
	return "unknown"
}

// WithRoute annotates ctx with the matched route template (call from router
// wrappers) so access logs stay low-cardinality. It also back-reports
// through the holder an outer AccessLog installed, so template visibility
// survives middleware nesting in either order.
func WithRoute(next http.Handler, template string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if holder, ok := r.Context().Value(CtxRouteHolder).(*routeHolder); ok && holder != nil {
			holder.template = template
		}
		ctx := context.WithValue(r.Context(), CtxRouteTemplate, template)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// BodyLimit caps request bodies at maxBytes with a 413 envelope on overflow.
func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil && r.ContentLength > maxBytes {
				WriteError(w, r, apperrors.New(apperrors.CodePayloadTooLarge, "Request body too large."))
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// CORSOptions configures the minimal CORS middleware: same-origin always,
// plus explicit allowed origins when set.
type CORSOptions struct {
	AllowedOrigins []string
}

// CORS allows same-origin requests and the configured origins. Preflights
// from allowed origins get ACAO + vary; anything else passes through
// without CORS headers (browser blocks, server stays neutral).
func CORS(opts CORSOptions) func(http.Handler) http.Handler {
	allowed := map[string]struct{}{}
	for _, o := range opts.AllowedOrigins {
		o := strings.TrimSpace(o)
		if o != "" {
			allowed[strings.ToLower(o)] = struct{}{}
		}
	}
	originAllowed := func(origin string) bool {
		if origin == "" {
			return true // same-origin / non-browser
		}
		_, ok := allowed[strings.ToLower(strings.TrimSpace(origin))]
		return ok
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if originAllowed(origin) && origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
				if !originAllowed(origin) && origin != "" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Csrf-Token, X-Request-Id, Authorization")
				w.Header().Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---- rate limit ----

// RateLimitConfig describes one token bucket: maxRequests refills per
// window with burst extra capacity.
type RateLimitConfig struct {
	MaxRequests int
	Window      time.Duration
	Burst       int
	// Tier is an optional low-cardinality metric label for capacity events.
	// It must never contain an identity, token, email, or IP address.
	Tier string
}

// RateLimitResult is the outcome of an Allow call.
type RateLimitResult struct {
	Allowed         bool
	Remaining       int
	RetryAfter      time.Duration
	CapacityLimited bool
}

// TokenBucket is a single in-memory token bucket.
type TokenBucket struct {
	mu         sync.Mutex
	tokens     float64
	lastRefill time.Time
	max        int
	window     time.Duration
	burst      int
}

func (b *TokenBucket) capacity() float64 { return float64(b.max + b.burst) }

func (b *TokenBucket) refillRatePerSecond() float64 {
	if b.max <= 0 || b.window <= 0 {
		return 1
	}
	rate := float64(b.max) / b.window.Seconds()
	if rate <= 0 {
		return 1
	}
	return rate
}

func (b *TokenBucket) allow(now time.Time) RateLimitResult {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.lastRefill.IsZero() {
		b.tokens = b.capacity()
		b.lastRefill = now
	}
	if elapsed := now.Sub(b.lastRefill); elapsed > 0 {
		cap := b.capacity()
		b.tokens += elapsed.Seconds() * b.refillRatePerSecond()
		if b.tokens > cap {
			b.tokens = cap
		}
		b.lastRefill = now
	}
	if b.tokens < 1 {
		perSec := b.refillRatePerSecond()
		return RateLimitResult{Allowed: false, RetryAfter: time.Duration(((1 - b.tokens) / perSec) * float64(time.Second))}
	}
	b.tokens--
	rem := int(b.tokens)
	if rem < 0 {
		rem = 0
	}
	return RateLimitResult{Allowed: true, Remaining: rem}
}

type bucketEntry struct {
	bucket   *TokenBucket
	lastSeen time.Time
}

// BucketStore holds per-key buckets with a cap and idle eviction.
type BucketStore struct {
	mu        sync.Mutex
	buckets   map[string]*bucketEntry
	maxKeys   int
	idleAfter time.Duration
	now       func() time.Time
}

// NewBucketStore creates a store capped at maxKeys keys (default 10000).
func NewBucketStore(maxKeys int) *BucketStore {
	return newBucketStoreWithClock(maxKeys, time.Minute, time.Now)
}

func newBucketStoreWithClock(maxKeys int, idleAfter time.Duration, now func() time.Time) *BucketStore {
	if maxKeys <= 0 {
		maxKeys = 10000
	}
	if idleAfter <= 0 {
		idleAfter = time.Minute
	}
	if now == nil {
		now = time.Now
	}
	return &BucketStore{
		buckets:   map[string]*bucketEntry{},
		maxKeys:   maxKeys,
		idleAfter: idleAfter,
		now:       now,
	}
}

func (s *BucketStore) currentTime() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *BucketStore) idleTTL(cfg RateLimitConfig) time.Duration {
	if cfg.Window > s.idleAfter {
		return cfg.Window
	}
	return s.idleAfter
}

func rateLimitMetricTier(tier string) string {
	switch strings.TrimSpace(tier) {
	case TierAuthCritical, TierAnonAuth, TierAuthedReads, TierPolling,
		TierHeartbeat, TierWrites, TierBackstop, "student-entry", "results-export":
		return strings.TrimSpace(tier)
	}
	return "unclassified"
}

func (s *BucketStore) evictIdleLocked(now time.Time, idleAfter time.Duration) bool {
	var oldestKey string
	var oldestSeen time.Time
	found := false
	for key, entry := range s.buckets {
		if entry == nil || now.Sub(entry.lastSeen) < idleAfter {
			continue
		}
		if !found || entry.lastSeen.Before(oldestSeen) {
			oldestKey = key
			oldestSeen = entry.lastSeen
			found = true
		}
	}
	if !found {
		return false
	}
	delete(s.buckets, oldestKey)
	return true
}

// KeyFunc derives the bucket key for a request. Empty means "no limiting"
// (used for routes where identity is unavailable — callers decide).
type KeyFunc func(r *http.Request) string

// TrustedProxies lists peer CIDRs whose X-Forwarded-For we honor (set via
// SetTrustedProxies; default loopback only). An XFF value is
// trusted ONLY when the direct TCP peer (RemoteAddr) is a trusted proxy;
// otherwise the left-most XFF entry is attacker-controlled and RemoteAddr
// is used. This keeps per-IP rate-limit buckets unspoofable from the open
// internet while still grouping correctly behind the platform LB.
var trustedProxiesMu = struct {
	sync.RWMutex
	nets []*net.IPNet
}{nets: defaultTrustedProxies()}

// defaultTrustedProxies trusts only loopback peers;
// deployments behind a platform LB must call SetTrustedProxies with the
// LB/proxy CIDRs so XFF is honored exactly there.
func defaultTrustedProxies() []*net.IPNet {
	var out []*net.IPNet
	for _, c := range []string{"127.0.0.0/8", "::1/128"} {
		if _, n, err := net.ParseCIDR(c); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// SetTrustedProxies replaces the trusted-proxy CIDR list (e.g. from
// TRUSTED_PROXIES env parsing at startup). Invalid CIDRs leave the current
// configuration unchanged and return an error.
func SetTrustedProxies(cidrs []string) error {
	var nets []*net.IPNet
	for _, c := range cidrs {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			return fmt.Errorf("invalid trusted proxy CIDR %q: %w", c, err)
		}
		nets = append(nets, n)
	}
	trustedProxiesMu.Lock()
	trustedProxiesMu.nets = nets
	trustedProxiesMu.Unlock()
	return nil
}

// peerIsTrustedProxy reports whether the direct TCP peer is trusted.
func peerIsTrustedProxy(remoteAddr string) bool {
	ip := net.ParseIP(stripPort(remoteAddr))
	if ip == nil {
		return false
	}
	trustedProxiesMu.RLock()
	defer trustedProxiesMu.RUnlock()
	for _, n := range trustedProxiesMu.nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// stripPort drops an optional host:port suffix (handles bare IPs,
// host:port, and [v6]:port without failing on bare colons).
func stripPort(hostport string) string {
	if h, _, err := net.SplitHostPort(strings.TrimSpace(hostport)); err == nil {
		return h
	}
	return strings.TrimSpace(hostport)
}

// ClientIPKey buckets by client IP. When the TCP peer is a trusted proxy,
// the left-most X-Forwarded-For entry is the client; otherwise RemoteAddr
// is authoritative (XFF ignored as spoofable). Empty/unparseable -> unknown.
func ClientIPKey(r *http.Request) string {
	if peerIsTrustedProxy(r.RemoteAddr) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			first := strings.TrimSpace(strings.Split(xff, ",")[0])
			first = strings.Trim(first, "[] ")
			if first != "" && net.ParseIP(first) != nil {
				return "ip:" + first
			}
			// Trusted proxy sent garbage: fall through to RemoteAddr.
			_ = first
		}
	}
	host := stripPort(r.RemoteAddr)
	host = strings.Trim(host, "[] ")
	if host == "" {
		host = "unknown"
	}
	return "ip:" + host
}

// Allow checks one key against cfg outside HTTP middleware (for
// handler-level tiers such as anonymous entry per-email+IP gates).
func (s *BucketStore) Allow(cfg RateLimitConfig, key string) RateLimitResult {
	return s.allowAt(cfg, key, s.currentTime())
}

func (s *BucketStore) allowAt(cfg RateLimitConfig, key string, now time.Time) RateLimitResult {
	if cfg.MaxRequests <= 0 {
		cfg.MaxRequests = 1
	}
	if cfg.Window <= 0 {
		cfg.Window = time.Minute
	}
	s.mu.Lock()
	if s.buckets == nil {
		s.buckets = map[string]*bucketEntry{}
	}
	if s.maxKeys <= 0 {
		s.maxKeys = 10000
	}
	if s.idleAfter <= 0 {
		s.idleAfter = time.Minute
	}
	entry, ok := s.buckets[key]
	if !ok {
		if len(s.buckets) >= s.maxKeys && !s.evictIdleLocked(now, s.idleTTL(cfg)) {
			s.mu.Unlock()
			telemetry.IncCounter(
				telemetry.MRatelimitCapacityTotal,
				"tier", rateLimitMetricTier(cfg.Tier),
				"key_class", keyClassOf(key),
			)
			return RateLimitResult{RetryAfter: time.Second, CapacityLimited: true}
		}
		entry = &bucketEntry{
			bucket:   &TokenBucket{max: cfg.MaxRequests, window: cfg.Window, burst: cfg.Burst},
			lastSeen: now,
		}
		s.buckets[key] = entry
	} else {
		entry.lastSeen = now
	}
	s.mu.Unlock()
	return entry.bucket.allow(now)
}

// RateLimit is token-bucket middleware: in-memory per-key buckets with
// burst. Denials render 429 {code RATE_LIMIT_EXCEEDED, retryAfterSeconds}.
// DB counters fallback: when dbLimited != nil and it denies, its verdict
// wins (callers wire distributed counters there); local verdict is the
// fast path.
func (s *BucketStore) RateLimit(cfg RateLimitConfig, keyFn KeyFunc, dbLimited func(ctx context.Context, key string) (allowed bool, retryAfter time.Duration, err error)) func(http.Handler) http.Handler {
	if cfg.MaxRequests <= 0 {
		cfg.MaxRequests = 1
	}
	if cfg.Window <= 0 {
		cfg.Window = time.Minute
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := ""
			if keyFn != nil {
				key = keyFn(r)
			}
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			res := s.allowAt(cfg, key, s.currentTime())
			if !res.Allowed {
				denyRateLimit(w, r, res.RetryAfter)
				return
			}
			if dbLimited != nil {
				allowed, retryAfter, err := dbLimited(r.Context(), key)
				if err != nil {
					// Fallback: DB failure must not open the gate nor
					// fail the request — keep the local verdict.
					_ = err
				} else if !allowed {
					denyRateLimit(w, r, retryAfter)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func denyRateLimit(w http.ResponseWriter, r *http.Request, retryAfter time.Duration) {
	denyRateLimitWithTier(w, r, "", retryAfter)
}

// WriteRateLimitExceeded renders the canonical rate-limit envelope for
// handler-level limiters that run after route middleware (for example export
// and student-entry gates). It keeps headers, body details, telemetry, and
// structured logging identical to route-tier denials.
func WriteRateLimitExceeded(w http.ResponseWriter, r *http.Request, tier, keyClass string, retryAfter time.Duration) {
	denyTierRateLimit(w, r, tier, keyClass, retryAfter)
}

// denyRateLimitWithTier renders the stable 429 envelope. The core fields
// (code, retryAfterSeconds, Retry-After header) are unchanged; a non-empty
// tier is purely additive so existing envelope consumers keep passing.
func denyRateLimitWithTier(w http.ResponseWriter, r *http.Request, tier string, retryAfter time.Duration) {
	secs := int(retryAfter.Seconds())
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", itoa(secs))
	if tier != "" {
		w.Header().Set("X-RateLimit-Tier", tier)
	}
	err := apperrors.New(apperrors.CodeRateLimitExceeded, "Rate limit exceeded.")
	err.HTTPStatus = http.StatusTooManyRequests
	details := map[string]any{"retryAfterSeconds": secs}
	if tier != "" {
		details["tier"] = tier
	}
	err.Details = details
	WriteError(w, r, err)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

var _ = debug.Stack
