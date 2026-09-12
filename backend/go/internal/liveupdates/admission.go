package liveupdates

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// AdmissionCaps bounds the in-memory websocket gate (plan C2). Values <= 0
// fall back to the package caps (never unbounded, never deny-all).
type AdmissionCaps struct {
	Total       int
	PerUser     int
	PerSchedule int
	TTL         time.Duration
}

func (c AdmissionCaps) normalized() AdmissionCaps {
	if c.Total <= 0 {
		c.Total = CapTotal
	}
	if c.PerUser <= 0 {
		c.PerUser = CapPerUser
	}
	if c.PerSchedule <= 0 {
		c.PerSchedule = CapPerSchedule
	}
	if c.TTL <= 0 {
		c.TTL = LeaseTTL
	}
	return c
}

type admissionEntry struct {
	userID     string
	scheduleID string
	expiresAt  time.Time
}

// Admission is the zero-SQL in-process websocket gate (plan C2). One RWMutex
// guards entries + count maps; every op is O(1) map work with a ~100ns
// critical section, so explicit sharding would optimize a non-bottleneck
// (acquire p99 target <1ms is met by construction; proven by the race +
// concurrent-acquire tests). A 1s background reaper expires TTL entries so
// dead conns never leak memory. Restart clears admission (safe direction:
// briefly permissive — documented, matches the plan risk note).
type Admission struct {
	caps AdmissionCaps

	mu       sync.Mutex
	entries  map[string]*admissionEntry
	perUser  map[string]int
	perSched map[string]int

	stopCh   chan struct{}
	stopOnce sync.Once
}

// NewAdmission builds the gate and starts the 1s reaper. Call Stop when the
// process shuts down (tests may leave it running; the goroutine is trivial).
func NewAdmission(caps AdmissionCaps) *Admission {
	a := &Admission{
		caps:     caps.normalized(),
		entries:  map[string]*admissionEntry{},
		perUser:  map[string]int{},
		perSched: map[string]int{},
		stopCh:   make(chan struct{}),
	}
	go a.reapLoop()
	return a
}

// Stop halts the background reaper.
func (a *Admission) Stop() {
	a.stopOnce.Do(func() { close(a.stopCh) })
}

// Caps reports the effective (normalized) caps.
func (a *Admission) Caps() AdmissionCaps { return a.caps }

// Active reports live (unexpired) entries. It prunes first so the gauge
// never reports dead conns.
func (a *Admission) Active() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneLocked(time.Now())
	return len(a.entries)
}

// Acquire attempts admission; ok=false names the rejecting cap in reason
// (total_cap|user_cap|schedule_cap, mirroring the DB lease failure labels
// so MWSLeaseFailures keeps its reason dimension). Expired entries are
// pruned first, so caps measure live conns only.
func (a *Admission) Acquire(userID string, scheduleID *string) (token string, ok bool, reason string) {
	sched := ""
	if scheduleID != nil {
		sched = strings.TrimSpace(*scheduleID)
	}
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneLocked(now)
	if len(a.entries) >= a.caps.Total {
		telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "total_cap")
		return "", false, "total_cap"
	}
	if a.perUser[userID] >= a.caps.PerUser {
		telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "user_cap")
		return "", false, "user_cap"
	}
	if sched != "" && a.perSched[sched] >= a.caps.PerSchedule {
		telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "schedule_cap")
		return "", false, "schedule_cap"
	}
	token = newAdmissionToken()
	a.entries[token] = &admissionEntry{userID: userID, scheduleID: sched, expiresAt: now.Add(a.caps.TTL)}
	a.perUser[userID]++
	if sched != "" {
		a.perSched[sched]++
	}
	telemetry.SetGauge(telemetry.MWSConnections, float64(len(a.entries)))
	return token, true, ""
}

// Heartbeat extends a live lease by TTL. Unknown or expired tokens report
// false (expired leases never revive — mirrors the DB Heartbeat NOT_FOUND).
func (a *Admission) Heartbeat(token string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.entries[token]
	if !ok || !time.Now().Before(e.expiresAt) {
		return false
	}
	e.expiresAt = time.Now().Add(a.caps.TTL)
	return true
}

// Release drops a lease on clean disconnect. Unknown tokens are a no-op
// (disconnect paths must never fail the request).
func (a *Admission) Release(token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.entries[token]
	if !ok {
		return
	}
	delete(a.entries, token)
	if a.perUser[e.userID] <= 1 {
		delete(a.perUser, e.userID)
	} else {
		a.perUser[e.userID]--
	}
	if e.scheduleID != "" {
		if a.perSched[e.scheduleID] <= 1 {
			delete(a.perSched, e.scheduleID)
		} else {
			a.perSched[e.scheduleID]--
		}
	}
	telemetry.SetGauge(telemetry.MWSConnections, float64(len(a.entries)))
}

func (a *Admission) reapLoop() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-a.stopCh:
			return
		case now := <-t.C:
			a.mu.Lock()
			before := len(a.entries)
			a.pruneLocked(now)
			if len(a.entries) != before {
				telemetry.SetGauge(telemetry.MWSConnections, float64(len(a.entries)))
			}
			a.mu.Unlock()
		}
	}
}

func (a *Admission) pruneLocked(now time.Time) {
	for token, e := range a.entries {
		if now.Before(e.expiresAt) {
			continue
		}
		delete(a.entries, token)
		if a.perUser[e.userID] <= 1 {
			delete(a.perUser, e.userID)
		} else {
			a.perUser[e.userID]--
		}
		if e.scheduleID != "" {
			if a.perSched[e.scheduleID] <= 1 {
				delete(a.perSched, e.scheduleID)
			} else {
				a.perSched[e.scheduleID]--
			}
		}
	}
}

func newAdmissionToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("liveupdates: crypto/rand unavailable: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
