package authoring

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satwordvault"
)

type WordVaultStatus struct {
	DraftID           string             `json:"draftId"`
	DraftCount        int                `json:"draftCount"`
	PublishedCount    int                `json:"publishedCount"`
	StaleCount        int                `json:"staleCount"`
	PublishedVersions []WordVaultVersion `json:"publishedVersions"`
}

type WordVaultVersion struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
}

type WordVaultImpact struct {
	Module string `json:"module"`
	Before int    `json:"before"`
	After  int    `json:"after"`
}

type WordVaultPreview struct {
	DraftID   string                      `json:"draftId"`
	VersionID string                      `json:"versionId,omitempty"`
	Revision  int                         `json:"revision"`
	Digest    string                      `json:"digest"`
	Before    int                         `json:"before"`
	Entries   []satwordvault.PrintedEntry `json:"entries"`
	Impact    []WordVaultImpact           `json:"impact"`
	Issues    []WordVaultIssue            `json:"issues"`
}

type WordVaultCommit struct {
	DraftID      string `json:"draftId"`
	VersionID    string `json:"versionId,omitempty"`
	Revision     int    `json:"revision"`
	Digest       string `json:"digest"`
	OperationKey string `json:"operationKey"`
	Confirmed    bool   `json:"confirmed"`
}

type WordVaultReceipt struct {
	DraftID   string `json:"draftId"`
	VersionID string `json:"versionId,omitempty"`
	Revision  int    `json:"revision"`
	Count     int    `json:"count"`
	// DraftUpdated reports that a published-version replacement was also
	// carried into the open draft, which moved the draft's revision. The
	// authoring shell must refresh when this is set.
	DraftUpdated bool `json:"draftUpdated,omitempty"`
}

func (s *Service) WordVaultStatus(ctx context.Context, examID string) (WordVaultStatus, error) {
	status := WordVaultStatus{PublishedVersions: []WordVaultVersion{}}
	err := s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		var draft, published sql.NullString
		err := q.QueryRowContext(ctx, `SELECT current_draft_version_id, current_published_version_id
			FROM exam_entities WHERE id = ? AND provider_key = 'sat'`, examID).Scan(&draft, &published)
		if err == sql.ErrNoRows {
			return notFoundError("SAT exam not found.")
		}
		if err != nil {
			return err
		}
		if draft.Valid && draft.String != "" {
			status.DraftID = draft.String
			printed, stale, err := satwordvault.Read(ctx, q, draft.String)
			if err != nil {
				return err
			}
			status.DraftCount = len(printed) + stale
			status.StaleCount = stale
		}
		if published.Valid && published.String != "" {
			entries, err := satwordvault.Load(ctx, q, published.String)
			if err != nil {
				return err
			}
			status.PublishedCount = len(entries)
		}
		rows, err := q.QueryContext(ctx, `SELECT id, version_number FROM exam_versions
			WHERE exam_id = ? AND is_published = TRUE AND is_draft = FALSE ORDER BY version_number DESC`, examID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var version WordVaultVersion
			if err := rows.Scan(&version.ID, &version.Number); err != nil {
				return err
			}
			status.PublishedVersions = append(status.PublishedVersions, version)
		}
		return rows.Err()
	})
	return status, err
}

const wordVaultDraftQuery = `SELECT v.id, v.revision FROM exam_entities e
	JOIN exam_versions v ON v.id = e.current_draft_version_id AND v.exam_id = e.id
	WHERE e.id = ? AND e.provider_key = 'sat' AND e.status <> 'archived' AND v.is_draft = TRUE`

func wordVaultTarget(examID, versionID string) (string, []any) {
	if versionID == "" {
		return wordVaultDraftQuery, []any{examID}
	}
	return `SELECT v.id, v.revision FROM exam_entities e JOIN exam_versions v ON v.exam_id = e.id
		WHERE e.id = ? AND e.provider_key = 'sat' AND e.status <> 'archived'
		AND v.id = ? AND v.is_published = TRUE AND v.is_draft = FALSE`, []any{examID, versionID}
}

func (s *Service) PreviewWordVault(ctx context.Context, examID string, data []byte) (WordVaultPreview, error) {
	return s.PreviewWordVaultForVersion(ctx, examID, "", data)
}

func (s *Service) PreviewWordVaultForVersion(ctx context.Context, examID, versionID string, data []byte) (WordVaultPreview, error) {
	rows, issues, err := parseWordVault(data)
	if err != nil {
		return WordVaultPreview{}, err
	}
	preview := WordVaultPreview{Digest: wordVaultDigest(data), Issues: issues,
		Entries: []satwordvault.PrintedEntry{}, Impact: []WordVaultImpact{}}
	err = s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		query, args := wordVaultTarget(examID, versionID)
		var targetID string
		err := q.QueryRowContext(ctx, query, args...).Scan(&targetID, &preview.Revision)
		if err == sql.ErrNoRows {
			if versionID != "" {
				return validationError("Choose a published version of this SAT exam.")
			}
			return validationError("Open an editable SAT draft before checking a vocabulary workbook.")
		}
		if err != nil {
			return err
		}
		before, err := satwordvault.Load(ctx, q, targetID)
		if err != nil {
			return err
		}
		preview.Before = len(before)
		if versionID == "" {
			preview.DraftID = targetID
		} else {
			preview.VersionID = targetID
			preview.Digest = publishedWordVaultDigest(data, targetID, before)
		}
		modules, err := satwordvault.Modules(ctx, q, targetID)
		if err != nil {
			return err
		}
		entries, referenceIssues := bindWordVaultRows(rows, modules)
		preview.Issues = append(preview.Issues, referenceIssues...)
		if printed, _ := satwordvault.Resolve(entries, modules); len(printed) > 0 {
			preview.Entries = printed
		}
		names := make(map[string]string, len(modules))
		for _, module := range modules {
			names[module.Key] = module.Title
		}
		for _, module := range satWorkbookModules {
			var impact WordVaultImpact
			impact.Module = module.label
			for _, entry := range before {
				if entry.ModuleKey == module.key {
					impact.Before++
				}
			}
			for _, entry := range entries {
				if entry.ModuleKey == module.key {
					impact.After++
				}
			}
			if impact.Before != 0 || impact.After != 0 {
				if name := names[module.key]; name != "" {
					impact.Module = name
				}
				preview.Impact = append(preview.Impact, impact)
			}
		}
		return nil
	})
	return preview, err
}

func (s *Service) CommitWordVault(ctx context.Context, examID, actorID string, data []byte, request WordVaultCommit) (WordVaultReceipt, error) {
	var receipt WordVaultReceipt
	published := request.VersionID != ""
	if !request.Confirmed || (request.DraftID != "") == published || request.Revision < 0 ||
		(!published && request.Digest != wordVaultDigest(data)) {
		return receipt, validationError("Check and confirm this vocabulary workbook before importing.")
	}
	key, err := normalizeOperationKey(request.OperationKey)
	if err != nil {
		return receipt, err
	}
	fingerprint, err := operationFingerprint(request)
	if err != nil {
		return receipt, err
	}
	if published {
		fingerprint = wordVaultDigest([]byte(fingerprint + ":" + wordVaultDigest(data)))
	}
	rows, issues, err := parseWordVault(data)
	if err != nil {
		return receipt, err
	}
	if len(issues) > 0 {
		return receipt, validationError("Fix the vocabulary workbook issues and check it again.")
	}
	scope := "sat-word-vault:" + examID
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		replay, claimed, err := claimOperationKey(ctx, q, actorID, scope, key, fingerprint)
		if err != nil {
			return err
		}
		if !claimed {
			if len(replay) == 0 {
				return conflictError("This import is still being saved. Retry with the same workbook.")
			}
			return json.Unmarshal(replay, &receipt)
		}
		target := request.DraftID
		if published {
			target = request.VersionID
		}
		query, args := wordVaultTarget(examID, request.VersionID)
		var targetID string
		var revision int
		err = q.QueryRowContext(ctx, query+" FOR UPDATE", args...).Scan(&targetID, &revision)
		if err == sql.ErrNoRows || (err == nil && (targetID != target || revision != request.Revision)) {
			return conflictError("The selected version changed. Check the vocabulary workbook again.")
		}
		if err != nil {
			return err
		}
		var publishedBefore []satwordvault.Entry
		if published {
			before, err := satwordvault.Load(ctx, q, targetID)
			if err != nil {
				return err
			}
			publishedBefore = before
			if request.Digest != publishedWordVaultDigest(data, targetID, before) {
				return conflictError("The workbook or saved vocabulary changed. Check the workbook again.")
			}
		}
		modules, err := satwordvault.Modules(ctx, q, targetID)
		if err != nil {
			return err
		}
		entries, referenceIssues := bindWordVaultRows(rows, modules)
		if len(referenceIssues) > 0 {
			return validationError("The workbook has question references that do not match the selected version. Check it again.")
		}
		if err := satwordvault.Replace(ctx, q, targetID, entries); err != nil {
			return err
		}
		receipt = WordVaultReceipt{DraftID: request.DraftID, VersionID: request.VersionID, Revision: revision, Count: len(entries)}
		if !published {
			if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", targetID); err != nil {
				return err
			}
			receipt.Revision++
		} else {
			carried, err := carryWordVaultToDraft(ctx, q, examID, targetID, publishedBefore, modules, rows)
			if err != nil {
				return err
			}
			receipt.DraftUpdated = carried
		}
		return storeOperationResult(ctx, q, actorID, scope, key, receipt)
	})
	return receipt, err
}

// Include the target and the saved vocabulary so a competing replacement
// invalidates the preview without changing the published exam revision.
func publishedWordVaultDigest(data []byte, versionID string, before []satwordvault.Entry) string {
	entries, _ := json.Marshal(before) // Entry contains only strings.
	digest := sha256.Sum256(entries)
	return wordVaultDigest([]byte(wordVaultDigest(data) + ":" + versionID + ":" + hex.EncodeToString(digest[:])))
}

func wordVaultDigest(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func bindWordVaultRows(rows []wordVaultRow, modules []satwordvault.Module) ([]satwordvault.Entry, []WordVaultIssue) {
	byKey := make(map[string][]satwordvault.Question, len(modules))
	for _, module := range modules {
		byKey[module.Key] = module.Questions
	}
	var entries []satwordvault.Entry
	var issues []WordVaultIssue
	for _, row := range rows {
		questions, exists := byKey[row.entry.ModuleKey]
		if !exists {
			issues = append(issues, WordVaultIssue{row.number, "A", "This module is not present in the selected version."})
			continue
		}
		if len(questions) == 0 {
			issues = append(issues, WordVaultIssue{row.number, "B", "This module has no questions in the selected version."})
			continue
		}
		if row.question > len(questions) {
			issues = append(issues, WordVaultIssue{row.number, "B", fmt.Sprintf("Question %d is missing from the selected version. Valid numbers for this module are 1–%d.", row.question, len(questions))})
			continue
		}
		entry := row.entry
		entry.QuestionID = questions[row.question-1].ID
		matches := 0
		for _, question := range questions {
			if question.ID == entry.QuestionID {
				matches++
			}
		}
		if matches != 1 || strings.TrimSpace(entry.QuestionID) == "" {
			issues = append(issues, WordVaultIssue{row.number, "B", "This question reference is ambiguous in the module."})
			continue
		}
		entries = append(entries, entry)
	}
	return entries, issues
}

// carryWordVaultToDraft mirrors a published-version replacement into the open
// draft while the draft still holds exactly the vocabulary it inherited.
//
// Publishing seals the DRAFT row, so a fix applied to an already-published
// version never reaches the next release: the next draft was cloned from that
// version before the fix and is what the next publish seals. Carrying the fix
// forward closes that loop.
//
// The guard is the point. Two vaults are compared by module, question position
// and the four printed fields; question ids are regenerated by every clone, so
// position is the only stable join. When they differ — or when the draft no
// longer has a module the workbook mentions — the draft wins and nothing is
// written: a published fix is a fix for students who already sat, never
// permission to overwrite an author's newer words.
func carryWordVaultToDraft(
	ctx context.Context, q tx.Tx, examID, versionID string,
	publishedBefore []satwordvault.Entry, publishedModules []satwordvault.Module,
	rows []wordVaultRow,
) (bool, error) {
	var draftID sql.NullString
	err := q.QueryRowContext(ctx, "SELECT current_draft_version_id FROM exam_entities WHERE id = ? AND provider_key = 'sat'", examID).Scan(&draftID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !draftID.Valid || strings.TrimSpace(draftID.String) == "" || draftID.String == versionID {
		return false, nil
	}

	draftModules, err := satwordvault.Modules(ctx, q, draftID.String)
	if err != nil {
		return false, err
	}
	draftEntries, err := satwordvault.Load(ctx, q, draftID.String)
	if err != nil {
		return false, err
	}
	inherited, ok := vaultFingerprint(publishedBefore, publishedModules)
	if !ok {
		return false, nil
	}
	current, ok := vaultFingerprint(draftEntries, draftModules)
	if !ok || !sameVaultFingerprint(inherited, current) {
		return false, nil
	}

	entries, issues := bindWordVaultRows(rows, draftModules)
	if len(issues) > 0 {
		return false, nil
	}
	if err := satwordvault.Replace(ctx, q, draftID.String, entries); err != nil {
		return false, err
	}
	// The draft's vault moved under its own revision, so fence any preview
	// taken against the previous one.
	if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", draftID.String); err != nil {
		return false, err
	}
	return true, nil
}

// vaultPrint is one entry with its question id replaced by the position that
// survives a clone. Sorting makes the comparison order-independent: a stored
// vault keeps workbook order, which two versions need not share.
type vaultPrint struct {
	module     string
	word       string
	thai       string
	definition string
	example    string
	position   int
}

func vaultFingerprint(entries []satwordvault.Entry, modules []satwordvault.Module) ([]vaultPrint, bool) {
	where := make(map[string]vaultPrint, len(modules)*2)
	for _, module := range modules {
		for index, question := range module.Questions {
			where[question.ID] = vaultPrint{module: module.Key, position: index}
		}
	}
	out := make([]vaultPrint, 0, len(entries))
	for _, entry := range entries {
		slot, ok := where[entry.QuestionID]
		if !ok {
			return nil, false
		}
		slot.word, slot.thai, slot.definition, slot.example = entry.Word, entry.Thai, entry.Definition, entry.Example
		out = append(out, slot)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].module != out[j].module {
			return out[i].module < out[j].module
		}
		if out[i].position != out[j].position {
			return out[i].position < out[j].position
		}
		return out[i].word < out[j].word
	})
	return out, true
}

func sameVaultFingerprint(a, b []vaultPrint) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
