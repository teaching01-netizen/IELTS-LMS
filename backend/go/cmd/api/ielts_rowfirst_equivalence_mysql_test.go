package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/answerhistory"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/student"
)

// ieltsEquivalenceStep is one save request of the scripted IELTS session.
type ieltsEquivalenceStep struct {
	name     string
	commands []attempts.ResponseCommand
}

// ieltsEquivalenceView is everything a reader can observe about one scripted
// attempt, with attempt-specific identifiers and clocks left out.
type ieltsEquivalenceView struct {
	Saves           []ieltsEquivalenceSave
	Cells           map[string]ieltsEquivalenceCell
	SessionAnswers  map[string]any
	BootstrapFlags  map[string]any
	FinalDigest     string
	FinalSubmission map[string]any
	History         map[string]any
}

type ieltsEquivalenceSave struct {
	Error            string
	Acks             []attempts.Ack
	ResponseRevision uint64
	Replayed         bool
}

type ieltsEquivalenceCell struct {
	Response       map[string]any
	ResponseHash   string
	ClientVersion  uint64
	ServerRevision uint64
}

func decodeJSONObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %q: %v", raw, err)
	}
	return out
}

// runIELTSEquivalenceScript drives one fresh attempt through readiness, the
// scripted saves and submit with row-first writes on or off.
func runIELTSEquivalenceScript(t *testing.T, rowFirst, interpolate bool, section string, steps []ieltsEquivalenceStep) ieltsEquivalenceView {
	t.Helper()
	f := seedIELTSLoadFixture(t, 1, 1, []string{section}, 8)
	svc := newIELTSBudgetServices(t, rowFirst, interpolate)
	c := f.candidates[0]
	ctx := context.Background()
	ready := true
	readiness, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, section, c.AttemptID, c.UserID, nil,
		examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready})
	if err != nil || readiness.Status != "active" {
		t.Fatalf("readiness: %+v %v", readiness, err)
	}
	var view ieltsEquivalenceView
	for _, step := range steps {
		result, err := svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
			AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: step.commands,
		}, v2Resolver{}, v2Locker{})
		if err != nil {
			// A rejected request is part of the observable contract too.
			appErr, ok := apperrors.As(err)
			if !ok {
				t.Fatalf("%s: %v", step.name, err)
			}
			view.Saves = append(view.Saves, ieltsEquivalenceSave{Error: string(appErr.Code) + ": " + appErr.Message})
			continue
		}
		view.Saves = append(view.Saves, ieltsEquivalenceSave{Acks: result.Acks, ResponseRevision: result.ResponseRevision, Replayed: result.Replayed})
	}

	rows, err := f.db.Query(`SELECT question_id, CAST(response AS CHAR), response_hash, client_version, server_revision FROM attempt_responses_v2 WHERE attempt_id = ?`, c.AttemptID)
	if err != nil {
		t.Fatal(err)
	}
	view.Cells = map[string]ieltsEquivalenceCell{}
	for rows.Next() {
		var id, raw string
		var cell ieltsEquivalenceCell
		if err := rows.Scan(&id, &raw, &cell.ResponseHash, &cell.ClientVersion, &cell.ServerRevision); err != nil {
			t.Fatal(err)
		}
		cell.Response = decodeJSONObject(t, []byte(raw))
		view.Cells[id] = cell
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}

	// The live student read views: blob columns with row-first off, the
	// row materializer with it on.
	reader := student.NewService(svc.pool, nil).SetRowFirst(rowFirst)
	session, err := reader.GetSession(ctx, c.AttemptID)
	if err != nil {
		t.Fatal(err)
	}
	view.SessionAnswers = decodeJSONObject(t, session.Answers)
	bootstrap, err := reader.Bootstrap(ctx, c.AttemptID)
	if err != nil {
		t.Fatal(err)
	}
	view.BootstrapFlags = decodeJSONObject(t, bootstrap.Flags)

	endIELTSSectionsForSubmit(t, f.db, "a.id = ?", c.AttemptID)
	submitted, err := svc.saver.Submit(ctx, c.Token, attempts.SubmitCommand{
		AttemptID: c.AttemptID, LeaseEpoch: 1, ExpectedControlEpoch: 1, SubmissionID: uuid.NewString(), ActorKind: "student",
	}, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, svc.sealer)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	view.FinalDigest = submitted.FinalDigest
	var final sql.NullString
	if err := f.db.QueryRow(`SELECT CAST(final_submission AS CHAR) FROM student_attempts WHERE id = ?`, c.AttemptID).Scan(&final); err != nil {
		t.Fatal(err)
	}
	sealed := decodeJSONObject(t, []byte(final.String))
	view.FinalSubmission = map[string]any{"answers": sealed["answers"], "writingAnswers": sealed["writingAnswers"], "flags": sealed["flags"], "providerKey": sealed["providerKey"]}

	overview, err := answerhistory.NewService(svc.pool).GetOverviewByAttempt(ctx, c.AttemptID)
	if err != nil {
		t.Fatal(err)
	}
	history := decodeJSONObject(t, overview)
	view.History = map[string]any{
		"questionSummaries": history["questionSummaries"], "sectionStats": history["sectionStats"],
		"totalRevisions": history["totalRevisions"], "totalTargetsEdited": history["totalTargetsEdited"],
	}
	return view
}

func ieltsCommand(writeID, questionID string, version uint64, answer any, marked bool) attempts.ResponseCommand {
	return attempts.ResponseCommand{
		WriteID: writeID, QuestionID: questionID, ClientVersion: version,
		Response: attempts.ResponsePayload{Answer: answer, MarkedForReview: marked},
	}
}

// TestIELTSRowFirstEquivalenceMySQL qualifies ROW_FIRST_WRITES and the
// interpolateParams DSN option for IELTS, independently and together: the
// same scripted session (flags set and cleared, an answer cleared, edge-case
// characters, a superseded stale write, an exact replay and long Writing
// edits) produces identical acknowledgements, cells, student read views,
// sealed submission, digest and answer-history overview as the deployed
// defaults.
func TestIELTSRowFirstEquivalenceMySQL(t *testing.T) {
	// Control characters other than tab/CR/LF are rejected by contract.
	edge := "ไทย \"quoted\" \\ back\\slash\ttab\r\nnewline 😀 ' -- ; DROP TABLE x; \u2028?"
	longEssay := strings.Repeat("The chart compares café visits — ‘quoted’ \"double\" \\path\\ 数字 123.\n", 220)
	// Edits set and clear flags, clear an answer, and send version 5 then 4
	// of one question in the same batch (the older one is superseded).
	edits := []attempts.ResponseCommand{
		ieltsCommand("l-5", "listening-q001", 2, "C", false),
		ieltsCommand("l-6", "listening-q002", 2, "B", false),
		ieltsCommand("l-7", "listening-q003", 2, nil, false),
		ieltsCommand("l-8", "listening-q001", 3, "D", true),
		ieltsCommand("l-11", "listening-q004", 5, "late", false),
		ieltsCommand("l-12", "listening-q004", 4, "older", false),
	}
	cases := []struct {
		section string
		steps   []ieltsEquivalenceStep
	}{
		{"listening", []ieltsEquivalenceStep{
			{"first batch", []attempts.ResponseCommand{
				ieltsCommand("l-1", "listening-q001", 1, "A", false),
				ieltsCommand("l-2", "listening-q002", 1, "B", true),
				ieltsCommand("l-3", "listening-q003", 1, edge, false),
				ieltsCommand("l-4", "listening-q004", 1, []any{"x", 1.5, map[string]any{"k": "v"}}, false),
			}},
			{"edits", edits},
			{"version collision", []attempts.ResponseCommand{ieltsCommand("l-9", "listening-q001", 1, "Z", false)}},
			{"exact replay", edits},
			{"single save", []attempts.ResponseCommand{ieltsCommand("l-10", "listening-q005", 1, "E", false)}},
		}},
		{"writing", []ieltsEquivalenceStep{
			{"drafts", []attempts.ResponseCommand{
				ieltsCommand("w-1", "writing-task-1", 1, longEssay, false),
				ieltsCommand("w-2", "writing-task-2", 1, edge, false),
			}},
			{"long edit", []attempts.ResponseCommand{ieltsCommand("w-3", "writing-task-1", 2, longEssay+longEssay, false)}},
			{"flag task 2", []attempts.ResponseCommand{ieltsCommand("w-4", "writing-task-2", 2, edge+" revised", true)}},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.section, func(t *testing.T) {
			// Baseline: the deployed defaults (row-first off, binary protocol).
			off := runIELTSEquivalenceScript(t, false, false, tc.section, tc.steps)
			for i, save := range off.Saves {
				t.Logf("%s: revision %d replayed=%v outcomes=%v %s", tc.steps[i].name, save.ResponseRevision, save.Replayed, ackOutcomes(save.Acks), save.Error)
			}
			for _, variant := range []struct{ rowFirst, interpolate bool }{{true, false}, {false, true}, {true, true}} {
				got := runIELTSEquivalenceScript(t, variant.rowFirst, variant.interpolate, tc.section, tc.steps)
				if !reflect.DeepEqual(off, got) {
					offJSON, _ := json.MarshalIndent(off, "", " ")
					gotJSON, _ := json.MarshalIndent(got, "", " ")
					t.Fatalf("rowFirst=%v interpolate=%v changes observable IELTS state\n baseline: %s\n  variant: %s", variant.rowFirst, variant.interpolate, offJSON, gotJSON)
				}
			}
			// The script's own expectations, independent of either mode.
			if tc.section == "listening" {
				answers, _ := off.FinalSubmission["answers"].(map[string]any)
				flags, _ := off.FinalSubmission["flags"].(map[string]any)
				if answers["listening-q001"] != "D" || answers["listening-q002"] != "B" || answers["listening-q003"] != nil ||
					answers["listening-q004"] != "late" || answers["listening-q005"] != "E" ||
					flags["listening-q001"] != true || flags["listening-q002"] != nil {
					t.Fatalf("sealed answers/flags do not match the script: answers=%v flags=%v", answers, flags)
				}
				if older := off.Saves[1].Acks[5]; older.Outcome == "applied" {
					t.Fatalf("an older version in the same batch must not apply: %+v", older)
				}
				if !strings.HasPrefix(off.Saves[2].Error, string(apperrors.CodeVersionCollision)) {
					t.Fatalf("a reused client version must collide, got %+v", off.Saves[2])
				}
				if !off.Saves[3].Replayed {
					t.Fatal("the repeated batch must replay")
				}
			} else {
				writing, _ := off.FinalSubmission["writingAnswers"].(map[string]any)
				if writing["writing-task-1"] != longEssay+longEssay || writing["writing-task-2"] != edge+" revised" {
					t.Fatalf("sealed Writing answers do not match the script (task 1 has %d bytes)", len(fmt.Sprint(writing["writing-task-1"])))
				}
			}
		})
	}
}

func ackOutcomes(acks []attempts.Ack) []string {
	out := make([]string, len(acks))
	for i, ack := range acks {
		out[i] = ack.Outcome
	}
	return out
}
