package db

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
)

// bindingModePool opens the production pool shape over TEST_MYSQL_DSN with
// the driver's binary protocol (server-side prepare per parameterized call)
// or client-side interpolation.
func bindingModePool(t *testing.T, interpolate bool) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	if interpolate {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn += sep + "interpolateParams=true"
	}
	pool, err := OpenRole(config.Config{DatabaseURL: dsn, DBPoolMaxAPI: 2, DBPoolMaxIdle: 2}, RoleAPI)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

type bindingRow struct {
	Text     string
	Blob     []byte
	JSON     string
	Unsigned uint64
	Signed   int64
	At       time.Time
}

func bindingCases() []bindingRow {
	at := time.Date(2026, 10, 23, 8, 0, 0, 123456000, time.UTC)
	return []bindingRow{
		{Text: `it's "quoted" \ back\\slash`, Blob: []byte("a\x00b'\\\""), JSON: `{"answer":"O'Brien \\ \"x\"","notes":["\u0000"]}`, Unsigned: math.MaxUint64, Signed: math.MinInt64, At: at},
		{Text: "emoji 😀 ไทย ✓ %_", Blob: []byte{0, 0xff, 0x27, 0x5c}, JSON: `{"answer":"😀 ไทย"}`, Unsigned: 0, Signed: math.MaxInt64, At: at.Add(-time.Hour)},
		{Text: strings.Repeat("x'\\", 1<<18), Blob: []byte(strings.Repeat("\x00'", 1<<19)), JSON: `{"answer":"` + strings.Repeat("y", 1<<20) + `"}`, Unsigned: 1, Signed: -1, At: time.Date(1970, 1, 1, 0, 0, 1, 0, time.UTC)},
	}
}

// roundTrip writes each case and reads it back on one connection (the
// temporary table is connection-scoped).
func roundTrip(t *testing.T, ctx context.Context, conn *sql.Conn) []bindingRow {
	t.Helper()
	if _, err := conn.ExecContext(ctx, `CREATE TEMPORARY TABLE binding_roundtrip (
		id INT PRIMARY KEY, txt LONGTEXT CHARACTER SET utf8mb4, blb LONGBLOB, doc JSON,
		u BIGINT UNSIGNED, s BIGINT, at TIMESTAMP(6) NULL)`); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, `DROP TEMPORARY TABLE binding_roundtrip`)
	var out []bindingRow
	for i, c := range bindingCases() {
		if _, err := conn.ExecContext(ctx, `INSERT INTO binding_roundtrip (id, txt, blb, doc, u, s, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			i, c.Text, c.Blob, c.JSON, c.Unsigned, c.Signed, c.At); err != nil {
			t.Fatalf("insert case %d: %v", i, err)
		}
		var r bindingRow
		if err := conn.QueryRowContext(ctx, `SELECT txt, blb, CAST(doc AS CHAR), u, s, at FROM binding_roundtrip WHERE id = ? AND txt = ? AND blb = ?`, i, c.Text, c.Blob).
			Scan(&r.Text, &r.Blob, &r.JSON, &r.Unsigned, &r.Signed, &r.At); err != nil {
			t.Fatalf("read case %d back by its own values: %v", i, err)
		}
		if r.Text != c.Text || !reflect.DeepEqual(r.Blob, c.Blob) || r.Unsigned != c.Unsigned || r.Signed != c.Signed || !r.At.Equal(c.At) {
			t.Fatalf("case %d changed in transit", i)
		}
		out = append(out, r)
	}
	return out
}

func TestDriverBindingModesRoundTripMySQL(t *testing.T) {
	ctx := context.Background()
	var results [2][]bindingRow
	for i, interpolate := range []bool{false, true} {
		pool := bindingModePool(t, interpolate)
		conn, err := pool.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var charset, collation string
		if err := conn.QueryRowContext(ctx, `SELECT @@character_set_connection, @@collation_connection`).Scan(&charset, &collation); err != nil {
			t.Fatal(err)
		}
		if charset != "utf8mb4" {
			t.Fatalf("connection charset %s/%s: client-side interpolation is only safe for utf8mb4 here", charset, collation)
		}
		results[i] = roundTrip(t, ctx, conn)
		// The driver escapes for the server's NO_BACKSLASH_ESCAPES status
		// flag; quotes and backslashes must survive with the mode on too.
		if _, err := conn.ExecContext(ctx, `SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')`); err != nil {
			t.Fatal(err)
		}
		if again := roundTrip(t, ctx, conn); !reflect.DeepEqual(again, results[i]) {
			t.Fatalf("interpolate=%v: NO_BACKSLASH_ESCAPES changed stored values", interpolate)
		}
		conn.Close()

		// Cancellation releases the caller promptly in both modes, and the
		// pool keeps serving.
		cctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
		started := time.Now()
		var slept int
		err = pool.QueryRowContext(cctx, `SELECT SLEEP(?)`, 5).Scan(&slept)
		cancel()
		if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 2*time.Second {
			t.Fatalf("interpolate=%v: cancelled query returned %v after %s", interpolate, err, time.Since(started))
		}
		var one int
		if err := pool.QueryRowContext(ctx, `SELECT ?`, 1).Scan(&one); err != nil || one != 1 {
			t.Fatalf("interpolate=%v: pool unusable after cancellation: %v", interpolate, err)
		}
	}
	if !reflect.DeepEqual(results[0], results[1]) {
		t.Fatal("binary protocol and client-side interpolation stored different values")
	}
}

// BenchmarkDriverBindingModesMySQL compares one primary-key SELECT per call
// under the binary protocol (prepare + execute + close per call) and
// client-side interpolation (one text query). Local results understate the
// difference at a real network RTT: qualify at the deployment RTT.
func BenchmarkDriverBindingModesMySQL(b *testing.B) {
	for _, mode := range []struct {
		name        string
		interpolate bool
	}{{"binary", false}, {"interpolated", true}} {
		b.Run(mode.name, func(b *testing.B) {
			dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
			if dsn == "" {
				b.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
			}
			if mode.interpolate {
				sep := "?"
				if strings.Contains(dsn, "?") {
					sep = "&"
				}
				dsn += sep + "interpolateParams=true"
			}
			pool, err := OpenRole(config.Config{DatabaseURL: dsn, DBPoolMaxAPI: 8, DBPoolMaxIdle: 8}, RoleAPI)
			if err != nil {
				b.Fatal(err)
			}
			defer pool.Close()
			ctx := context.Background()
			b.ReportAllocs()
			b.RunParallel(func(pb *testing.PB) {
				var filename string
				for pb.Next() {
					if err := pool.QueryRowContext(ctx, `SELECT filename FROM schema_migrations WHERE filename = ?`, "0001_init.sql").Scan(&filename); err != nil && err != sql.ErrNoRows {
						b.Error(err)
						return
					}
				}
			})
		})
	}
}
