package answeredpdf

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"testing"

	"example.com/ielts-proctoring/internal/satpdflayout"
	"github.com/pdfcpu/pdfcpu/pkg/api"
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
			config, _, err := image.DecodeConfig(im)
			if err != nil {
				t.Fatalf("page %d: decode image: %v", i+1, err)
			}
			branded[config.Width] = true
			if config.Width >= 41 && config.Width <= 51 && config.Height == 36 {
				if got[i] != 0 {
					t.Fatalf("page %d has multiple slide images", i+1)
				}
				got[i] = config.Width
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
