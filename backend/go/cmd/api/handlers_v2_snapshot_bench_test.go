package main

import (
	"fmt"
	"testing"
)

// benchmarkIELTSSnapshot builds a legacy IELTS content tree with the given
// number of questions per section. Each question carries options and rich-text
// nodes so the walk visits realistic non-question content as well.
func benchmarkIELTSSnapshot(questionsPerSection, optionsPerQuestion int) (map[string]any, []string) {
	root := map[string]any{}
	var ids []string
	for _, section := range []string{"listening", "reading", "writing", "speaking"} {
		parts := make([]any, 0, 4)
		for part := 0; part < 4; part++ {
			questions := make([]any, 0, questionsPerSection/4)
			for q := 0; q < questionsPerSection/4; q++ {
				id := fmt.Sprintf("%s-p%d-q%d", section, part, q)
				ids = append(ids, id)
				options := make([]any, 0, optionsPerQuestion)
				for o := 0; o < optionsPerQuestion; o++ {
					options = append(options, map[string]any{"label": string(rune('A' + o%26)), "text": "Option text"})
				}
				key := "questionId"
				if section == "writing" {
					key = "taskId"
				}
				questions = append(questions, map[string]any{
					key:       id,
					"type":    "multiple-choice",
					"stem":    map[string]any{"blocks": []any{map[string]any{"type": "paragraph", "text": "Stem"}}},
					"options": options,
				})
			}
			parts = append(parts, map[string]any{"title": fmt.Sprintf("Part %d", part+1), "questions": questions})
		}
		root[section] = map[string]any{"parts": parts}
	}
	return root, ids
}

// benchmarkRequest picks n IDs biased to the end of the tree (Writing and
// Speaking come last), replacing every fifth with a miss that forces a full walk.
func benchmarkRequest(ids []string, n int) []string {
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		if i%5 == 4 {
			out = append(out, fmt.Sprintf("missing-%d", i))
			continue
		}
		out = append(out, ids[len(ids)-1-(i*7)%len(ids)])
	}
	return out
}

var benchmarkSnapshotOwnersSink int

func BenchmarkSnapshotOwners(b *testing.B) {
	for _, shape := range []struct {
		name                string
		questionsPerSection int
		optionsPerQuestion  int
	}{
		{"small", 40, 4},
		{"large", 200, 12},
	} {
		root, ids := benchmarkIELTSSnapshot(shape.questionsPerSection, shape.optionsPerQuestion)
		for _, n := range []int{1, 2, 20, 100} {
			request := benchmarkRequest(ids, n)
			b.Run(fmt.Sprintf("snapshot=%s/ids=%d/algo=perQuestion", shape.name, n), func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					found := 0
					for _, id := range request {
						if _, ok := snapshotOwnerFor(root, id); ok {
							found++
						}
					}
					benchmarkSnapshotOwnersSink = found
				}
			})
			b.Run(fmt.Sprintf("snapshot=%s/ids=%d/algo=batch", shape.name, n), func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					benchmarkSnapshotOwnersSink = len(snapshotOwnersFor(root, request))
				}
			})
		}
	}
}
