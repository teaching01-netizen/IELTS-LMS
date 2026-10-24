package main

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"math/rand"
	"regexp"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

var (
	v2AckBatchSQL  = regexp.QuoteMeta("FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id IN (")
	v2AckSingleSQL = regexp.QuoteMeta("FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id = ?")
	v2AckCols      = []string{"client_write_id", "question_id", "client_version", "outcome", "server_revision", "response_hash", "canonical_response"}
)

const v2AckRaw = `{"answer":"A","markedForReview":false}`

func v2AckIDs(n int) []string {
	ids := make([]string, n)
	for i := range ids {
		ids[i] = fmt.Sprintf("w-%03d", i)
	}
	return ids
}

func v2AckArgs(ids []string) []driver.Value {
	args := []driver.Value{"att-1"}
	for _, id := range ids {
		args = append(args, id)
	}
	return args
}

// v2AckRows returns ledger rows for ids in a shuffled order: the helper must
// not depend on the order MySQL returns them in.
func v2AckRows(ids []string) *sqlmock.Rows {
	rows := sqlmock.NewRows(v2AckCols)
	shuffled := append([]string(nil), ids...)
	rand.New(rand.NewSource(7)).Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
	for _, id := range shuffled {
		rows.AddRow(id, "q-"+id, uint64(3), "applied", uint64(10), "h-"+id, v2AckRaw)
	}
	return rows
}

func assertV2AckOrder(t *testing.T, acks []attempts.Ack, want []string) {
	t.Helper()
	if len(acks) != len(want) {
		t.Fatalf("got %d acks, want %d", len(acks), len(want))
	}
	for i, ack := range acks {
		if ack.WriteID != want[i] || ack.QuestionID != "q-"+want[i] || ack.ContentHash != "h-"+want[i] {
			t.Fatalf("ack %d = %+v, want write %s", i, ack, want[i])
		}
		if ack.CanonicalResponse.EliminatedOptions == nil || ack.CanonicalResponse.Annotations == nil {
			t.Fatalf("ack %d must normalize nil slices to []: %+v", i, ack.CanonicalResponse)
		}
		if ack.CanonicalResponse.Answer != "A" {
			t.Fatalf("ack %d canonical answer = %v", i, ack.CanonicalResponse.Answer)
		}
	}
}

// 0, 1 and 100 final commands read 0, 1 and 1 acknowledgement statements,
// and the acks come back in command order whatever the row order.
func TestLoadV2AcknowledgementsBatchesReads(t *testing.T) {
	for _, n := range []int{0, 1, attempts.MaxBatchCommands} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			ids := v2AckIDs(n)
			if n > 0 {
				mock.ExpectQuery(v2AckBatchSQL).WithArgs(v2AckArgs(ids)...).WillReturnRows(v2AckRows(ids))
			}
			acks, err := loadV2Acknowledgements(context.Background(), db, "att-1", ids)
			if err != nil {
				t.Fatal(err)
			}
			if acks == nil {
				t.Fatal("acks must be a non-nil slice")
			}
			assertV2AckOrder(t, acks, ids)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Internal callers may pass more ids than a submit allows, or repeats: reads
// are chunked at MaxBatchCommands distinct ids and repeats keep their slots.
func TestLoadV2AcknowledgementsChunksAndRepeats(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ids := v2AckIDs(attempts.MaxBatchCommands + 1)
	mock.ExpectQuery(v2AckBatchSQL).WithArgs(v2AckArgs(ids[:attempts.MaxBatchCommands])...).WillReturnRows(v2AckRows(ids[:attempts.MaxBatchCommands]))
	mock.ExpectQuery(v2AckBatchSQL).WithArgs(v2AckArgs(ids[attempts.MaxBatchCommands:])...).WillReturnRows(v2AckRows(ids[attempts.MaxBatchCommands:]))
	request := append(append([]string(nil), ids...), ids[0])
	acks, err := loadV2Acknowledgements(context.Background(), db, "att-1", request)
	if err != nil {
		t.Fatal(err)
	}
	assertV2AckOrder(t, acks, request)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A requested id with no byte-equal row keeps the old single-id lookup:
// missing ids are skipped, and a collation-equal stored id (utf8mb4_unicode_ci)
// is returned with its stored spelling, exactly as the per-id loop did.
func TestLoadV2AcknowledgementsMissingAndCollationEqualIDs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	request := []string{"w-a", "w-missing", "W-B"}
	mock.ExpectQuery(v2AckBatchSQL).WithArgs(v2AckArgs(request)...).WillReturnRows(v2AckRows([]string{"w-b", "w-a"}))
	mock.ExpectQuery(v2AckSingleSQL).WithArgs("att-1", "w-missing").WillReturnRows(sqlmock.NewRows(v2AckCols))
	mock.ExpectQuery(v2AckSingleSQL).WithArgs("att-1", "W-B").WillReturnRows(v2AckRows([]string{"w-b"}))
	acks, err := loadV2Acknowledgements(context.Background(), db, "att-1", request)
	if err != nil {
		t.Fatal(err)
	}
	assertV2AckOrder(t, acks, []string{"w-a", "w-b"})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadV2AcknowledgementsErrors(t *testing.T) {
	t.Run("invalid stored json", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(v2AckBatchSQL).WillReturnRows(sqlmock.NewRows(v2AckCols).AddRow("w-1", "q-1", uint64(1), "applied", uint64(2), "h", "{not json"))
		if _, err := loadV2Acknowledgements(context.Background(), db, "att-1", []string{"w-1"}); err == nil {
			t.Fatal("a corrupt stored ack must fail the response")
		}
	})
	t.Run("query error", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		boom := errors.New("boom")
		mock.ExpectQuery(v2AckBatchSQL).WillReturnError(boom)
		if _, err := loadV2Acknowledgements(context.Background(), db, "att-1", []string{"w-1"}); !errors.Is(err, boom) {
			t.Fatalf("want query error, got %v", err)
		}
	})
	t.Run("row iteration error", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		boom := errors.New("connection lost")
		mock.ExpectQuery(v2AckBatchSQL).WillReturnRows(v2AckRows([]string{"w-1"}).RowError(0, boom))
		if _, err := loadV2Acknowledgements(context.Background(), db, "att-1", []string{"w-1"}); !errors.Is(err, boom) {
			t.Fatalf("want row error, got %v", err)
		}
	})
	t.Run("cancelled", func(t *testing.T) {
		db, _, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := loadV2Acknowledgements(ctx, db, "att-1", []string{"w-1"}); !errors.Is(err, context.Canceled) {
			t.Fatalf("want context.Canceled, got %v", err)
		}
	})
}
