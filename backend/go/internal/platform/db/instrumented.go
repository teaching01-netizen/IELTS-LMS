package db

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/go-sql-driver/mysql"
)

// measuredConnector wraps the shared MySQL pool boundary so direct and
// prepared query executions are measured consistently. Labels are fixed
// operation/outcome vocabularies; SQL text and request identifiers never
// enter metric series.
type measuredConnector struct{ inner driver.Connector }

func (c *measuredConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.inner.Connect(ctx)
	if err != nil {
		return nil, mapConnectionError(err)
	}
	return &measuredConn{Conn: conn}, nil
}

// mapConnectionError exposes MySQL's connection-capacity rejection as a
// retryable service error. Mapping at the connector covers direct queries and
// transactions before either can leak a raw driver error as HTTP 500.
func mapConnectionError(err error) error {
	var dbErr *mysql.MySQLError
	if !errors.As(err, &dbErr) || dbErr.Number != 1040 {
		return err
	}
	appErr := apperrors.New(apperrors.CodeServiceUnavailable, "The database is temporarily overloaded. Retry shortly.")
	appErr.Retryable = true
	return appErr
}

func (c *measuredConnector) Driver() driver.Driver { return utcDriver{c.inner.Driver()} }

// utcDriver marks pools whose DSN applies time_zone='+00:00' on every new
// physical connection, so transactions skip a per-request session statement.
type utcDriver struct{ driver.Driver }

func (utcDriver) SessionUTC() {}

var _ tx.SessionUTCDriver = utcDriver{}

type measuredConn struct{ driver.Conn }

func (c *measuredConn) Prepare(query string) (driver.Stmt, error) {
	started := time.Now()
	stmt, err := c.Conn.Prepare(query)
	observeQuery("prepare", started, err)
	if err != nil {
		return nil, err
	}
	return &measuredStmt{Stmt: stmt}, nil
}

func (c *measuredConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	started := time.Now()
	var (
		stmt driver.Stmt
		err  error
	)
	if preparer, ok := c.Conn.(driver.ConnPrepareContext); ok {
		stmt, err = preparer.PrepareContext(ctx, query)
	} else {
		stmt, err = c.Conn.Prepare(query)
	}
	if err != driver.ErrSkip {
		observeQuery("prepare", started, err)
	}
	if err != nil {
		return nil, err
	}
	return &measuredStmt{Stmt: stmt}, nil
}

func (c *measuredConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	beginner, ok := c.Conn.(driver.ConnBeginTx)
	if !ok {
		return nil, driver.ErrSkip
	}
	return beginner.BeginTx(ctx, opts)
}

func (c *measuredConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	execer, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	started := time.Now()
	result, err := execer.ExecContext(ctx, query, args)
	if err != driver.ErrSkip {
		observeQuery("exec", started, err)
	}
	return result, err
}

func (c *measuredConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	queryer, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	started := time.Now()
	rows, err := queryer.QueryContext(ctx, query, args)
	if err != driver.ErrSkip && (err != nil || rows == nil) {
		observeQuery("query", started, err)
	} else if err == nil {
		rows = &measuredRows{Rows: rows, startedAt: started}
	}
	return rows, err
}

func (c *measuredConn) Ping(ctx context.Context) error {
	pinger, ok := c.Conn.(driver.Pinger)
	if !ok {
		return driver.ErrSkip
	}
	return pinger.Ping(ctx)
}

func (c *measuredConn) ResetSession(ctx context.Context) error {
	resetter, ok := c.Conn.(driver.SessionResetter)
	if !ok {
		return driver.ErrSkip
	}
	return resetter.ResetSession(ctx)
}

func (c *measuredConn) IsValid() bool {
	validator, ok := c.Conn.(driver.Validator)
	return !ok || validator.IsValid()
}

func (c *measuredConn) CheckNamedValue(value *driver.NamedValue) error {
	checker, ok := c.Conn.(driver.NamedValueChecker)
	if !ok {
		return driver.ErrSkip
	}
	return checker.CheckNamedValue(value)
}

type measuredStmt struct{ driver.Stmt }

func (s *measuredStmt) Exec(args []driver.Value) (driver.Result, error) {
	started := time.Now()
	result, err := s.Stmt.Exec(args)
	if err != driver.ErrSkip {
		observeQuery("exec", started, err)
	}
	return result, err
}

func (s *measuredStmt) Query(args []driver.Value) (driver.Rows, error) {
	started := time.Now()
	rows, err := s.Stmt.Query(args)
	if err != driver.ErrSkip && (err != nil || rows == nil) {
		observeQuery("query", started, err)
	} else if err == nil {
		rows = &measuredRows{Rows: rows, startedAt: started}
	}
	return rows, err
}

func (s *measuredStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	started := time.Now()
	var (
		result driver.Result
		err    error
	)
	if execer, ok := s.Stmt.(driver.StmtExecContext); ok {
		result, err = execer.ExecContext(ctx, args)
	} else {
		var values []driver.Value
		values, err = namedValues(args)
		if err == nil {
			result, err = s.Stmt.Exec(values)
		}
	}
	if err != driver.ErrSkip {
		observeQuery("exec", started, err)
	}
	return result, err
}

func (s *measuredStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	started := time.Now()
	var (
		rows driver.Rows
		err  error
	)
	if queryer, ok := s.Stmt.(driver.StmtQueryContext); ok {
		rows, err = queryer.QueryContext(ctx, args)
	} else {
		var values []driver.Value
		values, err = namedValues(args)
		if err == nil {
			rows, err = s.Stmt.Query(values)
		}
	}
	if err != driver.ErrSkip && (err != nil || rows == nil) {
		observeQuery("query", started, err)
	} else if err == nil {
		rows = &measuredRows{Rows: rows, startedAt: started}
	}
	return rows, err
}

func namedValues(args []driver.NamedValue) ([]driver.Value, error) {
	values := make([]driver.Value, len(args))
	for i := range args {
		if args[i].Name != "" {
			return nil, fmt.Errorf("driver statement does not support named parameters")
		}
		value, err := driver.DefaultParameterConverter.ConvertValue(args[i].Value)
		if err != nil {
			return nil, err
		}
		values[i] = value
	}
	return values, nil
}

// measuredRows includes result streaming and early-close draining in query
// duration. It forwards the optional row metadata interfaces implemented by
// the MySQL driver, preserving database/sql ColumnTypes and multi-result use.
type measuredRows struct {
	driver.Rows
	startedAt time.Time
	once      sync.Once
}

func (r *measuredRows) Next(dest []driver.Value) error {
	err := r.Rows.Next(dest)
	if err != nil && (err != io.EOF || !r.HasNextResultSet()) {
		r.finish(err)
	}
	return err
}

func (r *measuredRows) Close() error {
	err := r.Rows.Close()
	r.finish(err)
	return err
}

func (r *measuredRows) HasNextResultSet() bool {
	next, ok := r.Rows.(driver.RowsNextResultSet)
	return ok && next.HasNextResultSet()
}

func (r *measuredRows) NextResultSet() error {
	next, ok := r.Rows.(driver.RowsNextResultSet)
	if !ok {
		r.finish(io.EOF)
		return io.EOF
	}
	err := next.NextResultSet()
	if err != nil {
		r.finish(err)
	}
	return err
}

func (r *measuredRows) ColumnTypeDatabaseTypeName(index int) string {
	columnType, ok := r.Rows.(driver.RowsColumnTypeDatabaseTypeName)
	if !ok {
		return ""
	}
	return columnType.ColumnTypeDatabaseTypeName(index)
}

func (r *measuredRows) ColumnTypeNullable(index int) (nullable, ok bool) {
	columnType, supported := r.Rows.(driver.RowsColumnTypeNullable)
	if !supported {
		return false, false
	}
	return columnType.ColumnTypeNullable(index)
}

func (r *measuredRows) ColumnTypePrecisionScale(index int) (precision, scale int64, ok bool) {
	columnType, supported := r.Rows.(driver.RowsColumnTypePrecisionScale)
	if !supported {
		return 0, 0, false
	}
	return columnType.ColumnTypePrecisionScale(index)
}

func (r *measuredRows) ColumnTypeScanType(index int) reflect.Type {
	columnType, ok := r.Rows.(driver.RowsColumnTypeScanType)
	if !ok {
		return nil
	}
	return columnType.ColumnTypeScanType(index)
}

func (r *measuredRows) finish(err error) {
	r.once.Do(func() { observeQuery("query", r.startedAt, err) })
}

func observeQuery(operation string, started time.Time, err error) {
	outcome := "success"
	if err != nil && err != io.EOF {
		outcome = "error"
	}
	telemetry.ObserveSeconds(telemetry.MQueryDur, time.Since(started).Seconds(), "operation", operation, "outcome", outcome)
}
