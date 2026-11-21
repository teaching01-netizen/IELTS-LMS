package satlearning

import "testing"

func TestDiffPolicyOnlyNamesChangedRoomFields(t *testing.T) {
	before := DefaultPolicy()
	after := DefaultPolicy()
	after.UnlimitedRetakes = true
	after.PauseOnLeave = true
	after.Study.RequiredCompletions = 3

	change := DiffPolicy(before, after)
	if !change.UnlimitedRetakes || !change.PauseOnLeave {
		t.Fatalf("change = %+v, want retakes and pause", change)
	}
	if change.ReportVisible || change.IncludeAnswerKeyInPdf {
		t.Fatalf("change leaked an untouched room field: %+v", change)
	}
	if DiffPolicy(before, before).Any() {
		t.Fatal("identical policies must produce a no-op")
	}
}

func TestApplyPolicyChangePreservesRoomLocalFields(t *testing.T) {
	room := DefaultPolicy()
	room.Revision = 7
	room.ReportVisible = false
	room.UnlimitedRetakes = true

	defaults := DefaultPolicy()
	defaults.ReportVisible = true
	defaults.PauseOnLeave = true

	next := ApplyPolicyChange(room, defaults, PolicyChange{ReportVisible: true, PauseOnLeave: true})
	if next.Revision != 7 {
		t.Fatalf("revision = %d, want the room's own token preserved", next.Revision)
	}
	if !next.ReportVisible || !next.PauseOnLeave {
		t.Fatalf("changed fields not applied: %+v", next)
	}
	if !next.UnlimitedRetakes {
		t.Fatalf("unchanged room-local retakes was overwritten: %+v", next)
	}
}

func TestApplyPolicyChangeHidingResultsClearsKey(t *testing.T) {
	room := DefaultPolicy()
	room.ReportVisible = true
	room.IncludeAnswerKeyInPdf = true

	defaults := DefaultPolicy()
	defaults.ReportVisible = false

	next := ApplyPolicyChange(room, defaults, PolicyChange{ReportVisible: true})
	if next.ReportVisible || next.IncludeAnswerKeyInPdf {
		t.Fatalf("hidden results must clear the key: %+v", next)
	}
}

func TestApplyPolicyChangeKeyOnlyKeepsRoomHiddenResults(t *testing.T) {
	room := DefaultPolicy()
	room.ReportVisible = false
	room.IncludeAnswerKeyInPdf = false

	defaults := DefaultPolicy()
	defaults.ReportVisible = true
	defaults.IncludeAnswerKeyInPdf = true

	next := ApplyPolicyChange(room, defaults, PolicyChange{IncludeAnswerKeyInPdf: true})
	if next.ReportVisible {
		t.Fatalf("key-only change revealed the room's hidden results: %+v", next)
	}
	if next.IncludeAnswerKeyInPdf {
		t.Fatalf("key must stay off behind hidden results: %+v", next)
	}
}
