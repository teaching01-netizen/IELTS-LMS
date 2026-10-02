package background

import (
	"context"
	"log"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// LifecycleHooks run serially. Drain stops recurring jobs and joins their
// current work; Park releases resources only after the final activity check.
type LifecycleHooks struct {
	Resume func(context.Context) error
	Drain  func(context.Context) error
	Park   func() error
	Stop   func()
}

// Lifecycle is the process-local owner of activity-driven background work.
// Idle has no timer: application requests wake it through a local signal.
type Lifecycle struct {
	mu          sync.Mutex
	ctx         context.Context
	cancel      context.CancelFunc
	done        chan struct{}
	wake        chan struct{}
	changed     chan struct{}
	hooks       LifecycleHooks
	grace       time.Duration
	state       string
	inFlight    int
	generation  uint64
	nextDrain   time.Time
	wantActive  bool
	activateErr error
	drainCancel context.CancelFunc
}

func NewLifecycle(parent context.Context, grace time.Duration, hooks LifecycleHooks) *Lifecycle {
	if grace <= 0 {
		grace = time.Minute
	}
	ctx, cancel := context.WithCancel(parent)
	l := &Lifecycle{ctx: ctx, cancel: cancel, done: make(chan struct{}), wake: make(chan struct{}, 1),
		changed: make(chan struct{}), hooks: hooks, grace: grace, state: "draining",
		nextDrain: time.Now().Add(grace)}
	go l.run()
	return l
}

// Reserve is acquired before any application database work and retained until
// the HTTP request or upgraded socket ends. Activation is owned by run(), so
// simultaneous callers join one resume operation.
func (l *Lifecycle) Reserve(ctx context.Context) (func(), error) {
	l.mu.Lock()
	l.inFlight++
	l.generation++
	l.nextDrain = time.Now().Add(l.grace)
	l.wantActive = true
	l.activateErr = nil
	if l.drainCancel != nil {
		l.drainCancel()
	}
	l.signalLocked()
	l.mu.Unlock()
	release := l.releaseOnce(true)
	for {
		l.mu.Lock()
		state, err, changed := l.state, l.activateErr, l.changed
		l.mu.Unlock()
		if l.ctx.Err() != nil {
			release()
			return nil, l.ctx.Err()
		}
		if err != nil {
			release()
			return nil, err
		}
		if state == "active" {
			return release, nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			release()
			return nil, ctx.Err()
		case <-l.ctx.Done():
			release()
			return nil, l.ctx.Err()
		}
	}
}

// Track protects internal work and dependency probes without extending the
// inactivity window or restarting jobs. It must not wait for activation,
// because a co-edit drain may call the internal persistence API.
func (l *Lifecycle) Track() func() {
	l.mu.Lock()
	l.inFlight++
	l.generation++
	if l.drainCancel != nil {
		l.drainCancel()
	}
	l.signalLocked()
	l.mu.Unlock()
	return l.releaseOnce(false)
}

func (l *Lifecycle) releaseOnce(touch bool) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			l.inFlight--
			l.generation++
			if touch {
				l.nextDrain = time.Now().Add(l.grace)
			}
			l.signalLocked()
			l.mu.Unlock()
		})
	}
}

func (l *Lifecycle) State() string { l.mu.Lock(); defer l.mu.Unlock(); return l.state }

func (l *Lifecycle) Close() { l.cancel(); <-l.done }

func (l *Lifecycle) signalLocked() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

func (l *Lifecycle) changeLocked(state string) {
	l.state = state
	for _, value := range []string{"active", "draining", "idle"} {
		current := float64(0)
		if value == state {
			current = 1
		}
		telemetry.SetGauge("background_runtime_state", current, "state", value)
	}
	close(l.changed)
	l.changed = make(chan struct{})
}

func (l *Lifecycle) resume() {
	var err error
	if l.hooks.Resume != nil {
		err = l.hooks.Resume(l.ctx)
	}
	l.mu.Lock()
	l.wantActive = false
	l.activateErr = err
	if err == nil {
		l.changeLocked("active")
	} else {
		l.changeLocked("idle")
	}
	l.mu.Unlock()
	if err == nil {
		log.Printf("background: state=active")
	} else {
		log.Printf("background: activation failed: %v", err)
	}
}

func (l *Lifecycle) run() {
	defer close(l.done)
	defer func() {
		if l.hooks.Stop != nil {
			l.hooks.Stop()
		}
		l.mu.Lock()
		l.changeLocked("idle")
		l.mu.Unlock()
	}()
	l.resume()
	for l.ctx.Err() == nil {
		l.mu.Lock()
		state, wanted, busy, at := l.state, l.wantActive, l.inFlight > 0, l.nextDrain
		l.mu.Unlock()
		if state == "idle" && wanted {
			l.resume()
			continue
		}
		if state == "active" && !busy && !time.Now().Before(at) {
			l.tryIdle()
			continue
		}
		var timer *time.Timer
		var tick <-chan time.Time
		if state == "active" && !busy {
			timer = time.NewTimer(time.Until(at))
			tick = timer.C
		}
		select {
		case <-l.ctx.Done():
		case <-l.wake:
		case <-tick:
		}
		if timer != nil {
			timer.Stop()
		}
	}
}

func (l *Lifecycle) tryIdle() {
	l.mu.Lock()
	if l.inFlight != 0 || time.Now().Before(l.nextDrain) {
		l.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(l.ctx, time.Minute)
	l.drainCancel = cancel
	generation := l.generation
	l.changeLocked("draining")
	l.mu.Unlock()
	log.Printf("background: state=draining")
	var err error
	if l.hooks.Drain != nil {
		err = l.hooks.Drain(ctx)
	}
	l.mu.Lock()
	if err == nil {
		err = ctx.Err()
	}
	unchanged := l.inFlight == 0 && l.generation == generation
	if err == nil && unchanged && l.hooks.Park != nil {
		err = l.hooks.Park()
	}
	l.drainCancel = nil
	cancel()
	blocked := err != nil || !unchanged
	if blocked {
		l.changeLocked("draining")
	} else {
		l.changeLocked("idle")
	}
	l.nextDrain = time.Now().Add(l.grace)
	l.wantActive = blocked
	l.mu.Unlock()
	if err != nil {
		telemetry.IncCounter("background_idle_blocked_total")
		log.Printf("background: idle blocked: %v", err)
	} else if !unchanged {
		log.Printf("background: idle cancelled by activity")
	} else {
		log.Printf("background: state=idle")
	}
	if blocked && l.ctx.Err() == nil {
		l.resume()
	}
}
