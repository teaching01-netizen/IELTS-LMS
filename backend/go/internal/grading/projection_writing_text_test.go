package grading

import "testing"

func TestWritingProjectionPreservesExactResponse(t *testing.T) {
	exact := "  first\t\tline\u00a0\u2003 &nbsp; <p>literal</p>\r\n\r\n  e\u0301 ≠ é  \n\n"
	for _, value := range []any{exact, map[string]any{"text": exact}, map[string]any{"text": " \t\n\n  "}} {
		expected := exact
		if object, ok := value.(map[string]any); ok {
			expected = object["text"].(string)
		}
		tasks := buildProjectionWritingTasks(map[string]any{"task1": value}, nil, nil)
		if len(tasks) != 1 || tasks[0].Text != expected {
			t.Fatalf("writing text changed: got %#v, want %q", tasks, expected)
		}
		payload := projectionWritingPayload(map[string]any{"task1": value}, nil, nil)
		if len(payload) != 1 {
			t.Fatalf("expected one projected response, got %#v", payload)
		}
		response := payload[0].(map[string]any)
		if response["text"] != expected {
			t.Fatalf("projected response must preserve literal text: %#v", response)
		}
	}
}
