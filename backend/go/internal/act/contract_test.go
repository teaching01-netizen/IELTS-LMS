package act

// Phase 01 ACT domain-contract locks (ai-planning-workflow, Phase 01).
//
// These tests pin the canonical ACT Science contract against the real Go
// implementation (backend/go/internal/act is authoritative): normalization of
// nested vs compact alias snapshots, scoring semantics, client-score
// rejection, null verdicts, image-reference durability, and legacy ACT+ielts
// identity planning. Fixtures live in testdata/ and are shared inputs only.
// No product source is modified by this file.
//
// Acceptance coverage: AT-04 (normalization), AT-05 (legacy identity),
// AT-06 (redacted delivery), AT-07 (durability shapes), AT-08 (scoring),
// AT-09 (sealed immutability inputs), AT-10 (results/null verdicts),
// AT-11 (images). AT-01/AT-12 SAT regression is covered on the TS side.

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
)

func mustLoadContractFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode fixture %s: %v", name, err)
	}
	return decoded
}

func mustLoadContractFixtureRaw(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(raw)
}

func contractAnswers(t *testing.T, name string) []Answer {
	t.Helper()
	fixture := mustLoadContractFixture(t, name)
	encoded, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	answers := decodeAnswers(encoded)
	if len(answers) == 0 {
		t.Fatalf("fixture %s decoded to no answers", name)
	}
	return answers
}

func contractAnswerMap(answers []Answer) map[string]any {
	out := map[string]any{}
	for _, a := range answers {
		out[a.QuestionID] = a.Answer
	}
	return out
}

// AT-01 identity fragment: wire provider key is lowercase act, exam type is
// ACT, section key is lowercase science.
func TestContractIdentityKeys(t *testing.T) {
	if examdomain.ProviderACT != "act" {
		t.Fatalf("provider key must be lowercase act, got %q", examdomain.ProviderACT)
	}
	if ExamTypeACT != "ACT" {
		t.Fatalf("exam type must be ACT, got %q", ExamTypeACT)
	}
	if examdomain.ExamTypeACT != "ACT" {
		t.Fatalf("domain exam type must be ACT, got %q", examdomain.ExamTypeACT)
	}
	if SectionScience != "science" {
		t.Fatalf("section key must be lowercase science, got %q", SectionScience)
	}
	if !examdomain.ValidSectionKey(examdomain.ProviderACT, SectionScience) {
		t.Fatal("science must be a valid section key for provider act")
	}
	if examdomain.ValidSectionKey(examdomain.ProviderIELTS, SectionScience) {
		t.Fatal("science must not validate as a genuine IELTS section key")
	}
}

// AT-04: nested authoring snapshots, the compact scoring projection, and
// alias spellings normalize to an identical ordered key.
func TestContractNormalizationNestedCompactAliases(t *testing.T) {
	nested := normalizeScienceContent(mustLoadContractFixture(t, "nested_science_content.json"))
	compact := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	alias := normalizeScienceContent(mustLoadContractFixture(t, "alias_variant_content.json"))

	wantOrder := []string{"q1", "q2", "q3"}
	for name, content := range map[string]map[string]any{"nested": nested, "compact": compact, "alias": alias} {
		if got := orderedQuestions(content); !slices.Equal(got, wantOrder) {
			t.Fatalf("%s ordered key = %v, want %v", name, got, wantOrder)
		}
	}

	nestedKey := answerKeyFromContent(nested)
	compactKey := answerKeyFromContent(compact)
	aliasKey := answerKeyFromContent(alias)
	if !reflect.DeepEqual(nestedKey, compactKey) {
		t.Fatalf("nested vs compact key mismatch: %#v vs %#v", nestedKey, compactKey)
	}
	if !reflect.DeepEqual(aliasKey, compactKey) {
		t.Fatalf("alias vs compact key mismatch: %#v vs %#v", aliasKey, compactKey)
	}
	if nestedKey["q1"] != "q1-B" || nestedKey["q2"] != "q2-A" || nestedKey["q3"] != "q3-C" {
		t.Fatalf("unexpected normalized key: %#v", nestedKey)
	}
}

// AT-04/AT-10: isCorrect-derived keys resolve from options; keyless draft
// questions stay keyless (never a fabricated incorrect).
func TestContractOptionsDerivedKeysAndKeyless(t *testing.T) {
	content := normalizeScienceContent(mustLoadContractFixture(t, "options_only_content.json"))
	key := answerKeyFromContent(content)
	if key["q1"] != "q1-B" {
		t.Fatalf("expected options-derived key q1=q1-B, got %#v", key)
	}
	if _, ok := key["q-keyless"]; ok {
		t.Fatalf("keyless draft question must not gain a key: %#v", key)
	}
	if got := orderedQuestions(content); !slices.Contains(got, "q-keyless") {
		t.Fatalf("keyless question must retain order position, got %v", got)
	}
}

// AT-05: ACT+ielts legacy rows plan as act; genuine IELTS/SAT rows are
// untouched by the repair rule.
func TestContractLegacyIdentityPlansScience(t *testing.T) {
	cases := []struct {
		name        string
		providerKey string
		examType    string
		want        string
	}{
		{"canonical act row stays act", examdomain.ProviderACT, examdomain.ExamTypeACT, examdomain.ProviderACT},
		{"legacy ACT+ielts heals to act", examdomain.ProviderIELTS, examdomain.ExamTypeACT, examdomain.ProviderACT},
		{"legacy ACT with blank provider heals to act", "", examdomain.ExamTypeACT, examdomain.ProviderACT},
		{"genuine IELTS academic is preserved", examdomain.ProviderIELTS, examdomain.ExamTypeAcademic, examdomain.ProviderIELTS},
		{"genuine IELTS general is preserved", examdomain.ProviderIELTS, examdomain.ExamTypeGeneralTraining, examdomain.ProviderIELTS},
		{"sat is preserved", examdomain.ProviderSAT, examdomain.ExamTypeAcademic, examdomain.ProviderSAT},
	}
	for _, tc := range cases {
		if got := examdomain.EffectiveProviderKey(tc.providerKey, tc.examType); got != tc.want {
			t.Fatalf("%s: EffectiveProviderKey(%q, %q) = %q, want %q", tc.name, tc.providerKey, tc.examType, got, tc.want)
		}
	}
	// The healed identity must admit the science section for runtime planning.
	if !examdomain.ValidSectionKey(examdomain.EffectiveProviderKey(examdomain.ProviderIELTS, examdomain.ExamTypeACT), SectionScience) {
		t.Fatal("healed legacy ACT identity must accept the science section key")
	}
}

// AT-08: full marks via fixtures (exact + trim/case-insensitive + null
// unanswered across canonical and legacy-nested answer maps).
func TestContractScoringFixtureAnswers(t *testing.T) {
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	for _, name := range []string{"answers_canonical.json", "answers_nested.json"} {
		score, err := ComputeScienceScore(map[string]any{}, content, contractAnswers(t, name), time.Now().UTC())
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		// q1 exact, q2 trim/case-insensitive, q3 null unanswered.
		if score.TotalScore != 2 || score.MaxScore != 3 {
			t.Fatalf("%s score = %+v, want total 2 max 3", name, score)
		}
	}
}

// AT-07/AT-08: blank/whitespace/null are unanswered (zero, never an error)
// and unknown IDs are excluded from scoring entirely.
func TestContractScoringBlankUnknownExcluded(t *testing.T) {
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	answers := contractAnswers(t, "answers_edge.json")
	byID := contractAnswerMap(answers)
	if _, ok := byID["unknown-q9"]; !ok {
		t.Fatal("edge fixture must carry the unknown audit-only ID")
	}
	score, err := ComputeScienceScore(map[string]any{}, content, answers, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 0 {
		t.Fatalf("blank/null answers must score zero, got %+v", score)
	}
	if score.MaxScore != 3 {
		t.Fatalf("unknown IDs must not inflate maxScore, got %+v", score)
	}
}

// AT-08: per-question weights scale total and max deterministically.
func TestContractScoringWeights(t *testing.T) {
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	config := map[string]any{"weights": []any{float64(2), float64(1), float64(3)}}
	score, err := ComputeScienceScore(config, content, []Answer{
		{QuestionID: "q1", Answer: "q1-B"},
		{QuestionID: "q2", Answer: "wrong"},
		{QuestionID: "q3", Answer: "q3-C"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 5 || score.MaxScore != 6 {
		t.Fatalf("weighted score = %+v, want total 5 max 6", score)
	}
}

// AT-08: empty scorable content errors instead of returning a silent zero.
func TestContractScoringEmptyContentErrors(t *testing.T) {
	if _, err := ComputeScienceScore(map[string]any{}, map[string]any{}, nil, time.Now().UTC()); err == nil {
		t.Fatal("empty content must error, not score zero")
	}
	if _, err := ComputeScienceScore(map[string]any{}, map[string]any{"questions": []any{}}, nil, time.Now().UTC()); err == nil {
		t.Fatal("empty questions list must error, not score zero")
	}
}

// AT-08: numeric/string coercion is forbidden unless explicitly normalized.
func TestContractNoNumericStringCoercion(t *testing.T) {
	content := map[string]any{"questions": []any{
		map[string]any{"questionId": "qn", "correctAnswer": float64(7)},
	}}
	coerced, err := ComputeScienceScore(map[string]any{}, content, []Answer{{QuestionID: "qn", Answer: "7"}}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if coerced.TotalScore != 0 {
		t.Fatalf("string \"7\" must not match numeric key 7: %+v", coerced)
	}
	exact, err := ComputeScienceScore(map[string]any{}, content, []Answer{{QuestionID: "qn", Answer: float64(7)}}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if exact.TotalScore != 1 {
		t.Fatalf("numeric 7 must match numeric key 7: %+v", exact)
	}
}

// AT-08: client-supplied scores are rejected before any seal write happens.
func TestContractClientScoreRejected(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	if _, err := SealScienceScore(context.Background(), db, "attempt-1", map[string]any{}, content, nil, true); err == nil {
		t.Fatal("client-supplied score must be rejected")
	} else if !strings.Contains(err.Error(), "server-authoritative") {
		t.Fatalf("rejection must name server authority, got: %v", err)
	}
	// Rejection happens before SQL: zero statements may have run.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

type captureString struct{ ptr *string }

func (c captureString) Match(v driver.Value) bool {
	s, ok := v.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return false
	}
	*c.ptr = s
	return true
}

// AT-08/AT-09: seal recomputes from sealed content + persisted answers and
// stamps the canonical provider/section identity atomically.
func TestContractSealWritesCanonicalIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT final_submission FROM student_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"final_submission"}).AddRow(`{"phase":"post-exam"}`))
	var written string
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET final_submission = ? WHERE id = ?")).
		WithArgs(captureString{&written}, "attempt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	score, err := SealScienceScore(context.Background(), db, "attempt-1", map[string]any{}, content, []Answer{
		{QuestionID: "q1", Answer: "q1-B"},
		{QuestionID: "q2", Answer: "q2-A"},
		{QuestionID: "q3", Answer: "q3-C"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 3 || score.MaxScore != 3 || score.Percentage != 100 {
		t.Fatalf("seal score = %+v, want full marks", score)
	}
	var merged map[string]any
	if err := json.Unmarshal([]byte(written), &merged); err != nil {
		t.Fatalf("seal write is not JSON: %v", err)
	}
	if merged["providerKey"] != "act" || merged["section"] != SectionScience {
		t.Fatalf("seal must stamp provider act + section science, got %#v", merged)
	}
	sealed, ok := merged["score"].(map[string]any)
	if !ok || sealed["totalScore"] != float64(3) || sealed["maxScore"] != float64(3) {
		t.Fatalf("seal must embed the computed score, got %#v", merged["score"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// AT-06: the terminal scoring projection carries only server-owned fields —
// aggregate score plus canonical identity, never keys or student payloads.
// Nested and flattened legacy answer maps converge to the same score.
func TestContractScoreAttemptRedactedProjection(t *testing.T) {
	nestedRaw := mustLoadContractFixtureRaw(t, "nested_science_content.json")
	canonicalRaw := mustLoadContractFixtureRaw(t, "answers_canonical.json")
	legacyNested := mustLoadContractFixtureRaw(t, "answers_nested.json")
	var lastProjection map[string]any
	for _, answersRaw := range []json.RawMessage{json.RawMessage(canonicalRaw), json.RawMessage(legacyNested)} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectQuery(regexp.QuoteMeta("SELECT config_snapshot, content_snapshot FROM exam_versions WHERE id = ?")).
			WithArgs("version-1").
			WillReturnRows(sqlmock.NewRows([]string{"config_snapshot", "content_snapshot"}).AddRow(`{}`, nestedRaw))
		projection, err := NewService(db, nil).ScoreAttempt(context.Background(), db, "attempt-1", "version-1", answersRaw)
		db.Close()
		if err != nil {
			t.Fatal(err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		if len(projection) != 3 {
			t.Fatalf("projection must carry exactly score/providerKey/section, got %v", projection)
		}
		if projection["providerKey"] != "act" || projection["section"] != SectionScience {
			t.Fatalf("projection identity wrong: %#v", projection)
		}
		for _, leaked := range []string{"questions", "correctAnswer", "content", "answers"} {
			if _, ok := projection[leaked]; ok {
				t.Fatalf("projection must not leak %q to students: %#v", leaked, projection)
			}
		}
		lastProjection = projection
	}
	first := lastProjection["score"].(Score)
	if first.TotalScore != 2 || first.MaxScore != 3 {
		t.Fatalf("nested/flattened answers must converge to 2/3, got %+v", first)
	}
}

// AT-10: ordered detail replays the sealed key; verdicts are null for
// unanswered or keyless rows and never render as incorrect.
func TestContractNullVerdicts(t *testing.T) {
	snap := mustLoadContractFixture(t, "result_sealed.json")
	questions := buildScienceQuestions(snap)
	if len(questions) != 3 {
		t.Fatalf("expected 3 ordered detail rows, got %+v", questions)
	}
	byID := map[string]ScienceQuestion{}
	for _, q := range questions {
		byID[q.QuestionID] = q
	}
	if questions[0].QuestionID != "q1" || questions[1].QuestionID != "q2" || questions[2].QuestionID != "q3" {
		t.Fatalf("detail must follow sealed key order, got %+v", questions)
	}
	// Case-insensitive convention: "a" matches sealed key "A".
	if byID["q1"].IsCorrect == nil || !*byID["q1"].IsCorrect {
		t.Fatalf("expected q1 correct, got %+v", byID["q1"])
	}
	if byID["q2"].IsCorrect == nil || *byID["q2"].IsCorrect {
		t.Fatalf("expected q2 incorrect, got %+v", byID["q2"])
	}
	if byID["q3"].IsCorrect != nil || byID["q3"].Answered {
		t.Fatalf("expected q3 unanswered null verdict, got %+v", byID["q3"])
	}
	// Legacy keyless rows surface with a null verdict instead of vanishing.
	keyless := mustLoadContractFixture(t, "result_keyless.json")
	keylessRows := buildScienceQuestions(keyless)
	if len(keylessRows) != 1 || keylessRows[0].QuestionID != "q-legacy-1" {
		t.Fatalf("keyless answer must surface audit-only, got %+v", keylessRows)
	}
	if keylessRows[0].IsCorrect != nil {
		t.Fatalf("keyless row verdict must be null, got %+v", keylessRows[0])
	}
	// Null verdicts serialize as JSON null (clients must not read them as false).
	encoded, err := json.Marshal(byID["q3"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"isCorrect":null`) {
		t.Fatalf("unanswered verdict must serialize as null, got %s", encoded)
	}
}

// AT-10: result loading reads the persisted aggregate; missing inputs stay
// missing without fabrication.
func TestContractLoadResultShapes(t *testing.T) {
	if got, err := LoadResultForAttempt(context.Background(), nil, "attempt-1"); got != nil || err != nil {
		t.Fatalf("nil db must yield nil result, got %#v %v", got, err)
	}
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if got, err := LoadResultForAttempt(context.Background(), db, "  "); got != nil || err != nil {
		t.Fatalf("blank attempt id must yield nil result, got %#v %v", got, err)
	}
	db2, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "submission_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).
			AddRow("res-1", "sub-1", "act", "scored", int64(2), `{"totalScore":2,"maxScore":3}`, "ready_to_release"))
	result, err := LoadResultForAttempt(context.Background(), db2, "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if result["providerKey"] != "act" || result["totalScore"] != int64(2) {
		t.Fatalf("unexpected persisted result: %#v", result)
	}
	if payload, ok := result["scorePayload"].(map[string]any); !ok || payload["maxScore"] != float64(3) {
		t.Fatalf("score payload must decode intact, got %#v", result["scorePayload"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// AT-03 count policy fragment: the 40-question target is a warning, never a
// scoring gate — non-40 sealed content scores normally.
func TestContractQuestionCountMismatchDoesNotBlockScoring(t *testing.T) {
	content := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	if n := len(orderedQuestions(content)); n == 40 {
		t.Fatalf("contract fixture must stay off-target to prove warning-only, got %d", n)
	}
	score, err := ComputeScienceScore(map[string]any{}, content, []Answer{
		{QuestionID: "q1", Answer: "q1-B"},
		{QuestionID: "q2", Answer: "q2-A"},
		{QuestionID: "q3", Answer: "q3-C"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("off-target count must not block scoring: %v", err)
	}
	if score.TotalScore != 3 || score.MaxScore != 3 {
		t.Fatalf("off-target score wrong: %+v", score)
	}
}

// AT-11: images are durable asset references, never new data URLs; sealed
// snapshots keep the same stable reference.
func TestContractImageRefsDurable(t *testing.T) {
	raw := mustLoadContractFixtureRaw(t, "nested_science_content.json")
	if strings.Contains(raw, "data:") {
		t.Fatal("authoring snapshot must not embed data URLs")
	}
	asset := mustLoadContractFixture(t, "image_reference.json")
	for _, field := range []string{"id", "alt", "src", "crop"} {
		if _, ok := asset[field]; !ok {
			t.Fatalf("image reference must carry %q, got %#v", field, asset)
		}
	}
	src, _ := asset["src"].(string)
	if strings.TrimSpace(src) == "" || strings.HasPrefix(src, "data:") {
		t.Fatalf("image src must be a durable reference, got %q", src)
	}
	nested := mustLoadContractFixture(t, "nested_science_content.json")
	science, _ := nested["science"].(map[string]any)
	stimuli, _ := science["stimuli"].([]any)
	first, _ := stimuli[0].(map[string]any)
	images, _ := first["images"].([]any)
	if len(images) != 1 {
		t.Fatalf("nested fixture must carry one stimulus image, got %#v", first["images"])
	}
	sealed, _ := images[0].(map[string]any)
	if sealed["id"] != asset["id"] || sealed["src"] != asset["src"] {
		t.Fatalf("sealed snapshot must keep the stable image reference: %#v vs %#v", sealed, asset)
	}
}

// AT-10 payload shape: sealed results persist the aggregate plus canonical
// identity; score fields keep their int/int/float types.
func TestContractResultPayloadShapes(t *testing.T) {
	snap := mustLoadContractFixture(t, "result_sealed.json")
	if snap["providerKey"] != "act" || snap["section"] != SectionScience {
		t.Fatalf("result must carry provider act + section science, got %#v", snap)
	}
	score, ok := snap["score"].(map[string]any)
	if !ok {
		t.Fatalf("result must embed a score aggregate, got %#v", snap["score"])
	}
	if _, ok := score["totalScore"].(float64); !ok {
		t.Fatalf("totalScore must be numeric, got %#v", score["totalScore"])
	}
	if _, ok := score["maxScore"].(float64); !ok {
		t.Fatalf("maxScore must be numeric, got %#v", score["maxScore"])
	}
	if _, ok := score["percentage"].(float64); !ok {
		t.Fatalf("percentage must be numeric, got %#v", score["percentage"])
	}
}
