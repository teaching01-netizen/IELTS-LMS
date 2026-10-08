package main

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"github.com/google/uuid"
)

// Only child test processes serve HTTP. The failpoint is test-only and runs
// after the production handler has committed, before any ACK reaches the socket.
func TestBoundaryAPIProcess(t *testing.T) {
	if os.Getenv("SAT_TEST_HTTP_PROCESS") != "1" {
		return
	}
	dsn, err := platformdb.NormalizeDSN(os.Getenv("TEST_MYSQL_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	cfg.SATPersonalCloseWindowSecs = 60
	cfg.OutboxExecOnly = true
	router := BuildRouter(BuildApp(cfg, db))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("SAT_TEST_DROP_ACK") == "1" && strings.HasSuffix(r.URL.Path, "/responses:batch") {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, r)
			if recorder.Code == http.StatusOK {
				process, _ := os.FindProcess(os.Getpid())
				if err := process.Kill(); err != nil {
					panic(err)
				}
				// Never return to net/http: SIGKILL delivery can race its implicit empty 200.
				select {}
			}
			for key, values := range recorder.Header() {
				w.Header()[key] = values
			}
			w.WriteHeader(recorder.Code)
			_, _ = w.Write(recorder.Body.Bytes())
			return
		}
		router.ServeHTTP(w, r)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("SAT_BOUNDARY_READY http://%s\n", listener.Addr())
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		t.Fatal(err)
	}
}

func startBoundaryAPI(t *testing.T, dropAck bool) (*exec.Cmd, string) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestBoundaryAPIProcess$")
	cmd.Env = append(os.Environ(), "SAT_TEST_HTTP_PROCESS=1", fmt.Sprintf("SAT_TEST_DROP_ACK=%d", map[bool]int{true: 1, false: 0}[dropAck]))
	cmd.Stderr = os.Stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if url, ok := strings.CutPrefix(scanner.Text(), "SAT_BOUNDARY_READY "); ok {
				ready <- url
			}
		}
	}()
	select {
	case url := <-ready:
		return cmd, url
	case <-time.After(10 * time.Second):
		t.Fatal("SAT rehearsal API did not become ready")
		return nil, ""
	}
}

func boundaryHTTP(client *http.Client, method, url, bearer string, payload any, result any) error {
	var raw []byte
	if payload != nil {
		var err error
		raw, err = json.Marshal(payload)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var body any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return fmt.Errorf("%s %s: HTTP %d: %v", method, req.URL.Path, resp.StatusCode, body)
	}
	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

func boundaryBearer(t *testing.T, db *sql.DB, schedule, attempt string) string {
	t.Helper()
	session, token := seedHandoffWriter(t, db, schedule, attempt)
	var user string
	if err := db.QueryRow("SELECT user_id FROM attempt_sessions WHERE token_id = ?", token).Scan(&user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?", user, session, attempt); err != nil {
		t.Fatal(err)
	}
	lease := uint64(1)
	bearer, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
		TokenID: token, UserID: user, ScheduleID: schedule, AttemptID: attempt, ClientSessionID: session,
		LeaseEpoch: &lease, Exp: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return bearer
}

func TestSATCommittedSaveSurvivesAPIKillAndConcurrentCloseMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, low, high := seedStaleETagExam(t, db)
	for _, query := range []string{
		"UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1', sat_handoff_mode = 'client_start' WHERE schedule_id = ?",
		"UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1' WHERE id = ?",
	} {
		if _, err := db.Exec(query, schedule); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6) - INTERVAL 3601 SECOND WHERE attempt_id = ?", attempt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE attempt_responses_v2 SET response = JSON_SET(response, '$.answer', 'C') WHERE attempt_id = ?", attempt); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query("SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order LIMIT 2", base)
	if err != nil {
		t.Fatal(err)
	}
	var commands []attempts.ResponseCommand
	for rows.Next() {
		var question string
		if err := rows.Scan(&question); err != nil {
			t.Fatal(err)
		}
		commands = append(commands, attempts.ResponseCommand{QuestionID: question, WriteID: uuid.NewString(), ClientVersion: 2,
			Response: attempts.ResponsePayload{Answer: "B", EliminatedOptions: []string{}, Annotations: []attempts.Annotation{}}})
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if len(commands) != 2 {
		t.Fatal("SAT rehearsal needs two final answers to cross the independently known 2/3 threshold")
	}
	bearer := boundaryBearer(t, db, schedule, attempt)
	request := map[string]any{"leaseEpoch": 1, "controlEpoch": 1, "commands": commands}
	client := &http.Client{Timeout: 10 * time.Second}
	dying, firstURL := startBoundaryAPI(t, true)
	path := "/api/v2/student/attempts/" + attempt + "/responses:batch"
	if err := boundaryHTTP(client, http.MethodPost, firstURL+path, bearer, request, nil); err == nil {
		t.Fatal("killed API unexpectedly delivered an ACK")
	}
	if err := dying.Wait(); err == nil {
		t.Fatal("failpoint did not kill the API process")
	}
	var committed int
	if err := db.QueryRow("SELECT COUNT(*) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_version = 2", attempt).Scan(&committed); err != nil || committed != 2 {
		t.Fatalf("save did not commit before process death: count=%d err=%v", committed, err)
	}
	_, secondURL := startBoundaryAPI(t, false)
	_, thirdURL := startBoundaryAPI(t, false)
	var moduleAttempt string
	if err := db.QueryRow("SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base).Scan(&moduleAttempt); err != nil {
		t.Fatal(err)
	}
	closeRequest := delivery.ModuleCloseRequest{ModuleID: base, ModuleAttemptID: moduleAttempt, CloseID: uuid.NewString()}
	for _, command := range commands {
		closeRequest.Answers = append(closeRequest.Answers, delivery.ModuleCloseAnswer{QuestionID: command.QuestionID, WriteID: command.WriteID, ClientVersion: 2})
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			url := []string{secondURL, thirdURL}[i%2]
			var saved struct {
				Acks []attempts.Ack `json:"acknowledgements"`
			}
			if err := boundaryHTTP(client, http.MethodPost, url+path, bearer, request, &saved); err != nil {
				errs <- err
				return
			}
			if len(saved.Acks) != 2 || saved.Acks[0].Outcome != "duplicate" || saved.Acks[1].Outcome != "duplicate" {
				errs <- fmt.Errorf("committed save was not replayed: %+v", saved.Acks)
				return
			}
			var ack delivery.SatModuleCloseAck
			if err := boundaryHTTP(client, http.MethodPost, url+"/api/v1/assessment-delivery/schedules/"+schedule+"/modules/close", bearer, closeRequest, &ack); err != nil {
				errs <- err
				return
			}
			if !ack.Closed || ack.NextModuleID == nil || *ack.NextModuleID != high {
				errs <- fmt.Errorf("close did not use committed 2/3 answers: %+v", ack)
				return
			}
			errs <- nil
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var decisions, branches, receipts int
	if err := db.QueryRow("SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND selected_module_id = ?", attempt, high).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base).Scan(&branches); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM assessment_lifecycle_receipts WHERE attempt_id = ? AND operation_id = ?", attempt, closeRequest.CloseID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if decisions != 1 || branches != 1 || receipts != 1 {
		t.Fatalf("conflicting lifecycle facts: routes=%d branches=%d receipts=%d", decisions, branches, receipts)
	}
	var started struct {
		SelectedSection *delivery.DeliverySection `json:"selectedSection"`
	}
	if err := boundaryHTTP(client, http.MethodPost, thirdURL+"/api/v1/assessment-delivery/schedules/"+schedule+"/modules/start", bearer,
		map[string]any{"moduleId": high, "needContent": true}, &started); err != nil {
		t.Fatal(err)
	}
	var snapshot struct {
		LeaseEpoch, ControlEpoch uint64
		Responses                []attempts.Ack
	}
	if err := boundaryHTTP(client, http.MethodGet, secondURL+"/api/v2/student/attempts/"+attempt+"/responses", bearer, nil, &snapshot); err != nil {
		t.Fatal(err)
	}
	if started.SelectedSection == nil {
		t.Fatal("M2 start withheld assigned content")
	}
	var nextQuestion string
	for _, module := range started.SelectedSection.Modules {
		if module.ID == high && len(module.Questions) > 0 {
			nextQuestion = module.Questions[0].ExamQuestionID
		}
	}
	if nextQuestion == "" {
		t.Fatal("M2 has no answerable question")
	}
	next := attempts.ResponseCommand{QuestionID: nextQuestion, WriteID: uuid.NewString(), ClientVersion: 1,
		Response: attempts.ResponsePayload{Answer: "B", EliminatedOptions: []string{}, Annotations: []attempts.Annotation{}}}
	if err := boundaryHTTP(client, http.MethodPost, secondURL+path, bearer,
		map[string]any{"leaseEpoch": snapshot.LeaseEpoch, "controlEpoch": snapshot.ControlEpoch, "commands": []attempts.ResponseCommand{next}}, nil); err != nil {
		t.Fatalf("M2 remained blocked after recovery: %v", err)
	}
	assertBoundaryStored(t, db, attempt, commands)
	assertBoundaryStored(t, db, attempt, []attempts.ResponseCommand{next})
	// A shared-runtime wave uses independent candidates and both API processes.
	durations := runBoundaryWave(t, db, schedule, attempt, base, low, high, commands, secondURL, thirdURL)
	if len(durations) > 0 {
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		t.Logf("local shared-runtime save+close wave: n=%d p95=%s max=%s (not a production capacity measurement)", len(durations), durations[(len(durations)*95-1)/100], durations[len(durations)-1])
	}
}

func assertBoundaryStored(t *testing.T, db *sql.DB, attempt string, commands []attempts.ResponseCommand) {
	t.Helper()
	for _, command := range commands {
		var write, answer string
		var version uint64
		if err := db.QueryRow("SELECT client_write_id, client_version, JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?", attempt, command.QuestionID).Scan(&write, &version, &answer); err != nil {
			t.Fatal(err)
		}
		if write != command.WriteID || version != command.ClientVersion || answer != command.Response.Answer {
			t.Fatalf("persisted answer changed: write=%s version=%d answer=%s", write, version, answer)
		}
	}
}

func runBoundaryWave(t *testing.T, db *sql.DB, schedule, sourceAttempt, base, low, high string, commands []attempts.ResponseCommand, urls ...string) []time.Duration {
	t.Helper()
	type candidate struct{ attempt, moduleAttempt, bearer string }
	candidates := make([]candidate, 20)
	for i := range candidates {
		c := candidate{attempt: uuid.NewString(), moduleAttempt: uuid.NewString()}
		_, err := db.Exec(`INSERT INTO student_attempts
			(id, schedule_id, student_key, organization_id, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, revision, protocol_version, delivery_status, lease_epoch, control_epoch, response_revision, wcode)
			SELECT ?, schedule_id, ?, organization_id, exam_id, published_version_id, exam_title, ?, candidate_name, candidate_email, 'exam', current_module, '{}', '{}', '{}', '[]', '{}', '{}', 0, 2, 'running', 1, 1, 0, ? FROM student_attempts WHERE id = ?`, c.attempt, c.attempt, c.attempt, c.attempt, sourceAttempt)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision) VALUES (?, ?, ?, 'active', 3600, UTC_TIMESTAMP(6) - INTERVAL 3601 SECOND, '{}', 1)", c.moduleAttempt, c.attempt, base); err != nil {
			t.Fatal(err)
		}
		c.bearer = boundaryBearer(t, db, schedule, c.attempt)
		candidates[i] = c
		t.Cleanup(func() {
			for _, table := range []string{"assessment_lifecycle_receipts", "attempt_mutations_v2", "attempt_responses_v2", "attempt_sessions", "assessment_route_decisions", "assessment_module_attempts"} {
				if _, err := db.Exec("DELETE FROM "+table+" WHERE attempt_id = ?", c.attempt); err != nil {
					t.Errorf("cleanup wave %s: %v", table, err)
				}
			}
			if _, err := db.Exec("DELETE FROM student_attempts WHERE id = ?", c.attempt); err != nil {
				t.Errorf("cleanup wave attempt: %v", err)
			}
		})
	}
	if os.Getenv("SAT_REHEARSAL_K6") == "1" {
		var proxies []*httputil.ReverseProxy
		for _, address := range urls {
			target, err := url.Parse(address)
			if err != nil {
				t.Fatal(err)
			}
			proxies = append(proxies, httputil.NewSingleHostReverseProxy(target))
		}
		var next atomic.Uint64
		proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			proxies[int(next.Add(1)-1)%len(proxies)].ServeHTTP(w, r)
		}))
		defer proxy.Close()
		waveAt := time.Now().Add(12 * time.Second)
		var credentials []map[string]any
		for _, c := range candidates {
			if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at = ? WHERE id = ?", waveAt.Add(-time.Hour).UTC(), c.moduleAttempt); err != nil {
				t.Fatal(err)
			}
			var answers []map[string]any
			for _, command := range commands {
				answers = append(answers, map[string]any{"questionId": command.QuestionID, "writeId": command.WriteID, "answer": command.Response.Answer, "clientVersion": command.ClientVersion})
			}
			credentials = append(credentials, map[string]any{"attemptId": c.attempt, "token": c.bearer, "moduleId": base, "moduleAttemptId": c.moduleAttempt, "expectedModuleId": high, "otherModuleId": low, "answers": answers})
		}
		fixturePath := filepath.Join(t.TempDir(), "credentials.json")
		encoded, err := json.Marshal(credentials)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fixturePath, encoded, 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "k6", "run", "--quiet", "--no-color", "../../../../k6/sat-m1-m2-handoff.js")
		cmd.Env = append(os.Environ(), "K6_BASE_URL="+proxy.URL, "K6_SCHEDULE_ID="+schedule,
			"K6_ATTEMPT_TOKENS_PATH="+fixturePath, "K6_VUS=20", "K6_BASELINE=0", "SAT_PERSONAL_CLOSE_WINDOW_SECS=60",
			"K6_FINAL_SAVE_DELAY_MS=750", fmt.Sprintf("K6_WAVE_AT_MS=%d", waveAt.UnixMilli()))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("k6 boundary rehearsal: %v\n%s", err, output)
		}
		t.Logf("k6 handoff rehearsal (20 candidates, two API processes):\n%s", output)
		for _, c := range candidates {
			assertBoundaryStored(t, db, c.attempt, commands)
			var routes, branches int
			if err := db.QueryRow("SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND selected_module_id = ?", c.attempt, high).Scan(&routes); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", c.attempt, base).Scan(&branches); err != nil {
				t.Fatal(err)
			}
			if routes != 1 || branches != 1 {
				t.Fatalf("k6 persisted conflicting facts: routes=%d branches=%d", routes, branches)
			}
		}
		return nil
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(candidates))
	durations := make([]time.Duration, len(candidates))
	start := make(chan struct{})
	for i, c := range candidates {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			at := time.Now()
			client := &http.Client{Timeout: 20 * time.Second}
			var saved struct {
				Acks []attempts.Ack `json:"acknowledgements"`
			}
			if err := boundaryHTTP(client, http.MethodPost, urls[i%len(urls)]+"/api/v2/student/attempts/"+c.attempt+"/responses:batch", c.bearer,
				map[string]any{"leaseEpoch": 1, "controlEpoch": 1, "commands": commands}, &saved); err != nil {
				errs <- err
				return
			}
			if len(saved.Acks) != len(commands) {
				errs <- fmt.Errorf("wave lost an acknowledgement")
				return
			}
			request := delivery.ModuleCloseRequest{ModuleID: base, ModuleAttemptID: c.moduleAttempt, CloseID: uuid.NewString()}
			for _, command := range commands {
				request.Answers = append(request.Answers, delivery.ModuleCloseAnswer{QuestionID: command.QuestionID, WriteID: command.WriteID, ClientVersion: int64(command.ClientVersion)})
			}
			var ack delivery.SatModuleCloseAck
			if err := boundaryHTTP(client, http.MethodPost, urls[(i+1)%len(urls)]+"/api/v1/assessment-delivery/schedules/"+schedule+"/modules/close", c.bearer, request, &ack); err != nil {
				errs <- err
				return
			}
			if ack.NextModuleID == nil || *ack.NextModuleID != high {
				errs <- fmt.Errorf("wave selected a conflicting branch")
				return
			}
			durations[i] = time.Since(at)
			errs <- nil
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range candidates {
		assertBoundaryStored(t, db, c.attempt, commands)
		var count int
		if err := db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND selected_module_id = ?", c.attempt, high).Scan(&count); err != nil || count != 1 {
			t.Fatalf("wave route count=%d err=%v", count, err)
		}
	}
	return durations
}
