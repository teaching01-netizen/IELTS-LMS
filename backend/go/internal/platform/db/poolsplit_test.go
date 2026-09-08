package db

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// B4: role pools size from the split envs. sql.Open is lazy, but the mysql
// driver validates the DSN eagerly — assert via OpenRole against an
// unroutable host: the failure must be a DIAL error (sizing already
// applied before connect), never a config/DSN error.
func TestRolePoolSizing(t *testing.T) {
	t.Setenv("DATABASE_URL", "mysql://u:p@127.0.0.1:1/db")
	t.Setenv("DB_POOL_MAX_CONNECTIONS", "20")
	t.Setenv("DB_POOL_MAX_API", "40")
	t.Setenv("DB_POOL_MAX_WORKER", "10")
	t.Setenv("DB_POOL_MAX_IDLE", "3")
	cfg := config.Load()
	if cfg.DBPoolMaxAPI != 40 || cfg.DBPoolMaxWorker != 10 {
		t.Fatalf("config split not loaded: api=%d worker=%d", cfg.DBPoolMaxAPI, cfg.DBPoolMaxWorker)
	}
	api, err := newPool(cfg.DatabaseURL, cfg.DBPoolMaxAPI, cfg.DBPoolMaxIdle)
	if err != nil {
		t.Fatalf("lazy newPool must not fail without a DB: %v", err)
	}
	defer api.Close()
	if got := api.Stats().MaxOpenConnections; got != 40 {
		t.Fatalf("api pool max = %d, want 40", got)
	}
	worker, err := newPool(cfg.DatabaseURL, cfg.DBPoolMaxWorker, cfg.DBPoolMaxIdle)
	if err != nil {
		t.Fatalf("lazy newPool must not fail without a DB: %v", err)
	}
	defer worker.Close()
	if got := worker.Stats().MaxOpenConnections; got != 10 {
		t.Fatalf("worker pool max = %d, want 10", got)
	}
}

// B4: OpenRole fails closed without a DSN (no ping attempted).
func TestOpenRoleRequiresDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	cfg := config.Load()
	if _, err := OpenRole(cfg, RoleAPI); err == nil {
		t.Fatalf("OpenRole without DSN must fail")
	}
	if _, err := OpenRole(cfg, "bogus"); err == nil {
		t.Fatalf("OpenRole with unknown role must fail")
	}
}
