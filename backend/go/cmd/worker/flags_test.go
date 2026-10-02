package main

import "testing"

func TestSATTimeoutOnlyWorkerModeFlag(t *testing.T) {
	if !satTimeoutsOnlyRequested([]string{"--sat-timeouts-only"}) {
		t.Fatal("activity-driven timeout worker flag was not recognized")
	}
	if satTimeoutsOnlyRequested([]string{"requeue-dead-letter", "--id", "dead-letter"}) {
		t.Fatal("operator requeue command must not select timeout-only mode")
	}
}

func TestRequeueFlagParsing(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"long id", []string{"requeue-dead-letter", "--id", "dlq-1"}, "dlq-1"},
		{"equals", []string{"requeue-dead-letter", "--id=dlq-2"}, "dlq-2"},
		{"alias", []string{"requeue", "--requeue", "dlq-3"}, "dlq-3"},
		{"alias equals", []string{"requeue", "--requeue=dlq-4"}, "dlq-4"},
		{"positional", []string{"requeue-dead-letter", "dlq-5"}, "dlq-5"},
		{"no command", []string{}, ""},
		{"other args", []string{"--verbose"}, ""},
		{"missing value", []string{"requeue-dead-letter"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := requeueDeadLetterID(tc.args); got != tc.want {
				t.Fatalf("requeueDeadLetterID(%v) = %q, want %q", tc.args, got, tc.want)
			}
		})
	}
}
