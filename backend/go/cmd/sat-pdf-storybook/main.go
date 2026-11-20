// Command sat-pdf-storybook serves the local Storybook with live SAT PDF previews.
package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/satpdflayout"
)

func main() {
	dist := flag.String("dist", "../../dist", "path to the built application")
	story := flag.String("storybook", "../../storybook-static", "path to the built Storybook")
	port := flag.Int("port", 6016, "loopback HTTP port")
	flag.Parse()
	printPage := filepath.Join(*dist, "index.html")
	for _, file := range []string{printPage, filepath.Join(*story, "index.html")} {
		if _, err := os.Stat(file); err != nil {
			log.Fatal(err)
		}
	}
	assets := http.FileServer(http.Dir(*dist))
	frontend := http.NewServeMux()
	frontend.HandleFunc("GET "+answeredpdf.PrintRoute, func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, printPage)
	})
	frontend.Handle("/", assets)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /__storybook/sat-pdf-preview", preview(answeredpdf.New(frontend, 2)))
	mux.Handle("/", http.FileServer(http.Dir(*story)))
	addr := "127.0.0.1:" + strconv.Itoa(*port)
	localhost := "localhost:" + strconv.Itoa(*port)
	server := http.Server{Addr: addr, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if (r.Host != addr && r.Host != localhost) || (origin != "" && origin != "http://"+r.Host) {
				http.Error(w, "Preview is available on the local Storybook origin.", http.StatusForbidden)
				return
			}
			mux.ServeHTTP(w, r)
		}),
	}
	log.Printf("SAT PDF Storybook at http://%s", addr)
	log.Fatal(server.ListenAndServe())
}

type sampleRequest struct {
	Targets       []satpdflayout.Option `json:"targets"`
	Design        satpdflayout.Layout   `json:"design"`
	Artwork       map[string]string     `json:"artwork"`
	WithAnswerKey bool                  `json:"withAnswerKey"`
	Section       *satpdflayout.Target  `json:"sectionSample"`
	SampleBook    bool                  `json:"sampleBook"`
}

func preview(renderer *answeredpdf.Renderer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaType != "application/json" {
			http.Error(w, "Expected a JSON preview request.", http.StatusUnsupportedMediaType)
			return
		}
		body := http.MaxBytesReader(w, r.Body, int64(base64.StdEncoding.EncodedLen(satpdflayout.MaxLayoutBytes))+(64<<10))
		decoder := json.NewDecoder(body)
		decoder.DisallowUnknownFields()
		var request sampleRequest
		if err := decoder.Decode(&request); err != nil || decoder.Decode(new(any)) != io.EOF || !request.valid() {
			http.Error(w, "Invalid sample layout or images.", http.StatusBadRequest)
			return
		}

		exam, view := answeredpdf.LayoutSample("SAT Practice 04", request.Targets, request.WithAnswerKey || request.SampleBook)
		visible := answeredpdf.VisibleLayoutTargets(exam, true)
		design := &satpdflayout.Resolved{
			Snapshot: satpdflayout.Snapshot{Layout: satpdflayout.Layout{
				Slides: []satpdflayout.Slide{}, Logos: request.Design.Logos,
			}},
			Images: request.Artwork,
		}
		var payload []byte
		var err error
		if request.Section != nil {
			if !visible[*request.Section] {
				http.Error(w, "This section is unavailable in the sample.", http.StatusUnprocessableEntity)
				return
			}
			payload, err = answeredpdf.MarshalSectionSample(exam, view, design, *request.Section)
		} else if request.SampleBook {
			payload, err = answeredpdf.MarshalSampleBook(exam, view, design)
		} else {
			for _, slide := range request.Design.Slides {
				if visible[slide.Target] {
					design.Layout.Slides = append(design.Layout.Slides, slide)
				}
			}
			payload, err = answeredpdf.MarshalPayload(exam, view, map[string]string{}, design)
		}
		if err != nil {
			http.Error(w, "Could not prepare sample PDF.", http.StatusInternalServerError)
			return
		}
		pdf, err := renderer.Render(r.Context(), payload)
		if errors.Is(err, answeredpdf.ErrBusy) {
			http.Error(w, "Sample renderer is busy.", http.StatusTooManyRequests)
			return
		}
		if err != nil {
			http.Error(w, "Could not render sample PDF.", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(pdf)
	}
}

func (r sampleRequest) valid() bool {
	if len(r.Targets) > 20 || len(r.Design.Slides) > satpdflayout.MaxSlides || len(r.Artwork) > satpdflayout.MaxSlides+3 {
		return false
	}
	for _, source := range r.Artwork {
		header, data, ok := strings.Cut(source, ",")
		if !ok || data == "" || (header != "data:image/png;base64" && header != "data:image/jpeg;base64") {
			return false
		}
	}
	for _, slide := range r.Design.Slides {
		if r.Artwork[slide.AssetID] == "" || (slide.Side != "before" && slide.Side != "after") {
			return false
		}
	}
	for _, logo := range []*satpdflayout.Logo{r.Design.Logos.Cover, r.Design.Logos.LeftWatermark, r.Design.Logos.RightWatermark} {
		if logo != nil && r.Artwork[logo.AssetID] == "" {
			return false
		}
	}
	return true
}
