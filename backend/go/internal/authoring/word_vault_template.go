package authoring

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
)

// The vocabulary template is the only place a teacher or an AI tool learns the
// import contract before an upload. It therefore carries the same two reference
// sheets as the SAT exam workbook: a Guide a human can read, and an AI
// Instructions sheet whose B4 cell is a prompt that restates every rule the
// parser enforces. Only Vocabulary is ever imported; both reference sheets are
// ignored by parseWordVault.
const (
	wordVaultGuideSheet        = "Guide"
	wordVaultInstructionsSheet = "AI Instructions"
	wordVaultTemplateVersion   = "1"
)

var (
	wordVaultTemplateWidths  = []float64{38, 18, 26, 28, 50, 50}
	wordVaultReferenceWidths = []float64{30, 62, 74}
)

type wordVaultReferenceStyles struct {
	body  int
	label int
}

// WordVaultTemplate builds the downloadable .xlsx: a header-only Vocabulary
// sheet that is itself a valid import, plus the human guide and the AI contract.
func WordVaultTemplate() ([]byte, error) {
	book := excelize.NewFile()
	defer book.Close()
	if err := book.SetSheetName("Sheet1", wordVaultSheet); err != nil {
		return nil, err
	}
	for _, name := range []string{wordVaultGuideSheet, wordVaultInstructionsSheet} {
		if _, err := book.NewSheet(name); err != nil {
			return nil, err
		}
	}
	headers := make([]any, len(wordVaultHeaders))
	for i, header := range wordVaultHeaders {
		headers[i] = header
	}
	if err := book.SetSheetRow(wordVaultSheet, "A1", &headers); err != nil {
		return nil, err
	}
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "#14375C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#E6F1FC"}},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
	})
	if err != nil {
		return nil, err
	}
	if err := book.SetCellStyle(wordVaultSheet, "A1", "F1", headerStyle); err != nil {
		return nil, err
	}
	if err := book.SetPanes(wordVaultSheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return nil, err
	}
	for i, width := range wordVaultTemplateWidths {
		column, _ := excelize.ColumnNumberToName(i + 1)
		if err := book.SetColWidth(wordVaultSheet, column, column, width); err != nil {
			return nil, err
		}
	}
	styles, err := newWordVaultReferenceStyles(book)
	if err != nil {
		return nil, err
	}
	for _, sheet := range []struct {
		name string
		rows [][]string
	}{
		{wordVaultGuideSheet, wordVaultGuideRows()},
		{wordVaultInstructionsSheet, wordVaultInstructionRows()},
	} {
		if err := writeWordVaultReferenceSheet(book, sheet.name, sheet.rows, headerStyle, styles); err != nil {
			return nil, err
		}
	}
	out, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func newWordVaultReferenceStyles(book *excelize.File) (wordVaultReferenceStyles, error) {
	body, err := book.NewStyle(&excelize.Style{
		Alignment: &excelize.Alignment{Vertical: "top", WrapText: true},
	})
	if err != nil {
		return wordVaultReferenceStyles{}, err
	}
	label, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "#14375C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#F3F7FC"}},
		Alignment: &excelize.Alignment{Vertical: "top", WrapText: true},
	})
	if err != nil {
		return wordVaultReferenceStyles{}, err
	}
	return wordVaultReferenceStyles{body: body, label: label}, nil
}

func writeWordVaultReferenceSheet(book *excelize.File, name string, rows [][]string, headerStyle int, styles wordVaultReferenceStyles) error {
	for i, row := range rows {
		values := make([]any, len(row))
		for j, value := range row {
			values[j] = value
		}
		if err := book.SetSheetRow(name, "A"+strconv.Itoa(i+1), &values); err != nil {
			return err
		}
	}
	for i, width := range wordVaultReferenceWidths {
		column, _ := excelize.ColumnNumberToName(i + 1)
		if err := book.SetColWidth(name, column, column, width); err != nil {
			return err
		}
	}
	lastRow := strconv.Itoa(len(rows))
	lastColumn, _ := excelize.ColumnNumberToName(len(wordVaultReferenceWidths))
	if err := book.SetCellStyle(name, "A1", lastColumn+"1", headerStyle); err != nil {
		return err
	}
	if len(rows) > 1 {
		if err := book.SetCellStyle(name, "A2", "A"+lastRow, styles.label); err != nil {
			return err
		}
		if err := book.SetCellStyle(name, "B2", lastColumn+lastRow, styles.body); err != nil {
			return err
		}
	}
	for i, row := range rows {
		if err := book.SetRowHeight(name, i+1, wordVaultReferenceRowHeight(row)); err != nil {
			return err
		}
	}
	return book.SetPanes(name, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
}

// wordVaultReferenceRowHeight estimates wrapped lines so a rule or the long AI
// prompt is readable without manually resizing every row. Excel caps a row at
// 409.5 points, so the B4 prompt is intentionally capped and labelled as a
// copy-from-the-formula-bar cell.
func wordVaultReferenceRowHeight(row []string) float64 {
	lines := 1
	for i, value := range row {
		if value == "" {
			continue
		}
		width := int(wordVaultReferenceWidths[i%len(wordVaultReferenceWidths)]) - 2
		if width < 8 {
			width = 8
		}
		cellLines := 0
		for _, part := range strings.Split(value, "\n") {
			cellLines += max(1, (utf8.RuneCountInString(part)+width-1)/width)
		}
		lines = max(lines, cellLines)
	}
	return min(float64(lines*14+6), 409)
}

func wordVaultGuideRows() [][]string {
	rows := [][]string{
		{"THE WORD VAULT · VOCABULARY WORKBOOK GUIDE", "Human + AI reference · vocabulary template " + wordVaultTemplateVersion, "Read this sheet and AI Instructions before filling Vocabulary."},
		{"HOW TO USE", "1. Open the editable draft you want to change, then download this workbook from The Word Vault.", "The vault belongs to a draft. Published versions keep their own copy."},
		{"HOW TO USE", "2. Fill one row per word in Vocabulary. Keep row 1 and its six headers unchanged.", "Guide and AI Instructions are references. Only Vocabulary is imported."},
		{"HOW TO USE", "3. Working with an AI tool? Read AI Instructions first and copy its prompt.", "The prompt restates every rule that can block an import."},
		{"HOW TO USE", "4. Upload the completed .xlsx and review every issue plus the per-module impact.", "One bad cell blocks the whole import; nothing is saved until the workbook is valid."},
		{"HOW TO USE", "5. Confirm to replace the entire draft vault.", "The preview lists words before → after per module, so omissions are visible before they change."},
		{"WORKBOOK CONTRACT", "Vocabulary is the only data sheet. Guide and AI Instructions are references.", "Do not rename sheets or move the Vocabulary headers."},
		{"WORKBOOK CONTRACT", "A confirmed upload replaces the ENTIRE draft Word Vault.", "Modules omitted from the file lose their draft words. A file with only the header row clears an existing vault."},
		{"WORKBOOK CONTRACT", "Headers are matched in order: Module, Question number, Vocabulary word, Thai meaning, English definition, Example sentence.", "Renaming, deleting, or reordering a header blocks the import. Case is ignored."},
		{"WORKBOOK CONTRACT", "Published versions and existing attempts keep the vocabulary of the version they use.", "Publishing pins the current draft vault to that version."},
		{"WORKBOOK CONTRACT", "A replacement has no undo.", "Review the preview: it shows exactly what each module gains or loses before you confirm."},
		{"WORKBOOK CONTRACT", "Nothing is saved when any row has an issue.", "Fix every reported cell and upload again."},
		{"COLUMN / FIELD", "EXACT MEANING", "REQUIRED / GUIDANCE"},
		{"Module", "One of the three Reading & Writing modules in MODULE MAP, by exact label or module key.", "Math modules are not part of the Word Vault. Case and repeated spaces are ignored; punctuation is not."},
		{"Question number", "1-based position of the question in that module, in the draft's order.", "Must exist in the current draft. The number is resolved at upload and pinned to that question."},
		{"Vocabulary word", "The English word or phrase as it appears in the question.", "1–80 characters. Plain text, one line, no formulas."},
		{"Thai meaning", "The Thai meaning students read in the PDF appendix.", "1–160 characters in Thai script, one line. Not a transliteration or an English gloss."},
		{"English definition", "A short learner-facing definition.", "1–320 characters, one line."},
		{"Example sentence", "One sentence that shows the word in use.", "1–320 characters, one line. Required for every entry."},
		{"All six columns", "Every row needs all six values.", "A blank word, Thai meaning, definition or example is reported and blocks the import."},
		{"MODULE", "The label or key must describe a module present in the current draft.", "A missing module is reported by row and column."},
		{"CUSTOM EXAMS", "Use only the Reading & Writing questions you want to attach words to.", "Module 1 only, either Module 2 branch on its own, and flexible question counts are supported. You can skip any question or module."},
		{"QUESTION NUMBER", "Question 1 is the first question in that module as currently authored.", "It matches the Order column of the question workbook in the same draft."},
		{"QUESTION NUMBER", "Enter a positive whole number: 7, not Q7, 7.0, or a cell reference.", "The number is the position, not the question ID."},
		{"QUESTION NUMBER", "Several words may point at the same question; one row per word.", "Identical rows are rejected as duplicates; different words on one question are allowed."},
		{"QUESTION NUMBER", "Reordering a question changes its printed number, not its words.", "The entry is pinned to the question identity; the appendix prints the current number."},
		{"QUESTION NUMBER", "Replacing a question can break its saved reference.", "Publishing reports sat.word_vault.stale and links back to The Word Vault; import a corrected file."},
		{"ADAPTIVE BRANCHES", "Module 2 — Lower and Module 2 — Higher are alternative branches.", "Write words for the branch whose questions actually carry them."},
		{"ADAPTIVE BRANCHES", "The student PDF appendix prints every entry in the published version.", "That includes entries from both Module 2 branches, whichever branch the student took."},
		{"ADAPTIVE BRANCHES", "Do not duplicate one entry into both branches unless both questions genuinely use the word.", "A duplication prints twice in the appendix."},
		{"LIMITS", "At most 200 entries in one workbook.", "More than 200 non-empty rows are reported and block the import."},
		{"LIMITS", "Workbook ≤ 2 MB; Vocabulary within the first 1,000 rows; six columns only.", "Extra non-empty cells beyond column F and rows past 1,000 are reported."},
		{"LIMITS", "Completely empty rows are ignored; a row with any value is checked.", "One value is enough to make a row part of the import."},
		{"LIMITS", "Values only: no formulas, macros, external links, or embedded media.", "Paste values. The importer rejects a workbook that contains these."},
		{"LIMITS", "Plain .xlsx only.", "Encrypted files, .xls, .csv, and other non-.xlsx formats are rejected."},
		{"THAI TEXT", "Type Thai in Thai script, on one line, in the Vocabulary sheet.", "The score-report PDF bundles Noto Sans Thai, so Thai renders without extra fonts."},
		{"THAI TEXT", "Do not use control characters or line breaks inside a cell.", "Each cell is one line of plain text."},
		{"CLEARING", "Uploading a file with only the header row clears an existing draft vault.", "The preview says “Removes every word from this draft”; the button says Remove all draft words."},
		{"WORKED EXAMPLE", "Reference only — do not paste this block into Vocabulary.", "The Vocabulary sheet already has its headers; start data at row 2."},
		{"EXAMPLE · ROW", "Reading & Writing · Module 1 | 7 | adapt | ปรับตัว | To adjust to a new situation or environment. | The team adapted quickly to the new schedule.", "The six values in column order, exactly as one Vocabulary row would hold them."},
		{"MODULE MAP", "EXACT LABEL", "MODULE KEY / MAXIMUM QUESTIONS"},
	}
	for _, spec := range satWorkbookModules {
		if spec.sectionKey != SectionReadingWriting {
			continue
		}
		rows = append(rows, []string{"MODULE MAP", spec.label, spec.key + " / " + strconv.Itoa(spec.count)})
	}
	rows = append(rows,
		[]string{"MODULE MAP", "Math modules", "Not supported: the Word Vault attaches words only to Reading & Writing questions."},
		[]string{"QA CHECKLIST", "Every Module cell uses a label or key from MODULE MAP.", "Math labels are invalid."},
		[]string{"QA CHECKLIST", "Every Question number exists in that module of the current draft.", "Check the printed order, not the Excel row number."},
		[]string{"QA CHECKLIST", "Every row has word, Thai meaning, definition, and example.", "All four are required; each must fit its character limit."},
		[]string{"QA CHECKLIST", "Thai text is Thai script on one line.", "No transliteration, no control characters."},
		[]string{"QA CHECKLIST", "No formula, no duplicate row, no extra column.", "A single issue blocks the import."},
		[]string{"QA CHECKLIST", "The preview impact matches the intended modules.", "Omitted modules lose their draft words."},
		[]string{"QA CHECKLIST", "Uncertain entries are reported, not guessed.", "Do not mark a file import-ready while a Thai meaning is unknown."},
		[]string{"PUBLISHING", "The published version prints every entry it holds.", "Empty vault adds no appendix pages. The answer-key setting is independent of the appendix."},
	)
	return rows
}

func wordVaultInstructionRows() [][]string {
	return [][]string{
		{"THE WORD VAULT · AI INSTRUCTIONS", "Vocabulary template " + wordVaultTemplateVersion + " · matches the SAT Word Vault importer", "Read Guide before writing."},
		{"PURPOSE", "This workbook is the output schema for attaching an English word, its Thai meaning, an English definition, and an example sentence to SAT Reading & Writing questions.", "Only the Vocabulary sheet is imported."},
		{"START HERE", "Copy the prompt in B4 into your AI conversation, attach this workbook, then attach the source material.", "Select B4, expand the formula bar, and copy the whole cell."},
		{"COPYABLE SYSTEM PROMPT", wordVaultAIPrompt, "B4 holds the full prompt; the row shows only a preview."},
		{"COPYABLE USER REQUEST", wordVaultAIRequest, "Attach the exam, word list, or answer key."},
		{"RULE ID", "CATEGORY", "REQUIREMENT / CHECK"},
		{"R01", "Source fidelity", "Only supplied material may justify a word, Thai meaning, definition, or example. Never invent one."},
		{"R02", "Workbook integrity", "Keep the three sheet names and the six Vocabulary headers in row 1. Write data only on Vocabulary."},
		{"R03", "Module map", "Use one of the three Reading & Writing labels or module keys from Guide. Math modules are invalid."},
		{"R04", "Question resolution", "Use the question's existing 1-based position in its module. Custom and flexible exams can use any subset of their questions."},
		{"R05", "Field limits", "Word 1–80, Thai 1–160, definition 1–320, example 1–320 characters. All four are required on every row."},
		{"R06", "Thai text", "Thai script, one line, no control characters. Do not substitute a transliteration or an English gloss."},
		{"R07", "Duplicates", "Identical rows are rejected. The same word attached to different questions is allowed."},
		{"R08", "Replacement scope", "The upload replaces the entire draft vault, including modules omitted from the file. A header-only file clears it."},
		{"R09", "Cell type", "Paste values, never formulas. No macros, external links, or embedded media."},
		{"R10", "Limits", "At most 200 entries, a 2 MB workbook, and 1,000 sheet rows."},
		{"R11", "Blockers", "If required information is missing, return the workbook unchanged and state NOT IMPORT READY with the exact blockers."},
		{"R12", "Human review", "The preview checks structure and question references, not whether Thai meanings are correct. A human reviews before publishing."},
		{"OUTPUT CHECKLIST", "CHECK", "EVIDENCE TO RETURN"},
		{"QA · 01", "Rows written", "Count of entries per module; state if any module was left out intentionally."},
		{"QA · 02", "Question references", "The module and question number for each entry, checked against the supplied exam."},
		{"QA · 03", "Field limits", "Every row within 80/160/320/320 characters, one line per cell."},
		{"QA · 04", "Thai review", "List every Thai meaning you were not fully confident about, or state that none needed review."},
		{"QA · 05", "Duplicates", "State how many identical rows were removed."},
		{"QA · 06", "No formulas", "Confirm Vocabulary contains pasted values only."},
		{"QA · 07", "Preview expectation", "Describe the expected before → after count for each module."},
		{"BLOCKERS", "Stop and report instead of guessing when:", "The module is Math; the question number cannot be confirmed; a Thai meaning or example is missing; the source contradicts itself; the workbook would exceed a limit."},
		{"RETURN FORMAT", "Return the completed .xlsx plus the QA report in the chat.", "Never write the QA report, notes, or colors into Vocabulary as data."},
	}
}

// wordVaultAIPrompt is the copyable contract in AI Instructions!B4. It is
// intentionally explicit about the schema, because the importer is
// all-or-nothing: one invalid cell blocks the entire vault replacement.
const wordVaultAIPrompt = `ROLE
You are a meticulous English–Thai SAT vocabulary editor. You fill the Vocabulary sheet of the attached Word Vault workbook from the material the user supplies. You never invent a word, a Thai meaning, an English definition, or an example sentence.

INPUTS
1. This workbook. Read Guide and AI Instructions in full before writing.
2. The user's source material: a vocabulary list, exam questions or passages, or an answer key.

OUTPUT CONTRACT
1. Write ONLY on the Vocabulary sheet, starting at row 2. Keep row 1 and the six headers exactly: Module | Question number | Vocabulary word | Thai meaning | English definition | Example sentence.
2. One row = one vocabulary entry attached to one question. Do not add columns, merged cells, notes, or data written as color.
3. Module must be one of the three Reading & Writing labels (or module keys) in Guide > MODULE MAP, copied exactly. Math modules are invalid.
4. Question number is the 1-based position of the question in that module as currently authored. For custom or flexible exams, use only the questions and modules present in the supplied draft. Include only the questions that need vocabulary. Never guess; if you cannot confirm a reference, omit the row and report it.
5. Vocabulary word: the English word or phrase, 1–80 characters. Thai meaning: 1–160 characters in Thai script. English definition: 1–320 characters. Example sentence: 1–320 characters. All four are required. One line per cell, plain text.
6. Paste values only. No formulas, macros, external links, or embedded media.
7. At most 200 entries. Empty rows are ignored. Keep the sheet within the first 1,000 rows.
8. If the user supplies exact Thai meanings, definitions, or examples, transcribe them faithfully. If the user asks you to derive them from the exam, base every entry only on the supplied question text. Mark any Thai wording you are not confident about as REVIEW NEEDED in the chat report; do not silently guess.
9. The upload replaces the ENTIRE draft Word Vault, including modules not in the file. A header-only file clears an existing vault. Include only rows the user intends.
10. A single invalid cell blocks the whole import. Fix your own errors before returning the workbook.
11. Return the completed .xlsx plus a short QA report in the chat: rows written per module, question numbers used, duplicates removed, and every item you could not verify. Never write the QA report into Vocabulary.
12. If required information is missing, stop and state NOT IMPORT READY with the exact blockers. Do not fabricate.`

const wordVaultAIRequest = `Read the attached Word Vault workbook and follow AI Instructions!B4 and the Guide. Fill Vocabulary from the attached source material. Do not invent entries. Return the completed workbook and a QA report, or state NOT IMPORT READY with the exact blockers.`
