// Package shutdown coordinates graceful termination (plan 73): stop
// accepting HTTP, stop websocket upgrades, cancel background loops, drain
// in-flight work bounded, release leases, close clients, close pool.
package shutdown

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Wait blocks until SIGINT/SIGTERM or ctx cancellation.
func Wait(ctx context.Context) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-ctx.Done():
	case <-sig:
	}
	signal.Stop(sig)
}

// DrainTimeout bounds in-flight request draining.
const DrainTimeout = 30 * time.Second
