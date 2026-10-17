package answeredpdf

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/objectstore"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
)

func TestExportLookupBrowserBindingAndExpiry(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exports := NewExports(db, objectstore.NewLocalStore(t.TempDir()))
	for _, tc := range []struct {
		name, state string
		expired     bool
	}{{"ready", "ready", false}, {"expired", "ready", true}, {"preparing", "preparing", false}} {
		t.Run(tc.name, func(t *testing.T) {
			expiry := time.Now().Add(time.Minute)
			if tc.expired {
				expiry = time.Now().Add(-time.Minute)
			}
			mock.ExpectQuery("SELECT owner_kind").WithArgs("export", BrowserHash("browser")).WillReturnRows(sqlmock.NewRows([]string{"owner_kind", "owner_id", "attempt_id", "binding", "state", "object_key", "filename", "size_bytes", "expires_at"}).AddRow("student", "u", "a", `{}`, tc.state, "answered-pdf/export.pdf", "exam.pdf", 10, expiry))
			record, err := exports.Lookup(t.Context(), "export", BrowserHash("browser"))
			if tc.expired || tc.state != "ready" {
				if !errors.Is(err, ErrExportUnavailable) {
					t.Fatalf("got %v", err)
				}
			} else if err != nil || record.Filename != "exam.pdf" {
				t.Fatalf("got %+v %v", record, err)
			}
		})
	}
	mock.ExpectQuery("SELECT owner_kind").WithArgs("export", BrowserHash("wrong-browser")).WillReturnRows(sqlmock.NewRows([]string{"owner_kind"}))
	if _, err := exports.Lookup(t.Context(), "export", BrowserHash("wrong-browser")); !errors.Is(err, ErrExportUnavailable) {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportStreamsSameBytesAndRemainsReadable(t *testing.T) {
	store := objectstore.NewLocalStore(t.TempDir())
	exports := NewExports(nil, store)
	pdf := []byte("%PDF-1.7 complete exam")
	if err := store.Put(t.Context(), "answered-pdf/test.pdf", pdf, "application/pdf"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		body, err := exports.Open(t.Context(), "answered-pdf/test.pdf")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := body.Seek(5, io.SeekStart); err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(body)
		body.Close()
		if err != nil || !bytes.Equal(got, pdf[5:]) {
			t.Fatalf("bytes changed: %q %v", got, err)
		}
	}
}

func TestExportCleanupKeepsRowUntilObjectDeleted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := objectstore.NewLocalStore(t.TempDir())
	exports := NewExports(db, store)
	if err := store.Put(t.Context(), "answered-pdf/old.pdf", []byte("old"), "application/pdf"); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT id, object_key").WithArgs(10).WillReturnRows(sqlmock.NewRows([]string{"id", "object_key"}).AddRow("old", "answered-pdf/old.pdf"))
	mock.ExpectExec("DELETE FROM sat_pdf_exports").WithArgs("old").WillReturnResult(sqlmock.NewResult(0, 1))
	if n, err := exports.Cleanup(t.Context(), 10); err != nil || n != 1 {
		t.Fatalf("cleanup %d %v", n, err)
	}
	if err := store.Stat(t.Context(), "answered-pdf/old.pdf"); err == nil {
		t.Fatal("expired bytes retained")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportReserveSerializesAndReplaces(t *testing.T) {
	for _, state := range []string{"none", "ready", "preparing", "concurrent-first-use"} {
		t.Run(state, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			binding := Binding{Kind: "staff", OwnerID: "user", AttemptID: "attempt", SessionID: "session"}
			scope := BrowserHash("staff\x00user\x00attempt\x00session")
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			rows := sqlmock.NewRows([]string{"state"})
			if state == "ready" || state == "preparing" {
				rows.AddRow(state)
			}
			mock.ExpectQuery("SELECT id FROM student_attempts").WithArgs("attempt").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("attempt"))
			mock.ExpectQuery("SELECT state FROM sat_pdf_exports").WithArgs(scope).WillReturnRows(rows)
			if state == "preparing" {
				mock.ExpectRollback()
			} else {
				mock.ExpectExec("UPDATE sat_pdf_exports SET scope_key = NULL").WithArgs(scope).WillReturnResult(sqlmock.NewResult(0, 1))
				raw, _ := json.Marshal(binding)
				insert := mock.ExpectExec("INSERT INTO sat_pdf_exports").WithArgs(sqlmock.AnyArg(), scope, "staff", "user", "attempt", BrowserHash("cookie"), raw, sqlmock.AnyArg())
				if state == "concurrent-first-use" {
					insert.WillReturnError(&mysql.MySQLError{Number: 1062})
					mock.ExpectRollback()
				} else {
					insert.WillReturnResult(sqlmock.NewResult(0, 1))
					mock.ExpectCommit()
				}
			}
			row, err := NewExports(db, objectstore.NewLocalStore(t.TempDir())).Reserve(t.Context(), binding, BrowserHash("cookie"))
			if state == "preparing" || state == "concurrent-first-use" {
				if !errors.Is(err, ErrBusy) || row != nil {
					t.Fatalf("got %+v %v", row, err)
				}
			} else if err != nil || len(row.ID) != 32 || row.ObjectKey != "answered-pdf/"+row.ID+".pdf" {
				t.Fatalf("got %+v %v", row, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

type exportStoreFailure struct {
	objectstore.Store
	putErr, deleteErr error
}

func (s exportStoreFailure) Put(ctx context.Context, key string, data []byte, kind string) error {
	if s.putErr != nil {
		return s.putErr
	}
	return s.Store.Put(ctx, key, data, kind)
}
func (s exportStoreFailure) Delete(ctx context.Context, key string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.Store.Delete(ctx, key)
}

type futureExpiry struct{ minimum, maximum time.Time }

func (v futureExpiry) Match(value driver.Value) bool {
	expiry, ok := value.(time.Time)
	return ok && !expiry.Before(v.minimum) && !expiry.After(v.maximum)
}

func TestExportPublishCompleteOrUnavailable(t *testing.T) {
	for _, scenario := range []string{"ready", "token-expiry", "cancelled", "storage-failure", "db-failure", "superseded"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			store := objectstore.NewLocalStore(t.TempDir())
			wrapper := exportStoreFailure{Store: store}
			if scenario == "storage-failure" {
				wrapper.putErr = errors.New("storage unavailable")
			}
			exports := NewExports(db, wrapper)
			row := &Export{ID: "export", ObjectKey: "answered-pdf/export.pdf"}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			limit := time.Time{}
			expectedExpiry := futureExpiry{time.Now().Add(ExportTTL - time.Second), time.Now().Add(ExportTTL + time.Second)}
			if scenario == "token-expiry" {
				limit = time.Now().Add(time.Minute)
				expectedExpiry = futureExpiry{limit, limit}
			}
			if scenario == "cancelled" {
				cancel()
			}
			if scenario != "cancelled" && scenario != "storage-failure" {
				update := mock.ExpectExec("UPDATE sat_pdf_exports SET state = 'ready'").WithArgs("exam.pdf", len("complete-pdf"), expectedExpiry, "export")
				switch scenario {
				case "db-failure":
					update.WillReturnError(errors.New("DB offline"))
				case "superseded":
					update.WillReturnResult(sqlmock.NewResult(0, 0))
				default:
					update.WillReturnResult(sqlmock.NewResult(0, 1))
				}
			}
			prepared, err := exports.Publish(ctx, row, []byte("complete-pdf"), "exam.pdf", limit)
			success := scenario == "ready" || scenario == "token-expiry"
			if success {
				if err != nil || prepared.SizeBytes != 12 || prepared.Filename != "exam.pdf" || prepared.DownloadURL != "/api/v1/sat-answered-pdf/downloads/export" {
					t.Fatalf("got %+v %v", prepared, err)
				}
			} else if err == nil || prepared.DownloadURL != "" {
				t.Fatalf("failed export published %+v %v", prepared, err)
			}
			if scenario == "cancelled" || scenario == "storage-failure" {
				if store.Stat(t.Context(), row.ObjectKey) == nil {
					t.Fatal("cancelled/failed write published bytes")
				}
			} else {
				data, err := store.Get(t.Context(), row.ObjectKey)
				if err != nil || string(data) != "complete-pdf" {
					t.Fatalf("partial bytes %q %v", data, err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestExportDiscardAfterCancellationAndRetryFailedCleanup(t *testing.T) {
	for _, fail := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		store := objectstore.NewLocalStore(t.TempDir())
		row := &Export{ID: "old", ObjectKey: "answered-pdf/old.pdf"}
		if err := store.Put(t.Context(), row.ObjectKey, []byte("complete"), "application/pdf"); err != nil {
			t.Fatal(err)
		}
		wrapper := exportStoreFailure{Store: store}
		if fail {
			wrapper.deleteErr = errors.New("temporary delete failure")
		}
		mock.ExpectExec("UPDATE sat_pdf_exports SET expires_at").WithArgs("old").WillReturnResult(sqlmock.NewResult(0, 1))
		if !fail {
			mock.ExpectExec("DELETE FROM sat_pdf_exports").WithArgs("old").WillReturnResult(sqlmock.NewResult(0, 1))
		}
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		NewExports(db, wrapper).Discard(ctx, row)
		if fail {
			mock.ExpectQuery("SELECT id, object_key").WithArgs(10).WillReturnRows(sqlmock.NewRows([]string{"id", "object_key"}).AddRow("old", row.ObjectKey))
			mock.ExpectExec("DELETE FROM sat_pdf_exports").WithArgs("old").WillReturnResult(sqlmock.NewResult(0, 1))
			if n, err := NewExports(db, store).Cleanup(t.Context(), 10); err != nil || n != 1 {
				t.Fatalf("retry %d %v", n, err)
			}
		}
		if err := store.Stat(t.Context(), row.ObjectKey); err == nil {
			t.Fatal("abandoned bytes retained")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
