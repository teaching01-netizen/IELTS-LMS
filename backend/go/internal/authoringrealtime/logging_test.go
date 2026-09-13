package authoringrealtime

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// contentTokens is a realistic question draft's worth of material that must
// never appear in an authoring log line: stem, options, answer key, rationale,
// student info, and a media path.
var contentTokens = []string{
	"The author's main purpose in the passage is to",
	"Options: A) describe B) evaluate C) criticize D) summarize",
	"correctOptionId: C",
	"because the second paragraph contrasts two views",
	"stu_8f2c41@example.com",
	"+1-415-555-0134",
	"https://cdn.example.com/uploads/stem-diagram-7f2a.png",
	`{"stimulus":{"version":2,"nodes":[{"type":"paragraph","text":"Passage text"}]}}`,
}

// The redaction guard. Each field position is handed content in turn; every one
// must collapse to `other` rather than reaching the log line.
func TestLogFieldsRejectContentInEveryField(t *testing.T) {
	for i, token := range contentTokens {
		fields := []LogFields{
			{Component: token},
			{Event: token},
			{RequestID: token},
			{ConnectionID: token},
			{OrganizationID: token},
			{ExamID: token},
			{DraftVersionID: token},
			{EventKind: token},
			{Result: token},
		}
		for j, f := range fields {
			rendered := f.String()
			if strings.Contains(rendered, token) {
				t.Fatalf("content token %d leaked into field position %d: %q", i, j, rendered)
			}
			// A populated field must still render SOMETHING, so the guard is
			// visible as `other` rather than silently dropping the field.
			if !strings.Contains(rendered, ReasonOther) {
				t.Fatalf("content token %d in field position %d produced %q, want an %s marker", i, j, rendered, ReasonOther)
			}
		}
	}
}

func TestSafeFieldAcceptsIdentifiers(t *testing.T) {
	for _, ok := range []string{
		"exam-1",
		"user-alice",
		"question.changed",
		"4f8a2c1e-9d3b-4a71-8c2f-7e6d5a4b3c2d",
		"authoring-subscribe",
		"cursor_too_old",
		"2026-09-13T12:00:00Z",
	} {
		if got := SafeField(ok); got != ok {
			t.Fatalf("SafeField(%q) = %q, want it unchanged", ok, got)
		}
	}
	if got := SafeField(""); got != "" {
		t.Fatalf("an unset field must stay empty, got %q", got)
	}
	if got := SafeField("some free text about a question"); got != ReasonOther {
		t.Fatalf("prose must be rejected, got %q", got)
	}
	if got := SafeField(strings.Repeat("a", maxFieldLen+1)); got != ReasonOther {
		t.Fatalf("an over-long value must be rejected, got %q", got)
	}
}

// A log line carries the allow-listed fields and nothing else. Numeric fields
// render as numbers, and absent fields are absent rather than blank.
func TestLogLineCarriesOnlyAllowListedFields(t *testing.T) {
	f := LogFields{
		Component:      ComponentSubscribe,
		Event:          EventSubscribeAccepted,
		RequestID:      "req-1",
		ConnectionID:   "ap-1",
		OrganizationID: "org-1",
		ExamID:         "exam-1",
		DraftVersionID: "draft-7",
		EventKind:      string(KindQuestionChanged),
		Cursor:         512,
		Revision:       9,
		Result:         "accepted",
		DurationMS:     12,
	}
	rendered := f.String()
	for _, want := range []string{
		"component=authoring-subscribe",
		"event=subscribe_accepted",
		"request_id=req-1",
		"connection_id=ap-1",
		"organization_id=org-1",
		"exam_id=exam-1",
		"draft_version_id=draft-7",
		"event_kind=question.changed",
		"cursor=512",
		"revision=9",
		"result=accepted",
		"duration_ms=12",
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("line %q is missing %q", rendered, want)
		}
	}

	// Zero-valued numbers and empty strings are omitted, so a lifecycle line
	// does not carry a meaningless cursor=0.
	sparse := LogFields{Component: ComponentForwarder, Event: EventDelivered}.String()
	if strings.Contains(sparse, "cursor=") || strings.Contains(sparse, "revision=") || strings.Contains(sparse, "duration_ms=") {
		t.Fatalf("sparse line must omit zero-valued numbers: %q", sparse)
	}
	if strings.Contains(sparse, "exam_id=") {
		t.Fatalf("sparse line must omit empty fields: %q", sparse)
	}
}

// End-to-end through log.Printf: the writer must be the only thing that
// changed, and no content token may appear in captured output.
func TestLogAuthoringWritesNothingContentShaped(t *testing.T) {
	var buf bytes.Buffer
	oldWriter := log.Writer()
	oldFlags := log.Flags()
	oldPrefix := log.Prefix()
	log.SetOutput(&buf)
	log.SetFlags(0)
	log.SetPrefix("")
	defer func() {
		log.SetOutput(oldWriter)
		log.SetFlags(oldFlags)
		log.SetPrefix(oldPrefix)
	}()

	LogAuthoring("api", LogFields{
		Component:      ComponentPublish,
		Event:          EventPublishFailed,
		ExamID:         contentTokens[0],
		DraftVersionID: contentTokens[3],
		Result:         contentTokens[2],
	})

	out := buf.String()
	if out == "" {
		t.Fatal("LogAuthoring wrote nothing")
	}
	for i, token := range contentTokens {
		if strings.Contains(out, token) {
			t.Fatalf("content token %d reached the log writer: %q", i, out)
		}
	}
	if !strings.HasPrefix(out, "api: ") {
		t.Fatalf("line %q lost the api: prefix convention", out)
	}
}
