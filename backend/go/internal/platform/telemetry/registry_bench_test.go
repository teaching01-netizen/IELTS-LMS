package telemetry

import (
	"strconv"
	"testing"
)

// BenchmarkObserveSecondsParallel is the hot-path cost of one duration
// observation (every SQL statement and transaction records one), with the
// label shape the instrumented driver uses.
func BenchmarkObserveSecondsParallel(b *testing.B) {
	r := NewRegistry()
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			r.ObserveSeconds(MQueryDur, float64(i%200)/1000, "operation", "query", "outcome", "ok")
			i++
		}
	})
}

// BenchmarkObserveSecondsWithScrape adds a concurrent /metrics scrape every
// 1,000 observations so lock hold time during exposition is visible.
func BenchmarkObserveSecondsWithScrape(b *testing.B) {
	r := NewRegistry()
	for i := 0; i < 20; i++ {
		r.ObserveSeconds(MQueryDur, 0.01, "operation", "op"+strconv.Itoa(i), "outcome", "ok")
	}
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			if i%1000 == 999 {
				_ = r.Snapshot()
			} else {
				r.ObserveSeconds(MQueryDur, float64(i%200)/1000, "operation", "query", "outcome", "ok")
			}
			i++
		}
	})
}
