// Package satstartcode owns the SAT session start code: the six-digit shared
// secret an admitted candidate enters to begin their own personal clock
// (docs/plans/2026-10-09-sat-access-code-start.md).
//
// It is deliberately a leaf: schedules and access links create codes inside
// their own schedule-creation transactions, proctor routes reveal/rotate them,
// and delivery decrypts them inside the first-start transaction. None of those
// packages import each other for this.
//
// Codes are stored only as AES-GCM ciphertext under a dedicated keyring. The
// associated data binds schedule id and generation, so ciphertext copied across
// schedules or generations fails to open. Plaintext never reaches logs, audit
// payloads, metrics or student responses.
package satstartcode

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Start modes persisted in exam_schedules.sat_start_mode.
const (
	ModeProctor    = "proctor"
	ModeAccessCode = "access_code"
)

// CodeLength is the exact number of ASCII digits in a start code.
const CodeLength = 6

const codeSpace = 1_000_000

// ReservationSlotsPerGeneration is the durable ceiling for concurrent or failed
// code comparisons in one fixed failure window.
const ReservationSlotsPerGeneration = 200

// previewCohortPrefix is the reserved builder-preview cohort namespace;
// previews keep their isolated proctor start.
const previewCohortPrefix = "__preview_runtime__:"

const personalTimingModel = "sat_personal_v1"

// Keyring is the versioned AES-GCM keyring. The first configured key seals;
// every configured key opens, so rows written under a retired key remain
// readable until they are re-encrypted.
type Keyring struct {
	activeID string
	keys     map[string]cipher.AEAD
}

// ParseKeyring parses "id:base64key[,id:base64key...]". Keys must decode to
// 16, 24 or 32 bytes. Errors never echo key material.
func ParseKeyring(raw string) (*Keyring, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	ring := &Keyring{keys: map[string]cipher.AEAD{}}
	for i, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		id, encoded, ok := strings.Cut(entry, ":")
		id = strings.TrimSpace(id)
		if !ok || id == "" || len(id) > 32 {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS entry %d must be id:base64key with an id of at most 32 characters", i+1)
		}
		if _, dup := ring.keys[id]; dup {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS key id %q is duplicated", id)
		}
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS key %q is not valid base64", id)
		}
		if len(key) != 16 && len(key) != 24 && len(key) != 32 {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS key %q must be 16, 24 or 32 bytes", id)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS key %q is unusable", id)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("SAT_START_CODE_KEYS key %q is unusable", id)
		}
		ring.keys[id] = aead
		if i == 0 {
			ring.activeID = id
		}
	}
	return ring, nil
}

type settings struct {
	creationEnabled bool
	ring            *Keyring
}

var current atomic.Pointer[settings]

// Configure installs the process-wide rollout switch and keyring. It is
// called once from the composition root (internal/app).
func Configure(creationEnabled bool, ring *Keyring) {
	current.Store(&settings{creationEnabled: creationEnabled, ring: ring})
}

// ValidateConfig is the fail-closed startup check: enabling creation without
// a keyring, or a malformed keyring, refuses to boot.
func ValidateConfig(creationEnabled bool, rawKeys string) (*Keyring, error) {
	ring, err := ParseKeyring(rawKeys)
	if err != nil {
		return nil, err
	}
	if creationEnabled && ring == nil {
		return nil, fmt.Errorf("SAT_START_CODE_KEYS must be set when SAT_ACCESS_CODE_START is enabled")
	}
	return ring, nil
}

func load() settings {
	if s := current.Load(); s != nil {
		return *s
	}
	return settings{}
}

// CreationEnabled reports whether new normal SAT schedules default to code start.
func CreationEnabled() bool { return load().creationEnabled }

func unavailable() *apperrors.Error {
	err := apperrors.New(apperrors.CodeServiceUnavailable, "The exam start code is temporarily unavailable.")
	err.Details = map[string]any{"reason": "START_CODE_UNAVAILABLE"}
	err.Retryable = true
	return err
}

func ringOrUnavailable() (*Keyring, error) {
	ring := load().ring
	if ring == nil {
		return nil, unavailable()
	}
	return ring, nil
}

// Generate draws a uniform code from 000000-999999 with crypto/rand.
func Generate() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(codeSpace))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func generateDifferentFrom(previous string) (string, error) {
	for {
		code, err := Generate()
		if err != nil {
			return "", err
		}
		if code != previous {
			return code, nil
		}
	}
}

// NormalizeSubmitted trims surrounding whitespace and requires exactly six
// ASCII digits. Letters, separators and non-ASCII digits are rejected, never
// stripped; leading zeros are preserved.
func NormalizeSubmitted(raw string) (string, bool) {
	code := strings.TrimSpace(raw)
	if len(code) != CodeLength {
		return "", false
	}
	for i := range len(code) {
		if code[i] < '0' || code[i] > '9' {
			return "", false
		}
	}
	return code, true
}

// Equal compares two validated codes in constant time.
func Equal(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func associatedData(scheduleID string, generation int) []byte {
	return []byte("sat-start-code:v1:" + scheduleID + ":" + strconv.Itoa(generation))
}

func (k *Keyring) seal(scheduleID string, generation int, code string) (ciphertext, nonce []byte, keyID string, err error) {
	aead := k.keys[k.activeID]
	nonce = make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, "", err
	}
	return aead.Seal(nil, nonce, []byte(code), associatedData(scheduleID, generation)), nonce, k.activeID, nil
}

func (k *Keyring) open(scheduleID string, generation int, keyID string, ciphertext, nonce []byte) (string, error) {
	aead, ok := k.keys[keyID]
	if !ok || len(nonce) != aead.NonceSize() {
		return "", unavailable()
	}
	plain, err := aead.Open(nil, nonce, ciphertext, associatedData(scheduleID, generation))
	if err != nil {
		return "", unavailable()
	}
	code, ok := NormalizeSubmitted(string(plain))
	if !ok || code != string(plain) {
		return "", unavailable()
	}
	return code, nil
}

// Code is the decrypted session code for staff presentation or comparison.
type Code struct {
	Value      string
	Generation int
	KeyID      string
}

// Audit actions appended to session_audit_logs (never with code material).
const (
	AuditCodeCreated  = "SAT_START_CODE_CREATED"
	AuditCodeRevealed = "SAT_START_CODE_REVEALED"
	AuditCodeRotated  = "SAT_START_CODE_ROTATED"
	AuditFirstStart   = "SAT_START_CODE_FIRST_START"
	AuditStartExpired = "SAT_START_WINDOW_CLOSED"
)

// AuditTx appends one start-code fact to the schedule audit log. The payload
// must never contain the code, its ciphertext or key material.
func AuditTx(ctx context.Context, q tx.Tx, scheduleID, actorID, action string, attemptID *string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := q.ExecContext(ctx,
		"INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))",
		uuid.NewString(), scheduleID, actorID, action, attemptID, string(raw))
	return err
}

// ResolveCreateMode decides the start mode for a newly created schedule.
// requested may be "", "proctor" or "access_code". Previews and non-SAT
// providers always use proctor start; code start requires rollout enablement.
func ResolveCreateMode(providerKey, cohortName, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	sat := strings.EqualFold(strings.TrimSpace(providerKey), "sat")
	preview := strings.HasPrefix(strings.TrimSpace(cohortName), previewCohortPrefix)
	switch requested {
	case "":
		if sat && !preview && CreationEnabled() {
			return ModeAccessCode, nil
		}
		return ModeProctor, nil
	case ModeProctor:
		return ModeProctor, nil
	case ModeAccessCode:
		if !sat {
			return "", apperrors.New(apperrors.CodeValidation, "Exam start codes are only available for SAT sessions.")
		}
		if preview {
			return "", apperrors.New(apperrors.CodeValidation, "Builder preview sessions use the preview start.")
		}
		if !CreationEnabled() {
			return "", apperrors.New(apperrors.CodeValidation, "Exam start codes are not enabled for new SAT sessions.")
		}
		return ModeAccessCode, nil
	default:
		return "", apperrors.New(apperrors.CodeValidation, "satStartMode must be proctor or access_code.")
	}
}

// ApplyCreateModeTx persists the resolved mode on a just-inserted schedule
// inside its creation transaction. Code mode requires the stored personal
// timing choice (a conflicting rollout is a configuration error, never a
// silent cohort downgrade), disables schedule auto-start, and creates the
// encrypted generation-1 code atomically with the schedule.
func ApplyCreateModeTx(ctx context.Context, q tx.Tx, scheduleID, mode, actorID string) error {
	if mode != ModeAccessCode {
		return nil
	}
	var timing sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT sat_timing_model FROM exam_schedules WHERE id = ?", scheduleID).Scan(&timing); err != nil {
		return err
	}
	if !timing.Valid || timing.String != personalTimingModel {
		err := apperrors.New(apperrors.CodeValidation, "Exam start codes require SAT personal timing (SAT_PERSONAL_TIMING).")
		err.Details = map[string]any{"reason": "START_CODE_TIMING_CONFLICT"}
		return err
	}
	if _, err := q.ExecContext(ctx, "UPDATE exam_schedules SET sat_start_mode = ?, auto_start = false WHERE id = ?", ModeAccessCode, scheduleID); err != nil {
		return err
	}
	return createCodeTx(ctx, q, scheduleID, actorID)
}

func createCodeTx(ctx context.Context, q tx.Tx, scheduleID, actorID string) error {
	ring, err := ringOrUnavailable()
	if err != nil {
		return err
	}
	code, err := Generate()
	if err != nil {
		return err
	}
	ciphertext, nonce, keyID, err := ring.seal(scheduleID, 1, code)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx,
		"INSERT INTO sat_session_start_codes (schedule_id, ciphertext, nonce, key_id, generation, created_at, updated_by) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(6), ?)",
		scheduleID, ciphertext, nonce, keyID, nullable(actorID)); err != nil {
		return err
	}
	if err := createGuardTx(ctx, q, scheduleID, 1); err != nil {
		return err
	}
	if err := createReservationSlotsTx(ctx, q, scheduleID, 1); err != nil {
		return err
	}
	return AuditTx(ctx, q, scheduleID, actorOrSystem(actorID), AuditCodeCreated, nil, map[string]any{"generation": 1})
}

// createGuardTx retains the legacy serialization row so an immediate rollback
// to the previous API can still use a valid row for each code generation. New
// slot claims do not lock this row.
func createGuardTx(ctx context.Context, q tx.Tx, scheduleID string, generation int) error {
	_, err := q.ExecContext(ctx, "INSERT IGNORE INTO sat_start_code_guards (schedule_id, generation) VALUES (?, ?)", scheduleID, generation)
	return err
}

func createReservationSlotsTx(ctx context.Context, q tx.Tx, scheduleID string, generation int) error {
	var query strings.Builder
	query.Grow(len("INSERT INTO sat_start_code_reservation_slots (schedule_id, generation, slot_no, state) VALUES ") + ReservationSlotsPerGeneration*16)
	query.WriteString("INSERT INTO sat_start_code_reservation_slots (schedule_id, generation, slot_no, state) VALUES ")
	args := make([]any, 0, ReservationSlotsPerGeneration*3)
	for slot := 0; slot < ReservationSlotsPerGeneration; slot++ {
		if slot > 0 {
			query.WriteByte(',')
		}
		query.WriteString("(?, ?, ?, 'free')")
		args = append(args, scheduleID, generation, slot)
	}
	_, err := q.ExecContext(ctx, query.String(), args...)
	return err
}

// SwitchModeTx changes an existing schedule's start mode. It is legal only
// before participation: no attempt and no runtime. The caller holds the
// schedule row FOR UPDATE.
func SwitchModeTx(ctx context.Context, q tx.Tx, scheduleID, providerKey, cohortName, mode, actorID string) error {
	var currentMode string
	if err := q.QueryRowContext(ctx, "SELECT sat_start_mode FROM exam_schedules WHERE id = ?", scheduleID).Scan(&currentMode); err != nil {
		return err
	}
	if currentMode == mode {
		return nil
	}
	var participated bool
	if err := q.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM student_attempts WHERE schedule_id = ?) OR EXISTS(SELECT 1 FROM exam_session_runtimes WHERE schedule_id = ?)",
		scheduleID, scheduleID).Scan(&participated); err != nil {
		return err
	}
	if participated {
		err := apperrors.New(apperrors.CodeConflict, "The start mode cannot change after candidates have joined or the session has started.")
		err.Details = map[string]any{"reason": "START_MODE_FROZEN"}
		return err
	}
	switch mode {
	case ModeProctor:
		if _, err := q.ExecContext(ctx, "DELETE FROM sat_session_start_codes WHERE schedule_id = ?", scheduleID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "DELETE FROM sat_start_code_reservation_slots WHERE schedule_id = ?", scheduleID); err != nil {
			return err
		}
		_, err := q.ExecContext(ctx, "UPDATE exam_schedules SET sat_start_mode = ? WHERE id = ?", ModeProctor, scheduleID)
		return err
	case ModeAccessCode:
		resolved, err := ResolveCreateMode(providerKey, cohortName, ModeAccessCode)
		if err != nil {
			return err
		}
		return ApplyCreateModeTx(ctx, q, scheduleID, resolved, actorID)
	default:
		return apperrors.New(apperrors.CodeValidation, "satStartMode must be proctor or access_code.")
	}
}

type storedCode struct {
	ciphertext []byte
	nonce      []byte
	keyID      string
	generation int
}

func readStoredTx(ctx context.Context, q tx.Tx, scheduleID, lockClause string) (storedCode, error) {
	var s storedCode
	err := q.QueryRowContext(ctx,
		"SELECT ciphertext, nonce, key_id, generation FROM sat_session_start_codes WHERE schedule_id = ?"+lockClause,
		scheduleID).Scan(&s.ciphertext, &s.nonce, &s.keyID, &s.generation)
	if err == sql.ErrNoRows {
		return storedCode{}, unavailable()
	}
	return s, err
}

// ReadTx decrypts the schedule's current code. lockClause is "", " FOR SHARE"
// or " FOR UPDATE" and follows the caller's lock order. Missing or corrupt
// material is a 503, never a silently regenerated code.
func ReadTx(ctx context.Context, q tx.Tx, scheduleID, lockClause string) (Code, error) {
	ring, err := ringOrUnavailable()
	if err != nil {
		return Code{}, err
	}
	stored, err := readStoredTx(ctx, q, scheduleID, lockClause)
	if err != nil {
		return Code{}, err
	}
	value, err := ring.open(scheduleID, stored.generation, stored.keyID, stored.ciphertext, stored.nonce)
	if err != nil {
		return Code{}, err
	}
	return Code{Value: value, Generation: stored.generation, KeyID: stored.keyID}, nil
}

// RotateTx replaces the code and advances its generation. The caller holds
// the schedule row FOR SHARE (lock order schedule -> code). A stale expected
// generation is a 409 and never rotates twice.
func RotateTx(ctx context.Context, q tx.Tx, scheduleID string, expectedGeneration int, actorID string) (Code, error) {
	ring, err := ringOrUnavailable()
	if err != nil {
		return Code{}, err
	}
	stored, err := readStoredTx(ctx, q, scheduleID, " FOR UPDATE")
	if err != nil {
		return Code{}, err
	}
	if stored.generation != expectedGeneration {
		err := apperrors.New(apperrors.CodeConflict, "The exam start code changed; refresh to see the current code.")
		err.Details = map[string]any{"reason": "START_CODE_GENERATION_STALE", "generation": stored.generation}
		return Code{}, err
	}
	previous, err := ring.open(scheduleID, stored.generation, stored.keyID, stored.ciphertext, stored.nonce)
	if err != nil {
		return Code{}, err
	}
	next, err := generateDifferentFrom(previous)
	if err != nil {
		return Code{}, err
	}
	generation := stored.generation + 1
	ciphertext, nonce, keyID, err := ring.seal(scheduleID, generation, next)
	if err != nil {
		return Code{}, err
	}
	if _, err := q.ExecContext(ctx,
		"UPDATE sat_session_start_codes SET ciphertext = ?, nonce = ?, key_id = ?, generation = ?, rotated_at = UTC_TIMESTAMP(6), updated_by = ? WHERE schedule_id = ? AND generation = ?",
		ciphertext, nonce, keyID, generation, nullable(actorID), scheduleID, stored.generation); err != nil {
		return Code{}, err
	}
	if err := createGuardTx(ctx, q, scheduleID, generation); err != nil {
		return Code{}, err
	}
	if err := createReservationSlotsTx(ctx, q, scheduleID, generation); err != nil {
		return Code{}, err
	}
	if err := AuditTx(ctx, q, scheduleID, actorOrSystem(actorID), AuditCodeRotated, nil, map[string]any{
		"previousGeneration": stored.generation, "generation": generation,
	}); err != nil {
		return Code{}, err
	}
	return Code{Value: next, Generation: generation, KeyID: keyID}, nil
}

// ReencryptTx re-seals the same code under the active key without changing
// its generation (key rotation, not code rotation).
func ReencryptTx(ctx context.Context, q tx.Tx, scheduleID string) (bool, error) {
	ring, err := ringOrUnavailable()
	if err != nil {
		return false, err
	}
	stored, err := readStoredTx(ctx, q, scheduleID, " FOR UPDATE")
	if err != nil {
		return false, err
	}
	if stored.keyID == ring.activeID {
		return false, nil
	}
	value, err := ring.open(scheduleID, stored.generation, stored.keyID, stored.ciphertext, stored.nonce)
	if err != nil {
		return false, err
	}
	ciphertext, nonce, keyID, err := ring.seal(scheduleID, stored.generation, value)
	if err != nil {
		return false, err
	}
	_, err = q.ExecContext(ctx,
		"UPDATE sat_session_start_codes SET ciphertext = ?, nonce = ?, key_id = ? WHERE schedule_id = ? AND generation = ?",
		ciphertext, nonce, keyID, scheduleID, stored.generation)
	return err == nil, err
}

func nullable(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func actorOrSystem(actorID string) string {
	if strings.TrimSpace(actorID) == "" {
		return "system"
	}
	return actorID
}
