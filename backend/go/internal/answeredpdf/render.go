// Package answeredpdf prints the SAT answered-exam paper to a PDF with
// headless Chromium, so the file is identical whatever browser asked for it
// (iOS Safari ignores @page size; every print dialog lets the user change
// paper, orientation and scale).
//
// Preparation supplies the authorized projection and inline figures entirely
// on the server; legacy callers may still post figures. Each render gets its
// own loopback listener that serves only the built SPA plus that one payload, and
// every request outside the listener is refused, so content in the payload can
// neither reach the API nor any other host.
package answeredpdf

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
)

// PrintRoute is the SPA route that renders the paper from the payload.
const PrintRoute = "/print/sat-answered"

const payloadPath = "/__answered-exam-payload/"

// RenderTimeout bounds preparation, media loading, rendering and optimization.
const RenderTimeout = 90 * time.Second

// A4 landscape with 10 mm margins: the content box is 277 × 190 mm. The
// viewport matches it at 96 px/in so the page's fit-to-page measurements see
// the print geometry (print/sat-answered keeps the same numbers in @page).
const (
	paperWidthIn  = 297 / 25.4
	paperHeightIn = 210 / 25.4
	viewportW     = 1047
	viewportH     = 718
)

var (
	// ErrBusy: every render slot is taken; the caller should retry shortly.
	ErrBusy = errors.New("answeredpdf: renderer busy")
	// ErrNotPrintable: the paper reported it is incomplete (a figure failed,
	// a module is missing) or never became ready. No PDF is produced (PDF-10).
	ErrNotPrintable = errors.New("answeredpdf: paper not printable")
)

// Renderer prints papers with a bounded number of concurrent browsers.
type Renderer struct {
	frontend     http.Handler
	slots        chan struct{}
	previewSlots chan struct{}
}

// New serves the SPA from frontend and allows at most slots renders at once.
func New(frontend http.Handler, slots int) *Renderer {
	return &Renderer{
		frontend: frontend, slots: make(chan struct{}, slots),
		previewSlots: make(chan struct{}, max(1, slots-1)),
	}
}

// Render prints payload (the JSON the print route reads) to PDF bytes.
func (r *Renderer) Render(ctx context.Context, payload []byte) ([]byte, error) {
	return r.RenderPrepared(ctx, func(context.Context) ([]byte, error) { return payload, nil })
}

// RenderPreview limits authoring previews within the shared capacity so they
// cannot occupy every slot on a renderer configured for concurrent downloads.
func (r *Renderer) RenderPreview(ctx context.Context, build func(context.Context) ([]byte, error)) ([]byte, error) {
	select {
	case r.previewSlots <- struct{}{}:
	default:
		return nil, ErrBusy
	}
	defer func() { <-r.previewSlots }()
	return r.RenderPrepared(ctx, build)
}

// RenderPrepared includes media preparation in the same concurrency and time
// budget as Chromium and optimization. Legacy binary POSTs use Render.
func (r *Renderer) RenderPrepared(ctx context.Context, build func(context.Context) ([]byte, error)) ([]byte, error) {
	select {
	case r.slots <- struct{}{}:
	default:
		return nil, ErrBusy
	}
	defer func() { <-r.slots }()

	ctx, cancel := context.WithTimeout(ctx, RenderTimeout)
	defer cancel()
	payload, err := build(ctx)
	if err != nil {
		return nil, err
	}
	pdf, err := r.render(ctx, payload)
	if err != nil {
		return nil, err
	}
	return optimizePDF(ctx, pdf, losslessOptimize)
}

func (r *Renderer) render(ctx context.Context, payload []byte) (pdf []byte, err error) {
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+payloadPath+token, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(payload)
	})
	mux.Handle("/", r.frontend)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	origin := "http://" + listener.Addr().String()

	allocCtx, cancelAlloc := chromedp.NewExecAllocator(ctx, append(chromedp.DefaultExecAllocatorOptions[:],
		// The container runs as root, where Chromium's sandbox cannot start.
		// offcut: no OS sandbox; containment is the network block below plus
		// a page that only ever renders our own bundle
		chromedp.NoSandbox,
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("font-render-hinting", "none"),
	)...)
	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx)

	started := time.Now()
	stage, stageStarted := "browser_startup", started
	timings := make([]slog.Attr, 0, 5)
	advance := func(next string) {
		timings = append(timings, slog.Int64(stage+"_ms", time.Since(stageStarted).Milliseconds()))
		stage, stageStarted = next, time.Now()
	}
	defer func() {
		lastStage := stage
		advance("")
		cleanupStarted := time.Now()
		cancelBrowser()
		cancelAlloc()
		status := "ok"
		switch {
		case errors.Is(err, context.DeadlineExceeded), errors.Is(err, chromedp.ErrPollingTimeout):
			status = "timeout"
		case errors.Is(err, context.Canceled):
			status = "canceled"
		case errors.Is(err, ErrNotPrintable):
			status = "not_printable"
		case err != nil:
			status = "failed"
		}
		slog.LogAttrs(ctx, slog.LevelInfo, "SAT answered PDF render",
			slog.String("request_id", httpx.RequestIDFrom(ctx, nil)),
			slog.String("stage", lastStage),
			slog.String("status", status),
			slog.Int64("elapsed_ms", time.Since(started).Milliseconds()),
			slog.Int64("cleanup_ms", time.Since(cleanupStarted).Milliseconds()),
			slog.Int("payload_bytes", len(payload)),
			slog.Attr{Key: "timings", Value: slog.GroupValue(timings...)},
		)
	}()

	pdf, err = chromedp.Run(browserCtx, func(ctx context.Context, t *chromedp.Target) ([]byte, error) {
		advance("browser_setup")
		// Subscribe before enabling interception so no request goes unanswered.
		paused := cdp.Events(ctx, t, fetch.RequestPaused)
		go func() {
			for e, err := range paused {
				if err != nil {
					return
				}
				if e.Request != nil && strings.HasPrefix(e.Request.URL, origin+"/") {
					_, _ = cdp.Call(ctx, t, fetch.ContinueRequest, fetch.ContinueRequestParams{RequestID: e.RequestID})
					continue
				}
				_, _ = cdp.Call(ctx, t, fetch.FailRequest, fetch.FailRequestParams{
					RequestID: e.RequestID, ErrorReason: network.ErrorReasonBlockedByClient,
				})
			}
		}()
		if _, err := cdp.Call(ctx, t, fetch.Enable, fetch.EnableParams{}); err != nil {
			return nil, err
		}
		if _, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Media: "print"}); err != nil {
			return nil, err
		}
		if _, err := chromedp.EmulateViewport(viewportW, viewportH)(ctx, t); err != nil {
			return nil, err
		}
		advance("navigate")
		if _, err := chromedp.Navigate(origin+PrintRoute+"?payload="+token)(ctx, t); err != nil {
			return nil, err
		}
		advance("print_ready")
		// Use the Go render deadline even if the page's timers stall.
		state, err := chromedp.Poll[string](`(document.body && document.body.dataset.printState) || ""`,
			chromedp.WithPollingInterval(100*time.Millisecond),
			chromedp.WithPollingTimeout(0))(ctx, t)
		if err != nil {
			return nil, err
		}
		if state != "ready" {
			// The page reports why it failed; log it for operations without
			// returning private content to the caller.
			pageError, _ := chromedp.Evaluate[string](`(document.body && document.body.dataset.printError) || ""`)(ctx, t)
			if len(pageError) > 800 {
				pageError = pageError[:800]
			}
			slog.InfoContext(ctx, "SAT answered PDF page failure",
				slog.String("request_id", httpx.RequestIDFrom(ctx, nil)),
				slog.String("page_error", pageError),
				slog.String("print_state", state),
			)
			if pageError == "" {
				return nil, ErrNotPrintable
			}
			return nil, fmt.Errorf("%w: %s", ErrNotPrintable, pageError)
		}
		advance("print_pdf")
		return chromedp.PrintToPDF(
			chromedp.PDFPaper(chromedp.PaperSize{Width: paperWidthIn, Height: paperHeightIn}),
			chromedp.PDFPreferCSSPageSize(),
			chromedp.PDFPrintBackground(),
		)(ctx, t)
	})
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return pdf, err
}

func randomToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
