// Package db owns connection-pool construction and session discipline.
// Every pooled connection runs in UTC (plan 53). Time comparisons that
// participate in lock ordering always read DB time inside the transaction.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	mysql "github.com/go-sql-driver/mysql"
)

// Role selects which side of the plan-B4.2 pool split a pool serves.
type Role string

const (
	// RoleAPI serves request-path services (larger share, e.g. 40).
	RoleAPI Role = "api"
	// RoleWorker serves background jobs (bounded share, e.g. 10).
	RoleWorker Role = "worker"
)

// Open creates the pool with bounded settings and UTC session init.
func Open(cfg config.Config) (*sql.DB, error) {
	return OpenRole(cfg, "")
}

// OpenRole opens a second pool from the same DSN sized for one role
// (plan B4.2): role api -> DBPoolMaxAPI, worker -> DBPoolMaxWorker,
// empty/unknown-role callers fall back to DBPoolMax. Config load already
// falls the split values back to the shared max, so an unset split is
// today's single-pool sizing on both sides. Rollback = drop the split.
func OpenRole(cfg config.Config, role Role) (*sql.DB, error) {
	max := cfg.DBPoolMax
	switch role {
	case RoleAPI:
		max = cfg.DBPoolMaxAPI
	case RoleWorker:
		max = cfg.DBPoolMaxWorker
	case "":
		// Legacy single-pool callers (migrate, seeds, tools).
	default:
		return nil, fmt.Errorf("unknown db role %q (want api|worker)", string(role))
	}
	pool, err := newPool(cfg.DatabaseURL, max, cfg.DBPoolMaxIdle)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pool.PingContext(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	// Session discipline: UTC on every connection checkout path is enforced
	// by running it once here and by migrations requiring TIMESTAMP(6) UTC.
	if _, err := pool.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		// Not fatal on pooled SESSION var setups that reset per checkout;
		// callers must still read UTC_TIMESTAMP(6) inside transactions.
		_ = err
	}
	return pool, nil
}

// NormalizeDSN applies the application's session discipline to a raw DSN so
// any pool opened with sql.Open agrees with the app's rendering of the same
// instant (loc=UTC + time_zone='+00:00' on every connection). Test harnesses
// that write clock fixtures need this: the schedule/runtime clock columns are
// MySQL TIMESTAMP, whose rendering depends on the session zone, so a pool left
// on the host's SYSTEM zone reads back an instant offset by the host offset -
// which turns a backdated fixture into a flaky comparison instead of a finding
// about the service under test.
func NormalizeDSN(raw string) (string, error) {
	return normalizeMySQLDSN(raw)
}

// ReportPoolStats maps one database/sql snapshot to the pool gauges with
// a role label (plan E3 dashboards + §7 baseline item 4: pool waits split
// API/worker). Callers pass pool.Stats() — zero new deps. Role values are
// the Role constants (api|worker); unknown roles pass through verbatim so
// single-pool callers stay queryable.
func ReportPoolStats(role Role, st sql.DBStats) {
	label := string(role)
	if label == "" {
		label = "single"
	}
	telemetry.SetGauge(telemetry.MPoolOpen, float64(st.OpenConnections), "role", label)
	telemetry.SetGauge(telemetry.MPoolInUse, float64(st.InUse), "role", label)
	telemetry.SetGauge(telemetry.MPoolWait, float64(st.WaitCount), "role", label)
}

// newPool builds an unconnected pool with bounded settings (sql.Open is
// lazy: no connection is attempted, so role sizing is assertable without
// a live DB). Callers ping + set UTC discipline explicitly (OpenRole).
func newPool(databaseURL string, maxOpen, maxIdle int) (*sql.DB, error) {
	dsn, err := normalizeMySQLDSN(databaseURL)
	if err != nil {
		return nil, err
	}
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(maxOpen)
	pool.SetMaxIdleConns(maxIdle)
	pool.SetConnMaxLifetime(25 * time.Minute)
	pool.SetConnMaxIdleTime(5 * time.Minute)
	return pool, nil
}

// normalizeMySQLDSN accepts both the native go-sql-driver DSN and the
// mysql:// URI form supplied by platforms such as Railway. The driver does
// not understand URI schemes, so normalize once at the connection boundary.
func normalizeMySQLDSN(raw string) (string, error) {
	dsn := strings.TrimSpace(raw)
	if dsn == "" {
		return dsn, nil
	}
	var config *mysql.Config
	if strings.Contains(dsn, "://") {
		u, err := url.Parse(dsn)
		if err != nil {
			return "", fmt.Errorf("invalid DATABASE_URL: %w", err)
		}
		if !strings.EqualFold(u.Scheme, "mysql") {
			return "", fmt.Errorf("unsupported DATABASE_URL scheme %q; expected mysql:// or a native MySQL DSN", u.Scheme)
		}
		if u.Hostname() == "" {
			return "", fmt.Errorf("invalid DATABASE_URL: host is required")
		}
		user := ""
		password := ""
		if u.User != nil {
			user = u.User.Username()
			if value, ok := u.User.Password(); ok {
				password = value
			}
		}
		port := u.Port()
		if port == "" {
			port = "3306"
		}
		dbName := strings.TrimPrefix(u.EscapedPath(), "/")
		if dbName == "" {
			return "", fmt.Errorf("invalid DATABASE_URL: database name is required")
		}
		dbName, err = url.PathUnescape(dbName)
		if err != nil {
			return "", fmt.Errorf("invalid DATABASE_URL database name: %w", err)
		}
		params, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return "", fmt.Errorf("invalid DATABASE_URL query: %w", err)
		}
		config = mysql.NewConfig()
		config.User = user
		config.Passwd = password
		config.Net = "tcp"
		config.Addr = net.JoinHostPort(u.Hostname(), port)
		config.DBName = dbName
		config.ParseTime = true
		config.Params = make(map[string]string, len(params))
		for key, values := range params {
			if key == "parseTime" || key == "loc" || key == "time_zone" {
				continue
			}
			if len(values) > 0 {
				config.Params[key] = values[0]
			}
		}
	} else {
		var err error
		config, err = mysql.ParseDSN(dsn)
		if err != nil {
			return "", fmt.Errorf("invalid DATABASE_URL: %w", err)
		}
	}

	// Application timestamps are UTC. `loc=UTC` makes time.Time values sent
	// through the driver and values scanned from TIMESTAMP columns agree, while
	// the generic DSN parameter applies SET time_zone on every new pooled
	// connection (setting it once after Ping is insufficient for a pool).
	// Use a distinct UTC location value so FormatDSN emits loc=UTC even on
	// hosts whose Go process-local location already happens to be UTC. parseTime is forced on: without it DATETIME arrives as bytes and time scans fail.
	config.ParseTime = true
	config.Loc = time.FixedZone("UTC", 0)
	if config.Params == nil {
		config.Params = map[string]string{}
	}
	config.Params["time_zone"] = "'+00:00'"
	return config.FormatDSN(), nil
}
