package answeredpdf

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/url"
	"os"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/satpdflayout"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func sampleTargets() []satpdflayout.Option {
	return []satpdflayout.Option{
		{Target: satpdflayout.Target{Kind: "reviewSubject", SectionKey: "math"}, Label: "Math"},
		{Target: satpdflayout.Target{Kind: "reviewModule", SectionKey: "math", ModuleKey: "math-m1"}, Label: "Module 1"},
		{Target: satpdflayout.Target{Kind: "reviewModule", SectionKey: "math", ModuleKey: "math-m2-higher"}, Label: "Module 2 Higher"},
	}
}

func TestVisibleLayoutTargetsUsesTheReleasedAttempt(t *testing.T) {
	options := sampleTargets()
	exam, _ := LayoutSample("Sample", options, true)
	exam.Sections[0].Modules[1].ContentWithheld = true
	exam.AnswerKey.Entries = exam.AnswerKey.Entries[1:]
	visible := VisibleLayoutTargets(exam, false)
	for _, target := range []satpdflayout.Target{{Kind: "cover"}, {Kind: "answerSummary"}, {Kind: "examReview"}, options[0].Target, options[1].Target} {
		if !visible[target] {
			t.Errorf("expected accessible target %#v", target)
		}
	}
	for _, target := range []satpdflayout.Target{{Kind: "scoreReport"}, {Kind: "answerKey"}, options[2].Target} {
		if visible[target] {
			t.Errorf("withheld target was available %#v", target)
		}
	}
}

func TestRenderCustomLayoutKeepsSlidePageOrder(t *testing.T) {
	r := renderer(t)
	options := sampleTargets()
	exam, view := LayoutSample("Layout order sample", options, true)
	design := &satpdflayout.Resolved{Images: map[string]string{}}
	imageData := func(width int) string {
		im := image.NewRGBA(image.Rect(0, 0, width, 36))
		draw.Draw(im, im.Bounds(), image.NewUniform(color.RGBA{20, byte(width * 3), 150, 255}), image.Point{}, draw.Src)
		var data bytes.Buffer
		if err := png.Encode(&data, im); err != nil {
			t.Fatal(err)
		}
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data.Bytes())
	}
	add := func(id string, target satpdflayout.Target, side string, width int) {
		design.Images[id] = imageData(width)
		design.Layout.Slides = append(design.Layout.Slides, satpdflayout.Slide{ID: id, AssetID: id, Target: target, Side: side, Description: id})
	}
	add("Opening slide", satpdflayout.Target{Kind: "cover"}, "before", 41)
	add("Score divider", satpdflayout.Target{Kind: "scoreReport"}, "after", 43)
	add("Summary intro", satpdflayout.Target{Kind: "answerSummary"}, "before", 45)
	add("Math divider", options[0].Target, "before", 47)
	add("First module intro", options[1].Target, "before", 49)
	add("Closing slide", satpdflayout.Target{Kind: "examReview"}, "after", 51)
	design.Layout.Logos = satpdflayout.Logos{
		Cover:          &satpdflayout.Logo{AssetID: "cover", Description: "Example school logo"},
		LeftWatermark:  &satpdflayout.Logo{AssetID: "left"},
		RightWatermark: &satpdflayout.Logo{AssetID: "right"},
	}
	design.Images["cover"], design.Images["left"], design.Images["right"] = imageData(61), imageData(63), imageData(65)
	payload, err := MarshalPayload(exam, view, map[string]string{}, design)
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := r.Render(t.Context(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("ANSWEREDPDF_OUT"); out != "" {
		if err := os.WriteFile(out, pdf, 0600); err != nil {
			t.Fatal(err)
		}
	}
	dimensions, err := api.PageDims(t.Context(), bytes.NewReader(pdf), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	for _, dim := range dimensions {
		if dim.Width < 841 || dim.Width > 843 || dim.Height < 594 || dim.Height > 596 {
			t.Fatalf("unexpected page geometry %v", dim)
		}
	}
	images, err := api.ExtractImagesRaw(t.Context(), bytes.NewReader(pdf), nil, pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	want := []int{41, 0, 0, 43, 45, 0, 47, 49, 0, 0, 51}
	got := make([]int, len(images))
	branded := map[int]bool{}
	for i, page := range images {
		for _, im := range page {
			embedded, _, err := image.Decode(im)
			if err != nil {
				t.Fatalf("page %d: decode image: %v", i+1, err)
			}
			branded[embedded.Bounds().Dx()] = true
			// Chromium may embed just the cropped region. Identify the fixture by
			// its fill color, which survives cropping.
			bounds := embedded.Bounds()
			pixel := color.NRGBAModel.Convert(embedded.At(bounds.Min.X+bounds.Dx()/2, bounds.Min.Y+bounds.Dy()/2)).(color.NRGBA)
			if pixel.R == 20 && pixel.B == 150 && pixel.G%3 == 0 && pixel.G >= 41*3 && pixel.G <= 51*3 {
				if got[i] != 0 {
					t.Fatalf("page %d has multiple slide images", i+1)
				}
				got[i] = int(pixel.G / 3)
			}
		}
	}
	if len(got) != len(want) {
		t.Fatalf("page image order = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("page image order = %v, want %v", got, want)
		}
	}
	for _, width := range []int{61, 63, 65} {
		if !branded[width] {
			t.Errorf("logo with width %d missing in the rendered PDF", width)
		}
	}
	parsed, err := api.ReadContext(t.Context(), bytes.NewReader(pdf), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := parsed.Catalog()
	if err != nil || catalog["StructTreeRoot"] == nil {
		t.Fatalf("custom PDF is missing accessibility structure: %v", err)
	}
	alts := map[string]bool{}
	var walk func(types.Object)
	walk = func(node types.Object) {
		if node == nil {
			return
		}
		value, err := parsed.Dereference(node)
		if err != nil {
			t.Fatal(err)
		}
		switch value := value.(type) {
		case types.Array:
			for _, child := range value {
				walk(child)
			}
		case types.Dict:
			if value["Alt"] != nil {
				text, err := types.StringOrHexLiteral(value["Alt"])
				if err == nil && text != nil {
					alts[*text] = true
				}
			}
			walk(value["K"])
		}
	}
	walk(catalog["StructTreeRoot"])
	for _, description := range []string{"Opening slide", "Closing slide", "Example school logo"} {
		if !alts[description] {
			t.Errorf("image description %q missing in the tagged PDF", description)
		}
	}

}

func TestRenderSectionSamples(t *testing.T) {
	r := renderer(t)
	math := sampleTargets()
	reading := []satpdflayout.Option{
		{Target: satpdflayout.Target{Kind: "reviewSubject", SectionKey: "reading-writing"}, Label: "Reading and Writing"},
		{Target: satpdflayout.Target{Kind: "reviewModule", SectionKey: "reading-writing", ModuleKey: "rw-m1"}, Label: "Module 1"},
	}
	math[2].Label = "Module 2 · Higher"
	math = append(math, satpdflayout.Option{Target: satpdflayout.Target{Kind: "reviewModule", SectionKey: "math", ModuleKey: "math-m2-lower"}, Label: "Module 2 · Lower"})
	options := append(reading, math[0], math[1], math[3], math[2])
	exam, view := LayoutSample("SAT Practice 04", options, true)
	for _, sample := range []struct {
		name   string
		target satpdflayout.Target
		pages  int
	}{
		{"cover", satpdflayout.Target{Kind: "cover"}, 1},
		{"scoreReport", satpdflayout.Target{Kind: "scoreReport"}, 1},
		{"answerSummary", satpdflayout.Target{Kind: "answerSummary"}, 1},
		{"answerKey", satpdflayout.Target{Kind: "answerKey"}, 1},
		{"examReview", satpdflayout.Target{Kind: "examReview"}, 4},
		{"reviewSubject-reading-writing", reading[0].Target, 1},
		{"reviewModule-reading-writing-rw-m1", reading[1].Target, 1},
		{"reviewSubject-math", math[0].Target, 3},
		{"reviewModule-math-math-m1", math[1].Target, 1},
		{"reviewModule-math-math-m2-higher", math[2].Target, 1},
		{"reviewModule-math-math-m2-lower", math[3].Target, 1},
	} {
		t.Run(sample.name, func(t *testing.T) {
			payload, err := MarshalSectionSample(exam, view, nil, sample.target)
			if err != nil {
				t.Fatal(err)
			}
			pdf, err := r.Render(t.Context(), payload)
			if err != nil {
				t.Fatal(err)
			}
			pages, err := api.PageDims(t.Context(), bytes.NewReader(pdf), pdfConfiguration())
			if err != nil {
				t.Fatal(err)
			}
			if len(pages) != sample.pages {
				t.Fatalf("got %d pages, want %d", len(pages), sample.pages)
			}
		})
	}
}

func TestSampleBookIndexesGeneratedSections(t *testing.T) {
	r := renderer(t)
	exam, view := LayoutSample("Sample book", sampleTargets(), true)
	payload, err := MarshalSampleBook(exam, view, nil)
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := r.Render(t.Context(), payload)
	if err != nil {
		t.Fatal(err)
	}
	annotations, err := api.Annotations(t.Context(), bytes.NewReader(pdf), nil, pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	const markerPrefix = "https://sat-pdf-preview.invalid/section/"
	found := make(map[string]int)
	for page, annotationsByKind := range annotations {
		for _, annotation := range annotationsByKind[model.AnnLink].Map {
			link, ok := annotation.(model.LinkAnnotation)
			if !ok || !strings.HasPrefix(link.URI, markerPrefix) {
				continue
			}
			key, err := url.PathUnescape(strings.TrimPrefix(link.URI, markerPrefix))
			if err != nil {
				t.Fatal(err)
			}
			found[key] = page
		}
	}
	want := map[string]int{
		"scoreReport":                       2,
		"answerSummary":                     3,
		"answerKey":                         4,
		`["reviewModule","math","math-m1"]`: 5,
		`["reviewModule","math","math-m2-higher"]`: 6,
	}
	for key, page := range want {
		if got := found[key]; got != page {
			t.Errorf("section %s points to page %d, want %d", key, got, page)
		}
	}
}
