package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

// The recovery capability is browser-generated before admission and retained
// across response loss. Display email never selects an account. Its digest
// identifies one isolated practice principal in one sitting; it is not logged
// or returned as an account email.
func practiceEntryAddress(scheduleID, capability string) (string, error) {
	secret, err := hex.DecodeString(capability)
	if err != nil || len(secret) != 32 || strings.TrimSpace(scheduleID) == "" {
		return "", apperrors.New(apperrors.CodeValidation, "A 32-byte hexadecimal entrySession recovery capability is required. Update the entry client and preserve it when retrying.")
	}
	hash := sha256.New()
	hash.Write([]byte("practice-entry-v1\x00"))
	hash.Write([]byte(scheduleID))
	hash.Write([]byte{0})
	hash.Write(secret)
	return hex.EncodeToString(hash.Sum(nil)) + "@practice.invalid", nil
}

func practiceEntryPrincipal(ctx context.Context, db *sql.DB, scheduleID, capability, name string) (string, string, error) {
	accountEmail, err := practiceEntryAddress(scheduleID, capability)
	if err != nil {
		return "", "", err
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, ?, 'student', 'active') ON DUPLICATE KEY UPDATE id = id", uuid.NewString(), accountEmail, strings.TrimSpace(name)); err != nil {
		return "", "", err
	}
	var id, role, state, displayName string
	if err := db.QueryRowContext(ctx, "SELECT id, role, state, COALESCE(display_name, '') FROM users WHERE email = ?", accountEmail).Scan(&id, &role, &state, &displayName); err != nil {
		return "", "", err
	}
	if role != "student" || state != "active" {
		return "", "", apperrors.New(apperrors.CodeUnauthorized, "Practice admission is unavailable.")
	}
	return id, displayName, nil
}
