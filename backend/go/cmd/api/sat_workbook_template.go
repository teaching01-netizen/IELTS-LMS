package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"html"
	"io"
	"strconv"
	"strings"
)

var satWorkbookHeaders = []string{
	"Module", "Order", "Prompt", "Stimulus", "Response Type", "A", "B", "C", "D", "Correct",
	"Accepted Responses", "Domain", "Skill", "Difficulty", "Pretest", "Rationale", "Tags",
}

type satWorkbookModule struct {
	label string
	count int
}

var satWorkbookModules = []satWorkbookModule{
	{label: "Reading & Writing · Module 1", count: 27},
	{label: "Reading & Writing · Module 2 — Lower", count: 27},
	{label: "Reading & Writing · Module 2 — Higher", count: 27},
	{label: "Math · Module 1", count: 22},
	{label: "Math · Module 2 — Lower", count: 22},
	{label: "Math · Module 2 — Higher", count: 22},
}

// buildSATWorkbookTemplate creates the same stable workbook contract as the
// Rust endpoint: Questions, Guide, Assets, AI Instructions, and hidden _SAT.
// Inline strings keep this implementation dependency-free; Excel and the
// existing workbook importer both read them as ordinary cell values.
func buildSATWorkbookTemplate() ([]byte, error) {
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	add := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = io.WriteString(w, content)
		return err
	}

	if err := add("[Content_Types].xml", satWorkbookContentTypes()); err != nil {
		return nil, err
	}
	if err := add("_rels/.rels", satWorkbookRootRelationships()); err != nil {
		return nil, err
	}
	if err := add("xl/workbook.xml", satWorkbookWorkbook()); err != nil {
		return nil, err
	}
	if err := add("xl/_rels/workbook.xml.rels", satWorkbookWorkbookRelationships()); err != nil {
		return nil, err
	}
	if err := add("xl/worksheets/sheet1.xml", satWorkbookQuestionsSheet()); err != nil {
		return nil, err
	}
	if err := add("xl/worksheets/sheet2.xml", satWorkbookGuideSheet()); err != nil {
		return nil, err
	}
	if err := add("xl/worksheets/sheet3.xml", satWorkbookAssetsSheet()); err != nil {
		return nil, err
	}
	if err := add("xl/worksheets/sheet4.xml", satWorkbookInstructionsSheet()); err != nil {
		return nil, err
	}
	if err := add("xl/worksheets/sheet5.xml", satWorkbookManifestSheet()); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func satWorkbookContentTypes() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
}

func satWorkbookRootRelationships() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

func satWorkbookWorkbook() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets>
  <sheet name="Questions" sheetId="1" r:id="rId1"/>
  <sheet name="Guide" sheetId="2" r:id="rId2"/>
  <sheet name="Assets" sheetId="3" r:id="rId3"/>
  <sheet name="AI Instructions" sheetId="4" r:id="rId4"/>
  <sheet name="_SAT" sheetId="5" state="hidden" r:id="rId5"/>
 </sheets>
</workbook>`
}

func satWorkbookWorkbookRelationships() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
 <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
 <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
</Relationships>`
}

func satWorkbookQuestionsSheet() string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>`)
	row := 1
	b.WriteString(satWorkbookRow(row, satWorkbookHeaders...))
	row++
	for _, module := range satWorkbookModules {
		for order := 1; order <= module.count; order++ {
			b.WriteString(satWorkbookRowWithNumbers(row, map[int]string{1: module.label, 2: strconv.Itoa(order), 5: "Multiple Choice", 14: "Medium", 15: "No"}, 17))
			row++
		}
	}
	b.WriteString(`</sheetData><autoFilter ref="A1:Q148"/><dataValidations count="7">`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="A2:A148"><formula1>"Reading &amp; Writing · Module 1,Reading &amp; Writing · Module 2 — Lower,Reading &amp; Writing · Module 2 — Higher,Math · Module 1,Math · Module 2 — Lower,Math · Module 2 — Higher"</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="E2:E148"><formula1>"Multiple Choice,Student Response"</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="J2:J148"><formula1>"A,B,C,D"</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="L2:L148"><formula1>"Information and Ideas,Craft and Structure,Expression of Ideas,Standard English Conventions,Algebra,Advanced Math,Problem-Solving and Data Analysis,Geometry and Trigonometry"</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="M2:M148"><formula1>_SAT!$D$1:$D$31</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="N2:N148"><formula1>"Easy,Medium,Hard"</formula1></dataValidation>`)
	b.WriteString(`<dataValidation type="list" allowBlank="1" sqref="O2:O148"><formula1>"No,Yes"</formula1></dataValidation>`)
	b.WriteString(`</dataValidations></worksheet>`)
	return b.String()
}

func satWorkbookGuideSheet() string {
	rows := [][]string{
		{"SAT Excel authoring", "Fill the Questions sheet, keep the headers unchanged, then preview the workbook before importing."},
		{"Prompt", "Required student-visible question. Stimulus is optional supporting material; Rationale is internal."},
		{"Response type", "Reading & Writing uses Multiple Choice. Math may use Multiple Choice or Student Response."},
		{"Rich content", `Use **bold**, *italic*, \(inline math\), \[display math\], Markdown tables, and ![asset_key] image references.`},
		{"Assets", "Put each visual on the Assets sheet with a unique Asset Key, Alt Text, and optional Caption."},
		{"Settings", "Timing, adaptive routing, calculator policy, publishing, and release are configured in the SAT Release page."},
	}
	return satWorkbookSimpleSheet(rows)
}

func satWorkbookAssetsSheet() string {
	return satWorkbookSimpleSheet([][]string{{"Asset Key", "Alt Text", "Caption", "Image"}})
}

func satWorkbookInstructionsSheet() string {
	return satWorkbookSimpleSheet([][]string{
		{"SAT AI authoring instructions", "Create original Digital SAT practice content in this workbook. Preserve sheet names and headers."},
		{"Contract", "Fill all required Questions fields, use valid taxonomy values, and keep every image reference matched to one Assets row."},
		{"Quality", "Verify calculations, answer keys, distractors, taxonomy, difficulty, rich-content delimiters, and module counts before upload."},
	})
}

func satWorkbookManifestSheet() string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	b.WriteString(satWorkbookRow(1, "templateVersion", "2"))
	b.WriteString(satWorkbookRow(2, "providerKey", "sat"))
	skills := []string{
		"Central Ideas and Details", "Command of Evidence — Textual", "Command of Evidence — Quantitative", "Inferences",
		"Words in Context", "Text Structure and Purpose", "Cross-Text Connections", "Rhetorical Synthesis", "Transitions",
		"Boundaries", "Form, Structure, and Sense", "Linear Equations in One Variable", "Linear Functions",
		"Linear Equations in Two Variables", "Systems of Two Linear Equations", "Linear Inequalities", "Equivalent Expressions",
		"Nonlinear Equations in One Variable", "Systems of Equations in Two Variables", "Nonlinear Functions",
		"Ratios, Rates, Proportional Relationships, and Units", "Percentages", "One-Variable Data", "Two-Variable Data",
		"Probability and Conditional Probability", "Inference from Sample Statistics and Margin of Error", "Evaluating Statistical Claims",
		"Area and Volume", "Lines, Angles, and Triangles", "Right Triangles and Trigonometry", "Circles",
	}
	for i, skill := range skills {
		b.WriteString(satWorkbookRow(i+1, "", "", "", skill))
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func satWorkbookSimpleSheet(rows [][]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for i, row := range rows {
		b.WriteString(satWorkbookRow(i+1, row...))
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func satWorkbookRow(row int, values ...string) string {
	valuesByColumn := make(map[int]string, len(values))
	for i, value := range values {
		valuesByColumn[i+1] = value
	}
	return satWorkbookRowWithNumbers(row, valuesByColumn, len(values))
}

func satWorkbookRowWithNumbers(row int, values map[int]string, columnCount int) string {
	var b strings.Builder
	fmt.Fprintf(&b, `<row r="%d">`, row)
	for column := 1; column <= columnCount; column++ {
		value, ok := values[column]
		if !ok || value == "" {
			continue
		}
		ref := fmt.Sprintf("%s%d", satWorkbookColumnName(column), row)
		if column == 2 && row > 1 {
			fmt.Fprintf(&b, `<c r="%s" t="n"><v>%s</v></c>`, ref, html.EscapeString(value))
			continue
		}
		fmt.Fprintf(&b, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, html.EscapeString(value))
	}
	b.WriteString(`</row>`)
	return b.String()
}

func satWorkbookColumnName(column int) string {
	var out []byte
	for column > 0 {
		column--
		out = append([]byte{byte('A' + column%26)}, out...)
		column /= 26
	}
	return string(out)
}
