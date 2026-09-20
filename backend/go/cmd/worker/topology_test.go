package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDockerEntrypointKeepsActivityDrivenWorkerless(t *testing.T) {
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
	coedit := strings.Index(script, "/usr/local/bin/bun run /app/services/authoring-coedit/src/main.ts &")
	if coedit < 0 {
		// The co-edit runtime moved to the Node/tsx runner because its
		// Hocuspocus Node adapter rejects Bun. Keep the topology guard
		// compatible with both supported image generations.
		coedit = strings.Index(script, "/usr/local/bin/node /app/node_modules/tsx/dist/cli.mjs /app/services/authoring-coedit/src/main.ts &")
	}
	if coedit < 0 {
		t.Fatal("Dockerfile entrypoint must start embedded SAT co-editing")
	}
	worker := strings.Index(script[activity:], "/app/worker &")
	if worker < 0 {
		t.Fatal("Dockerfile entrypoint no longer starts the worker in continuous mode")
	}
	worker += activity
	if strings.Contains(script[activity:worker], "/app/worker &") {
		t.Fatal("activity_driven branch must not launch a worker")
	}
	if !strings.Contains(script[activity:worker], `wait -n "$API_PID" "$COEDIT_PID"`) {
		t.Fatal("activity_driven branch must supervise API and embedded co-editing")
	}
}
