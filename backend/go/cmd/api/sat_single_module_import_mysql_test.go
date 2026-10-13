package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
)

func singleModuleWorkbookFixture(t *testing.T, target string) []byte {
	t.Helper()
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	row := 2
	for _, spec := range satWorkbookModules {
		for order := 1; order <= spec.count; order++ {
			if spec.key == target {
				domain, skill := "Information and Ideas", "Central Ideas and Details"
				if spec.section == "Math" {
					domain, skill = "Algebra", "Linear Equations in One Variable"
				}
				for col, value := range map[string]any{"C": "Imported question " + strconv.Itoa(order), "F": "Choice A", "G": "Choice B", "H": "Choice C", "I": "Choice D", "J": "A", "L": domain, "M": skill, "O": ""} {
					if err := book.SetCellValue("Questions", col+strconv.Itoa(row), value); err != nil {
						t.Fatal(err)
					}
				}
			}
			row++
		}
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func singleModulePreviewFixture(t *testing.T, target string) authoring.SatWorkbookPreview {
	t.Helper()
	preview, err := authoring.ParseSATWorkbook(singleModuleWorkbookFixture(t, target), authoring.SatWorkbookImportOptions{Mode: "single_module", TargetModuleKey: target})
	if err != nil || !preview.Valid {
		t.Fatalf("fixture preview err=%v issues=%+v", err, preview.Issues)
	}
	return preview
}

func fullSATWorkbookPreviewFixture(t *testing.T) authoring.SatWorkbookPreview {
	t.Helper()
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	row := 2
	for _, spec := range satWorkbookModules {
		for order := 1; order <= spec.count; order++ {
			domain, skill := "Information and Ideas", "Central Ideas and Details"
			if spec.section == "Math" {
				domain, skill = "Algebra", "Linear Equations in One Variable"
			}
			pretest := "No"
			if order <= 2 {
				pretest = "Yes"
			}
			for col, value := range map[string]any{"C": "Full import question " + strconv.Itoa(order), "F": "Choice A", "G": "Choice B", "H": "Choice C", "I": "Choice D", "J": "A", "L": domain, "M": skill, "O": pretest} {
				if err := book.SetCellValue("Questions", col+strconv.Itoa(row), value); err != nil {
					t.Fatal(err)
				}
			}
			row++
		}
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	preview, err := authoring.ParseSATWorkbook(buffer.Bytes())
	if err != nil || !preview.Valid || len(preview.Modules) != len(satWorkbookModules) {
		t.Fatalf("full fixture preview err=%v modules=%d issues=%+v", err, len(preview.Modules), preview.Issues)
	}
	return preview
}

func singleModuleRequest(preview authoring.SatWorkbookPreview, shell authoring.Shell, key string) authoring.SatWorkbookCommitRequest {
	modules := make([]authoring.SatWorkbookModuleDraft, len(preview.Modules))
	for i, module := range preview.Modules {
		questions := make([]authoring.QuestionDraft, len(module.Questions))
		for j, question := range module.Questions {
			questions[j] = question.QuestionDraft
		}
		modules[i] = authoring.SatWorkbookModuleDraft{ModuleKey: module.ModuleKey, SectionKey: module.SectionKey, Questions: questions}
	}
	return authoring.SatWorkbookCommitRequest{ImportID: preview.ImportID, ExpectedVersionID: shell.VersionID, ExpectedVersionRevision: shell.VersionRevision,
		Mode: "single_module", TargetModuleKey: preview.TargetModuleKey, Modules: modules, OperationKey: key,
		PretestResolution: &authoring.SatWorkbookPretestResolution{SelectedOrders: []int{8, 19}, DesignationSource: "staff_defined", Confirmed: true}}
}

func TestSATSingleModulePreviewAndCommitHTTPMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	h.authors.SetSingleModuleImportsEnabled(true)
	app := &App{DB: h.db, Exams: h.exams, Authoring: h.authors}
	workbook := singleModuleWorkbookFixture(t, "rw-m1")

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	file, err := writer.CreateFormFile("file", "single-module.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(workbook); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("mode", "single_module"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("targetModuleKey", "rw-m1"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	previewRequest := httptest.NewRequest(http.MethodPost, "/exams/"+h.examID+"/sat-workbook-preview", &upload)
	previewRequest.Header.Set("Content-Type", writer.FormDataContentType())
	route := chi.NewRouteContext()
	route.URLParams.Add("examID", h.examID)
	session := &auth.Session{ID: "test-session", UserID: h.actor, Role: auth.RoleAdmin}
	previewRequest = previewRequest.WithContext(context.WithValue(previewRequest.Context(), chi.RouteCtxKey, route))
	previewRequest = previewRequest.WithContext(context.WithValue(previewRequest.Context(), sessionCtxKey, session))
	previewResponse := httptest.NewRecorder()
	authorPreviewImportHandler(app).ServeHTTP(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", previewResponse.Code, previewResponse.Body.String())
	}
	var preview authoring.SatWorkbookPreview
	if err := json.Unmarshal(previewResponse.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if !preview.Valid || preview.CommitReady || preview.Mode != "single_module" || preview.TargetModuleKey != "rw-m1" || len(preview.Modules) != 1 {
		t.Fatalf("single-module API preview contract mismatch: %+v", preview)
	}
	for _, question := range preview.Modules[0].Questions {
		if question.IsPretest != nil {
			t.Fatalf("blank source pretest must remain unknown, got %v", *question.IsPretest)
		}
	}

	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	commit := singleModuleRequest(preview, shell, "http-"+uuid.NewString())
	body, err := json.Marshal(commit)
	if err != nil {
		t.Fatal(err)
	}
	commitRequest := httptest.NewRequest(http.MethodPost, "/exams/"+h.examID+"/sat-workbook-commit", bytes.NewReader(body))
	commitRequest.Header.Set("Content-Type", "application/json")
	commitRequest.Header.Set("Idempotency-Key", commit.OperationKey)
	commitRequest = commitRequest.WithContext(context.WithValue(commitRequest.Context(), chi.RouteCtxKey, route))
	commitRequest = commitRequest.WithContext(context.WithValue(commitRequest.Context(), sessionCtxKey, session))
	commitResponse := httptest.NewRecorder()
	authorCommitImportHandler(app).ServeHTTP(commitResponse, commitRequest)
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var result authoring.CommitResult
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	var targetCount int
	for _, section := range result.Shell.Sections {
		for _, module := range section.Modules {
			if module.ModuleKey == "rw-m1" {
				targetCount = len(module.Questions)
			} else if len(module.Questions) != 0 {
				t.Fatalf("HTTP commit changed non-target module %s", module.ModuleKey)
			}
		}
	}
	if targetCount != 27 || result.Shell.VersionRevision != shell.VersionRevision+1 {
		t.Fatalf("single-module HTTP commit target count=%d revision=%d", targetCount, result.Shell.VersionRevision)
	}
}

func seedNonTargetModules(t *testing.T, h *concurrencyHarness, target string) authoring.Shell {
	t.Helper()
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range shell.Sections {
		for _, module := range section.Modules {
			if module.ModuleKey != target {
				if _, err := h.authors.CreateQuestion(context.Background(), module.ID, h.actor, validSATPublishQuestion()); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	shell, err = h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	return shell
}

func sameLogicalModule(left, right authoring.Module) bool {
	left.ID, right.ID = "", ""
	left.Revision, right.Revision = 0, 0
	left.Questions = append([]authoring.QuestionSummary(nil), left.Questions...)
	right.Questions = append([]authoring.QuestionSummary(nil), right.Questions...)
	for i := range left.Questions {
		left.Questions[i].ExamQuestionID = ""
		left.Questions[i].QuestionID = ""
		left.Questions[i].QuestionRevision = ""
		left.Questions[i].SemanticRevision = 0
		left.Questions[i].Revision = 0
	}
	for i := range right.Questions {
		right.Questions[i].ExamQuestionID = ""
		right.Questions[i].QuestionID = ""
		right.Questions[i].QuestionRevision = ""
		right.Questions[i].SemanticRevision = 0
		right.Questions[i].Revision = 0
	}
	return reflect.DeepEqual(left, right)
}

func sameLogicalRouting(left, right *authoring.RoutingPolicy) bool {
	if left == nil || right == nil {
		return left == right
	}
	leftValue, rightValue := *left, *right
	leftValue.ID, rightValue.ID = "", ""
	leftValue.BaseModuleID, rightValue.BaseModuleID = "", ""
	leftValue.LowerModuleID, rightValue.LowerModuleID = "", ""
	leftValue.HigherModuleID, rightValue.HigherModuleID = "", ""
	return reflect.DeepEqual(leftValue, rightValue)
}

func TestSATSingleModulePreservesOtherModulesAndUndoMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	h.authors.SetSingleModuleImportsEnabled(true)
	before := seedNonTargetModules(t, h, "rw-m1")
	preview := singleModulePreviewFixture(t, "rw-m1")
	if err := h.authors.RegisterSATWorkbookPreview(context.Background(), h.examID, h.actor, preview); err != nil {
		t.Fatal(err)
	}
	request := singleModuleRequest(preview, before, "single-"+uuid.NewString())
	first, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey(request.OperationKey))
	if err != nil {
		t.Fatal(err)
	}
	if first.Shell.VersionRevision != before.VersionRevision+1 {
		t.Fatalf("revision advanced incorrectly: %d", first.Shell.VersionRevision)
	}
	for i, section := range first.Shell.Sections {
		if !reflect.DeepEqual(section.RoutingPolicy, before.Sections[i].RoutingPolicy) {
			t.Fatal("routing changed")
		}
		for j, module := range section.Modules {
			if module.ModuleKey != "rw-m1" {
				if !reflect.DeepEqual(module, before.Sections[i].Modules[j]) {
					t.Fatalf("non-target %s changed", module.ModuleKey)
				}
			} else {
				if len(module.Questions) != 27 {
					t.Fatalf("target count %d", len(module.Questions))
				}
				for k, question := range module.Questions {
					if question.IsPretest != (k == 7 || k == 18) {
						t.Fatalf("wrong pretest order %d", k+1)
					}
				}
			}
		}
	}
	replayed, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey(request.OperationKey))
	if err != nil || !reflect.DeepEqual(first, replayed) {
		t.Fatalf("lost-ACK replay err=%v", err)
	}
	restored, err := h.authors.UndoSATWorkbook(context.Background(), h.examID, preview.ImportID, h.actor)
	if err != nil {
		t.Fatal(err)
	}
	if restored.VersionID == before.VersionID {
		t.Fatal("undo did not use separate checkpoint version")
	}
	for i, section := range restored.Sections {
		if !sameLogicalRouting(section.RoutingPolicy, before.Sections[i].RoutingPolicy) {
			t.Fatalf("checkpoint routing policy not restored for %s", section.SectionKey)
		}
		for j, module := range section.Modules {
			if !sameLogicalModule(module, before.Sections[i].Modules[j]) {
				t.Fatalf("checkpoint %s logical content not restored", module.ModuleKey)
			}
		}
	}
	// Receipt survives undo, preview expiry, flag rollback and ledger cleanup.
	h.authors.SetSingleModuleImportsEnabled(false)
	if _, err := h.db.Exec("DELETE FROM authoring_operation_keys WHERE actor_id = ? AND scope = ?", h.actor, "workbook:"+h.examID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.Exec("UPDATE sat_workbook_imports SET expires_at = DATE_SUB(NOW(6), INTERVAL 2 DAY) WHERE id = ?", preview.ImportID); err != nil {
		t.Fatal(err)
	}
	replayed, err = h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey(request.OperationKey))
	if err != nil || !reflect.DeepEqual(first, replayed) {
		t.Fatalf("durable replay err=%v", err)
	}
	current, _ := h.authors.Shell(context.Background(), h.examID)
	if current.VersionID != restored.VersionID {
		t.Fatal("retry after undo mutated current draft")
	}
	request.Modules[0].Questions[0].Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"Changed"}]}`)
	if _, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey(request.OperationKey)); err == nil {
		t.Fatal("changed key payload accepted")
	}
}

func TestSATSingleModuleTwoInstanceRaceMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	h.authors.SetSingleModuleImportsEnabled(true)
	otherDB, err := sql.Open("mysql", os.Getenv("TEST_MYSQL_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	defer otherDB.Close()
	other := authoring.NewService(otherDB, tx.NewRunner(otherDB)).SetSingleModuleImportsEnabled(true)
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	actors := []string{h.actor, "race-" + uuid.NewString()}
	services := []*authoring.Service{h.authors, other}
	requests := make([]authoring.SatWorkbookCommitRequest, 2)
	for i := range requests {
		preview := singleModulePreviewFixture(t, "rw-m1")
		if err := services[i].RegisterSATWorkbookPreview(context.Background(), h.examID, actors[i], preview); err != nil {
			t.Fatal(err)
		}
		requests[i] = singleModuleRequest(preview, shell, "race-"+uuid.NewString())
	}
	barrier := make(chan struct{})
	ready := make(chan struct{}, 2)
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	for i := range requests {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ready <- struct{}{}
			<-barrier
			_, err := services[i].CommitSATWorkbook(context.Background(), h.examID, requests[i], actors[i], authoring.WithOperationKey(requests[i].OperationKey))
			outcomes <- err
		}(i)
	}
	<-ready
	<-ready
	close(barrier)
	wg.Wait()
	close(outcomes)
	wins, conflicts := 0, 0
	for err := range outcomes {
		if err == nil {
			wins++
		} else if e, ok := apperrors.As(err); ok && e.Code == apperrors.CodeConflict {
			conflicts++
		} else {
			t.Fatalf("unexpected race error %v", err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("race got %d winners/%d conflicts", wins, conflicts)
	}
	after, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	if after.VersionRevision != shell.VersionRevision+1 || len(after.Sections[0].Modules[0].Questions) != 27 {
		t.Fatal("mixed or repeated mutation")
	}
}

func TestSATSingleModuleRejectsDisabledAndTamperedRequestsMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	preview := singleModulePreviewFixture(t, "rw-m1")
	if err := h.authors.RegisterSATWorkbookPreview(context.Background(), h.examID, h.actor, preview); err == nil {
		t.Fatal("preview registration succeeded while the feature flag was off")
	}
	h.authors.SetSingleModuleImportsEnabled(true)
	if err := h.authors.RegisterSATWorkbookPreview(context.Background(), h.examID, h.actor, preview); err != nil {
		t.Fatal(err)
	}
	before, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	base := singleModuleRequest(preview, before, "invalid-"+uuid.NewString())
	missingResolution := base
	missingResolution.PretestResolution = nil
	if _, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, missingResolution, h.actor, authoring.WithOperationKey(base.OperationKey)); err == nil {
		t.Fatal("commit without an explicit pretest resolution succeeded")
	}
	changed := base
	changed.Modules = append([]authoring.SatWorkbookModuleDraft(nil), base.Modules...)
	changed.Modules[0].Questions = append([]authoring.QuestionDraft(nil), base.Modules[0].Questions...)
	changed.Modules[0].Questions[0].Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"tampered after preview"}]}`)
	if _, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, changed, h.actor, authoring.WithOperationKey(base.OperationKey)); err == nil {
		t.Fatal("commit accepted question content that did not match the registered preview")
	}
	after, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("rejected request changed the draft")
	}
}

func TestSATSingleModuleTransactionRollsBackLateReceiptFailureMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	h.authors.SetSingleModuleImportsEnabled(true)
	before := seedNonTargetModules(t, h, "rw-m1")
	preview := singleModulePreviewFixture(t, "rw-m1")
	if err := h.authors.RegisterSATWorkbookPreview(context.Background(), h.examID, h.actor, preview); err != nil {
		t.Fatal(err)
	}
	request := singleModuleRequest(preview, before, "rollback-"+uuid.NewString())
	trigger := "fail_receipt_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := h.db.Exec("CREATE TRIGGER " + trigger + " BEFORE UPDATE ON sat_single_module_imports FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected receipt failure'"); err != nil {
		t.Fatalf("create rollback trigger: %v", err)
	}
	defer func() {
		if _, err := h.db.Exec("DROP TRIGGER IF EXISTS " + trigger); err != nil {
			t.Errorf("drop rollback trigger: %v", err)
		}
	}()
	if _, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey(request.OperationKey)); err == nil {
		t.Fatal("injected late receipt failure did not abort the transaction")
	}
	after, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("late transaction failure left partial draft changes")
	}
	var state string
	var checkpoint sql.NullString
	if err := h.db.QueryRow("SELECT state, checkpoint_version_id FROM sat_workbook_imports WHERE id = ?", preview.ImportID).Scan(&state, &checkpoint); err != nil {
		t.Fatal(err)
	}
	if state != "previewed" || checkpoint.Valid {
		t.Fatalf("import state was not rolled back: state=%s checkpoint=%+v", state, checkpoint)
	}
	var operationKey, requestHash, result sql.NullString
	if err := h.db.QueryRow("SELECT operation_key, request_hash, CAST(result_json AS CHAR) FROM sat_single_module_imports WHERE import_id = ?", preview.ImportID).Scan(&operationKey, &requestHash, &result); err != nil {
		t.Fatal(err)
	}
	if operationKey.Valid || requestHash.Valid || result.Valid {
		t.Fatalf("durable receipt partially survived rollback: %v %v %v", operationKey, requestHash, result)
	}
	var ledgerRows int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM authoring_operation_keys WHERE actor_id = ? AND scope = ? AND operation_key = ?", h.actor, "workbook:"+h.examID, request.OperationKey).Scan(&ledgerRows); err != nil {
		t.Fatal(err)
	}
	if ledgerRows != 0 {
		t.Fatal("shared operation claim survived rollback")
	}
}

func TestSATFullWorkbookImportCompatibilityMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	preview := fullSATWorkbookPreviewFixture(t)
	if err := h.authors.RegisterSATWorkbookPreview(context.Background(), h.examID, h.actor, preview); err != nil {
		t.Fatal(err)
	}
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	modules := make([]authoring.SatWorkbookModuleDraft, len(preview.Modules))
	for i, module := range preview.Modules {
		questions := make([]authoring.QuestionDraft, len(module.Questions))
		for j, question := range module.Questions {
			questions[j] = question.QuestionDraft
		}
		modules[i] = authoring.SatWorkbookModuleDraft{ModuleKey: module.ModuleKey, SectionKey: module.SectionKey, Questions: questions}
	}
	request := authoring.SatWorkbookCommitRequest{ImportID: preview.ImportID, ExpectedVersionID: shell.VersionID, ExpectedVersionRevision: shell.VersionRevision, Modules: modules}
	if _, err := h.authors.CommitSATWorkbook(context.Background(), h.examID, request, h.actor, authoring.WithOperationKey("full-"+uuid.NewString())); err != nil {
		t.Fatal(err)
	}
	result, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, section := range result.Sections {
		for _, module := range section.Modules {
			total += len(module.Questions)
			pretests := 0
			for _, question := range module.Questions {
				if question.IsPretest {
					pretests++
				}
			}
			if pretests != 2 || len(module.Questions) != module.TargetQuestionCount {
				t.Fatalf("full import module %s count=%d pretests=%d", module.ModuleKey, len(module.Questions), pretests)
			}
		}
	}
	if total != 147 {
		t.Fatalf("full import produced %d questions, want 147", total)
	}
}
