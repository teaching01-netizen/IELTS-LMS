package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/google/uuid"
)

// A separate OS process has its own session resolver and cache. Both APIs
// deliberately share only MySQL, exactly as a primary-routed deployment does.
func TestPersistentLoginAPIProcess(t *testing.T) {
	if os.Getenv("PERSISTENT_LOGIN_API_CHILD") != "1" {
		return
	}
	db := staleETagTestDB(t)
	cfg := config.Load()
	cfg.Environment = "test"
	cfg.CookieSecure = false
	cfg.SessionCookieName, cfg.CsrfCookieName = "session", "csrf"
	cfg.AuthPublicOrigin = ""
	cfg.SessionCacheEnabled = false
	cfg.PersistentLoginEnabled = true
	cfg.SessionRememberStaffIdleHours, cfg.SessionRememberStaffAbsoluteHours = 168, 720
	cfg.RateLimitMode = config.RateLimitModeLocal
	server := httptest.NewServer(BuildRouter(BuildApp(cfg, db)))
	defer server.Close()
	fmt.Println(server.URL)
	// Closing stdin is the parent's graceful shutdown signal.
	_, _ = io.Copy(io.Discard, os.Stdin)
}

func startPersistentAPI(t *testing.T) (string, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPersistentLoginAPIProcess$", "-test.timeout=45s")
	cmd.Env = append(os.Environ(), "PERSISTENT_LOGIN_API_CHILD=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	var diagnostics bytes.Buffer
	cmd.Stderr = &diagnostics
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		_ = input.Close()
		if err := cmd.Wait(); err != nil {
			t.Errorf("API child failed: %v %s", err, diagnostics.String())
		}
		cancel()
	}
	t.Cleanup(stop)
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(output)
		if scanner.Scan() {
			ready <- scanner.Text()
		} else {
			ready <- ""
		}
		_, _ = io.Copy(io.Discard, output)
	}()
	select {
	case address := <-ready:
		if !strings.HasPrefix(address, "http://127.0.0.1:") {
			cancel()
			t.Fatal("API child did not start")
		}
		return address, stop
	case <-time.After(15 * time.Second):
		cancel()
		t.Fatal("API child startup timed out")
	}
	return "", stop
}

func TestPersistentLoginRevocationAcrossAPIProcessesMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	id := uuid.NewString()
	email := "persistent-process-" + id + "@example.test"
	hash, err := auth.HashPassword("Process-Test-Password-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id,email,display_name,role,state) VALUES (?,?,'Process Test','builder','active')`, id, email); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM user_sessions WHERE user_id=?`, id)
		_, _ = db.Exec(`DELETE FROM user_password_credentials WHERE user_id=?`, id)
		_, _ = db.Exec(`DELETE FROM users WHERE id=?`, id)
	})
	if _, err := db.Exec(`INSERT INTO user_password_credentials (user_id,password_hash) VALUES (?,?)`, id, hash); err != nil {
		t.Fatal(err)
	}
	a, _ := startPersistentAPI(t)
	b, stopB := startPersistentAPI(t)
	client := &http.Client{Timeout: 10 * time.Second}
	request := func(address, method, path, body string, cookies []*http.Cookie, want int) []*http.Cookie {
		t.Helper()
		req, err := http.NewRequest(method, address+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", address)
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
			if cookie.Name == "csrf" {
				req.Header.Set("X-CSRF-Token", cookie.Value)
			}
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		_, _ = io.Copy(io.Discard, res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s: status %d, want %d", method, path, res.StatusCode, want)
		}
		return res.Cookies()
	}
	cookies := request(a, "POST", "/api/v1/auth/login", `{"email":"`+email+`","password":"Process-Test-Password-1","rememberMe":true}`, nil, 200)
	if len(cookies) != 2 || cookies[0].MaxAge <= 0 {
		t.Fatal("remembered login did not issue persistent cookies")
	}
	request(b, "GET", "/api/v1/auth/session", "", cookies, 200)
	// Restart process B: restoration must survive the loss of all local state.
	stopB()
	b, _ = startPersistentAPI(t)
	request(b, "GET", "/api/v1/auth/session", "", cookies, 200)
	request(a, "POST", "/api/v1/auth/logout", "", cookies, 200)
	request(b, "GET", "/api/v1/auth/session", "", cookies, 401)
}
