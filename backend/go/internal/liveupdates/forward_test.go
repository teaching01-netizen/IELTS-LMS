package liveupdates

import (
	"testing"
)

// Subscription authorization matrix (plan 131: websocket subscription
// authorization; DoD websocket lease leg). ShouldForward is pure, so the
// full role x kind x scope matrix pins here without a database; cap
// enforcement stays in the DB-backed LeaseRepository suite.
func TestShouldForwardMatrix(t *testing.T) {
	allowed := map[string]struct{}{"sched-1": {}}
	rt := Event{Kind: KindScheduleRuntime, ID: "sched-1"}
	roster := Event{Kind: KindScheduleRoster, ID: "sched-1"}
	alert := Event{Kind: KindScheduleAlert, ID: "sched-1"}
	other := Event{Kind: KindScheduleRuntime, ID: "sched-2"}
	att := Event{Kind: KindAttempt, ID: "att-1"}
	unknown := Event{Kind: "mystery", ID: "sched-1"}

	cases := []struct {
		name                        string
		e                           Event
		role, scheduleID, attemptID string
		allow                       map[string]struct{}
		want                        bool
	}{
		{"student gets own schedule runtime", rt, RoleStudent, "sched-1", "", allowed, true},
		{"student denied other schedule runtime", other, RoleStudent, "sched-1", "", allowed, false},
		{"student denied roster frames", roster, RoleStudent, "sched-1", "", allowed, false},
		{"student denied alert frames", alert, RoleStudent, "sched-1", "", allowed, false},
		{"student gets own attempt events", att, RoleStudent, "", "att-1", allowed, true},
		{"student denied other attempt events", att, RoleStudent, "", "att-9", allowed, false},
		{"student denied unknown kinds", unknown, RoleStudent, "sched-1", "att-1", allowed, false},
		{"staff gets allowed schedule runtime", rt, "proctor", "sched-1", "", allowed, true},
		{"staff gets allowed roster", roster, "proctor", "", "", allowed, true},
		{"staff gets allowed alerts", alert, "admin", "", "", allowed, true},
		{"staff denied unallowed schedule", other, "proctor", "", "", allowed, false},
		{"lone attempt sub gets no schedule broadcasts", rt, "proctor", "", "att-1", allowed, false},
		{"staff gets exact attempt events", att, "proctor", "", "att-1", allowed, true},
		{"staff denied other attempt events", att, "proctor", "", "att-9", allowed, false},
		{"staff denied unknown kinds", unknown, "proctor", "sched-1", "", allowed, false},
	}
	for _, c := range cases {
		if got := ShouldForward(c.e, c.role, c.scheduleID, c.attemptID, c.allow); got != c.want {
			t.Fatalf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
