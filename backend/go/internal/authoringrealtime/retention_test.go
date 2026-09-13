package authoringrealtime

import (
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/maintenance"
)

// The retention window is asserted against the live-bus window on purpose: the
// purge that actually runs is the live-bus one (authoring rows share
// live_update_events), so if these two ever diverge, the documented authoring
// window would be a lie while the real purge used something else.
func TestAuthoringRetentionWindowMatchesLiveBusWindow(t *testing.T) {
	if AuthoringRetentionHours != maintenance.LiveEventRetentionHours {
		t.Fatalf(
			"authoring retention %dh does not match the live-bus purge window %dh: the wired purge would not deliver the documented promise",
			AuthoringRetentionHours, maintenance.LiveEventRetentionHours,
		)
	}
	if AuthoringRetentionHours <= 0 {
		t.Fatalf("retention window must be positive, got %d", AuthoringRetentionHours)
	}
}

func TestAuthoringRetentionBatchIsBounded(t *testing.T) {
	if AuthoringRetentionBatch <= 0 {
		t.Fatalf("batch must be positive, got %d", AuthoringRetentionBatch)
	}
	// A purge pass must never be able to delete an unbounded slice of the table
	// in one statement, and it must stay within the same order of magnitude as
	// the other retention batches so the worker cycle stays predictable.
	if AuthoringRetentionBatch > 10000 {
		t.Fatalf("batch %d is too large for one bounded pass", AuthoringRetentionBatch)
	}
}

// Every domain kind in the frozen vocabulary must be enumerable as an
// event_name. Derived from KnownKinds, so a kind added later cannot be
// forgotten by a future authoring-scoped query.
func TestAuthoringEventNamesCoversEveryKnownKind(t *testing.T) {
	names := AuthoringEventNames()
	if len(names) != len(KnownKinds) {
		t.Fatalf("event_name list has %d kinds, vocabulary has %d", len(names), len(KnownKinds))
	}
	seen := map[Kind]bool{}
	for _, name := range names {
		if !IsKnownKind(name) {
			t.Fatalf("event_name list contains non-vocabulary kind %q", name)
		}
		if seen[name] {
			t.Fatalf("event_name list lists %q twice", name)
		}
		seen[name] = true
	}
	for kind := range KnownKinds {
		if !seen[kind] {
			t.Fatalf("kind %q is not enumerable as an event_name", kind)
		}
	}
}

// The scoped statement is the documented fallback for the day authoring rows
// need a different window or their own table. It must stay bounded,
// oldest-first, and windowed.
func TestPurgeStatementIsBoundedOldestFirstAndWindowed(t *testing.T) {
	compact := strings.Join(strings.Fields(PurgeAuthoringEventsSQL), " ")
	for _, want := range []string{
		"DELETE FROM live_update_events",
		"created_at <",
		"ORDER BY sequence_id ASC",
		"LIMIT ?",
	} {
		if !strings.Contains(compact, want) {
			t.Fatalf("purge statement is missing %q: %s", want, compact)
		}
	}
	if strings.Contains(strings.ToUpper(compact), "ORDER BY SEQUENCE_ID DESC") {
		t.Fatalf("purge must be oldest-first: %s", compact)
	}
}

// The correctness test for the column semantics. live_update_events carries TWO
// kind columns: event_kind is the bus family ('authoring') and event_name is the
// domain kind ('question.changed'). Scoping the purge on domain kinds against
// event_kind would match ZERO rows — a purge that never purges while reading as
// entirely plausible. This test is what makes that mistake impossible to land.
func TestPurgeScopesOnTheBusKindColumnNotDomainKinds(t *testing.T) {
	compact := strings.Join(strings.Fields(PurgeAuthoringEventsSQL), " ")

	if !strings.Contains(compact, "event_kind = '"+BusEventKindColumn+"'") {
		t.Fatalf("purge must scope on event_kind = %q: %s", BusEventKindColumn, compact)
	}

	// No DOMAIN kind may appear as a predicate against event_kind. (They are
	// valid event_name values, and never belong in this clause.)
	for _, name := range AuthoringEventNames() {
		if strings.Contains(compact, "event_kind = '"+string(name)+"'") {
			t.Fatalf("domain kind %q must never be compared against event_kind", name)
		}
		if strings.Contains(compact, "event_kind IN") {
			t.Fatalf("the purge must not use an event_kind IN list of domain kinds: %s", compact)
		}
	}

	// The bus-family constant itself must be the value the append path writes.
	if BusEventKindColumn != BusEventKind {
		t.Fatalf("retention scopes on %q but the append path writes %q", BusEventKindColumn, BusEventKind)
	}
}

// A cursor below the global retention watermark must recover via RESYNC labelled
// cursor_expired, not by replaying whatever happens to be left. replay.go owns
// that decision; this asserts the wire reason maps to a listed metric reason.
func TestCursorTooOldMapsToCursorExpiredResync(t *testing.T) {
	mapped := ResyncReasonFor(ReasonCursorTooOld)
	if mapped != ResyncCursorExpired {
		t.Fatalf("cursor_too_old mapped to %q, want %q", mapped, ResyncCursorExpired)
	}
	if !resyncReasons[string(mapped)] {
		t.Fatalf("cursor_expired %q is not in the closed set", mapped)
	}
}
