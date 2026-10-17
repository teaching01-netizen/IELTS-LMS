package answeredpdf

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

const optimizationTimeout = 10 * time.Second

func pdfConfiguration() *model.Configuration {
	conf := model.NewStatelessConfiguration()
	conf.Offline = true
	conf.PreserveInfoDict = true
	conf.OptimizeDuplicateContentStreams = true
	return conf
}

// Only structural optimization: embedded images and fonts keep their detail.
func losslessOptimize(ctx context.Context, original []byte) ([]byte, error) {
	var out bytes.Buffer
	if err := api.Optimize(ctx, bytes.NewReader(original), &out, pdfConfiguration(), nil); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// The original is already a complete Chromium PDF. Optimization is optional;
// its own failure must not discard that record or outlive the request.
func optimizePDF(ctx context.Context, original []byte, optimize func(context.Context, []byte) ([]byte, error)) (result []byte, err error) {
	started := time.Now()
	status := "optimized"
	defer func() {
		// Codes only: parser errors can quote private PDF content.
		slog.InfoContext(ctx, "SAT answered PDF optimization",
			"original_bytes", len(original), "output_bytes", len(result),
			"optimization_ms", time.Since(started).Milliseconds(), "status", status)
	}()
	if err := ctx.Err(); err != nil {
		status = "request_canceled"
		return nil, err
	}
	optCtx, cancel := context.WithTimeout(ctx, optimizationTimeout)
	defer cancel()
	optimized, optErr := optimize(optCtx, original)
	if err := ctx.Err(); err != nil {
		status = "request_canceled"
		return nil, err
	}
	if optCtx.Err() != nil || errors.Is(optErr, context.DeadlineExceeded) {
		status = "timeout"
		return original, nil
	}
	if optErr != nil {
		status = "optimizer_error"
		return original, nil
	}
	if len(optimized) >= len(original) {
		status = "not_smaller"
		return original, nil
	}
	validationErr := api.Validate(optCtx, bytes.NewReader(optimized), pdfConfiguration(), nil)
	if err := ctx.Err(); err != nil {
		status = "request_canceled"
		return nil, err
	}
	if optCtx.Err() != nil {
		status = "timeout"
		return original, nil
	}
	if validationErr != nil {
		status = "invalid_output"
		return original, nil
	}
	return optimized, nil
}
