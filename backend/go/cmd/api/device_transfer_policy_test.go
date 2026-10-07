package main

import "testing"

func TestSingleWriterScheduleCanary(t *testing.T) {
	app := &App{}
	app.Config.SATSingleWriter = true
	app.Config.SATSingleWriterScheduleIDs = " practice-a, practice-b "
	if !singleWriterEnabledForSchedule(app, "practice-a") || !singleWriterEnabledForSchedule(app, "practice-b") {
		t.Fatal("selected practice schedules must admit under single-writer policy")
	}
	if singleWriterEnabledForSchedule(app, "live-room") || singleWriterEnabledForSchedule(app, "practice") {
		t.Fatal("unselected schedules and partial ID matches must not acquire policy")
	}
	app.Config.SATSingleWriter = false
	if singleWriterEnabledForSchedule(app, "practice-a") {
		t.Fatal("rollback switch must override schedule selection for new claims")
	}
}
