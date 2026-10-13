package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// TC-19 over real processes: two separately started API binaries (own pools, own
// in-memory state) race opposite staff Module 2 choices for one attempt over HTTP.
// Only the MySQL row lock can pick the winner.
func TestSATClassroomStaffRouteAcrossAPIBinariesMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	t.Setenv("DATABASE_URL", os.Getenv("TEST_MYSQL_DSN"))
	t.Setenv("AUTH_SECRET", "test-secret-test-secret-test-secret-123456")
	t.Setenv("APP_ENV", "test")
	t.Setenv("ENVIRONMENT", "test")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("SESSION_COOKIE_NAME", "session")
	t.Setenv("CSRF_COOKIE_NAME", "csrf")
	t.Setenv("SAT_CLASSROOM_ENABLED", "true")
	cfg := config.Load()

	adminID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, email, display_name, role, state, organization_id, failed_login_count, created_at, updated_at)
		VALUES (?, ?, 'Binary Race Admin', 'admin', 'active', 'stale-etag-org', 0, NOW(), NOW())`, adminID, adminID+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at) VALUES (?, 'Binary Race Admin', ?, NOW(), NOW())`, adminID, adminID+"@example.test"); err != nil {
		t.Fatal(err)
	}
	_, sessionToken, csrf, err := auth.CreateSession(ctx, db, cfg, adminID, auth.RoleAdmin, auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	bin := filepath.Join(t.TempDir(), "api")
	build := exec.Command("go", "build", "-o", bin, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build api: %v\n%s", err, out)
	}
	const instances = 2
	bases := make([]string, instances)
	for i := range bases {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := ln.Addr().(*net.TCPAddr).Port
		ln.Close()
		var logs bytes.Buffer
		cmd := exec.Command(bin)
		cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", port), fmt.Sprintf("API_PORT=%d", port))
		cmd.Stdout, cmd.Stderr = &logs, &logs
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
			if t.Failed() {
				t.Logf("api instance log:\n%s", logs.String())
			}
		})
		bases[i] = fmt.Sprintf("http://127.0.0.1:%d", port)
		deadline := time.Now().Add(90 * time.Second)
		for {
			resp, err := http.Get(bases[i] + "/healthz")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					break
				}
			}
			if time.Now().After(deadline) {
				t.Fatalf("api instance %d never became healthy: %v\n%s", i, err, logs.String())
			}
			time.Sleep(200 * time.Millisecond)
		}
	}

	post := func(base, route string) (int, string) {
		body, _ := json.Marshal(map[string]string{"sectionKey": "reading-writing", "route": route})
		req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/v1/proctor/sessions/%s/attempts/%s/route", base, schedule, attempt), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Csrf-Token", csrf)
		req.AddCookie(&http.Cookie{Name: "session", Value: sessionToken})
		req.AddCookie(&http.Cookie{Name: "csrf", Value: csrf})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return 0, err.Error()
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	const callers = 12
	type outcome struct {
		route, body string
		status      int
	}
	start := make(chan struct{})
	out := make(chan outcome, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		route := "lower"
		if i%2 == 1 {
			route = "higher"
		}
		base := bases[i%instances]
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			status, body := post(base, route)
			out <- outcome{route, body, status}
		}()
	}
	close(start)
	wg.Wait()
	close(out)
	ok, conflicts := map[string]int{}, 0
	for o := range out {
		switch o.status {
		case 200:
			ok[o.route]++
		case 409:
			conflicts++
		default:
			t.Fatalf("unexpected %d for %s: %s", o.status, o.route, o.body)
		}
	}
	t.Logf("ok=%v conflicts=%d", ok, conflicts)
	if len(ok) != 1 {
		t.Fatalf("both routes succeeded across instances: %v", ok)
	}
	var decisions, branches int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base).Scan(&branches); err != nil {
		t.Fatal(err)
	}
	if decisions != 1 || branches != 1 {
		t.Fatalf("decisions=%d branches=%d, want 1/1 (ok=%v conflicts=%d)", decisions, branches, ok, conflicts)
	}
}
