package db

import (
	"context"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestMeasuredConnectionReportsBoundedQueryMetrics(t *testing.T) {
	registry := telemetry.NewRegistry()
	previous := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = registry
	defer func() { telemetry.DefaultRegistry = previous }()

	testConn := &measuredTestConn{}
	conn := &measuredConn{Conn: testConn}
	if _, err := conn.ExecContext(context.Background(), "UPDATE answers SET body='secret'", nil); err != nil {
		t.Fatal(err)
	}
	rows, err := conn.QueryContext(context.Background(), "SELECT secret FROM answers", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := rows.Next(make([]driver.Value, 1)); err != io.EOF {
		t.Fatalf("query rows Next() = %v, want EOF", err)
	}
	testConn.skipQuery = true
	if _, err := conn.QueryContext(context.Background(), "SELECT secret FROM answers WHERE id=?", []driver.NamedValue{{Ordinal: 1, Value: int64(1)}}); err != driver.ErrSkip {
		t.Fatalf("query fallback signal = %v, want driver.ErrSkip", err)
	}
	testConn.skipQuery = false
	stmt, err := conn.PrepareContext(context.Background(), "UPDATE answers SET body=?")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stmt.(driver.StmtExecContext).ExecContext(context.Background(), []driver.NamedValue{{Ordinal: 1, Value: "secret"}}); err != nil {
		t.Fatal(err)
	}

	snapshot := registry.Snapshot()
	for _, expected := range []string{
		`db_query_duration_seconds_count{operation="exec",outcome="success"} 2`,
		`db_query_duration_seconds_count{operation="prepare",outcome="success"} 1`,
		`db_query_duration_seconds_count{operation="query",outcome="success"} 1`,
	} {
		if !strings.Contains(snapshot, expected) {
			t.Errorf("missing %q in metrics:\n%s", expected, snapshot)
		}
	}
	if strings.Contains(snapshot, "secret") || strings.Contains(snapshot, "answers") {
		t.Errorf("SQL text leaked into metric labels:\n%s", snapshot)
	}
}

type measuredTestConn struct{ skipQuery bool }

func (*measuredTestConn) Prepare(string) (driver.Stmt, error) { return measuredTestStmt{}, nil }
func (*measuredTestConn) Close() error                        { return nil }
func (*measuredTestConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (*measuredTestConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (c *measuredTestConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if c.skipQuery {
		return nil, driver.ErrSkip
	}
	return measuredTestRows{}, nil
}

type measuredTestStmt struct{}

func (measuredTestStmt) Close() error  { return nil }
func (measuredTestStmt) NumInput() int { return -1 }
func (measuredTestStmt) Exec([]driver.Value) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (measuredTestStmt) Query([]driver.Value) (driver.Rows, error) {
	return measuredTestRows{}, nil
}

type measuredTestRows struct{}

func (measuredTestRows) Columns() []string         { return []string{"answer"} }
func (measuredTestRows) Close() error              { return nil }
func (measuredTestRows) Next([]driver.Value) error { return io.EOF }
