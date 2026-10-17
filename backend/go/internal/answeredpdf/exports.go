package answeredpdf

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"

	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/go-sql-driver/mysql"
)

const ExportTTL = 5 * time.Minute

var ErrExportUnavailable = errors.New("answeredpdf: export unavailable")

// Binding is server-established identity, never an attempt credential in a URL.
type Binding struct {
	Kind      string                `json:"kind"`
	OwnerID   string                `json:"ownerId"`
	AttemptID string                `json:"attemptId"`
	SessionID string                `json:"sessionId,omitempty"`
	Claims    *crypto.AttemptClaims `json:"claims,omitempty"`
}

type Export struct {
	ID        string
	Binding   Binding
	ObjectKey string
	Filename  string
	SizeBytes int64
	ExpiresAt time.Time
}

type PreparedExport struct {
	DownloadURL string    `json:"downloadUrl"`
	Filename    string    `json:"filename"`
	SizeBytes   int64     `json:"sizeBytes"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type Exports struct {
	db    *sql.DB
	store objectstore.Store
}

func NewExports(db *sql.DB, store objectstore.Store) *Exports { return &Exports{db: db, store: store} }
func BrowserHash(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

// Reserve serializes scope replacement using the existing attempt row lock.
// Superseded rows remain tracked until their stored objects are deleted.
func (s *Exports) Reserve(ctx context.Context, binding Binding, browserHash string) (*Export, error) {
	id, err := randomToken()
	if err != nil {
		return nil, err
	}
	row := &Export{ID: id, Binding: binding, ObjectKey: "answered-pdf/" + id + ".pdf"}
	scope := BrowserHash(binding.Kind + "\x00" + binding.OwnerID + "\x00" + binding.AttemptID + "\x00" + binding.SessionID)
	raw, err := json.Marshal(binding)
	if err != nil {
		return nil, err
	}
	err = tx.NewRunner(s.db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		// Lock a stable parent before reading the replaceable scope row. A
		// unique-key read alone can miss the replacement after waiting on an
		// old ready row, permitting two concurrent preparations.
		var attemptID string
		if err := q.QueryRowContext(ctx, "SELECT id FROM student_attempts WHERE id = ? FOR UPDATE", binding.AttemptID).Scan(&attemptID); err != nil {
			if err == sql.ErrNoRows {
				return ErrExportUnavailable
			}
			return err
		}
		var state string
		err := q.QueryRowContext(ctx, "SELECT state FROM sat_pdf_exports WHERE scope_key = ? AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE", scope).Scan(&state)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if state == "preparing" {
			return ErrBusy
		}
		if _, err = q.ExecContext(ctx, "UPDATE sat_pdf_exports SET scope_key = NULL, expires_at = UTC_TIMESTAMP(6) WHERE scope_key = ?", scope); err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, `INSERT INTO sat_pdf_exports (id,scope_key,owner_kind,owner_id,attempt_id,browser_hash,binding,state,object_key,expires_at) VALUES (?,?,?,?,?,?,?,'preparing',?,DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 120 SECOND))`, id, scope, binding.Kind, binding.OwnerID, binding.AttemptID, browserHash, raw, row.ObjectKey)
		var me *mysql.MySQLError
		if errors.As(err, &me) && me.Number == 1062 {
			return ErrBusy
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return row, nil
}

func (s *Exports) Publish(ctx context.Context, row *Export, pdf []byte, filename string, expiryLimit time.Time) (PreparedExport, error) {
	if err := ctx.Err(); err != nil {
		return PreparedExport{}, err
	}
	expiry := time.Now().UTC().Add(ExportTTL)
	if !expiryLimit.IsZero() && expiryLimit.Before(expiry) {
		expiry = expiryLimit
	}
	if !expiry.After(time.Now()) {
		return PreparedExport{}, ErrExportUnavailable
	}
	if err := s.store.Put(ctx, row.ObjectKey, pdf, "application/pdf"); err != nil {
		return PreparedExport{}, err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE sat_pdf_exports SET state = 'ready', filename = ?, size_bytes = ?, expires_at = ? WHERE id = ? AND state = 'preparing' AND scope_key IS NOT NULL AND expires_at > UTC_TIMESTAMP(6)`, filename, len(pdf), expiry, row.ID)
	if err != nil {
		return PreparedExport{}, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return PreparedExport{}, err
	}
	if n != 1 {
		return PreparedExport{}, ErrExportUnavailable
	}
	return PreparedExport{DownloadURL: "/api/v1/sat-answered-pdf/downloads/" + row.ID, Filename: filename, SizeBytes: int64(len(pdf)), ExpiresAt: expiry}, nil
}

func (s *Exports) Lookup(ctx context.Context, id, browserHash string) (*Export, error) {
	row := &Export{ID: id}
	var binding []byte
	var kind, owner, attempt, state string
	err := s.db.QueryRowContext(ctx, `SELECT owner_kind,owner_id,attempt_id,binding,state,object_key,filename,size_bytes,expires_at FROM sat_pdf_exports WHERE id = ? AND browser_hash = ?`, id, browserHash).Scan(&kind, &owner, &attempt, &binding, &state, &row.ObjectKey, &row.Filename, &row.SizeBytes, &row.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, ErrExportUnavailable
	}
	if err != nil {
		return nil, err
	}
	if state != "ready" || !row.ExpiresAt.After(time.Now().UTC()) {
		return nil, ErrExportUnavailable
	}
	if err := json.Unmarshal(binding, &row.Binding); err != nil {
		return nil, err
	}
	row.Binding.Kind, row.Binding.OwnerID, row.Binding.AttemptID = kind, owner, attempt
	return row, nil
}

type seekCloser struct{ *bytes.Reader }

func (seekCloser) Close() error { return nil }
func (s *Exports) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	if opener, ok := s.store.(objectstore.Opener); ok {
		return opener.Open(ctx, key)
	}
	data, err := s.store.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return seekCloser{bytes.NewReader(data)}, nil
}

// Discard uses a fresh bounded cleanup context after an aborted request. If
// deletion fails, keep the expired row so maintenance can retry the object.
func (s *Exports) Discard(ctx context.Context, row *Export) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(cleanup, "UPDATE sat_pdf_exports SET expires_at = UTC_TIMESTAMP(6) WHERE id = ?", row.ID); err != nil {
		return
	}
	if err := s.store.Delete(cleanup, row.ObjectKey); err != nil {
		return
	}
	_, _ = s.db.ExecContext(cleanup, "DELETE FROM sat_pdf_exports WHERE id = ? AND expires_at <= UTC_TIMESTAMP(6)", row.ID)
}

func (s *Exports) Cleanup(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, object_key FROM sat_pdf_exports WHERE expires_at <= UTC_TIMESTAMP(6) ORDER BY expires_at LIMIT ?", limit)
	if err != nil {
		return 0, err
	}
	var old []Export
	for rows.Next() {
		var row Export
		if err := rows.Scan(&row.ID, &row.ObjectKey); err != nil {
			rows.Close()
			return 0, err
		}
		old = append(old, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, row := range old {
		if err := s.store.Delete(ctx, row.ObjectKey); err != nil {
			return count, err
		}
		result, err := s.db.ExecContext(ctx, "DELETE FROM sat_pdf_exports WHERE id = ? AND expires_at <= UTC_TIMESTAMP(6)", row.ID)
		if err != nil {
			return count, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return count, err
		}
		count += int(n)
	}
	return count, nil
}
