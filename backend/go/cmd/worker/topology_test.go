package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSingleContainerStartupModes(t *testing.T) {
	_, source, _, _ := runtime.Caller(0)
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(source), "../../../Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	dockerfile := string(raw)
	start := strings.Index(dockerfile, "#!/bin/bash\n")
	end := strings.Index(dockerfile[start:], "\nEOF") + start
	script := dockerfile[start:end]
	if strings.Contains(script, "--sat-timeouts-only") {
		t.Fatal("activity-driven mode must own every job inside the API")
	}
	exportAt := strings.Index(script, "export BACKGROUND_RUNTIME_MODE\n")
	if exportAt < 0 || exportAt > strings.Index(script, "/app/migrate\n") {
		t.Fatal("mode must be inherited by every process")
	}
	for _, mode := range []string{"activity-driven", "continuous"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			record := filepath.Join(dir, "calls")
			// Execute the actual entrypoint with local processes; no Docker daemon needed.
			for _, name := range []string{"migrate", "api", "worker", "node"} {
				child := "#!/bin/bash\necho '" + name + "'\" $BACKGROUND_RUNTIME_MODE\" >> '" + record + "'\n"
				if name != "migrate" {
					count := "3"
					if mode == "continuous" {
						count = "4"
					}
					child += "for i in {1..200}; do\n  if [ \"$(wc -l < '" + record + "')\" -ge " + count + " ]; then break; fi\n  sleep 0.02\ndone\nsleep 0.05\nexit 0\n"
				}
				if err := os.WriteFile(filepath.Join(dir, name), []byte(child), 0755); err != nil {
					t.Fatal(err)
				}
			}
			normalizer, err := os.ReadFile(filepath.Join(filepath.Dir(source), "../../../scripts/normalize-background-runtime-mode.sh"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "normalize-background-runtime-mode.sh"), normalizer, 0755); err != nil {
				t.Fatal(err)
			}
			local := strings.ReplaceAll(script, "/app/", dir+"/")
			local = strings.ReplaceAll(local, "/usr/local/bin/node", filepath.Join(dir, "node"))
			entry := filepath.Join(dir, "start.sh")
			if err := os.WriteFile(entry, []byte(local), 0755); err != nil {
				t.Fatal(err)
			}
			bash := "/bin/bash"
			if _, err := os.Stat("/opt/homebrew/bin/bash"); err == nil {
				bash = "/opt/homebrew/bin/bash"
			}
			if out, _ := exec.Command(bash, "-c", "help wait").Output(); !strings.Contains(string(out), "-n") {
				t.Skip("entrypoint needs Bash 4.3+")
			}
			cmd := exec.Command(bash, entry)
			cmd.Env = append(os.Environ(), "BACKGROUND_RUNTIME_MODE="+mode)
			if err := cmd.Run(); err == nil {
				t.Fatal("unexpected child exit must fail the container")
			}
			calls, err := os.ReadFile(record)
			if err != nil {
				t.Fatal(err)
			}
			canonical := strings.ReplaceAll(mode, "-", "_")
			for _, name := range []string{"migrate", "api", "node"} {
				if !strings.Contains(string(calls), name+" "+canonical) {
					t.Fatalf("missing %s with canonical mode: %s", name, calls)
				}
			}
			if strings.Contains(string(calls), "worker ") != (mode == "continuous") {
				t.Fatalf("wrong worker topology: %s", calls)
			}
		})
	}
}
