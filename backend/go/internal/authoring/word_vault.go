package authoring

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satwordvault"
)

type WordVaultStatus struct {
	DraftID        string `json:"draftId"`
	DraftCount     int    `json:"draftCount"`
	PublishedCount int    `json:"publishedCount"`
	StaleCount     int    `json:"staleCount"`
}

type WordVaultImpact struct {
	Module string `json:"module"`
	Before int    `json:"before"`
	After  int    `json:"after"`
}

type WordVaultPreview struct {
	DraftID  string                      `json:"draftId"`
	Revision int                         `json:"revision"`
	Digest   string                      `json:"digest"`
	Before   int                         `json:"before"`
	Entries  []satwordvault.PrintedEntry `json:"entries"`
	Impact   []WordVaultImpact           `json:"impact"`
	Issues   []WordVaultIssue            `json:"issues"`
}

type WordVaultCommit struct {
	DraftID      string `json:"draftId"`
	Revision     int    `json:"revision"`
	Digest       string `json:"digest"`
	OperationKey string `json:"operationKey"`
	Confirmed    bool   `json:"confirmed"`
}

type WordVaultReceipt struct {
	DraftID  string `json:"draftId"`
	Revision int    `json:"revision"`
	Count    int    `json:"count"`
}

func (s *Service) WordVaultStatus(ctx context.Context, examID string) (WordVaultStatus, error) {
	var status WordVaultStatus
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
		return nil
	})
	return status, err
}

const wordVaultDraftQuery = `SELECT v.id, v.revision FROM exam_entities e
	JOIN exam_versions v ON v.id = e.current_draft_version_id AND v.exam_id = e.id
	WHERE e.id = ? AND e.provider_key = 'sat' AND e.status <> 'archived' AND v.is_draft = TRUE`

func (s *Service) PreviewWordVault(ctx context.Context, examID string, data []byte) (WordVaultPreview, error) {
	rows, issues, err := parseWordVault(data)
	if err != nil {
		return WordVaultPreview{}, err
	}
	preview := WordVaultPreview{Digest: wordVaultDigest(data), Issues: issues,
		Entries: []satwordvault.PrintedEntry{}, Impact: []WordVaultImpact{}}
	err = s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		err := q.QueryRowContext(ctx, wordVaultDraftQuery, examID).Scan(&preview.DraftID, &preview.Revision)
		if err == sql.ErrNoRows {
			return validationError("Open an editable SAT draft before checking a vocabulary workbook.")
		}
		if err != nil {
			return err
		}
		before, err := satwordvault.Load(ctx, q, preview.DraftID)
		if err != nil {
			return err
		}
		preview.Before = len(before)
		modules, err := satwordvault.Modules(ctx, q, preview.DraftID)
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
	if !request.Confirmed || request.DraftID == "" || request.Revision < 0 || request.Digest != wordVaultDigest(data) {
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
		var draftID string
		var revision int
		err = q.QueryRowContext(ctx, wordVaultDraftQuery+" FOR UPDATE", examID).Scan(&draftID, &revision)
		if err == sql.ErrNoRows || (err == nil && (draftID != request.DraftID || revision != request.Revision)) {
			return conflictError("The draft changed. Check the vocabulary workbook again.")
		}
		if err != nil {
			return err
		}
		modules, err := satwordvault.Modules(ctx, q, draftID)
		if err != nil {
			return err
		}
		entries, referenceIssues := bindWordVaultRows(rows, modules)
		if len(referenceIssues) > 0 {
			return validationError("The workbook has question references that do not match this draft. Check it again.")
		}
		if err := satwordvault.Replace(ctx, q, draftID, entries); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", draftID); err != nil {
			return err
		}
		receipt = WordVaultReceipt{DraftID: draftID, Revision: revision + 1, Count: len(entries)}
		return storeOperationResult(ctx, q, actorID, scope, key, receipt)
	})
	return receipt, err
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
			issues = append(issues, WordVaultIssue{row.number, "A", "This module is not present in the current draft."})
			continue
		}
		if row.question > len(questions) {
			issues = append(issues, WordVaultIssue{row.number, "B", "This question number is not present in the module."})
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
