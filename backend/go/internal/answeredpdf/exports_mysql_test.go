package answeredpdf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/objectstore"
	"github.com/go-sql-driver/mysql"
)

// Uses its own scratch schema: never mutates the database named by the DSN.
func TestExportsMySQLConcurrentPreparationAndCleanup(t *testing.T) {
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires MySQL")
	}
	cfg, err := mysql.ParseDSN(raw)
	if err != nil {
		t.Fatal(err)
	}
	cfg.DBName = ""
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.MultiStatements = true
	admin, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	id, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	schema := "sat_pdf_test_" + id
	if _, err := admin.Exec("CREATE DATABASE " + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + schema)
	cfg.DBName = schema
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ddl, err := os.ReadFile("../../migrations/0092_sat_pdf_exports.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(ddl)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE student_attempts (id VARCHAR(36) PRIMARY KEY); INSERT INTO student_attempts (id) VALUES ('attempt')"); err != nil {
		t.Fatal(err)
	}
	store := objectstore.NewLocalStore(t.TempDir())
	exports := NewExports(db, store)
	binding := Binding{Kind: "staff", OwnerID: "owner", AttemptID: "attempt", SessionID: "browser"}
	// Exercise the missing-row race as well as replacement of a ready row.
	for round := range 20 {
		if round > 0 {
			if _, err := db.Exec("UPDATE sat_pdf_exports SET state='ready' WHERE scope_key IS NOT NULL"); err != nil {
				t.Fatal(err)
			}
		}
		const workers = 8
		start := make(chan struct{})
		out := make(chan *Export, workers)
		errs := make(chan error, workers)
		var wg sync.WaitGroup
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				row, err := exports.Reserve(t.Context(), binding, BrowserHash(fmt.Sprint(round)))
				if err != nil {
					errs <- err
				} else {
					out <- row
				}
			}()
		}
		close(start)
		wg.Wait()
		close(out)
		close(errs)
		var winner *Export
		success := 0
		for row := range out {
			success++
			winner = row
		}
		for err := range errs {
			if !errors.Is(err, ErrBusy) {
				t.Fatalf("round %d: non-busy concurrent error: %v", round, err)
			}
		}
		if success != 1 {
			t.Fatalf("round %d: %d simultaneous preparations, want exactly one", round, success)
		}
		if _, err := exports.Publish(t.Context(), winner, []byte("complete PDF"), "exam.pdf", time.Time{}); err != nil {
			t.Fatal(err)
		}
		current, err := exports.Lookup(t.Context(), winner.ID, BrowserHash(fmt.Sprint(round)))
		if err != nil || current.SizeBytes != 12 {
			t.Fatalf("published %+v %v", current, err)
		}
		if round > 0 {
			if _, err := exports.Cleanup(t.Context(), 100); err != nil {
				t.Fatal(err)
			}
		}
	}
	var currentCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM sat_pdf_exports").Scan(&currentCount); err != nil || currentCount != 1 {
		t.Fatalf("artifacts after cleanup %d %v", currentCount, err)
	}
	// Different browser sessions may prepare independently.
	binding.SessionID = "another-browser"
	row, err := exports.Reserve(t.Context(), binding, BrowserHash("another"))
	if err != nil {
		t.Fatal(err)
	}
	cancelCtx, cancel := context.WithCancel(t.Context())
	cancel()
	exports.Discard(cancelCtx, row)
	if _, err := exports.Lookup(t.Context(), row.ID, BrowserHash("another")); !errors.Is(err, ErrExportUnavailable) {
		t.Fatal(err)
	}
}
