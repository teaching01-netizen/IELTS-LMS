// Command e2e_provision_staff creates the disposable staff accounts used by
// the production-load Playwright suite. It is deliberately a database tool,
// so the caller must opt in before it can mutate DATABASE_URL.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"github.com/google/uuid"
)

type args struct {
	scheduleID string
	targetPath string
	credsPath  string
	grantedBy  string
}

type prodTarget struct {
	Editor   staffTarget   `json:"editor"`
	Proctors []staffTarget `json:"proctors"`
}

type staffTarget struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

type outputCreds struct {
	Editor   outputCred   `json:"editor"`
	Proctors []outputCred `json:"proctors"`
}

type outputCred struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "e2e_provision_staff: %v\n", err)
		os.Exit(1)
	}
}

func parseArgs() (args, error) {
	fs := flag.NewFlagSet("e2e_provision_staff", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	out := args{}
	fs.StringVar(&out.scheduleID, "schedule-id", "", "schedule to which all proctors should be assigned")
	fs.StringVar(&out.targetPath, "target", "e2e/prod-data/prod-target.json", "staff target JSON path")
	fs.StringVar(&out.credsPath, "output-creds", "e2e/prod-data/prod-creds.json", "plaintext credentials output path")
	fs.StringVar(&out.grantedBy, "granted-by", "e2e_provision_staff", "assignment audit actor")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return args{}, err
	}
	if fs.NArg() != 0 {
		return args{}, fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
	}
	return out, nil
}

func run(ctx context.Context) error {
	if os.Getenv("E2E_ALLOW_PROD_DB_MUTATIONS") != "true" {
		return fmt.Errorf("refusing to mutate DATABASE_URL without E2E_ALLOW_PROD_DB_MUTATIONS=true")
	}
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	args, err := parseArgs()
	if err != nil {
		return err
	}
	target, err := readTarget(args.targetPath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(target.Editor.Email) == "" || strings.TrimSpace(target.Editor.DisplayName) == "" {
		return fmt.Errorf("target editor must include email and displayName")
	}
	if len(target.Proctors) != 10 {
		return fmt.Errorf("target file must contain exactly 10 proctors")
	}

	existing := readExistingCreds(args.credsPath)
	db, err := platformdb.Open(config.Load())
	if err != nil {
		return fmt.Errorf("connect to DATABASE_URL: %w", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	editorPassword := existingPassword(existing, target.Editor.Email)
	if editorPassword == "" {
		editorPassword = generatePassword("editor")
	}
	editorID, err := ensureUser(ctx, db, target.Editor, auth.RoleAdmin, editorPassword)
	if err != nil {
		return fmt.Errorf("ensure editor %s: %w", target.Editor.Email, err)
	}

	credentials := make([]outputCred, 0, len(target.Proctors))
	for index, proctor := range target.Proctors {
		password := existingPassword(existing, proctor.Email)
		if password == "" {
			password = generatePassword(fmt.Sprintf("proctor%02d", index+1))
		}
		userID, err := ensureUser(ctx, db, proctor, auth.RoleProctor, password)
		if err != nil {
			return fmt.Errorf("ensure proctor %s: %w", proctor.Email, err)
		}
		if args.scheduleID != "" {
			if err := ensureProctorAssignment(ctx, db, args.scheduleID, userID, args.grantedBy); err != nil {
				return fmt.Errorf("assign proctor %s: %w", proctor.Email, err)
			}
		}
		credentials = append(credentials, outputCred{Email: proctor.Email, Password: password})
	}

	if err := os.MkdirAll(filepath.Dir(args.credsPath), 0o700); err != nil && !os.IsExist(err) {
		return fmt.Errorf("create credentials directory: %w", err)
	}
	encoded, err := json.MarshalIndent(outputCreds{
		Editor:   outputCred{Email: target.Editor.Email, Password: editorPassword},
		Proctors: credentials,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode credentials: %w", err)
	}
	if err := os.WriteFile(args.credsPath, append(encoded, '\n'), 0o600); err != nil {
		return fmt.Errorf("write credentials %s: %w", args.credsPath, err)
	}

	// Do not print passwords to stdout.
	fmt.Printf("Provisioned staff at %s. Wrote creds to %s. Editor user id=%s.\n", time.Now().UTC().Format(time.RFC3339), args.credsPath, editorID)
	return nil
}

func readTarget(path string) (prodTarget, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return prodTarget{}, fmt.Errorf("read target %s: %w", path, err)
	}
	var target prodTarget
	if err := json.Unmarshal(data, &target); err != nil {
		return prodTarget{}, fmt.Errorf("parse target %s: %w", path, err)
	}
	return target, nil
}

func readExistingCreds(path string) *outputCreds {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var creds outputCreds
	if json.Unmarshal(data, &creds) != nil {
		return nil
	}
	return &creds
}

func existingPassword(creds *outputCreds, email string) string {
	if creds == nil {
		return ""
	}
	want := strings.ToLower(strings.TrimSpace(email))
	if strings.ToLower(strings.TrimSpace(creds.Editor.Email)) == want {
		return creds.Editor.Password
	}
	for _, entry := range creds.Proctors {
		if strings.ToLower(strings.TrimSpace(entry.Email)) == want {
			return entry.Password
		}
	}
	return ""
}

func generatePassword(label string) string {
	return fmt.Sprintf("E2E-%s-%s-%s", label, uuid.NewString(), uuid.NewString())
}

func ensureUser(ctx context.Context, db *sql.DB, target staffTarget, role, password string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(target.Email))
	var userID string
	err := db.QueryRowContext(ctx, "SELECT id FROM users WHERE email = ? LIMIT 1", email).Scan(&userID)
	if err == sql.ErrNoRows {
		userID = uuid.NewString()
	} else if err != nil {
		return "", err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, display_name, role, state, failed_login_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'active', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), role = VALUES(role), state = VALUES(state), updated_at = UTC_TIMESTAMP(6)`,
		userID, email, target.DisplayName, role); err != nil {
		return "", err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO user_password_credentials (user_id, password_hash, updated_at)
		VALUES (?, ?, UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = VALUES(updated_at)`, userID, hash); err != nil {
		return "", err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO staff_profiles (user_id, staff_code, full_name, email, created_at, updated_at)
		VALUES (?, NULL, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), updated_at = UTC_TIMESTAMP(6)`,
		userID, target.DisplayName, email); err != nil {
		return "", err
	}
	return userID, nil
}

func ensureProctorAssignment(ctx context.Context, db *sql.DB, scheduleID, userID, grantedBy string) error {
	var existing string
	err := db.QueryRowContext(ctx, `
		SELECT id FROM schedule_staff_assignments
		WHERE schedule_id = ? AND user_id = ? AND role = 'proctor' AND revoked_at IS NULL LIMIT 1`, scheduleID, userID).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO schedule_staff_assignments
		(id, schedule_id, actor_id, role, granted_by, created_at, revoked_at, user_id)
		VALUES (?, ?, ?, 'proctor', ?, UTC_TIMESTAMP(6), NULL, ?)`,
		uuid.NewString(), scheduleID, userID, grantedBy, userID)
	return err
}
