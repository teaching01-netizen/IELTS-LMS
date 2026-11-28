package authoring

import (
	"bytes"
	"errors"
	"strconv"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satpublish"
	"example.com/ielts-proctoring/internal/satwordvault"
	"github.com/xuri/excelize/v2"
)

func wordVaultTestBook(t *testing.T, rows ...[]any) []byte {
	t.Helper()
	template, err := WordVaultTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(template))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	for i, row := range rows {
		if err := book.SetSheetRow(wordVaultSheet, "A"+strconv.Itoa(i+2), &row); err != nil {
			t.Fatal(err)
		}
	}
	out, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func testWordRow(module string, question int, word string) []any {
	return []any{module, question, word, "ปรับตัว", "To adjust to new conditions.", "We adapt to a new calendar."}
}

func TestWordVaultWorkbook(t *testing.T) {
	lower := testWordRow("rw-m2-lower", 1, "adapt")
	higher := testWordRow("Reading & Writing · Module 2 — Higher", 1, "adjust")
	got, issues, err := parseWordVault(wordVaultTestBook(t, lower, nil, higher, lower, testWordRow("math-m1", 1, "invalid")))
	if err != nil || len(got) != 2 || len(issues) != 2 {
		t.Fatalf("rows=%+v issues=%+v err=%v", got, issues, err)
	}
	if got[0].entry.Thai != "ปรับตัว" || got[1].entry.ModuleKey != "rw-m2-higher" ||
		issues[0].Row != 5 || issues[0].Column != "C" || issues[1].Row != 6 || issues[1].Column != "A" {
		t.Fatalf("unexpected row or diagnostic: rows=%+v issues=%+v", got, issues)
	}
	if rows, issues, err := parseWordVault(wordVaultTestBook(t)); err != nil || len(rows) != 0 || len(issues) != 0 {
		t.Fatalf("header-only template should validate: rows=%+v issues=%+v err=%v", rows, issues, err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(wordVaultTestBook(t, lower)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if err := book.SetCellFormula(wordVaultSheet, "C2", "1+1"); err != nil {
		t.Fatal(err)
	}
	data, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	rows, issues, err := parseWordVault(data.Bytes())
	if err != nil || len(rows) != 0 || len(issues) == 0 || issues[0].Column != "C" {
		t.Fatalf("formula must block import: rows=%+v issues=%+v err=%v", rows, issues, err)
	}
}

func TestWordVaultAcceptsPartialCustomDrafts(t *testing.T) {
	for _, key := range []string{"rw-m1", "rw-m2-lower", "rw-m2-higher"} {
		t.Run(key, func(t *testing.T) {
			modules := []satwordvault.Module{{Key: key, Questions: []satwordvault.Question{
				{ID: "first", Number: 1}, {ID: "second", Number: 2},
			}}}
			data := wordVaultTestBook(t, testWordRow(key, 2, "adapt"), testWordRow(key, 3, "adjust"))
			rows, parseIssues, err := parseWordVault(data)
			if err != nil || len(parseIssues) != 0 {
				t.Fatalf("parse custom exam rows: %v %v", parseIssues, err)
			}
			entries, issues := bindWordVaultRows(rows, modules)
			if len(entries) != 1 || entries[0].ModuleKey != key || entries[0].QuestionID != "second" {
				t.Fatalf("expected a word tied to only the second question: %+v", entries)
			}
			if len(issues) != 1 || issues[0].Row != 3 || issues[0].Column != "B" ||
				!strings.Contains(issues[0].Message, "1–2") {
				t.Fatalf("expected just an out-of-range question diagnostic: %+v", issues)
			}
		})
	}
}

func TestWordVaultVersionLifecycleMySQL(t *testing.T) {
	f := seedReadPerfFixture(t)
	ctx := t.Context()
	check := func(data []byte) WordVaultPreview {
		t.Helper()
		preview, err := f.Service.PreviewWordVault(ctx, f.ExamID, data)
		if err != nil || len(preview.Issues) != 0 {
			t.Fatalf("check vocabulary: %+v %v", preview.Issues, err)
		}
		return preview
	}
	request := func(p WordVaultPreview, key string) WordVaultCommit {
		return WordVaultCommit{DraftID: p.DraftID, Revision: p.Revision, Digest: p.Digest, OperationKey: key, Confirmed: true}
	}
	commit := func(data []byte, r WordVaultCommit) WordVaultReceipt {
		t.Helper()
		receipt, err := f.Service.CommitWordVault(ctx, f.ExamID, "word-vault-test", data, r)
		if err != nil {
			t.Fatalf("commit vocabulary: %v", err)
		}
		return receipt
	}
	firstBook := wordVaultTestBook(t, testWordRow("rw-m2-lower", 1, "lower"), testWordRow("rw-m2-higher", 1, "higher"))
	initial := check(firstBook)
	if initial.Before != 0 || len(initial.Entries) != 2 {
		t.Fatalf("initial preview: %+v", initial)
	}
	first := request(initial, "initial-vault")
	saved := commit(firstBook, first)
	if saved.Count != 2 || commit(firstBook, first) != saved {
		t.Fatalf("failed initial commit or replay: %+v", saved)
	}
	if _, err := f.Service.CommitWordVault(ctx, f.ExamID, "word-vault-test", firstBook, request(initial, "stale-vault")); err == nil {
		t.Fatal("a stale revision committed")
	}

	higher := wordVaultTestBook(t, testWordRow("rw-m2-higher", 2, "replace"))
	incoming := check(higher)
	if incoming.Before != 2 || len(incoming.Impact) != 2 || incoming.Impact[0].After != 0 {
		t.Fatalf("whole-vault removal not disclosed: %+v", incoming)
	}
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	for _, key := range []string{"replacement-1", "replacement-2"} {
		go func() {
			<-start
			_, err := f.Service.CommitWordVault(ctx, f.ExamID, "word-vault-test", higher, request(incoming, key))
			outcomes <- err
		}()
	}
	close(start)
	wins, conflicts := 0, 0
	for range 2 {
		err := <-outcomes
		var conflict *apperrors.Error
		switch {
		case err == nil:
			wins++
		case errors.As(err, &conflict) && conflict.Code == apperrors.CodeConflict:
			conflicts++
		default:
			t.Fatalf("unexpected result of competing commits: %v", err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("competing commits: got %d wins and %d conflicts", wins, conflicts)
	}
	// Restore both branches before sealing the published fixture.
	lastRequest := request(check(firstBook), "sealed-vault")
	last := commit(firstBook, lastRequest)
	publishReadPerfFixture(t, ctx, f)
	if commit(firstBook, lastRequest) != last {
		t.Fatal("replay after sealing changed the receipt")
	}
	draft, err := f.Service.OpenShell(ctx, f.ExamID, "word-vault-test")
	if err != nil {
		t.Fatal(err)
	}
	if draft.VersionID == last.DraftID {
		t.Fatal("published version became editable")
	}
	clear := wordVaultTestBook(t)
	clearPreview := check(clear)
	if clearPreview.Before != 2 || clearPreview.DraftID != draft.VersionID {
		t.Fatalf("clone must inherit the sealed vocabulary: %+v", clearPreview)
	}
	if commit(clear, request(clearPreview, "clear-vault")).Count != 0 {
		t.Fatal("header-only replacement should clear the draft")
	}
	commit(higher, request(check(higher), "stale-reference-fixture"))
	var placement string
	err = f.DB.QueryRowContext(ctx, `SELECT eq.id FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ? AND m.module_key = 'rw-m2-higher'
		ORDER BY eq.display_order, eq.id LIMIT 1 OFFSET 1`, draft.VersionID).Scan(&placement)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.DB.ExecContext(ctx, "DELETE FROM assessment_exam_questions WHERE id = ?", placement); err != nil {
		t.Fatal(err)
	}
	status, err := f.Service.WordVaultStatus(ctx, f.ExamID)
	if err != nil || status.StaleCount != 1 {
		t.Fatalf("stale reference status: %+v %v", status, err)
	}
	issues, err := satpublish.ValidateDraft(ctx, f.DB, draft.VersionID)
	if err != nil {
		t.Fatal(err)
	}
	blocked := false
	for _, issue := range issues {
		if issue.Code == "sat.word_vault.stale" && issue.Blocking {
			blocked = true
			break
		}
	}
	if !blocked {
		t.Fatalf("stale reference must block publication: %+v", issues)
	}
	words, stale, err := satwordvault.Read(ctx, f.DB, last.DraftID)
	if err != nil || stale != 0 || len(words) != 2 || words[0].Word != "lower" || words[1].Word != "higher" {
		t.Fatalf("published words changed: %+v stale=%d err=%v", words, stale, err)
	}
}

func wordVaultSheetText(t *testing.T, book *excelize.File, sheet string) string {
	t.Helper()
	rows, err := book.GetRows(sheet)
	if err != nil {
		t.Fatal(err)
	}
	var text strings.Builder
	for _, row := range rows {
		for _, cell := range row {
			text.WriteString(cell)
			text.WriteString("\n")
		}
	}
	return text.String()
}

func TestWordVaultTemplateCarriesTheImportContract(t *testing.T) {
	template, err := WordVaultTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(template))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()

	if sheets := book.GetSheetList(); len(sheets) != 3 || sheets[0] != wordVaultSheet || sheets[1] != wordVaultGuideSheet || sheets[2] != wordVaultInstructionsSheet {
		t.Fatalf("unexpected sheets: %v", sheets)
	}

	// The guide must document the rules the parser actually enforces, so a
	// teacher or an AI tool does not discover them only after a failed upload.
	guide := wordVaultSheetText(t, book, wordVaultGuideSheet)
	for _, want := range []string{
		"Reading & Writing · Module 1",
		"rw-m2-lower",
		"rw-m2-higher",
		"Question number",
		"200 entries",
		"2 MB",
		"replaces the ENTIRE draft Word Vault",
		"Thai script",
		"sat.word_vault.stale",
		"header row clears an existing vault",
	} {
		if !strings.Contains(guide, want) {
			t.Fatalf("guide is missing %q", want)
		}
	}

	instructions := wordVaultSheetText(t, book, wordVaultInstructionsSheet)
	for _, want := range []string{"COPYABLE SYSTEM PROMPT", "NOT IMPORT READY", "Question number", "MODULE MAP"} {
		if !strings.Contains(instructions, want) {
			t.Fatalf("AI instructions are missing %q", want)
		}
	}

	prompt, err := book.GetCellValue(wordVaultInstructionsSheet, "B4")
	if err != nil {
		t.Fatal(err)
	}
	if len(prompt) < 1200 {
		t.Fatalf("the copyable AI prompt is too thin: %d characters", len(prompt))
	}
	for _, want := range []string{"OUTPUT CONTRACT", "NOT IMPORT READY", "Vocabulary", "Thai meaning"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("AI prompt is missing %q", want)
		}
	}

	// The template itself must stay a valid header-only import: uploading it
	// unchanged either clears an existing draft vault or is a no-op.
	if rows, issues, err := parseWordVault(template); err != nil || len(rows) != 0 || len(issues) != 0 {
		t.Fatalf("template must be a valid empty import: rows=%+v issues=%+v err=%v", rows, issues, err)
	}
}
