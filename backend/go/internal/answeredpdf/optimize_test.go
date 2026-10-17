package answeredpdf

import (
	"bytes"
	"context"
	"errors"
	"log"
	"log/slog"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func optimizationFixture(t *testing.T) []byte {
	t.Helper()
	pdf, err := os.ReadFile("testdata/optimization.pdf")
	if err != nil {
		t.Fatal(err)
	}
	return pdf
}

func TestOptimizePDFSmallerAndValid(t *testing.T) {
	original := optimizationFixture(t)
	got, err := optimizePDF(t.Context(), original, losslessOptimize)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) >= len(original) || !bytes.Contains(got, []byte("/ObjStm")) {
		t.Fatalf("not optimized: %d -> %d bytes", len(original), len(got))
	}
	if err := api.Validate(t.Context(), bytes.NewReader(got), model.NewStatelessConfiguration(), nil); err != nil {
		t.Fatal(err)
	}
	before, err := api.ReadContext(t.Context(), bytes.NewReader(original), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	after, err := api.ReadContext(t.Context(), bytes.NewReader(got), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := before.DereferenceDict(*before.Info)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := after.DereferenceDict(*after.Info)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(beforeInfo, afterInfo) {
		t.Fatalf("document metadata changed: before=%v after=%v", beforeInfo, afterInfo)
	}
	catalog, err := after.Catalog()
	if err != nil {
		t.Fatal(err)
	}
	tree, err := after.DereferenceDict(catalog["StructTreeRoot"])
	if err != nil || tree == nil || catalog["MarkInfo"] == nil || catalog["Lang"] == nil {
		t.Fatalf("accessibility structure lost: tree=%v err=%v", tree, err)
	}
}

func TestOptimizePDFDeadlineExpires(t *testing.T) {
	if testing.Short() {
		t.Skip("exercises the real 10 second optimization deadline")
	}
	original := optimizationFixture(t)
	got, err := optimizePDF(t.Context(), original, func(ctx context.Context, _ []byte) ([]byte, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	if err != nil || !bytes.Equal(got, original) {
		t.Fatalf("deadline discarded original PDF: size=%d err=%v", len(got), err)
	}
}

func TestOptimizePDFParentDeadlineDoesNotDownload(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), time.Millisecond)
	defer cancel()
	got, err := optimizePDF(ctx, optimizationFixture(t), func(ctx context.Context, _ []byte) ([]byte, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) || got != nil {
		t.Fatalf("expired request returned a file: size=%d err=%v", len(got), err)
	}
}

func TestOptimizationLogsOnlySizesTimingAndStatus(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	previousWriter, previousFlags := log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer func() {
		slog.SetDefault(previous)
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	}()
	original := optimizationFixture(t)
	_, err := optimizePDF(t.Context(), original, func(context.Context, []byte) ([]byte, error) {
		return nil, errors.New("PRIVATE_STUDENT_CONTENT")
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"original_bytes", "output_bytes", "optimization_ms", "optimizer_error"} {
		if !strings.Contains(logs.String(), field) {
			t.Errorf("missing %s", field)
		}
	}
	if strings.Contains(logs.String(), "PRIVATE_STUDENT_CONTENT") || strings.Contains(logs.String(), "SAT lossless regression") {
		t.Fatal("PDF content was logged")
	}
}

func TestOptimizePDFKeepsOriginalOnFailure(t *testing.T) {
	original := optimizationFixture(t)
	for _, tc := range []struct {
		name   string
		output []byte
		err    error
	}{
		{"optimizer failure", nil, errors.New("private document content must not be logged")},
		{"optimizer timeout", nil, context.DeadlineExceeded},
		{"invalid smaller output", []byte("%PDF-broken"), nil},
		{"empty output", nil, nil},
		{"equal size", original, nil},
		{"larger output", append(bytes.Clone(original), ' '), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := optimizePDF(t.Context(), original, func(ctx context.Context, _ []byte) ([]byte, error) {
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) > 10*time.Second {
					t.Fatal("optimizer must have a deadline of at most 10 seconds")
				}
				return tc.output, tc.err
			})
			if err != nil || !bytes.Equal(got, original) {
				t.Fatalf("did not preserve original: size=%d err=%v", len(got), err)
			}
		})
	}
}

func TestOptimizePDFRequestCancellation(t *testing.T) {
	for _, alreadyCanceled := range []bool{true, false} {
		t.Run(map[bool]string{true: "before", false: "during"}[alreadyCanceled], func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if alreadyCanceled {
				cancel()
			}
			called := false
			got, err := optimizePDF(ctx, optimizationFixture(t), func(context.Context, []byte) ([]byte, error) {
				called = true
				cancel()
				return nil, context.Canceled
			})
			if !errors.Is(err, context.Canceled) || got != nil || called == alreadyCanceled {
				t.Fatalf("got size=%d err=%v called=%v", len(got), err, called)
			}
		})
	}
}

func TestOptimizePDFConcurrentAndAlreadyOptimized(t *testing.T) {
	original := optimizationFixture(t)
	for range 8 {
		t.Run("independent configuration", func(t *testing.T) {
			t.Parallel()
			first, err := optimizePDF(t.Context(), original, losslessOptimize)
			if err != nil {
				t.Fatal(err)
			}
			second, err := optimizePDF(t.Context(), first, losslessOptimize)
			if err != nil || len(second) > len(first) {
				t.Fatalf("already optimized file grew: %d -> %d err=%v", len(first), len(second), err)
			}
		})
	}
}
