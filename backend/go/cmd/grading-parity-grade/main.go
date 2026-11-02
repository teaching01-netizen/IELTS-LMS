// Command grading-parity-grade is the Go half of the objective grading parity
// harness. It reads a JSON array of grading inputs from stdin and writes a JSON
// array of per-question results to stdout. It reads no database and writes no
// database: the harness supplies exam content + answers.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"example.com/ielts-proctoring/internal/grading"
)

func main() {
	var inputs []grading.ParityInput
	if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil {
		fmt.Fprintf(os.Stderr, "grading-parity-grade: decode input: %v\n", err)
		os.Exit(1)
	}
	results := make([]grading.ParitySectionResult, 0, len(inputs))
	for _, input := range inputs {
		results = append(results, grading.GradeContentForParity(input))
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		fmt.Fprintf(os.Stderr, "grading-parity-grade: encode output: %v\n", err)
		os.Exit(1)
	}
}
