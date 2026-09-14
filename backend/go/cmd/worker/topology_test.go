package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDockerEntrypointKeepsActivityDrivenAPIOnly(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller did not return the test path")
	}
	dockerfile, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), "../../../Dockerfile"))
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	script := string(dockerfile)
	activity := strings.Index(script, `if [ "$BACKGROUND_RUNTIME_MODE" = "activity_driven" ]`)
	if activity < 0 {
		t.Fatal("Dockerfile entrypoint has no activity_driven branch")
	}
	worker := strings.Index(script[activity:], "/app/worker &")
	if worker < 0 {
		t.Fatal("Dockerfile entrypoint no longer starts the worker in continuous mode")
	}
	worker += activity
	if !strings.Contains(script[activity:worker], `wait "$API_PID"`) {
		t.Fatal("activity_driven branch must wait on the API without launching a worker")
	}
}
