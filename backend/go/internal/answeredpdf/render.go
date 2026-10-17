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
	"net"
	"net/http"
	"strings"
	"time"

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
	frontend http.Handler
	slots    chan struct{}
}

// New serves the SPA from frontend and allows at most slots renders at once.
func New(frontend http.Handler, slots int) *Renderer {
	return &Renderer{frontend: frontend, slots: make(chan struct{}, slots)}
}

// Render prints payload (the JSON the print route reads) to PDF bytes.
func (r *Renderer) Render(ctx context.Context, payload []byte) ([]byte, error) {
	return r.RenderPrepared(ctx, func(context.Context) ([]byte, error) { return payload, nil })
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

func (r *Renderer) render(ctx context.Context, payload []byte) ([]byte, error) {

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
	defer cancelAlloc()
	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx)
	defer cancelBrowser()

	// Subscribe before navigating so no request goes unanswered.
	paused := chromedp.Events(browserCtx, fetch.RequestPaused)
	go func() {
		for e, err := range paused {
			if err != nil {
				return
			}
			if e.Request != nil && strings.HasPrefix(e.Request.URL, origin+"/") {
				_, _ = chromedp.Call(browserCtx, fetch.ContinueRequest, fetch.ContinueRequestParams{RequestID: e.RequestID})
				continue
			}
			_, _ = chromedp.Call(browserCtx, fetch.FailRequest, fetch.FailRequestParams{
				RequestID: e.RequestID, ErrorReason: network.ErrorReasonBlockedByClient,
			})
		}
	}()

	pdf, err := chromedp.Run(browserCtx, func(ctx context.Context, t *chromedp.Target) ([]byte, error) {
		if _, err := cdp.Call(ctx, t, fetch.Enable, fetch.EnableParams{}); err != nil {
			return nil, err
		}
		if _, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Media: "print"}); err != nil {
			return nil, err
		}
		if _, err := chromedp.EmulateViewport(viewportW, viewportH)(ctx, t); err != nil {
			return nil, err
		}
		if _, err := chromedp.Navigate(origin+PrintRoute+"?payload="+token)(ctx, t); err != nil {
			return nil, err
		}
		state, err := chromedp.Poll[string](`(document.body && document.body.dataset.printState) || ""`,
			chromedp.WithPollingInterval(100*time.Millisecond),
			chromedp.WithPollingTimeout(RenderTimeout))(ctx, t)
		if err != nil {
			return nil, err
		}
		if state != "ready" {
			return nil, ErrNotPrintable
		}
		return chromedp.PrintToPDF(
			chromedp.PDFPaper(chromedp.PaperSize{Width: paperWidthIn, Height: paperHeightIn}),
			chromedp.PDFPreferCSSPageSize(),
			chromedp.PDFPrintBackground(),
		)(ctx, t)
	})
	// A paper that never reports a state within the bound is not printable.
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if errors.Is(err, ErrNotPrintable) {
		return nil, ErrNotPrintable
	}
	if err != nil {
		return nil, err
	}
	return pdf, nil
}

func randomToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
