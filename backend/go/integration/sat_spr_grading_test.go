package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/results"
)

// Real MySQL: the decisive typed answer goes through the delivery save API,
// then timeout finalization, stored route selection, bootstrap and export.
func TestSATStrictSPRMathRoutingMySQL(t *testing.T) {
	cases := []struct {
		name                      string
		answers                   [3]any
		want                      int
		v2, pretest, legacyPolicy bool
	}{
		{name: "below", answers: [3]any{".6667", ".66", ""}, want: 1},
		{name: "at", answers: [3]any{".6667", "4/6", ""}, want: 2},
		{name: "above", answers: [3]any{".6667", "4/6", "0.667"}, want: 3},
		{name: "v2 at", answers: [3]any{".6667", "0.667", ""}, want: 2, v2: true},
		{name: "v2 clear overrides correct legacy", answers: [3]any{".6667", nil, ""}, want: 1, v2: true},
		{name: "pretest excluded", answers: [3]any{".6667", "0.667", ".66"}, want: 1, v2: true, pretest: true},
		{name: "invalid preserved", answers: [3]any{"1 1/2", "123456", "1/0"}, want: 0},
		{name: "old publication retains legacy", answers: [3]any{".6667", "0.667", ""}, want: 0, legacyPolicy: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newAdaptiveExam(t)
			ctx := context.Background()
			exec := func(query string, args ...any) {
				t.Helper()
				if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
					t.Fatal(err)
				}
			}
			if !tc.legacyPolicy {
				exec(`UPDATE exam_versions SET config_snapshot = '{"satStudentResponseScoring":"strict_v1"}' WHERE id = ?`, f.versionID)
			}
			exec(`UPDATE assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id SET qr.question_type = 'student_produced_response', qr.answer_definition = '{"kind":"student_produced_response","acceptedResponses":["2/3"],"normalizeFraction":true,"normalizeDecimal":true,"numericTolerance":null}' WHERE eq.module_id = ?`, f.math.baseID)
			attemptID := f.seedStudent(f.math, 0, false)
			f.openWriterSession(t, attemptID)
			questions := f.examQuestionIDs(t, f.math.baseID)
			if tc.pretest {
				exec(`UPDATE assessment_exam_questions SET is_pretest = TRUE WHERE id = ?`, questions[0])
			}
			for index, answer := range tc.answers {
				if tc.v2 {
					// A stale correct legacy answer must never resurrect a cleared V2 answer.
					f.dropV2Response(t, attemptID, questions[index])
					if err := f.saveAnswer(t, attemptID, questions[index], "2/3"); err != nil {
						t.Fatal(err)
					}
					payload, _ := json.Marshal(map[string]any{"answer": answer})
					exec(`INSERT INTO attempt_responses_v2 (attempt_id,question_id,module_id,lease_epoch,control_epoch,client_version,client_write_id,request_hash,response,response_hash,server_revision) VALUES (?,?,?,1,1,2,?, 'test-request',?,'test-response',8)`, attemptID, questions[index], f.math.baseID, "strict-"+questions[index], string(payload))
				} else {
					f.dropV2Response(t, attemptID, questions[index])
					if index == 1 {
						f.backdateModuleStartedAt(t, attemptID, f.math.baseID, 3598*time.Second)
					}
					if err := f.saveAnswer(t, attemptID, questions[index], answer.(string)); err != nil {
						t.Fatal(err)
					}
				}
			}
			before := f.bootstrap(t, attemptID)
			for _, response := range before.Attempt.Responses {
				for index, id := range questions {
					if response.ExamQuestionID == id {
						var saved any
						if len(response.Response) > 0 {
							if err := json.Unmarshal(response.Response, &saved); err != nil {
								t.Fatal(err)
							}
						}
						if saved != tc.answers[index] {
							t.Fatalf("saved answer changed: got %#v want %#v", saved, tc.answers[index])
						}
					}
				}
			}
			f.expireBase(t, attemptID, f.math.baseID)
			if !f.reconcile(t, attemptID) {
				t.Fatal("expiry did not finalize Math Module 1")
			}
			decision, score := f.assertRouteMatchesStoredScore(t, attemptID, f.math)
			if score != tc.want {
				t.Fatalf("score %d want %d", score, tc.want)
			}
			operational := 3
			if tc.pretest {
				operational--
			}
			var count int
			if err := f.db.QueryRowContext(ctx, `SELECT operational_question_count FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, attemptID, f.math.baseID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != operational {
				t.Fatalf("operational count %d want %d", count, operational)
			}
			selected, other := f.math.lowID, f.math.highID
			if tc.want >= 2 {
				selected, other = other, selected
			}
			if decision.selectedModuleID != selected || decision.selectedRoute != routeForScore(tc.want) {
				t.Fatalf("incorrect route: %+v", decision)
			}
			if f.countModuleAttempts(t, attemptID, selected) != 1 || f.countModuleAttempts(t, attemptID, other) != 0 {
				t.Fatal("wrong Module 2 attempt created")
			}
			f.reconcile(t, attemptID)
			if f.countDecisions(t, attemptID) != 1 {
				t.Fatal("retry duplicated route decision")
			}
			if _, ok := bootstrapModuleIDs(f.bootstrap(t, attemptID))[selected]; !ok {
				t.Fatal("bootstrap omitted selected Module 2")
			}
			// Seed the scored result header required by the review surface; its
			// question verdicts are computed by the real read service below.
			resultID := uuid.NewString()
			exec(`INSERT INTO assessment_results (id,attempt_id,provider_key,outcome_status,score_payload,release_status) VALUES (?,?,'sat','scored','{}','ready_to_release')`, resultID, attemptID)
			detail, err := results.NewService(f.db).GetSATResult(ctx, auth.NewActorContext("strict-admin", auth.RoleAdmin), resultID)
			if err != nil {
				t.Fatal(err)
			}
			checked := 0
			for _, question := range detail.Questions {
				if question.ModuleKey != "math-m1" {
					continue
				}
				checked++
				answer := tc.answers[question.DisplayOrder]
				if answer == nil || answer == "" || (tc.pretest && question.DisplayOrder == 0) {
					if question.IsCorrect != nil {
						t.Fatal("review gave a verdict to pretest/unanswered input")
					}
					continue
				}
				want := !tc.legacyPolicy && (answer == ".6667" || answer == "4/6" || answer == "0.667")
				if question.IsCorrect == nil || *question.IsCorrect != want {
					t.Fatalf("review Q%d mismatch: %+v", question.DisplayOrder, question)
				}
			}
			if checked != 3 {
				t.Fatalf("review returned %d Math Module 1 questions", checked)
			}
			exported, err := results.NewService(f.db).ExportSATRawdata(ctx, auth.NewActorContext("strict-admin", auth.RoleAdmin), f.examID, f.scheduleID)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, row := range exported.Rows {
				// Literal workbook module code A identifies the base module.
				if row[48] != "A" {
					continue
				}
				found = true
				for index, answer := range tc.answers {
					want := "0"
					if answer == nil || answer == "" {
						want = "No answer"
					}
					if answer == ".6667" || answer == "4/6" || answer == "0.667" {
						want = "1"
					}
					if tc.legacyPolicy && want == "1" {
						want = "0"
					}
					if row[21+index] != want {
						t.Fatalf("export Q%d=%q want %q", index+1, row[21+index], want)
					}
				}
			}
			if !found {
				t.Fatalf("export omitted Math Module 1: %+v", exported.Rows)
			}
		})
	}
}
