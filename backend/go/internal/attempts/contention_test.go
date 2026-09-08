package attempts

// Plan E3: 500-way same-attempt save contention must produce zero
// deadlocks. The V2 write path serializes on the locked attempt row +
// per-question rows under READ COMMITTED (plan B1); concurrent batches for
// DIFFERENT questions on the same attempt must all commit (no lock-order
// inversion, no gap-lock pileup). This test drives 500 parallel
// SaveResponses through sqlmock: each worker gets an independent mock DB
// (no shared mock mutex), so what is proven is decision-safety under
// parallelism — every batch accepted or exact-replayed, none erroring.
// Real InnoDB row contention stays in the k6 wave (2_contend.js asserts
// zero 500s / zero deadlock codes at the HTTP layer).
import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestConcurrentDistinctQuestionsAllAccepted(t *testing.T) {
	const workers = 500
	secret := []byte("test-secret-32-bytes-long--------")

	var accepted, replayed, failed int64
	var wg sync.WaitGroup
	errs := make(chan error, workers)

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			db, mock, err := sqlmock.New()
			if err != nil {
				errs <- err
				return
			}
			defer db.Close()
			svc := testService(db, secret)
			bearer := mintToken(t, secret, baseClaims())

			qid := fmt.Sprintf("q-%d", w)
			wid := fmt.Sprintf("w-%d", w)
			saveHappyStubs(mock)
			mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
				WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
			mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
			saveTailCommit(mock)

			cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
				Commands: []ResponseCommand{{WriteID: wid, QuestionID: qid, ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
			qr, rl := liveStubs()
			res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
			if err != nil {
				atomic.AddInt64(&failed, 1)
				errs <- fmt.Errorf("worker %d: %v", w, err)
				return
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				atomic.AddInt64(&failed, 1)
				errs <- fmt.Errorf("worker %d expectations: %v", w, err)
				return
			}
			if res.Replayed {
				atomic.AddInt64(&replayed, 1)
			} else {
				atomic.AddInt64(&accepted, 1)
			}
		}(w)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if got := atomic.LoadInt64(&failed); got != 0 {
		t.Fatalf("500-way contention: %d batches failed (want 0)", got)
	}
	if got := atomic.LoadInt64(&accepted) + atomic.LoadInt64(&replayed); got != workers {
		t.Fatalf("500-way contention: %d outcomes (want %d)", got, workers)
	}
	t.Logf("500-way contention: accepted=%d replayed=%d failed=0", accepted, replayed)
	var _ = sql.ErrNoRows
}
