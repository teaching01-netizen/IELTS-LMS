package main

// V1 content-snapshot branch fence.
//
// `/v1/student/sessions/{scheduleID}/static` and the session read project
// exam_versions.content_snapshot to the student. That snapshot is a second
// projection of the same published version the delivery payload describes, so
// it needs the same narrowing: answer-key redaction alone still leaves an
// adaptive branch's stimulus, prompt and options readable.
//
// The openers are assessment_module_attempts rows (the routed branch is
// inserted with the route decision), and an unresolvable attempt narrows to
// base modules — a missing question set is survivable, a leaked one is not.

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func branchFixtureSnapshot() map[string]any {
	branch := func(id, moduleKey, role, questionID string) map[string]any {
		return map[string]any{
			"id": id, "moduleKey": moduleKey, "adaptiveRole": role,
			"questions": []any{map[string]any{"examQuestionId": questionID}},
		}
	}
	return map[string]any{
		"sections": map[string]any{
			"reading-writing": map[string]any{
				"modules": []any{
					branch("mod-m1", "m1", "base", "q-m1"),
					branch("mod-lower", "m2", "lower_branch", "q-low"),
					branch("mod-higher", "m2", "higher_branch", "q-high"),
				},
			},
			"math": map[string]any{
				"modules": []any{
					branch("mod-math-m1", "m1", "base", "q-math-m1"),
					branch("mod-math-higher", "m2", "higher_branch", "q-math-high"),
					// A non-adaptive section is untouched: role "none".
					branch("mod-drill", "drill", "none", "q-drill"),
				},
			},
		},
	}
}

func collectSnapshotModuleIDs(t *testing.T, snapshot map[string]any) []string {
	t.Helper()
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	var ids []string
	var walk func(node any)
	walk = func(node any) {
		switch v := node.(type) {
		case map[string]any:
			if id, ok := v["id"].(string); ok {
				ids = append(ids, id)
				return
			}
			for _, child := range v {
				walk(child)
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(decoded)
	return ids
}

func TestFenceStudentSnapshotKeepsOnlyTheAssignedBranch(t *testing.T) {
	snapshot := branchFixtureSnapshot()
	fenceStudentSnapshotBranches(snapshot, map[string]bool{
		"mod-m1": true, "mod-higher": true, "mod-math-m1": true, "mod-math-higher": true,
	})

	ids := collectSnapshotModuleIDs(t, snapshot)
	want := map[string]bool{
		"mod-m1": true, "mod-higher": true, "mod-math-m1": true,
		"mod-math-higher": true, "mod-drill": true,
	}
	if len(ids) != len(want) {
		t.Fatalf("surviving modules = %v, want %v", ids, want)
	}
	for _, id := range ids {
		if !want[id] {
			t.Fatalf("module %q must not survive the fence (got %v)", id, ids)
		}
	}
}

func TestFenceStudentSnapshotDropsEveryBranchWithoutAnAttempt(t *testing.T) {
	snapshot := branchFixtureSnapshot()
	fenceStudentSnapshotBranches(snapshot, nil)

	ids := collectSnapshotModuleIDs(t, snapshot)
	for _, dropped := range []string{"mod-lower", "mod-higher", "mod-math-higher"} {
		for _, id := range ids {
			if id == dropped {
				t.Fatalf("branch %q must be dropped when no attempt is resolved (got %v)", dropped, ids)
			}
		}
	}
	for _, kept := range []string{"mod-m1", "mod-math-m1", "mod-drill"} {
		found := false
		for _, id := range ids {
			found = found || id == kept
		}
		if !found {
			t.Fatalf("non-branch module %q must survive (got %v)", kept, ids)
		}
	}
}

// The fence must not leak the question ids of a dropped branch either: the
// module is removed before it is walked, so its subtree goes with it.
func TestFenceStudentSnapshotRemovesTheDroppedBranchSubtree(t *testing.T) {
	snapshot := branchFixtureSnapshot()
	fenceStudentSnapshotBranches(snapshot, map[string]bool{"mod-higher": true})

	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "q-low") {
		t.Fatalf("a dropped branch must not leave its questions behind: %s", encoded)
	}
	if !strings.Contains(string(encoded), "q-high") {
		t.Fatalf("the assigned branch must keep its questions: %s", encoded)
	}
}

// snake_case spellings are understood, and a branch whose id cannot be read
// fails closed: a future authoring generation cannot bypass the fence by
// renaming a key, and an unidentifiable branch is never treated as assigned.
func TestFenceStudentSnapshotHandlesSnakeCaseAndMissingIds(t *testing.T) {
	snapshot := map[string]any{
		"sections": []any{
			map[string]any{
				"modules": []any{
					map[string]any{"adaptive_role": "lower_branch", "module_key": "m2", "questions": []any{}},
					map[string]any{"adaptive_role": "higher_branch", "questions": []any{}},
				},
			},
		},
	}
	// The lower branch is identified only by its snake_case module_key, which
	// the opener set does contain, so it must survive.
	fenceStudentSnapshotBranches(snapshot, map[string]bool{"m2": true})

	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), "lower_branch") {
		t.Fatalf("a snake_case branch the attempt opened must survive, got %s", encoded)
	}
	if strings.Contains(string(encoded), "higher_branch") {
		t.Fatalf("a branch with no readable id must be dropped, got %s", encoded)
	}
}

// A new caller that forgets to resolve the opener set would silently ship every
// branch again, so the projection itself must own the fence.
func TestStudentVersionProjectionAppliesTheBranchFence(t *testing.T) {
	raw, err := os.ReadFile("student_context.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	const fence = "fenceStudentSnapshotBranches(content, openedModules)"
	if strings.Count(source, fence) == 0 {
		t.Fatalf("loadStudentScheduleVersion no longer applies %q", fence)
	}
	if !strings.Contains(source, "func loadStudentScheduleVersion(ctx context.Context, db *sql.DB, scheduleID string, openedModules map[string]bool)") {
		t.Fatal("loadStudentScheduleVersion must require the opener set; a caller that cannot supply one would ship every branch")
	}
}
