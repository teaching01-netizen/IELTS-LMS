package main

import "testing"

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
