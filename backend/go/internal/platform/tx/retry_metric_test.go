package tx

// Plan E3: retried transients must be OBSERVABLE. db_deadlocks_total today
// counts only surfaces that emit it (none on the hot path) — a wave that
// deadlocks 500x and retries clean would look identical to a wave with
// zero contention. The retry loop reports each retried transient through
// an injectable package hook (nil = silent, zero behavior change);
// services wire it to telemetry. RED: hook must fire once per retry.
import (
	"github.com/go-sql-driver/mysql"
	"sync/atomic"
	"testing"
)

func TestRetryReportsTransientThroughHook(t *testing.T) {
	var hooks int64
	defer SetRetryHook(nil)()
	SetRetryHook(func(err error) { atomic.AddInt64(&hooks, 1) })
	deadlock := &mysql.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock"}
	if !transient(deadlock) {
		t.Fatalf("classifier must recognize InnoDB deadlock")
	}
	noteRetry(deadlock)
	if got := atomic.LoadInt64(&hooks); got != 1 {
		t.Fatalf("retry hook must fire once, fired %d", got)
	}
	noteRetry(nil)
	if got := atomic.LoadInt64(&hooks); got != 1 {
		t.Fatalf("nil error must not fire hook, fired %d", got)
	}
}
