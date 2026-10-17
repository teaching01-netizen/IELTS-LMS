package answeredpdf

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/media"
	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// Independent synthetic fixtures: never rewrite the developer's payload.json.
func fullExamPayload(t *testing.T) []byte {
	t.Helper()
	type obj = map[string]any
	text := func(value string) obj {
		return obj{"version": 1, "nodes": []obj{{"type": "paragraph", "id": "text", "text": value}}}
	}
	figure := func(id string) obj {
		return obj{"version": 2, "nodes": []obj{}, "document": obj{"type": "doc", "content": []obj{
			{"type": "image", "attrs": obj{"assetId": id, "alt": "Synthetic graph", "width": 320}},
		}}}
	}
	media := map[string]string{}
	img := image.NewNRGBA(image.Rect(0, 0, 320, 180))
	for y := 0; y < 180; y++ {
		for x := 0; x < 320; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x % 256), G: uint8(y), B: 100, A: uint8(80 + (x+y)%176)})
		}
	}
	for _, format := range []string{"png", "jpeg"} {
		var encoded bytes.Buffer
		var err error
		if format == "png" {
			err = png.Encode(&encoded, img)
		} else {
			err = jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 95})
		}
		if err != nil {
			t.Fatal(err)
		}
		media[format] = "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	}
	sections, attempts, responses := []obj{}, []obj{}, []obj{}
	for _, section := range []struct {
		key, title string
		count      int
	}{
		{"reading-writing", "Reading and Writing", 27}, {"math", "Math", 22},
	} {
		modules := []obj{}
		for m := 1; m <= 2; m++ {
			id := fmt.Sprintf("%s-%d", section.key, m)
			questions := []obj{}
			for i := 0; i < section.count; i++ {
				qid := fmt.Sprintf("%s-q%d", id, i)
				stimulus := text(strings.Repeat("A long passage explains the relationship between observations and evidence. Students compare the details before choosing an answer. ", 8))
				if i%7 == 0 {
					stimulus = figure("png")
				}
				if i%7 == 1 {
					stimulus = figure("jpeg")
				}
				prompt := text("Which conclusion is supported by the evidence?")
				if section.key == "math" {
					prompt = obj{"version": 1, "nodes": []obj{
						{"type": "paragraph", "id": "prompt", "text": "Find the positive value of x."},
						{"type": "equation", "id": "equation", "latex": `\frac{x^2}{4} + \sqrt{9} = 12`, "display": true},
					}}
				}
				options := []obj{}
				for _, letter := range []string{"a", "b", "c", "d"} {
					options = append(options, obj{"id": letter, "content": text("Answer choice " + letter)})
				}
				answer := obj{"kind": "single_choice", "options": options}
				response := "b"
				if section.key == "math" && i%3 == 0 {
					answer = obj{"kind": "student_produced_response"}
					response = "3/4"
				}
				questions = append(questions, obj{
					"examQuestionId": qid, "questionId": qid, "displayOrder": i,
					"questionType": answer["kind"], "isPretest": false, "stimulus": stimulus,
					"prompt": prompt, "answer": answer, "metadata": obj{}, "accessibility": obj{"longDescription": nil},
				})
				if i != 2 {
					responses = append(responses, obj{"moduleAttemptId": id, "examQuestionId": qid, "response": response, "markedForReview": i%5 == 0})
				}
			}
			modules = append(modules, obj{"id": id, "moduleKey": id, "title": fmt.Sprintf("Module %d", m), "displayOrder": m - 1, "questions": questions})
			attempts = append(attempts, obj{"id": id, "moduleId": id, "startedAt": "2026-10-17T09:00:00Z"})
		}
		sections = append(sections, obj{"sectionKey": section.key, "title": section.title, "modules": modules})
	}
	payload, err := json.Marshal(obj{"exam": obj{
		"examTitle": "SAT full exam fidelity fixture", "candidateName": "มินา เฉิน",
		"sections": sections, "attempt": obj{"moduleAttempts": attempts, "responses": responses},
	}, "view": nil, "media": media})
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func assertPDFStructureAndImages(t *testing.T, original, optimized []byte) {
	t.Helper()
	before, err := api.PageDims(t.Context(), bytes.NewReader(original), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	after, err := api.PageDims(t.Context(), bytes.NewReader(optimized), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("page count or dimensions changed")
	}
	imagePixels := func(pdf []byte) map[[32]byte]bool {
		pages, err := api.ExtractImagesRaw(t.Context(), bytes.NewReader(pdf), nil, pdfConfiguration())
		if err != nil {
			t.Fatal(err)
		}
		// Extraction caches shared images across pages. Compare unique pixels
		// document-wide; the independent page rasters verify their placement.
		result := map[[32]byte]bool{}
		seen := map[int]bool{}
		for _, page := range pages {
			for _, resource := range page {
				if seen[resource.ObjNr] {
					continue
				}
				seen[resource.ObjNr] = true
				decoded, _, err := image.Decode(resource.Reader)
				if err != nil {
					t.Fatal(err)
				}
				hash := sha256.New()
				fmt.Fprint(hash, decoded.Bounds())
				for y := decoded.Bounds().Min.Y; y < decoded.Bounds().Max.Y; y++ {
					for x := decoded.Bounds().Min.X; x < decoded.Bounds().Max.X; x++ {
						r, g, b, a := decoded.At(x, y).RGBA()
						fmt.Fprintf(hash, "%04x%04x%04x%04x", r, g, b, a)
					}
				}
				var digest [32]byte
				copy(digest[:], hash.Sum(nil))
				result[digest] = true
			}
		}
		return result
	}
	if !reflect.DeepEqual(imagePixels(original), imagePixels(optimized)) {
		t.Fatal("decoded image pixels changed")
	}
}

// Optional independent oracles: Poppler for pixels, pypdf for text. Enable
// with ANSWEREDPDF_FIDELITY=1 and ANSWEREDPDF_PYTHON pointing to Python + pypdf.
func assertPDFPixelsAndText(t *testing.T, original, optimized []byte) {
	t.Helper()
	if os.Getenv("ANSWEREDPDF_FIDELITY") != "1" {
		return
	}
	python := os.Getenv("ANSWEREDPDF_PYTHON")
	if python == "" {
		python = "python3"
	}
	for _, name := range []string{"pdftoppm", python} {
		if _, err := exec.LookPath(name); err != nil {
			t.Fatalf("fidelity run needs %s: %v", name, err)
		}
	}
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "original.pdf"), filepath.Join(dir, "optimized.pdf")}
	for i, pdf := range [][]byte{original, optimized} {
		if err := os.WriteFile(paths[i], pdf, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	run := func(name string, args ...string) []byte {
		cmd := exec.CommandContext(t.Context(), name, args...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("%s: %v: %s", name, err, &stderr)
		}
		return out
	}
	const extractText = "import sys,json; from pypdf import PdfReader; print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages], ensure_ascii=True))"
	if !bytes.Equal(run(python, "-c", extractText, paths[0]), run(python, "-c", extractText, paths[1])) {
		t.Fatal("extracted text changed")
	}
	count, err := api.PageCount(t.Context(), bytes.NewReader(original), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	for _, dpi := range []string{"96", "200"} {
		for page := 1; page <= count; page++ {
			n := strconv.Itoa(page)
			a := run("pdftoppm", "-r", dpi, "-f", n, "-l", n, "-singlefile", paths[0])
			b := run("pdftoppm", "-r", dpi, "-f", n, "-l", n, "-singlefile", paths[1])
			if !bytes.Equal(a, b) {
				t.Fatalf("page %d pixels changed at %s DPI", page, dpi)
			}
		}
	}
	t.Logf("all %d pages: identical text and pixels at 96 and 200 DPI", count)
}

func TestOptimizationFixtureFidelity(t *testing.T) {
	original := optimizationFixture(t)
	optimized, err := optimizePDF(t.Context(), original, losslessOptimize)
	if err != nil {
		t.Fatal(err)
	}
	assertPDFStructureAndImages(t, original, optimized)
	assertPDFPixelsAndText(t, original, optimized)
}

func TestFullExamFidelity(t *testing.T) {
	for _, withReport := range []bool{false, true} {
		name := "without-score-report"
		if withReport {
			name = "with-score-report"
		}
		t.Run(name, func(t *testing.T) { verifyFullExamFidelity(t, withReport) })
	}
}

func verifyFullExamFidelity(t *testing.T, withReport bool) {
	r := renderer(t)
	ctx, cancel := context.WithTimeout(t.Context(), RenderTimeout)
	defer cancel()
	var fixture struct {
		Exam  *delivery.AnsweredExam `json:"exam"`
		View  json.RawMessage        `json:"view"`
		Media map[string]string      `json:"media"`
	}
	if err := json.Unmarshal(fullExamPayload(t), &fixture); err != nil {
		t.Fatal(err)
	}
	if withReport {
		fixture.View = json.RawMessage(`{
          "layout":"full-sat","title":"Digital SAT Score Report","primaryLabel":"Total score",
          "primaryScore":{"kind":"estimated","low":1320,"high":1360,"scale":{"min":400,"max":1600}},
          "showCombinedScore":true,"notice":null,"methodology":{"isEstimated":true,"converterVersion":"fixture-v1"},"issues":[],
          "subjects":[
            {"key":"reading-writing","label":"Reading & Writing","score":{"kind":"estimated","low":660,"high":680,"scale":{"min":200,"max":800}},"rawCorrect":44,"rawTotal":54,
             "modules":[{"key":"reading-writing-1","label":"Module 1","rawCorrect":22,"rawTotal":27},{"key":"reading-writing-2","label":"Module 2","rawCorrect":22,"rawTotal":27}],
             "domains":[{"name":"Information and Ideas","correct":12,"total":14,"accuracy":86}]},
            {"key":"math","label":"Math","score":{"kind":"estimated","low":660,"high":680,"scale":{"min":200,"max":800}},"rawCorrect":36,"rawTotal":44,
             "modules":[{"key":"math-1","label":"Module 1","rawCorrect":18,"rawTotal":22},{"key":"math-2","label":"Module 2","rawCorrect":18,"rawTotal":22}],
             "domains":[{"name":"Algebra","correct":12,"total":14,"accuracy":86}]}
          ]}`)
	}
	legacy, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := BuildPayload(ctx, fixture.Exam, fixture.View, func(_ context.Context, id string) (media.Content, error) {
		parts := strings.SplitN(fixture.Media[id], ";base64,", 2)
		if len(parts) != 2 {
			return media.Content{}, ErrNotPrintable
		}
		data, err := base64.StdEncoding.DecodeString(parts[1])
		return media.Content{ContentType: strings.TrimPrefix(parts[0], "data:"), Body: imageBody{bytes.NewReader(data)}}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(legacy, payload) {
		t.Fatal("server preparation changed the legacy print payload")
	}
	original, err := r.render(ctx, payload)
	if err != nil {
		t.Fatal(err)
	}
	optimized, err := optimizePDF(t.Context(), original, losslessOptimize)
	if err != nil {
		t.Fatal(err)
	}
	count, err := api.PageCount(t.Context(), bytes.NewReader(optimized), pdfConfiguration())
	if err != nil || count < 100 || count > 103 {
		t.Fatalf("98 questions plus front matter: pages=%d err=%v", count, err)
	}
	if len(optimized) >= len(original) {
		t.Fatalf("full exam was not reduced: %d -> %d", len(original), len(optimized))
	}
	if dir := os.Getenv("ANSWEREDPDF_FIDELITY_OUT"); dir != "" {
		for name, pdf := range map[string][]byte{"original.pdf": original, "optimized.pdf": optimized} {
			if withReport {
				name = strings.TrimSuffix(name, ".pdf") + "-score-report.pdf"
			}
			if err := os.WriteFile(filepath.Join(dir, name), pdf, 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	t.Logf("full exam: %d pages, %d -> %d bytes", count, len(original), len(optimized))
	assertPDFStructureAndImages(t, original, optimized)
	assertPDFPixelsAndText(t, original, optimized)
}
