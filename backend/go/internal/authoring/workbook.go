package authoring

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
)

const (
	satWorkbookTemplateVersion = "2"
	MaxSATWorkbookBytes        = 12 << 20
	maxSATWorkbookRows         = 200
	maxSATWorkbookCellChars    = 50_000
	maxSATWorkbookZipEntries   = 1_000
	maxSATWorkbookUnzipped     = 80 << 20
	maxSATWorkbookAssets       = 48
	maxSATWorkbookAssetBytes   = 10 << 20
	maxSATWorkbookAssetTotal   = 30 << 20
)

// SatWorkbookIssue is a row-level diagnostic returned by workbook preview.
type SatWorkbookIssue struct {
	Row      int    `json:"row"`
	Field    string `json:"field"`
	Message  string `json:"message"`
	Blocking bool   `json:"blocking"`
}

// SatWorkbookModuleDraft is the complete content for one SAT module.
type SatWorkbookModuleDraft struct {
	ModuleKey  string          `json:"moduleKey"`
	SectionKey string          `json:"sectionKey"`
	Questions  []QuestionDraft `json:"questions"`
}

// SatWorkbookAsset is a checked embedded workbook image. The bytes are only
// returned during preview so the browser can stage them through media APIs.
type SatWorkbookAsset struct {
	Key            string  `json:"key"`
	FileName       string  `json:"fileName"`
	ContentType    string  `json:"contentType"`
	SizeBytes      int     `json:"sizeBytes"`
	ChecksumSHA256 string  `json:"checksumSha256"`
	AltText        string  `json:"altText"`
	Caption        *string `json:"caption"`
	DataBase64     *string `json:"dataBase64,omitempty"`
}

// SatWorkbookPreview is the renderer-ready result of parsing a workbook.
type SatWorkbookPreview struct {
	ImportID        string                   `json:"importId"`
	TemplateVersion string                   `json:"templateVersion"`
	RowCount        int                      `json:"rowCount"`
	QuestionCount   int                      `json:"questionCount"`
	Valid           bool                     `json:"valid"`
	Modules         []SatWorkbookModuleDraft `json:"modules"`
	Assets          []SatWorkbookAsset       `json:"assets"`
	Issues          []SatWorkbookIssue       `json:"issues"`
}

// SatWorkbookStagedAsset binds a checked workbook key to a finalized media
// asset owned by the preview import.
type SatWorkbookStagedAsset struct {
	Key     string `json:"key"`
	AssetID string `json:"assetId"`
}

// SatWorkbookCommitRequest is the optimistic, complete replacement request.
// OperationKey makes a lost-response commit retry replay instead of
// replacing the draft a second time.
type SatWorkbookCommitRequest struct {
	ImportID                string                   `json:"importId"`
	ExpectedVersionID       string                   `json:"expectedVersionId"`
	ExpectedVersionRevision int                      `json:"expectedVersionRevision"`
	Modules                 []SatWorkbookModuleDraft `json:"modules"`
	Assets                  []SatWorkbookStagedAsset `json:"assets"`
	OperationKey            string                   `json:"operationKey"`
}

type satWorkbookModuleSpec struct {
	key, sectionKey, label string
	count                  int
}

var satWorkbookModules = []satWorkbookModuleSpec{
	{key: "rw-m1", sectionKey: SectionReadingWriting, label: "Reading & Writing · Module 1", count: 27},
	{key: "rw-m2-lower", sectionKey: SectionReadingWriting, label: "Reading & Writing · Module 2 — Lower", count: 27},
	{key: "rw-m2-higher", sectionKey: SectionReadingWriting, label: "Reading & Writing · Module 2 — Higher", count: 27},
	{key: "math-m1", sectionKey: SectionMath, label: "Math · Module 1", count: 22},
	{key: "math-m2-lower", sectionKey: SectionMath, label: "Math · Module 2 — Lower", count: 22},
	{key: "math-m2-higher", sectionKey: SectionMath, label: "Math · Module 2 — Higher", count: 22},
}

var workbookModuleByLabel = func() map[string]satWorkbookModuleSpec {
	out := make(map[string]satWorkbookModuleSpec, len(satWorkbookModules)*2)
	for _, spec := range satWorkbookModules {
		out[normalizeWorkbookValue(spec.label)] = spec
		out[spec.key] = spec
	}
	return out
}()

var workbookHeaderAliases = map[string]string{
	"module":             "module",
	"order":              "order",
	"prompt":             "prompt",
	"stimulus":           "stimulus",
	"response type":      "responseType",
	"a":                  "a",
	"b":                  "b",
	"c":                  "c",
	"d":                  "d",
	"correct":            "correct",
	"accepted responses": "acceptedResponses",
	"domain":             "domain",
	"skill":              "skill",
	"difficulty":         "difficulty",
	"pretest":            "pretest",
	"rationale":          "rationale",
	"tags":               "tags",
}

var workbookAssetKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// WorkbookError is a safe parser failure. Invalid row content is represented
// in a normal preview so staff can correct it without a second upload.
type WorkbookError struct {
	TooLarge bool
	Message  string
}

func (e *WorkbookError) Error() string { return e.Message }

func guardSATWorkbookArchive(data []byte) error {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return &WorkbookError{Message: "The file is not a readable .xlsx workbook."}
	}
	if len(archive.File) > maxSATWorkbookZipEntries {
		return &WorkbookError{Message: "The workbook contains too many archive entries."}
	}
	var total uint64
	for _, file := range archive.File {
		if file.Flags&0x1 != 0 {
			return &WorkbookError{Message: "Encrypted workbooks are not supported."}
		}
		total += file.UncompressedSize64
		if total > maxSATWorkbookUnzipped {
			return &WorkbookError{Message: "The workbook expands beyond the 80 MB safety limit."}
		}
	}
	return nil
}

// ParseSATWorkbook parses the Questions and Assets contract emitted by the
// template endpoint. Excel content is converted to the structured-content
// shape used by the authoring editor and student renderer.
func ParseSATWorkbook(data []byte) (SatWorkbookPreview, error) {
	if len(data) > MaxSATWorkbookBytes {
		return SatWorkbookPreview{}, &WorkbookError{TooLarge: true, Message: "SAT workbooks must be 12 MB or smaller."}
	}
	if len(data) < 2 || data[0] != 'P' || data[1] != 'K' {
		return SatWorkbookPreview{}, &WorkbookError{Message: "The file is not a readable .xlsx workbook."}
	}
	if err := guardSATWorkbookArchive(data); err != nil {
		return SatWorkbookPreview{}, err
	}
	book, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{
		UnzipSizeLimit:    80 << 20,
		UnzipXMLSizeLimit: 16 << 20,
	})
	if err != nil {
		return SatWorkbookPreview{}, &WorkbookError{Message: "The file is not a readable .xlsx workbook."}
	}
	defer func() { _ = book.Close() }()

	issues := make([]SatWorkbookIssue, 0)
	if err := scanSATWorkbookPictures(book, &issues); err != nil {
		return SatWorkbookPreview{}, err
	}
	assets, assetAlt, assetCaption, err := parseSATWorkbookAssets(book, &issues)
	if err != nil {
		return SatWorkbookPreview{}, err
	}
	rows, err := book.GetRows("Questions", excelize.Options{RawCellValue: false})
	if err != nil {
		return SatWorkbookPreview{}, &WorkbookError{Message: "The workbook must contain a readable Questions sheet."}
	}
	if len(rows) == 0 {
		issues = append(issues, satWorkbookIssue(1, "file", "The Questions sheet is empty."))
		return emptySATWorkbookPreview(assets, issues), nil
	}
	formulaFound := false
	for rowIndex, row := range rows {
		for columnIndex := range row {
			cell, err := book.GetCellFormula("Questions", workbookColumnName(columnIndex+1)+strconv.Itoa(rowIndex+1))
			if err == nil && strings.TrimSpace(cell) != "" {
				formulaFound = true
				break
			}
		}
		if formulaFound {
			break
		}
	}
	if formulaFound {
		issues = append(issues, satWorkbookIssue(0, "file", "Formulas are not allowed in SAT imports. Replace formulas with their displayed values."))
	}

	columns := make(map[string]int)
	for index, header := range rows[0] {
		if canonical, ok := workbookHeaderAliases[normalizeWorkbookValue(header)]; ok {
			columns[canonical] = index
		}
	}
	for _, required := range []string{"module", "order", "prompt", "responseType", "domain", "skill", "difficulty", "pretest"} {
		if _, ok := columns[required]; !ok {
			issues = append(issues, satWorkbookIssue(1, required, fmt.Sprintf("Missing required column %q.", required)))
		}
	}

	parsed := make(map[string][]workbookQuestion)
	orders := make(map[string]map[int]bool)
	rowCount := 0
	questionRows := rows[1:]
	if len(questionRows) > maxSATWorkbookRows {
		issues = append(issues, satWorkbookIssue(maxSATWorkbookRows+2, "file", "A SAT workbook can contain at most 200 question rows."))
		questionRows = questionRows[:maxSATWorkbookRows]
	}
	for rowIndex, row := range questionRows {
		excelRow := rowIndex + 2
		if workbookRowBlank(row) {
			continue
		}
		rowCount++
		oversized := false
		for columnIndex, cell := range row {
			if len([]rune(cell)) <= maxSATWorkbookCellChars {
				continue
			}
			field := "file"
			if columnIndex < len(rows[0]) {
				field = strings.TrimSpace(rows[0][columnIndex])
			}
			if field == "" {
				field = "file"
			}
			issues = append(issues, satWorkbookIssue(excelRow, field, "Cell content is too large. Keep each cell under 50,000 characters."))
			oversized = true
		}
		if oversized {
			continue
		}
		value := func(name string) string { return workbookCell(row, columns[name]) }
		moduleValue := value("module")
		spec, ok := workbookModuleByLabel[normalizeWorkbookValue(moduleValue)]
		if !ok {
			issues = append(issues, satWorkbookIssue(excelRow, "Module", "Choose one of the six SAT modules from the template."))
			continue
		}
		if orders[spec.key] == nil {
			orders[spec.key] = map[int]bool{}
		}
		order, orderOK := parseWorkbookOrder(value("order"), spec.count)
		if !orderOK {
			issues = append(issues, satWorkbookIssue(excelRow, "Order", fmt.Sprintf("Order must be a unique number from 1 through %d.", spec.count)))
		} else if orders[spec.key][order] {
			issues = append(issues, satWorkbookIssue(excelRow, "Order", "Order must be unique within a module."))
		} else {
			orders[spec.key][order] = true
		}

		responseType := normalizeWorkbookValue(value("responseType"))
		isSPR := responseType == "student response" || responseType == "spr" || responseType == "student produced response"
		isMCQ := responseType == "" || responseType == "multiple choice" || responseType == "mcq" || responseType == "single choice"
		if !isSPR && !isMCQ {
			issues = append(issues, satWorkbookIssue(excelRow, "Response Type", "Response Type must be Multiple Choice or Student Response."))
		}
		if isSPR && spec.sectionKey != SectionMath {
			issues = append(issues, satWorkbookIssue(excelRow, "Response Type", "Student Response is only supported in Math."))
		}

		promptText := strings.TrimSpace(value("prompt"))
		if promptText == "" {
			issues = append(issues, satWorkbookIssue(excelRow, "Prompt", "Question text is required."))
		}
		domain, domainOK := resolveWorkbookDomain(spec.sectionKey, value("domain"))
		if !domainOK {
			issues = append(issues, satWorkbookIssue(excelRow, "Domain", "Choose a valid SAT domain for this section."))
		}
		skill := strings.TrimSpace(value("skill"))
		if !satSkillValid(domain, skill) {
			issues = append(issues, satWorkbookIssue(excelRow, "Skill", "Choose a skill that belongs to the selected SAT domain."))
		}
		difficulty := strings.ToLower(strings.TrimSpace(value("difficulty")))
		if difficulty != "easy" && difficulty != "medium" && difficulty != "hard" {
			issues = append(issues, satWorkbookIssue(excelRow, "Difficulty", "Difficulty must be Easy, Medium, or Hard."))
		}
		pretest, pretestOK := parseWorkbookBool(value("pretest"))
		if !pretestOK {
			issues = append(issues, satWorkbookIssue(excelRow, "Pretest", "Pretest must be Yes or No."))
		}

		prompt := compileWorkbookContent(promptText, assetAlt, assetCaption)
		stimulus := compileWorkbookContent(strings.TrimSpace(value("stimulus")), assetAlt, assetCaption)
		rationale := compileWorkbookContent(strings.TrimSpace(value("rationale")), assetAlt, assetCaption)
		answer := compileWorkbookAnswer(isSPR, row, columns, assetAlt, assetCaption, excelRow, &issues)
		metadata := marshalWorkbookMetadata(spec.sectionKey, domain, skill, difficulty, splitWorkbookList(value("tags")))
		accessibility := json.RawMessage(`{"longDescription":null}`)
		questionType := "single_choice"
		if isSPR {
			questionType = "student_produced_response"
		}
		draft := QuestionDraft{
			QuestionType:  questionType,
			Stimulus:      stimulus,
			Prompt:        prompt,
			Answer:        answer,
			Rationale:     rationale,
			Metadata:      metadata,
			Accessibility: accessibility,
			IsPretest:     pretest,
		}
		for _, issue := range validateSATQuestion(spec.sectionKey, questionType, string(stimulus), string(prompt), string(answer), string(rationale), string(metadata)) {
			if issue.Blocking {
				issues = append(issues, satWorkbookIssue(excelRow, workbookFieldForPath(issue.Path), issue.Message))
			}
		}
		difficultyOK := difficulty == "easy" || difficulty == "medium" || difficulty == "hard"
		skillOK := satSkillValid(domain, skill)
		if !orderOK || !pretestOK || !domainOK || !skillOK || !difficultyOK || strings.TrimSpace(promptText) == "" {
			continue
		}
		parsed[spec.key] = append(parsed[spec.key], workbookQuestion{order: order, draft: draft})
	}

	modules := make([]SatWorkbookModuleDraft, 0, len(satWorkbookModules))
	for _, spec := range satWorkbookModules {
		items := parsed[spec.key]
		sort.SliceStable(items, func(i, j int) bool { return items[i].order < items[j].order })
		pretests := 0
		questions := make([]QuestionDraft, 0, len(items))
		for _, item := range items {
			if item.draft.IsPretest {
				pretests++
			}
			questions = append(questions, item.draft)
		}
		if len(questions) != spec.count {
			issues = append(issues, satWorkbookIssue(0, "Module", fmt.Sprintf("%s requires exactly %d questions; found %d.", spec.label, spec.count, len(questions))))
		}
		if pretests != 2 {
			issues = append(issues, satWorkbookIssue(0, "Pretest", fmt.Sprintf("%s requires exactly 2 pretest questions; found %d.", spec.label, pretests)))
		}
		modules = append(modules, SatWorkbookModuleDraft{ModuleKey: spec.key, SectionKey: spec.sectionKey, Questions: questions})
	}
	valid := true
	for _, issue := range issues {
		if issue.Blocking {
			valid = false
			break
		}
	}
	return SatWorkbookPreview{
		ImportID:        uuid.NewString(),
		TemplateVersion: satWorkbookTemplateVersion,
		RowCount:        rowCount,
		QuestionCount:   sumWorkbookQuestions(modules),
		Valid:           valid,
		Modules:         modules,
		Assets:          assets,
		Issues:          issues,
	}, nil
}

// scanSATWorkbookPictures enforces the placement and archive-wide limits that
// the Rust importer applied before reading individual Assets rows. Excelize's
// public picture-cell index lets us reject images hidden on another sheet or
// anchored outside the Assets Image column instead of silently dropping them.
func scanSATWorkbookPictures(book *excelize.File, issues *[]SatWorkbookIssue) error {
	count := 0
	var totalBytes uint64
	for _, sheet := range book.GetSheetList() {
		cells, err := book.GetPictureCells(sheet)
		if err != nil {
			return &WorkbookError{Message: "The workbook contains unreadable embedded images."}
		}
		for _, cell := range cells {
			pictures, err := book.GetPictures(sheet, cell)
			if err != nil {
				return &WorkbookError{Message: "The workbook contains unreadable embedded images."}
			}
			count += len(pictures)
			for _, picture := range pictures {
				totalBytes += uint64(len(picture.File))
			}
			column, row, err := excelize.CellNameToCoordinates(cell)
			if err != nil {
				return &WorkbookError{Message: "The workbook contains an invalid embedded image anchor."}
			}
			if sheet != "Assets" {
				*issues = append(*issues, satWorkbookIssue(row, "Assets", fmt.Sprintf("Embedded image on %s must be placed on the Assets sheet.", sheet)))
				continue
			}
			if column != 4 || row < 2 {
				*issues = append(*issues, satWorkbookIssue(row, "Image", "Anchor each embedded image in the Image column on the same row as its asset metadata."))
			}
		}
	}
	if count > maxSATWorkbookAssets {
		return &WorkbookError{Message: fmt.Sprintf("The workbook contains more than %d embedded images.", maxSATWorkbookAssets)}
	}
	if totalBytes > maxSATWorkbookAssetTotal {
		return &WorkbookError{Message: "Embedded images exceed the 30 MB safety limit."}
	}
	return nil
}

type workbookQuestion struct {
	order int
	draft QuestionDraft
}

func emptySATWorkbookPreview(assets []SatWorkbookAsset, issues []SatWorkbookIssue) SatWorkbookPreview {
	modules := make([]SatWorkbookModuleDraft, 0, len(satWorkbookModules))
	for _, spec := range satWorkbookModules {
		modules = append(modules, SatWorkbookModuleDraft{ModuleKey: spec.key, SectionKey: spec.sectionKey, Questions: []QuestionDraft{}})
	}
	return SatWorkbookPreview{ImportID: uuid.NewString(), TemplateVersion: satWorkbookTemplateVersion, Valid: false, Modules: modules, Assets: assets, Issues: issues}
}

func sumWorkbookQuestions(modules []SatWorkbookModuleDraft) int {
	total := 0
	for _, module := range modules {
		total += len(module.Questions)
	}
	return total
}

func satWorkbookIssue(row int, field, message string) SatWorkbookIssue {
	return SatWorkbookIssue{Row: row, Field: field, Message: message, Blocking: true}
}

func normalizeWorkbookValue(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
}

func workbookRowBlank(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func workbookCell(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return row[index]
}

func workbookColumnName(column int) string {
	var out []byte
	for column > 0 {
		column--
		out = append([]byte{byte('A' + column%26)}, out...)
		column /= 26
	}
	return string(out)
}

func parseWorkbookOrder(raw string, max int) (int, bool) {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	return value, err == nil && value >= 1 && value <= max
}

func parseWorkbookBool(raw string) (bool, bool) {
	switch normalizeWorkbookValue(raw) {
	case "yes", "y", "true", "1":
		return true, true
	case "no", "n", "false", "0":
		return false, true
	default:
		return false, false
	}
}

func resolveWorkbookDomain(section, raw string) (string, bool) {
	value := normalizeWorkbookValue(raw)
	domains := map[string]map[string]string{
		SectionReadingWriting: {
			"information and ideas":        "information-and-ideas",
			"information-and-ideas":        "information-and-ideas",
			"craft and structure":          "craft-and-structure",
			"craft-and-structure":          "craft-and-structure",
			"expression of ideas":          "expression-of-ideas",
			"expression-of-ideas":          "expression-of-ideas",
			"standard english conventions": "standard-english-conventions",
			"standard-english-conventions": "standard-english-conventions",
		},
		SectionMath: {
			"algebra":                           "algebra",
			"advanced math":                     "advanced-math",
			"advanced-math":                     "advanced-math",
			"problem solving and data analysis": "problem-solving-and-data-analysis",
			"problem-solving-and-data-analysis": "problem-solving-and-data-analysis",
			"geometry and trigonometry":         "geometry-and-trigonometry",
			"geometry-and-trigonometry":         "geometry-and-trigonometry",
		},
	}
	value = domains[section][value]
	return value, value != ""
}

func marshalWorkbookMetadata(section, domain, skill, difficulty string, tags []string) json.RawMessage {
	value, _ := json.Marshal(map[string]any{
		"sectionKey": section,
		"domain":     nullableWorkbookString(domain),
		"skill":      nullableWorkbookString(skill),
		"difficulty": difficulty,
		"tags":       tags,
	})
	return value
}

func nullableWorkbookString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func splitWorkbookList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ';' })
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" && !seen[part] {
			seen[part] = true
			out = append(out, part)
		}
	}
	return out
}

func compileWorkbookAnswer(spr bool, row []string, columns map[string]int, alt, captions map[string]string, excelRow int, issues *[]SatWorkbookIssue) json.RawMessage {
	if spr {
		responses := splitWorkbookList(workbookCell(row, columns["acceptedResponses"]))
		value, _ := json.Marshal(map[string]any{
			"kind":              "student_produced_response",
			"acceptedResponses": responses,
			"normalizeFraction": true,
			"normalizeDecimal":  true,
			"numericTolerance":  nil,
		})
		return value
	}
	options := make([]map[string]any, 0, 4)
	for _, key := range []string{"a", "b", "c", "d"} {
		content := compileWorkbookContent(strings.TrimSpace(workbookCell(row, columns[key])), alt, captions)
		options = append(options, map[string]any{"id": strings.ToUpper(key), "content": json.RawMessage(content)})
	}
	correct := strings.ToUpper(strings.TrimSpace(workbookCell(row, columns["correct"])))
	var correctValue *string
	if correct == "A" || correct == "B" || correct == "C" || correct == "D" {
		correctValue = &correct
	} else {
		*issues = append(*issues, satWorkbookIssue(excelRow, "Correct", "Correct answer must be A, B, C, or D."))
	}
	value, _ := json.Marshal(map[string]any{"kind": "single_choice", "options": options, "correctOptionId": correctValue})
	return value
}

func workbookFieldForPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "Question"
	}
	parts := strings.Split(path, ".")
	last := parts[len(parts)-1]
	if strings.Contains(last, "options[") {
		return "Choices"
	}
	return last
}

func parseSATWorkbookAssets(book *excelize.File, issues *[]SatWorkbookIssue) ([]SatWorkbookAsset, map[string]string, map[string]string, error) {
	rows, err := book.GetRows("Assets", excelize.Options{RawCellValue: false})
	if err != nil {
		return []SatWorkbookAsset{}, map[string]string{}, map[string]string{}, nil
	}
	if len(rows) <= 1 {
		return []SatWorkbookAsset{}, map[string]string{}, map[string]string{}, nil
	}
	assets := make([]SatWorkbookAsset, 0)
	altByKey := map[string]string{}
	captionByKey := map[string]string{}
	totalBytes := 0
	for rowIndex, row := range rows[1:] {
		excelRow := rowIndex + 2
		key := strings.TrimSpace(workbookCell(row, 0))
		alt := strings.TrimSpace(workbookCell(row, 1))
		caption := strings.TrimSpace(workbookCell(row, 2))
		if key == "" && alt == "" && caption == "" {
			continue
		}
		if !workbookAssetKeyPattern.MatchString(key) || len(key) > 80 {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Asset Key", "Asset keys may contain only letters, numbers, dots, dashes, and underscores."))
			continue
		}
		if _, exists := altByKey[key]; exists {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Asset Key", "Asset keys must be unique."))
			continue
		}
		// Record the key before validating the image so a malformed first row
		// cannot make a duplicate metadata row appear valid.
		altByKey[key] = alt
		captionByKey[key] = caption
		if alt == "" {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Alt Text", "Every embedded image requires meaningful alternative text."))
		}
		pictures, picErr := book.GetPictures("Assets", fmt.Sprintf("D%d", excelRow))
		if picErr != nil || len(pictures) == 0 {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "Embed one image in the Image column for every asset row."))
			continue
		}
		if len(pictures) > 1 {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "Only one embedded image is allowed per asset row."))
			continue
		}
		picture := pictures[0]
		if len(picture.File) > maxSATWorkbookAssetBytes {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "Embedded images must be 10 MB or smaller."))
			continue
		}
		if len(assets) >= maxSATWorkbookAssets {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "A workbook can contain at most 48 embedded images."))
			continue
		}
		totalBytes += len(picture.File)
		if totalBytes > maxSATWorkbookAssetTotal {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "Embedded images exceed the 30 MB total limit."))
			continue
		}
		contentType, extension, ok := workbookImageType(picture.Extension, picture.File)
		if !ok {
			*issues = append(*issues, satWorkbookIssue(excelRow, "Image", "Use PNG, JPEG, GIF, or WebP images."))
			continue
		}
		digest := sha256.Sum256(picture.File)
		checksum := hex.EncodeToString(digest[:])
		fileName := key + "." + extension
		captionPtr := (*string)(nil)
		if caption != "" {
			captionCopy := caption
			captionPtr = &captionCopy
		}
		data := base64.StdEncoding.EncodeToString(picture.File)
		assets = append(assets, SatWorkbookAsset{
			Key: key, FileName: fileName, ContentType: contentType,
			SizeBytes: len(picture.File), ChecksumSHA256: checksum,
			AltText: alt, Caption: captionPtr, DataBase64: &data,
		})
	}
	return assets, altByKey, captionByKey, nil
}

func workbookImageType(ext string, data []byte) (string, string, bool) {
	ext = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(ext)), ".")
	switch {
	case ext == "png" && bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png", "png", true
	case (ext == "jpg" || ext == "jpeg") && len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", "jpg", true
	case ext == "gif" && (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))):
		return "image/gif", "gif", true
	case ext == "webp" && len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp", "webp", true
	default:
		return "", "", false
	}
}

func compileWorkbookContent(raw string, alt, captions map[string]string) json.RawMessage {
	raw = strings.ReplaceAll(strings.ReplaceAll(raw, "\r\n", "\n"), "\r", "\n")
	if strings.TrimSpace(raw) == "" {
		return json.RawMessage(`{"version":2,"nodes":[],"document":{"type":"doc","content":[]}}`)
	}
	lines := strings.Split(raw, "\n")
	blocks := make([]any, 0)
	for index := 0; index < len(lines); {
		trimmed := strings.TrimSpace(lines[index])
		if trimmed == "" {
			index++
			continue
		}
		if key, ok := standaloneWorkbookImage(trimmed); ok {
			blocks = append(blocks, workbookImageNode(key, alt, captions))
			index++
			continue
		}
		if node, next, ok := parseWorkbookCodeBlock(lines, index); ok {
			blocks = append(blocks, node)
			index = next
			continue
		}
		if node, next, ok := parseWorkbookBlockMath(lines, index); ok {
			blocks = append(blocks, node)
			index = next
			continue
		}
		if isWorkbookTableLine(trimmed) && index+1 < len(lines) && isWorkbookTableSeparator(lines[index+1]) {
			rows := make([][]string, 0)
			for index < len(lines) && isWorkbookTableLine(strings.TrimSpace(lines[index])) {
				if isWorkbookTableSeparator(lines[index]) {
					index++
					continue
				}
				rows = append(rows, splitWorkbookTableRow(lines[index]))
				index++
			}
			blocks = append(blocks, workbookTableNode(rows, alt, captions))
			continue
		}
		if strings.HasPrefix(trimmed, "## ") || strings.HasPrefix(trimmed, "### ") {
			level := 2
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "## "))
			if strings.HasPrefix(trimmed, "### ") {
				level = 3
				value = strings.TrimSpace(strings.TrimPrefix(trimmed, "### "))
			}
			blocks = append(blocks, map[string]any{"type": "heading", "attrs": map[string]any{"level": level}, "content": workbookInlineNodes(value, alt, captions)})
			index++
			continue
		}
		if isWorkbookBullet(trimmed) {
			items := make([]any, 0)
			for index < len(lines) && isWorkbookBullet(strings.TrimSpace(lines[index])) {
				value := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(lines[index])[1:], " \t"))
				items = append(items, map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": workbookInlineNodes(value, alt, captions)}}})
				index++
			}
			blocks = append(blocks, map[string]any{"type": "bulletList", "content": items})
			continue
		}
		if isWorkbookOrdered(trimmed) {
			items := make([]any, 0)
			for index < len(lines) && isWorkbookOrdered(strings.TrimSpace(lines[index])) {
				current := strings.TrimSpace(lines[index])
				period := strings.Index(current, ".")
				value := strings.TrimSpace(strings.TrimLeft(current[period+1:], " \t"))
				items = append(items, map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": workbookInlineNodes(value, alt, captions)}}})
				index++
			}
			blocks = append(blocks, map[string]any{"type": "orderedList", "attrs": map[string]any{"order": 1}, "content": items})
			continue
		}
		if strings.HasPrefix(trimmed, "> ") {
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "> "))
			blocks = append(blocks, map[string]any{"type": "blockquote", "content": []any{map[string]any{"type": "paragraph", "content": workbookInlineNodes(value, alt, captions)}}})
			index++
			continue
		}
		paragraph := []string{trimmed}
		index++
		for index < len(lines) {
			next := strings.TrimSpace(lines[index])
			if next == "" || startsWorkbookBlock(lines, index) {
				break
			}
			paragraph = append(paragraph, next)
			index++
		}
		blocks = append(blocks, map[string]any{"type": "paragraph", "content": workbookInlineNodes(strings.Join(paragraph, "\n"), alt, captions)})
	}
	value, _ := json.Marshal(map[string]any{"version": 2, "nodes": []any{}, "document": map[string]any{"type": "doc", "content": blocks}})
	return value
}

func standaloneWorkbookImage(value string) (string, bool) {
	if !strings.HasPrefix(value, "![") || !strings.HasSuffix(value, "]") || len(value) < 4 {
		return "", false
	}
	key := strings.TrimSpace(value[2 : len(value)-1])
	return key, workbookAssetKeyPattern.MatchString(key) && len(key) <= 80
}

func parseWorkbookCodeBlock(lines []string, start int) (map[string]any, int, bool) {
	first := strings.TrimSpace(lines[start])
	if !strings.HasPrefix(first, "```") {
		return nil, start, false
	}
	language := strings.TrimSpace(strings.TrimPrefix(first, "```"))
	code := make([]string, 0)
	index := start + 1
	for index < len(lines) && strings.TrimSpace(lines[index]) != "```" {
		code = append(code, lines[index])
		index++
	}
	if index < len(lines) {
		index++
	}
	attrs := map[string]any{}
	if language != "" {
		attrs["language"] = language
	}
	return map[string]any{"type": "codeBlock", "attrs": attrs, "content": []any{map[string]any{"type": "text", "text": strings.Join(code, "\n")}}}, index, true
}

func parseWorkbookBlockMath(lines []string, start int) (map[string]any, int, bool) {
	trimmed := strings.TrimSpace(lines[start])
	open, close := "", ""
	switch {
	case strings.HasPrefix(trimmed, "\\["):
		open, close = "\\[", "\\]"
	case strings.HasPrefix(trimmed, "$$"):
		open, close = "$$", "$$"
	default:
		return nil, start, false
	}
	remainder := strings.TrimSpace(strings.TrimPrefix(trimmed, open))
	if strings.HasSuffix(remainder, close) && remainder != close {
		latex := strings.TrimSpace(strings.TrimSuffix(remainder, close))
		return map[string]any{"type": "blockMath", "attrs": map[string]any{"latex": latex}}, start + 1, true
	}
	body := make([]string, 0, 2)
	if remainder != "" {
		body = append(body, remainder)
	}
	index := start + 1
	for index < len(lines) {
		current := strings.TrimSpace(lines[index])
		if strings.HasSuffix(current, close) {
			value := strings.TrimSpace(strings.TrimSuffix(current, close))
			if value != "" {
				body = append(body, value)
			}
			index++
			break
		}
		body = append(body, current)
		index++
	}
	return map[string]any{"type": "blockMath", "attrs": map[string]any{"latex": strings.Join(body, "\n")}}, index, true
}

func startsWorkbookBlock(lines []string, index int) bool {
	trimmed := strings.TrimSpace(lines[index])
	if trimmed == "" || strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "\\[") || strings.HasPrefix(trimmed, "$$") || strings.HasPrefix(trimmed, "## ") || strings.HasPrefix(trimmed, "### ") || isWorkbookBullet(trimmed) || isWorkbookOrdered(trimmed) || strings.HasPrefix(trimmed, "> ") || isWorkbookTableLine(trimmed) {
		return true
	}
	_, ok := standaloneWorkbookImage(trimmed)
	return ok
}

func workbookImageNode(key string, alt, captions map[string]string) map[string]any {
	attrs := map[string]any{"assetId": "workbook:" + key, "workbookKey": key, "alt": alt[key]}
	if captions[key] != "" {
		attrs["caption"] = captions[key]
	}
	return map[string]any{"type": "image", "attrs": attrs}
}

func isWorkbookBullet(value string) bool {
	return strings.HasPrefix(value, "- ") || strings.HasPrefix(value, "* ")
}

func isWorkbookOrdered(value string) bool {
	prefix, rest, ok := strings.Cut(value, ". ")
	if !ok || len(prefix) == 0 || len(prefix) > 3 || strings.TrimSpace(rest) == "" {
		return false
	}
	for _, character := range prefix {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func isWorkbookTableLine(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), "|") && strings.Count(value, "|") >= 2
}

func isWorkbookTableSeparator(value string) bool {
	cells := splitWorkbookTableRow(value)
	if len(cells) == 0 {
		return false
	}
	for _, cell := range cells {
		cell = strings.TrimSpace(strings.Trim(cell, ":"))
		if len(cell) < 3 || strings.Trim(cell, "-") != "" {
			return false
		}
	}
	return true
}

func splitWorkbookTableRow(value string) []string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "|")
	value = strings.TrimSuffix(value, "|")
	parts := strings.Split(value, "|")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	return parts
}

func workbookTableNode(rows [][]string, alt, captions map[string]string) map[string]any {
	content := make([]any, 0, len(rows))
	for rowIndex, row := range rows {
		cells := make([]any, 0, len(row))
		cellType := "tableCell"
		if rowIndex == 0 {
			cellType = "tableHeader"
		}
		for _, cell := range row {
			cells = append(cells, map[string]any{"type": cellType, "content": []any{map[string]any{"type": "paragraph", "content": workbookInlineNodes(cell, alt, captions)}}})
		}
		content = append(content, map[string]any{"type": "tableRow", "content": cells})
	}
	return map[string]any{"type": "table", "content": content}
}

func workbookInlineNodes(value string, alt, captions map[string]string) []any {
	nodes := make([]any, 0)
	for len(value) > 0 {
		start, token := nextWorkbookInlineToken(value)
		if start > 0 {
			nodes = append(nodes, map[string]any{"type": "text", "text": value[:start]})
			value = value[start:]
			continue
		}
		switch token.kind {
		case "image":
			key := token.value
			attrs := map[string]any{"assetId": "workbook:" + key, "workbookKey": key, "alt": alt[key]}
			if captions[key] != "" {
				attrs["caption"] = captions[key]
			}
			nodes = append(nodes, map[string]any{"type": "image", "attrs": attrs})
		case "inlineMath":
			nodes = append(nodes, map[string]any{"type": "inlineMath", "attrs": map[string]any{"latex": token.value}})
		case "blockMath":
			nodes = append(nodes, map[string]any{"type": "blockMath", "attrs": map[string]any{"latex": token.value}})
		case "bold", "italic", "code":
			nodes = append(nodes, map[string]any{"type": "text", "text": token.value, "marks": []any{map[string]any{"type": token.kind}}})
		default:
			nodes = append(nodes, map[string]any{"type": "text", "text": token.value})
		}
		value = value[token.end:]
	}
	return nodes
}

type workbookInlineToken struct {
	kind, value string
	end         int
}

func nextWorkbookInlineToken(value string) (int, workbookInlineToken) {
	patterns := []struct {
		prefix, suffix, kind string
	}{
		{"![", "]", "image"},
		{"\\(", "\\)", "inlineMath"},
		{"**", "**", "bold"},
		{"*", "*", "italic"},
		{"`", "`", "code"},
	}
	best := -1
	var selected struct{ prefix, suffix, kind string }
	for _, pattern := range patterns {
		if index := strings.Index(value, pattern.prefix); index >= 0 && (best < 0 || index < best) {
			best = index
			selected = pattern
		}
	}
	if best < 0 {
		return 0, workbookInlineToken{kind: "text", value: value, end: len(value)}
	}
	if best > 0 {
		return best, workbookInlineToken{}
	}
	start := len(selected.prefix)
	close := strings.Index(value[start:], selected.suffix)
	if close < 0 {
		return 0, workbookInlineToken{kind: "text", value: value, end: len(value)}
	}
	close += start
	return 0, workbookInlineToken{kind: selected.kind, value: value[start:close], end: close + len(selected.suffix)}
}
