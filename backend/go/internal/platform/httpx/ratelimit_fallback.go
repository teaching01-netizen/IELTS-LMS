// Package httpx distributed rate-limit fallback (round 75): the middleware
// contract already accepts a dbLimited func; this file implements it against
// distributed_rate_limit_counters so multi-instance deploys share one
// ceiling. Local buckets stay the fast path; the DB verdict only ADDS
// denials (a DB error keeps the local verdict, never opens the gate).
package httpx

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// A small permit lease amortizes shared counter writes during an exam burst.
	// A process restart can strand at most three unused permits per API instance/key.
	rateLimitReservationSize      = 4
	rateLimitLeaseCacheCap        = 10000
	rateLimitReservationBatchSize = 64
	rateLimitReservationQueueCap  = 2048
	rateLimitReservationBatchWait = 2 * time.Millisecond
	rateLimitReservationDBTimeout = 5 * time.Second
)

type rateLimitLease struct {
	mu          sync.Mutex
	windowStart string
	remaining   int
}

type rateLimitReservationRequest struct {
	ctx         context.Context
	key         string
	windowStart string
	expires     string
	requested   int
	result      chan rateLimitReservationResult
}

type rateLimitReservationResult struct {
	grant int
	err   error
}

// DBRateLimiter enforces per-key fixed windows in MySQL/TiDB. One row per
// (route_key, bucket_key, window_start); expired windows are pruned lazily
// by the retention job (maintenance RunRetention), not per-request.
type DBRateLimiter struct {
	db          *sql.DB
	routeKey    string
	maxRequests int
	window      time.Duration
	mu          sync.Mutex
	leases      map[string]*rateLimitLease
	batchMu     sync.Mutex
	batchQueue  chan *rateLimitReservationRequest
	batchActive bool
}

// NewDBRateLimiter wires the pool explicitly; maxRequests<=0 means 1.
func NewDBRateLimiter(db *sql.DB, routeKey string, maxRequests int, window time.Duration) *DBRateLimiter {
	if maxRequests <= 0 {
		maxRequests = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &DBRateLimiter{
		db: db, routeKey: routeKey, maxRequests: maxRequests, window: window,
		batchQueue: make(chan *rateLimitReservationRequest, rateLimitReservationQueueCap),
	}
}

// Check reports the current fixed-window verdict. Each API process reserves up
// to rateLimitReservationSize permits at a time from the shared counter, so
// concurrent instances still cannot exceed the global ceiling. A crash can
// strand at most rateLimitReservationSize unused permits per instance/key
// for the rest of that window, causing an early denial but never an overrun.
// A DB error returns (true, 0, err) so the middleware uses its bounded local
// emergency limiter.
func (l *DBRateLimiter) Check(ctx context.Context, key string) (bool, time.Duration, error) {
	if !utf8.ValidString(key) || !utf8.ValidString(l.routeKey) || utf8.RuneCountInString(key) > 255 || utf8.RuneCountInString(l.routeKey) > 128 {
		// Keep malformed or unrepresentable keys out of a multi-key statement so
		// one invalid bucket cannot make unrelated limiter checks use fallback.
		return true, 0, errors.New("rate-limit key exceeds its storage bounds")
	}
	now := time.Now().UTC()
	winStart := now.Truncate(l.window).Format("2006-01-02 15:04:05")
	expires := now.Add(l.window).Format("2006-01-02 15:04:05")
	lease := l.leaseFor(key, winStart)
	if lease != nil {
		lease.mu.Lock()
		if lease.windowStart == winStart && lease.remaining > 0 {
			lease.remaining--
			lease.mu.Unlock()
			return true, 0, nil
		}
		lease.windowStart = winStart
		lease.remaining = 0
		requested := rateLimitReservationSize
		if requested > l.maxRequests {
			requested = l.maxRequests
		}
		grant, err := l.reserve(ctx, key, winStart, expires, requested)
		if err != nil {
			lease.mu.Unlock()
			return true, 0, err
		}
		if grant > 0 {
			lease.remaining = grant - 1
			lease.mu.Unlock()
			return true, 0, nil
		}
		lease.mu.Unlock()
		return false, l.retryAfter(now), nil
	}
	// The bounded cache is full. Keep exact distributed enforcement without
	// allocating process memory for another attacker-controlled key.
	grant, err := l.reserve(ctx, key, winStart, expires, 1)
	if err != nil {
		return true, 0, err
	}
	if grant == 0 {
		return false, l.retryAfter(now), nil
	}
	return true, 0, nil
}

func (l *DBRateLimiter) leaseFor(key, winStart string) *rateLimitLease {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.leases == nil {
		l.leases = make(map[string]*rateLimitLease)
	}
	if lease := l.leases[key]; lease != nil {
		return lease
	}
	if len(l.leases) >= rateLimitLeaseCacheCap {
		for staleKey, stale := range l.leases {
			if stale.mu.TryLock() {
				expired := stale.windowStart != winStart
				stale.mu.Unlock()
				if expired {
					delete(l.leases, staleKey)
				}
				if len(l.leases) < rateLimitLeaseCacheCap {
					break
				}
			}
		}
	}
	if len(l.leases) >= rateLimitLeaseCacheCap {
		return nil
	}
	lease := &rateLimitLease{}
	l.leases[key] = lease
	return lease
}

func (l *DBRateLimiter) retryAfter(now time.Time) time.Duration {
	retry := now.Truncate(l.window).Add(l.window).Sub(now)
	if retry < time.Second {
		return time.Second
	}
	return retry
}

func (l *DBRateLimiter) reserve(ctx context.Context, key, winStart, expires string, requested int) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	req := &rateLimitReservationRequest{
		ctx: ctx, key: key, windowStart: winStart, expires: expires,
		requested: requested, result: make(chan rateLimitReservationResult, 1),
	}
	queued := false
	startBatch := false
	l.batchMu.Lock()
	select {
	case l.batchQueue <- req:
		queued = true
		if !l.batchActive {
			l.batchActive = true
			startBatch = true
		}
	default:
	}
	l.batchMu.Unlock()
	if !queued {
		// Keep overload bounded. The existing one-key reservation remains the
		// exact fallback when the coalescing queue is full.
		return l.reserveSingle(ctx, key, winStart, expires, requested)
	}
	if startBatch {
		go l.drainReservationBatches()
	}
	select {
	case result := <-req.result:
		if err := ctx.Err(); err != nil {
			// A committed reservation whose caller timed out is safely stranded;
			// never turn an unknown client outcome into an extra local permit.
			return 0, err
		}
		return result.grant, result.err
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

// drainReservationBatches is run by the caller that changes batchActive from
// false to true. Enqueue and the idle transition share batchMu, so work cannot
// be stranded between an empty-queue check and a future caller joining.
func (l *DBRateLimiter) drainReservationBatches() {
	for {
		first := <-l.batchQueue
		batch := []*rateLimitReservationRequest{first}
		timer := time.NewTimer(rateLimitReservationBatchWait)
	collect:
		for len(batch) < rateLimitReservationBatchSize {
			select {
			case req := <-l.batchQueue:
				batch = append(batch, req)
			case <-timer.C:
				break collect
			}
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		l.executeReservationBatch(batch)

		l.batchMu.Lock()
		if len(l.batchQueue) == 0 {
			l.batchActive = false
			l.batchMu.Unlock()
			return
		}
		l.batchMu.Unlock()
	}
}

func (l *DBRateLimiter) executeReservationBatch(requests []*rateLimitReservationRequest) {
	active := make([]*rateLimitReservationRequest, 0, len(requests))
	for _, req := range requests {
		if err := req.ctx.Err(); err != nil {
			req.result <- rateLimitReservationResult{err: err}
			continue
		}
		active = append(active, req)
	}
	if len(active) == 0 {
		return
	}
	if len(active) == 1 {
		req := active[0]
		grant, err := l.reserveSingle(req.ctx, req.key, req.windowStart, req.expires, req.requested)
		req.result <- rateLimitReservationResult{grant: grant, err: err}
		return
	}

	ctx, cancel := rateLimitBatchContext(active)
	grants, err := l.reserveBatch(ctx, active)
	cancel()
	for _, req := range active {
		if requestErr := req.ctx.Err(); requestErr != nil {
			req.result <- rateLimitReservationResult{err: requestErr}
			continue
		}
		if err != nil {
			req.result <- rateLimitReservationResult{err: err}
			continue
		}
		req.result <- rateLimitReservationResult{grant: grants[req]}
	}
}

func rateLimitBatchContext(requests []*rateLimitReservationRequest) (context.Context, context.CancelFunc) {
	base := context.WithoutCancel(requests[0].ctx)
	// A caller's cancellation must not cancel reservations owned by other
	// requests in the same batch. Each caller still stops waiting independently;
	// a committed permit for a canceled caller is safely stranded.
	return context.WithTimeout(base, rateLimitReservationDBTimeout)
}

// reserveBatch reserves permits for distinct keys under row locks, then
// increments all granted counters in one transaction. The per-key lease mutex
// guarantees that one DBRateLimiter cannot enqueue the same key twice at once.
func (l *DBRateLimiter) reserveBatch(ctx context.Context, requests []*rateLimitReservationRequest) (map[*rateLimitReservationRequest]int, error) {
	ordered := append([]*rateLimitReservationRequest(nil), requests...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].windowStart != ordered[j].windowStart {
			return ordered[i].windowStart < ordered[j].windowStart
		}
		return ordered[i].key < ordered[j].key
	})

	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	grants := make(map[*rateLimitReservationRequest]int, len(ordered))
	for start := 0; start < len(ordered); {
		end := start + 1
		for end < len(ordered) && ordered[end].windowStart == ordered[start].windowStart {
			end++
		}
		group := ordered[start:end]
		for i := 1; i < len(group); i++ {
			if group[i-1].key == group[i].key {
				return nil, errors.New("duplicate rate-limit reservation key in batch")
			}
		}
		if err := l.reserveWindowBatch(ctx, tx, group, grants); err != nil {
			return nil, err
		}
		start = end
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return grants, nil
}

func (l *DBRateLimiter) reserveWindowBatch(ctx context.Context, tx *sql.Tx, requests []*rateLimitReservationRequest, grants map[*rateLimitReservationRequest]int) error {
	values := make([]string, len(requests))
	insertArgs := make([]any, 0, len(requests)*4)
	keys := make([]any, 0, len(requests))
	for i, req := range requests {
		values[i] = "(?, ?, ?, 0, ?)"
		insertArgs = append(insertArgs, l.routeKey, req.key, req.windowStart, req.expires)
		keys = append(keys, req.key)
	}
	insert := "INSERT INTO distributed_rate_limit_counters (route_key, bucket_key, window_start, request_count, expires_at) VALUES " + strings.Join(values, ",") + " ON DUPLICATE KEY UPDATE request_count = request_count"
	if _, err := tx.ExecContext(ctx, insert, insertArgs...); err != nil {
		return err
	}

	selectArgs := make([]any, 0, len(requests)+2)
	selectArgs = append(selectArgs, l.routeKey, requests[0].windowStart)
	selectArgs = append(selectArgs, keys...)
	selectQuery := "SELECT bucket_key, request_count FROM distributed_rate_limit_counters WHERE route_key = ? AND window_start = ? AND bucket_key IN (" + strings.TrimSuffix(strings.Repeat("?,", len(requests)), ",") + ") ORDER BY bucket_key FOR UPDATE"
	rows, err := tx.QueryContext(ctx, selectQuery, selectArgs...)
	if err != nil {
		return err
	}
	counts := make(map[string]int, len(requests))
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			_ = rows.Close()
			return err
		}
		counts[key] = count
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(counts) != len(requests) {
		return errors.New("rate-limit reservation row was not materialized")
	}

	granted := make([]*rateLimitReservationRequest, 0, len(requests))
	for _, req := range requests {
		remaining := l.maxRequests - counts[req.key]
		if remaining < 0 {
			remaining = 0
		}
		grant := req.requested
		if grant > remaining {
			grant = remaining
		}
		grants[req] = grant
		if grant > 0 {
			granted = append(granted, req)
		}
	}
	if len(granted) == 0 {
		return nil
	}

	parts := make([]string, len(granted))
	updateArgs := make([]any, 0, len(granted)*3+2)
	for i, req := range granted {
		if i == 0 {
			parts[i] = "SELECT ? AS bucket_key, ? AS permit_count, ? AS expires_at"
		} else {
			parts[i] = "SELECT ?, ?, ?"
		}
		updateArgs = append(updateArgs, req.key, grants[req], req.expires)
	}
	updateArgs = append(updateArgs, l.routeKey, requests[0].windowStart)
	update := "UPDATE distributed_rate_limit_counters AS counters JOIN (" + strings.Join(parts, " UNION ALL ") + ") AS grants ON grants.bucket_key = counters.bucket_key SET counters.request_count = counters.request_count + grants.permit_count, counters.expires_at = grants.expires_at WHERE counters.route_key = ? AND counters.window_start = ?"
	result, err := tx.ExecContext(ctx, update, updateArgs...)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != int64(len(granted)) {
		return errors.New("rate-limit reservation update changed an unexpected row count")
	}
	return nil
}

func (l *DBRateLimiter) reserveSingle(ctx context.Context, key, winStart, expires string, requested int) (int, error) {
	// Pin one pooled connection because LAST_INSERT_ID is connection-scoped.
	conn, err := l.db.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = conn.Close() }()
	// The insert and duplicate paths both return the number of newly reserved
	// permits through the connection-local LAST_INSERT_ID value.
	query := "INSERT INTO distributed_rate_limit_counters (route_key, bucket_key, window_start, request_count, expires_at) VALUES (?, ?, ?, LAST_INSERT_ID(?), ?) ON DUPLICATE KEY UPDATE request_count = request_count + LAST_INSERT_ID(LEAST(?, GREATEST(0, ? - request_count))), expires_at = VALUES(expires_at)"
	result, err := conn.ExecContext(ctx, query, l.routeKey, key, winStart, requested, expires, requested, l.maxRequests)
	if err != nil {
		return 0, err
	}
	grant, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	return int(grant), nil
}
