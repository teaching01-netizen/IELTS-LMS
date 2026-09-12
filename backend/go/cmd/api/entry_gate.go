package main

import (
	"context"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/schedules"
)

// fastPathAttempt resolves a pre-provisioned (or already-minted) attempt via
// one unlocked SELECT (plan D3). Non-nil = skip the mint tx. Nil = miss,
// caller mints. Errors fail closed to mint (never refuse entry on lookup
// trouble) — except nil-Schedules which cannot mint either (fail closed
// with nil,nil and let the mint path surface the outage... actually the
// mint would nil-panic; guard explicitly: return an error here).
func (a *App) fastPathAttempt(ctx context.Context, scheduleID, registrationID string) (*schedules.AttemptRef, error) {
	if a.Schedules == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Entry service is unavailable.")
	}
	ref, found, err := a.Schedules.LookupAttemptByRegistration(ctx, scheduleID, registrationID)
	return fastPathResolve(ref, found, err)
}

// fastPathResolve is the D3 fail-open decision (pure, unit-pinned): lookup
// trouble or a miss returns (nil,nil) so the caller runs the mint tx
// (registration lock + replay stays the correctness backstop). Only a hit
// returns a ref. Lookup errors must NEVER refuse entry with a 503.
func fastPathResolve(ref schedules.AttemptRef, found bool, err error) (*schedules.AttemptRef, error) {
	if err != nil {
		return nil, nil
	}
	if !found {
		return nil, nil
	}
	return &ref, nil
}

// entryGateConfig tunes the plan-D3 per-schedule check-in bucket: sustained
// PerSec admissions with Burst absorbency. Non-positive values fall back to
// the plan defaults (500/s, burst 2000) — never unbounded, never deny-all.
type entryGateConfig struct {
	PerSec float64
	Burst  float64
}

const (
	defaultEntryPerSec = 500
	defaultEntryBurst  = 2000
)

func (c entryGateConfig) normalized() entryGateConfig {
	if c.PerSec <= 0 {
		c.PerSec = defaultEntryPerSec
	}
	if c.Burst <= 0 {
		c.Burst = defaultEntryBurst
	}
	return c
}

// entryGateResult is the check-in verdict: Allowed, or 429 with an honest
// RetryAfterSecs (deficit / rate, rounded up) + QueuePosition (waiting
// deficit, so clients render a queue instead of an outage).
type entryGateResult struct {
	Allowed        bool
	RetryAfterSecs int64
	QueuePosition  int64
}

type entryBucket struct {
	tokens  float64
	at      time.Time
	waiting int64
}

// entryGate is the in-process per-schedule token bucket (plan D3). One
// mutex guards all buckets; ops are O(1). Memory is bounded by distinct
// schedule IDs seen (exam-day cardinality: hundreds, not millions).
type entryGate struct {
	cfg     entryGateConfig
	mu      sync.Mutex
	buckets map[string]*entryBucket
}

func newEntryGate(cfg entryGateConfig) *entryGate {
	return &entryGate{cfg: cfg.normalized(), buckets: map[string]*entryBucket{}}
}

func (g *entryGate) Allow(scheduleID string, now time.Time) entryGateResult {
	g.mu.Lock()
	defer g.mu.Unlock()
	b, ok := g.buckets[scheduleID]
	if !ok {
		b = &entryBucket{tokens: g.cfg.Burst, at: now}
		g.buckets[scheduleID] = b
	}
	elapsed := now.Sub(b.at).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * g.cfg.PerSec
		if b.tokens > g.cfg.Burst {
			b.tokens = g.cfg.Burst
		}
		b.at = now
	}
	if b.tokens >= 1 {
		b.tokens--
		if b.waiting > 0 {
			b.waiting--
		}
		telemetry.IncCounter(telemetry.MEntryGateAdmit)
		return entryGateResult{Allowed: true}
	}
	b.waiting++
	deficit := 1 - b.tokens
	retrySecs := int64(deficit / g.cfg.PerSec)
	if float64(retrySecs)*g.cfg.PerSec < deficit {
		retrySecs++
	}
	if retrySecs < 1 {
		retrySecs = 1
	}
	telemetry.IncCounter(telemetry.MEntryGateQueued)
	return entryGateResult{Allowed: false, RetryAfterSecs: retrySecs, QueuePosition: b.waiting}
}
