package main

import "testing"

// Under the single-writer policy the owner's client session id is the writer
// capability; a student projection may echo it only to that same session.
func TestRedactWriterIdentityWithholdsOtherSessions(t *testing.T) {
	projection := func() map[string]any {
		return map[string]any{
			"activeClientSessionId": "owner-session",
			"integrity":             map[string]any{"clientSessionId": "owner-session", "lastHeartbeatAt": "t"},
			"recovery":              map[string]any{"clientSessionId": "owner-session", "syncState": "idle"},
		}
	}

	for _, caller := range []string{"", "other-session"} {
		p := projection()
		redactWriterIdentity(p, caller)
		if _, ok := p["activeClientSessionId"]; ok {
			t.Fatalf("caller %q must not see the owner session id", caller)
		}
		for _, key := range []string{"integrity", "recovery"} {
			obj := p[key].(map[string]any)
			if obj["clientSessionId"] != nil {
				t.Fatalf("caller %q must not see %s.clientSessionId", caller, key)
			}
		}
		if p["integrity"].(map[string]any)["lastHeartbeatAt"] != "t" || p["recovery"].(map[string]any)["syncState"] != "idle" {
			t.Fatalf("redaction must keep non-identity fields for caller %q", caller)
		}
	}

	p := projection()
	redactWriterIdentity(p, "owner-session")
	if p["activeClientSessionId"] != "owner-session" || p["recovery"].(map[string]any)["clientSessionId"] != "owner-session" {
		t.Fatal("the owner session keeps its own identity")
	}
}
