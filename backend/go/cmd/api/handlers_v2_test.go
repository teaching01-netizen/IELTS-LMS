package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
)

func TestSnapshotContainsQuestionRecognizesWritingTaskID(t *testing.T) {
	t.Parallel()

	snapshot := map[string]any{
		"tasks": []any{
			map[string]any{
				"taskId": "task1",
				"prompt": "Summarise the information.",
			},
		},
	}

	if !snapshotContainsQuestion(snapshot, "task1") {
		t.Fatal("snapshot writing task should resolve by taskId")
	}
	if snapshotContainsQuestion(snapshot, "task2") {
		t.Fatal("unrelated writing task should not resolve")
	}
}

// legacySnapshotFixture exercises every identifier spelling, the ordered
// top-level keys, the sorted "sections" map, the content/exam wrappers and an
// ID shared by two sections.
const legacySnapshotFixture = `{
	"listening": {"parts": [{"questions": [{"id": "l-1"}, {"questionId": "shared"}]}]},
	"reading": [{"passage": {"questionID": "r-1", "items": [{"id": "r-2", "options": [{"id": "opt-a"}]}]}}],
	"writing": {"tasks": [{"taskId": "task1"}, {"taskID": "task2", "prompt": "Describe."}]},
	"sections": {
		"Speaking": {"parts": [{"id": "s-1"}, {"id": "shared"}]},
		"reading_writing": [{"questionId": "rw-1"}],
		"unknown": [{"id": "orphan"}]
	},
	"content": {"math": [{"id": "m-1"}, {"id": "l-1"}], "listening": [{"id": "dup-wrapper"}]},
	"exam": {"science": [{"questionId": "sci-1", "id": 7}]},
	"metadata": {"id": "meta-1"}
}`

func decodeSnapshotFixture(t testing.TB, raw string) map[string]any {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		t.Fatal(err)
	}
	return root
}

// assertSnapshotOwnersMatchOracle compares the batch traversal with the
// unchanged per-question walk for every requested ID.
func assertSnapshotOwnersMatchOracle(t *testing.T, root map[string]any, ids []string) {
	t.Helper()
	got := snapshotOwnersFor(root, ids)
	want := make(map[string]attempts.QuestionOwner)
	for _, id := range ids {
		if owner, ok := snapshotOwnerFor(root, id); ok {
			want[id] = owner
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("snapshotOwnersFor(%q)\n got: %+v\nwant: %+v", ids, got, want)
	}
}

func TestSnapshotOwnersForMatchesPerQuestionWalk(t *testing.T) {
	t.Parallel()
	root := decodeSnapshotFixture(t, legacySnapshotFixture)
	before := decodeSnapshotFixture(t, legacySnapshotFixture)
	ids := []string{
		"l-1", "shared", "r-1", "r-2", "opt-a", "task1", "task2", "s-1", "rw-1",
		"m-1", "dup-wrapper", "sci-1", "7", "orphan", "meta-1", "missing", "",
	}
	idsBefore := append([]string(nil), ids...)

	assertSnapshotOwnersMatchOracle(t, root, ids)

	got := snapshotOwnersFor(root, ids)
	// First eligible root wins: "shared" is under listening before Speaking,
	// and "l-1" under listening before the wrapped math root.
	if got["shared"].SectionKey != "listening" || got["l-1"].SectionKey != "listening" {
		t.Fatalf("first root must own duplicate IDs: %+v", got)
	}
	if got["task1"].SectionKey != "writing" || got["task2"].SectionKey != "writing" {
		t.Fatalf("Writing task IDs must resolve: %+v", got)
	}
	if got["rw-1"].SectionKey != "reading-writing" || got["sci-1"].SectionKey != "science" {
		t.Fatalf("section keys must normalize: %+v", got)
	}
	for _, absent := range []string{"7", "orphan", "meta-1", "missing", "", "dup-wrapper"} {
		if _, ok := got[absent]; ok {
			t.Fatalf("%q must not resolve: %+v", absent, got[absent])
		}
	}
	if !reflect.DeepEqual(root, before) || !reflect.DeepEqual(ids, idsBefore) {
		t.Fatal("snapshotOwnersFor must not mutate its inputs")
	}
}

func TestSnapshotOwnersForEmptyInputs(t *testing.T) {
	t.Parallel()
	root := decodeSnapshotFixture(t, legacySnapshotFixture)
	if got := snapshotOwnersFor(root, nil); got == nil || len(got) != 0 {
		t.Fatalf("empty request must return an empty map, got %#v", got)
	}
	if got := snapshotOwnersFor(map[string]any{}, []string{"l-1"}); len(got) != 0 {
		t.Fatalf("empty snapshot must resolve nothing, got %+v", got)
	}
	// Duplicate requested IDs collapse to one entry.
	assertSnapshotOwnersMatchOracle(t, root, []string{"r-1", "r-1", "task1"})
}

// TestSnapshotOwnersForRandomTreesMatchOracle checks equivalence on generated
// trees whose IDs repeat across sections and nesting levels.
func TestSnapshotOwnersForRandomTreesMatchOracle(t *testing.T) {
	t.Parallel()
	rng := rand.New(rand.NewSource(20261024))
	spellings := []string{"id", "questionId", "questionID", "taskId", "taskID", "prompt"}
	sections := []string{"listening", "reading", "writing", "speaking", "math", "science", "reading-writing", "readingWriting", "notes"}
	var node func(depth int) any
	node = func(depth int) any {
		if depth == 0 || rng.Intn(4) == 0 {
			return map[string]any{spellings[rng.Intn(len(spellings))]: fmt.Sprintf("q-%d", rng.Intn(40))}
		}
		if rng.Intn(2) == 0 {
			children := make([]any, 1+rng.Intn(4))
			for i := range children {
				children[i] = node(depth - 1)
			}
			return children
		}
		out := map[string]any{spellings[rng.Intn(len(spellings))]: fmt.Sprintf("q-%d", rng.Intn(40))}
		for i := 0; i < 1+rng.Intn(3); i++ {
			out[fmt.Sprintf("k%d", i)] = node(depth - 1)
		}
		return out
	}
	for trial := 0; trial < 200; trial++ {
		root := map[string]any{}
		nested := map[string]any{}
		for _, section := range sections {
			switch rng.Intn(4) {
			case 0:
				root[section] = node(4)
			case 1:
				nested[section] = node(4)
			}
		}
		root[[]string{"sections", "content", "exam"}[rng.Intn(3)]] = nested
		ids := make([]string, 0, 30)
		for i := 0; i < 30; i++ {
			ids = append(ids, fmt.Sprintf("q-%d", rng.Intn(50)))
		}
		assertSnapshotOwnersMatchOracle(t, root, ids)
	}
}

func TestSnapshotOwnersRecognizeIELTSResponseSlots(t *testing.T) {
	root := decodeSnapshotFixture(t, `{"listening":{"parts":[{"blocks":[
 {"id":"notes","type":"NOTE_COMPLETION","questions":[{"id":"q39","blanks":[{"id":"b39"},{"id":"b40"}]}]},
 {"id":"sentence","type":"SENTENCE_COMPLETION","questions":[{"id":"q1","blanks":[{"id":"blank"}]}]},
 {"id":"classify","type":"CLASSIFICATION","items":[{"id":"item"}]},
 {"id":"matching","type":"MATCHING_FEATURES","features":[{"id":"feature"}]},
 {"id":"table","type":"TABLE_COMPLETION","cells":[{"id":"cell"}]},
 {"id":"diagram","type":"DIAGRAM_LABELING","labels":[{"id":"label"}]},
 {"id":"flow","type":"FLOW_CHART","steps":[{"id":"step"}]},
 {"id":"tree","type":"SHORT_ANSWER","subAnswerModeEnabled":true,"answerTree":[{"id":"root","children":[{"id":"branch","children":[{"id":"leaf"}]}]}]}
 ]}]},"reading":{"blocks":[{"id":"other","type":"CLASSIFICATION","items":[{"id":"other-item"}]}]}}`)
	valid := []string{"q39", "q39:b39", "q39:b40", "q1:blank", "classify:item", "matching:feature", "table:cell", "diagram:label", "flow:step", "tree::tree::root::leaf"}
	invalid := []string{"q39:unknown", "q39:blank", "classify:other-item", "matching:item", "q39:b39:extra", "tree::tree::root::branch", "tree::tree::branch::leaf"}
	ids := append(append([]string{}, valid...), invalid...)
	batch := snapshotOwnersFor(root, ids)
	for _, id := range valid {
		owner, ok := snapshotOwnerFor(root, id)
		if !ok || owner.SectionKey != "listening" {
			t.Errorf("valid response slot %q must resolve to listening, got %+v, %v", id, owner, ok)
		}
		if batch[id] != owner || batch[id].SectionKey != "listening" {
			t.Errorf("batch must resolve valid response slot %q: %+v", id, batch[id])
		}
	}
	for _, id := range invalid {
		if _, ok := snapshotOwnerFor(root, id); ok {
			t.Errorf("unknown response slot %q must be rejected", id)
		}
		if _, ok := batch[id]; ok {
			t.Errorf("batch must reject unknown response slot %q", id)
		}
	}
}

func TestSnapshotOwnersRecognizeHydratedLegacyIELTSIDs(t *testing.T) {
	root := decodeSnapshotFixture(t, `{"writing":{"task1Prompt":"Describe the chart.","task2Prompt":"Discuss both views.","tasks":[]},"reading":{"passages":[{"blocks":[{"id":"mcq","type":"SINGLE_MCQ","questions":[{"stem":"First"},{"stem":"Second"},{"id":"explicit","stem":"Third"}]}]}]}}`)
	cases := map[string]string{"task1": "writing", "task2": "writing", "mcq": "reading", "mcq:q2": "reading", "explicit": "reading"}
	ids := []string{"task1", "task2", "mcq", "mcq:q2", "explicit", "task3", "mcq:q3", "mcq:q4"}
	batch := snapshotOwnersFor(root, ids)
	for _, id := range ids {
		owner, ok := snapshotOwnerFor(root, id)
		section, wanted := cases[id]
		if ok != wanted || owner.SectionKey != section {
			t.Errorf("%q: owner=%+v found=%v; want section=%q found=%v", id, owner, ok, section, wanted)
		}
		batchOwner, batchOK := batch[id]
		if batchOK != wanted || batchOwner.SectionKey != section {
			t.Errorf("batch %q: owner=%+v found=%v; want section=%q found=%v", id, batchOwner, batchOK, section, wanted)
		}
	}
}
