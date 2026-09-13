package authoringrealtime

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func strptr(s string) *string { return &s }

func validEventJSON(t *testing.T, mutate func(m map[string]any)) []byte {
	t.Helper()
	m := map[string]any{
		"version":       1,
		"kind":          "question.changed",
		"eventId":       "evt-1",
		"occurredAt":    "2026-09-12T00:00:00Z",
		"actor":         map[string]any{"id": "user-alice", "kind": "staff"},
		"scope":         map[string]any{"organizationId": "org-1", "examId": "exam-1", "draftVersionId": "draft-7"},
		"entity":        map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": "q-1", "moduleId": "m-1"},
		"revision":      3,
		"changedFields": []any{"prompt", "answer"},
	}
	if mutate != nil {
		mutate(m)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	return raw
}

func TestParse_ValidQuestionChanged(t *testing.T) {
	e, err := Parse(validEventJSON(t, nil))
	if err != nil {
		t.Fatalf("Parse valid: %v", err)
	}
	if e.Kind != KindQuestionChanged || e.Revision != 3 {
		t.Fatalf("unexpected event: %+v", e)
	}
	if e.Entity.QuestionID == nil || *e.Entity.QuestionID != "q-1" {
		t.Fatalf("question pointer must round-trip")
	}
}

func TestParse_AllKinds(t *testing.T) {
	cases := []struct {
		kind   Kind
		entity map[string]any
	}{
		{KindQuestionChanged, map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": "q-1", "moduleId": "m-1"}},
		{KindQuestionCreated, map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": "q-1", "moduleId": "m-1"}},
		{KindQuestionDeleted, map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": nil, "moduleId": "m-1"}},
		{KindQuestionMoved, map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": "q-1", "moduleId": "m-1"}},
		{KindQuestionDuplicated, map[string]any{"kind": "question", "examQuestionId": "eq-2", "questionId": "q-2", "moduleId": "m-1"}},
		{KindQuestionBulkChanged, map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": "q-1", "moduleId": "m-1"}},
		{KindExamChanged, map[string]any{"kind": "exam", "examId": "exam-1"}},
		{KindDraftOpened, map[string]any{"kind": "draft", "examId": "exam-1", "draftVersionId": "draft-7"}},
		{KindDraftReplaced, map[string]any{"kind": "draft", "examId": "exam-1", "draftVersionId": "draft-8"}},
		{KindExamPublished, map[string]any{"kind": "exam", "examId": "exam-1"}},
	}
	if len(cases) != 10 {
		t.Fatalf("vocabulary must hold 10 kinds, got %d", len(cases))
	}
	for _, tc := range cases {
		e, err := Parse(validEventJSON(t, func(m map[string]any) {
			m["kind"] = string(tc.kind)
			m["entity"] = tc.entity
		}))
		if err != nil {
			t.Fatalf("Parse %s: %v", tc.kind, err)
		}
		if e.Kind != tc.kind {
			t.Fatalf("kind mismatch: got %s want %s", e.Kind, tc.kind)
		}
	}
}

func TestParse_DomainCarriesNoCursor(t *testing.T) {
	raw := validEventJSON(t, nil)
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := v["sequenceId"]; ok {
		t.Fatal("domain payload must not contain sequenceId")
	}
	if _, ok := v["cursor"]; ok {
		t.Fatal("domain payload must not contain cursor")
	}
	f := Frame{Type: "authoring.event", Cursor: 384}
	fe, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse frame event: %v", err)
	}
	f.Event = fe
	fraw, _ := json.Marshal(f)
	if !strings.Contains(string(fraw), "\"cursor\":384") {
		t.Fatal("frame must carry the cursor")
	}
}

func TestParse_UnknownKind_Tolerated(t *testing.T) {
	raw := validEventJSON(t, func(m map[string]any) {
		m["kind"] = "question.pinned"
	})
	c, err := Classify(raw)
	if err != nil {
		t.Fatalf("classify unknown kind must not error: %v", err)
	}
	if c.Status != "unknown-kind" {
		t.Fatalf("status must be unknown-kind, got %s", c.Status)
	}
}

func TestClassify_UnsupportedVersionNeverInterprets(t *testing.T) {
	raw := validEventJSON(t, func(m map[string]any) {
		m["kind"] = "question.changed"
		m["version"] = 2
	})
	c, err := Classify(raw)
	if err != nil {
		t.Fatalf("classify v2 must not error: %v", err)
	}
	if c.Status != "unsupported-version" || c.Version != 2 {
		t.Fatalf("v2 familiar kind must be unsupported-version, got %+v", c)
	}
}

func TestParse_AdditiveEvolutionTolerated(t *testing.T) {
	raw := validEventJSON(t, func(m map[string]any) {
		m["futureNote"] = "added by v2 writer"
	})
	if _, err := Parse(raw); err != nil {
		t.Fatalf("additive field must be ignored: %v", err)
	}
}

func TestValidate_RejectsMissingScope(t *testing.T) {
	if _, err := Parse(validEventJSON(t, func(m map[string]any) { m["scope"] = map[string]any{} })); err == nil {
		t.Fatal("missing scope must fail")
	}
}

func TestValidate_RejectsBadEntity(t *testing.T) {
	if _, err := Parse(validEventJSON(t, func(m map[string]any) {
		m["entity"] = map[string]any{"kind": "question", "examQuestionId": "", "questionId": nil, "moduleId": nil}
	})); err == nil {
		t.Fatal("bad entity must fail")
	}
}

func TestValidate_RejectsVersionZero(t *testing.T) {
	if _, err := Parse(validEventJSON(t, func(m map[string]any) { m["version"] = 0 })); err == nil {
		t.Fatal("version 0 must fail")
	}
	c, err := Classify(validEventJSON(t, func(m map[string]any) {
		m["version"] = 0
	}))
	if err != nil {
		t.Fatalf("classify v0 must not error: %v", err)
	}
	if c.Status != "unsupported-version" {
		t.Fatal("v0 must classify unsupported-version")
	}
}

func TestValidate_RejectsOversizeAffectedIDs(t *testing.T) {
	ids := make([]any, 0, 201)
	for i := 0; i < 201; i++ {
		ids = append(ids, "eq-x")
	}
	if _, err := Parse(validEventJSON(t, func(m map[string]any) {
		m["affectedExamQuestionIds"] = ids
	})); err == nil {
		t.Fatal("201 affected ids must fail")
	}
}

func TestShouldProcessCursor(t *testing.T) {
	if !ShouldProcessCursor(381, 384) {
		t.Fatal("381->384 is valid on a filtered cursor")
	}
	if !ShouldProcessCursor(41, 42) {
		t.Fatal("41->42 processes")
	}
	if ShouldProcessCursor(41, 41) || ShouldProcessCursor(41, 40) {
		t.Fatal("duplicate/stale must not process")
	}
}

func TestSortFramesByCursor(t *testing.T) {
	now := time.Now().UTC()
	mk := func(cursor int64, id string) Frame {
		return Frame{Type: "authoring.event", Cursor: cursor, Event: Event{Version: 1, Kind: KindQuestionChanged, EventID: id, OccurredAt: now, Actor: Actor{ID: "u", Kind: "staff"}, Scope: Scope{OrganizationID: strptr("o"), ExamID: "e", DraftVersionID: "d"}, Entity: Entity{Kind: EntityQuestion, ExamQuestionID: "eq", QuestionID: strptr("q"), ModuleID: strptr("m")}, Revision: 1}}
	}
	in := []Frame{mk(5, "b"), mk(3, "a"), mk(5, "a")}
	SortFramesByCursor(in)
	if in[0].Cursor != 3 || in[1].Event.EventID != "a" || in[2].Event.EventID != "b" {
		t.Fatalf("bad order: %+v", in)
	}
}

func TestNewChangedFields_AllowsKnownDropsUnknown(t *testing.T) {
	got := NewChangedFields("prompt", "not-a-field", "answer")
	if len(got) != 2 || got[0] != "prompt" || got[1] != "answer" {
		t.Fatalf("allow-list failed: %v", got)
	}
}

func TestErrorCodes_StatusMapping(t *testing.T) {
	if len(AllDomainCodes) != 7 {
		t.Fatalf("vocabulary must hold 7 codes, got %d", len(AllDomainCodes))
	}
	cases := map[DomainCode]int{
		CodeRevisionConflict: http.StatusConflict, CodeDraftReplaced: http.StatusConflict, CodeDraftNotEditable: http.StatusConflict,
		CodePermissionDenied: http.StatusForbidden, CodeSubscriptionForbidden: http.StatusForbidden,
		CodeEntityDeleted: http.StatusGone, CodeCursorTooOld: http.StatusGone,
	}
	for code, want := range cases {
		e := code.ToAppError("probe")
		if e.HTTPStatus != want {
			t.Fatalf("%s status: got %d want %d", code, e.HTTPStatus, want)
		}
		if e.Details["authoringReason"] != string(code) {
			t.Fatalf("%s missing authoringReason in Details", code)
		}
	}
	gone := CodeEntityDeleted.ToAppError("gone")
	if string(gone.Code) == "GONE" {
		t.Fatal("wire code must stay in the stable apperrors set")
	}
}

func TestFlags_DefaultOff(t *testing.T) {
	if (Off() != Flags{}) {
		t.Fatal("zero value must be all OFF")
	}
}

func TestFlags_ParsesBoolVariants(t *testing.T) {
	for _, v := range []string{"1", "TRUE", "Yes", " on "} {
		if !parseBool(v) {
			t.Fatalf("parseBool(%q) must be true", v)
		}
	}
	if parseBool("") || parseBool("maybe") {
		t.Fatal("empty/unknown must be false")
	}
}

func TestNoContentPayload(t *testing.T) {
	raw := validEventJSON(t, nil)
	s := string(raw)
	for _, banned := range []string{"promptPreview", "answerKeyPreview", "dataBase64"} {
		if strings.Contains(s, banned) {
			t.Fatalf("fixture must not contain %s", banned)
		}
	}
	e, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	out, _ := json.Marshal(e)
	if !strings.Contains(string(out), "questionId") {
		t.Fatal("questionId must serialize")
	}
}

func TestTombstone_SerializesExplicitNulls(t *testing.T) {
	e, err := Parse(validEventJSON(t, func(m map[string]any) {
		m["entity"] = map[string]any{"kind": "question", "examQuestionId": "eq-1", "questionId": nil, "moduleId": "m-1"}
	}))
	if err != nil {
		t.Fatalf("parse tombstone: %v", err)
	}
	out, _ := json.Marshal(e.Entity)
	s := string(out)
	for _, want := range []string{"\"questionId\":null", "\"moduleId\":\"m-1\""} {
		if !strings.Contains(s, want) {
			t.Fatalf("tombstone must serialize %s, got %s", want, s)
		}
	}
}

func TestFrame_SerializesCursorOutsideEvent(t *testing.T) {
	e, err := Parse(validEventJSON(t, nil))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	f := Frame{Type: "authoring.event", Cursor: 384, Event: e}
	out, _ := json.Marshal(f)
	if !strings.Contains(string(out), "\"cursor\":384") {
		t.Fatal("frame must carry cursor")
	}
	var decoded struct {
		Cursor int64          `json:"cursor"`
		Event  map[string]any `json:"event"`
	}
	if err := json.Unmarshal(out, &decoded); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	if _, ok := decoded.Event["sequenceId"]; ok {
		t.Fatal("domain event must not embed sequenceId")
	}
	if _, ok := decoded.Event["cursor"]; ok {
		t.Fatal("domain event must not embed cursor")
	}
}
