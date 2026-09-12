// Command migrate applies backend/go/migrations/*.sql in lexical order
// against the schema_migrations(filename PK) history table.
//
// It mirrors backend/crates/infrastructure/src/migrations.rs:
//   - acquires GET_LOCK('ielts_backend_startup_migrations_lock', 300)
//   - creates schema_migrations when missing; legacy non-empty databases
//     without history are refused (fail closed) unless
//     MIGRATION_HISTORY_GUARD_MODE=warn
//   - splits each file into statements (quote/comment aware), executes
//     them one by one, records the filename
//   - verifies checksums when schema_migration_versions exists, else the
//     legacy schema_migrations table
//   - enforces the required-columns / required-indexes / mutation-guard
//     checks via platform/db before reporting success
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
)

const (
	lockName    = "ielts_backend_startup_migrations_lock"
	lockTimeout = 300
	roleFile    = "0001_roles.sql"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatalf("migrate: %v", err)
	}
}

func run(ctx context.Context) error {
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	validateOnly := fs.Bool("validate-only", false, "verify runtime schema and report pending migrations without applying")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return err
	}
	if !*validateOnly {
		switch strings.ToLower(strings.TrimSpace(os.Getenv("MIGRATE_VALIDATE_ONLY"))) {
		case "1", "true", "yes", "on":
			*validateOnly = true
		}
	}
	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}
	dir := migrationsDir()
	pool, err := db.Open(cfg)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer func() { _ = pool.Close() }()

	conn, err := pool.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire conn: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if err := acquireLock(ctx, conn); err != nil {
		return err
	}
	defer func() {
		if err := releaseLock(ctx, conn); err != nil {
			log.Printf("migrate: release lock: %v", err)
		}
	}()

	if *validateOnly {
		return runValidateOnly(ctx, pool, conn, dir)
	}
	if err := applyMigrations(ctx, conn, dir); err != nil {
		return err
	}
	if err := db.VerifyRuntimeSchema(ctx, pool); err != nil {
		return err
	}
	log.Printf("migrate: up to date (dir=%s)", dir)
	return nil
}

// validateOnly runs the same VerifyRuntimeSchema gate and reports pending
// migration files without applying anything. Exit 0 when clean (no pending
// files and schema gate passes); exit 1 with the drift listed otherwise.
func runValidateOnly(ctx context.Context, pool *sql.DB, conn *sql.Conn, dir string) error {
	if err := db.VerifyRuntimeSchema(ctx, pool); err != nil {
		return err
	}
	pending, err := pendingMigrations(ctx, conn, dir)
	if err != nil {
		return err
	}
	if len(pending) > 0 {
		return fmt.Errorf("pending migrations (%d): %s", len(pending), strings.Join(pending, ", "))
	}
	log.Printf("migrate: validate-only clean (dir=%s)", dir)
	return nil
}

// pendingMigrations lists migration files not yet recorded in
// schema_migrations (excluding the roles no-op, which is recorded without
// execution on the apply path).
func pendingMigrations(ctx context.Context, conn *sql.Conn, dir string) ([]string, error) {
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (filename varchar(255) primary key, applied_at timestamp not null default current_timestamp)`); err != nil {
		return nil, fmt.Errorf("ensure schema_migrations: %w", err)
	}
	files, err := loadMigrations(dir)
	if err != nil {
		return nil, err
	}
	var pending []string
	for _, f := range files {
		if f.name == roleFile {
			continue
		}
		applied, err := isApplied(ctx, conn, f.name)
		if err != nil {
			return nil, err
		}
		if !applied {
			pending = append(pending, f.name)
		}
	}
	return pending, nil
}

// migrationsDir resolves backend/go/migrations: MIGRATIONS_DIR wins,
// then a migrations dir next to the executable, then the repo-relative path.
// backend/go/migrations is the single canonical migration tree (0001..0052).
func migrationsDir() string {
	if v := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR")); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		if adj := filepath.Join(filepath.Dir(exe), "migrations"); dirExists(adj) {
			return adj
		}
	}
	if dirExists("migrations") {
		return "migrations"
	}
	return filepath.Join("backend", "go", "migrations")
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func acquireLock(ctx context.Context, conn *sql.Conn) error {
	ctx, cancel := context.WithTimeout(ctx, (lockTimeout+30)*time.Second)
	defer cancel()
	var state sql.NullInt64
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, ?)", lockName, lockTimeout).Scan(&state); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	switch {
	case state.Valid && state.Int64 == 1:
		return nil
	case state.Valid && state.Int64 == 0:
		return fmt.Errorf("timed out waiting for startup migration advisory lock")
	default:
		return fmt.Errorf("failed to acquire startup migration advisory lock")
	}
}

func releaseLock(ctx context.Context, conn *sql.Conn) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if _, err := conn.ExecContext(ctx, "SELECT RELEASE_LOCK(?)", lockName); err != nil {
		return fmt.Errorf("release migration lock: %w", err)
	}
	return nil
}

// applyMigrations creates history, backfills-guards, skips the roles no-op,
// applies pending files lexically, then verifies version checksums.
func applyMigrations(ctx context.Context, conn *sql.Conn, dir string) error {
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (filename varchar(255) primary key, applied_at timestamp not null default current_timestamp)`); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	if err := guardLegacyHistory(ctx, conn); err != nil {
		return err
	}
	tidb, err := databaseIsTiDB(ctx, conn)
	if err != nil {
		return fmt.Errorf("detect database engine: %w", err)
	}
	// WS-07: TiDB cannot run the 0056 receipt-immutability triggers, so it
	// must never serve production traffic (fail closed). MySQL 8.4 is the
	// supported production engine.
	if err := refuseTiDBProduction(tidb); err != nil {
		return err
	}
	if version, err := databaseVersion(ctx, conn); err != nil {
		return fmt.Errorf("detect database version: %w", err)
	} else if err := requireSupportedEngine(version); err != nil {
		return err
	}
	checksumGate := hasVersionsTable(ctx, conn)
	if !checksumGate {
		log.Printf("migrate: schema_migration_versions absent, using legacy schema_migrations history")
	}

	files, err := loadMigrations(dir)
	if err != nil {
		return err
	}
	// Role management is a no-op on MySQL (standard user management):
	// record 0001_roles.sql as applied without executing it.
	roleApplied, err := isApplied(ctx, conn, roleFile)
	if err != nil {
		return err
	}
	if !roleApplied {
		if err := recordMigration(ctx, conn, roleFile); err != nil {
			return err
		}
	}
	for _, f := range files {
		if f.name == roleFile {
			continue
		}
		applied, err := isApplied(ctx, conn, f.name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		log.Printf("migrate: applying %s", f.name)
		for _, stmt := range splitStatements(f.sql) {
			if strings.TrimSpace(stmt) == "" {
				continue
			}
			if tidb && isTriggerStatement(stmt) {
				log.Printf("migrate: skipping trigger statement in %s on TiDB", f.name)
				continue
			}
			if _, err := conn.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("apply %s: %w", f.name, err)
			}
		}
		if err := recordMigration(ctx, conn, f.name); err != nil {
			return err
		}
	}
	// Checksum verification runs synchronously and aborts startup on
	// mismatch: a deferred log-only check would let tampered migrations
	// slip through while reporting success.
	if checksumGate {
		if err := verifyChecksums(ctx, conn, dir); err != nil {
			return err
		}
	}
	return nil
}

// refuseTiDBProduction fails closed when the migrator runs against TiDB in
// production: WS-07 receipt immutability is enforced by MySQL triggers
// (0056_receipt_immutability.sql), which TiDB cannot run, so the
// application transaction paths alone cannot guarantee the invariant there.
// MySQL 8.4 is the supported production engine. Non-production TiDB stays
// allowed (dev/test), where the skipped-trigger posture is documented.
func refuseTiDBProduction(isTiDB bool) error {
	if !isTiDB {
		return nil
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	}
	if env == "production" || env == "prod" {
		return fmt.Errorf("refusing TiDB in production: receipt immutability requires MySQL 8.4 triggers (0056); migrate to MySQL 8.4 or leave APP_ENV/ENVIRONMENT out of production")
	}
	return nil
}

// databaseIsTiDB distinguishes TiDB from MySQL before applying DDL. TiDB
// does not support triggers, so trigger DDL is skipped while the application
// transaction paths remain the single owner of the terminalization invariant.
func databaseIsTiDB(ctx context.Context, conn *sql.Conn) (bool, error) {
	version, err := databaseVersion(ctx, conn)
	if err != nil {
		return false, err
	}
	return strings.Contains(strings.ToLower(version), "tidb"), nil
}

func databaseVersion(ctx context.Context, conn *sql.Conn) (string, error) {
	var version string
	if err := conn.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); err != nil {
		return "", err
	}
	return version, nil
}

// requireSupportedEngine fails closed on engines the migration tree cannot
// serve: MariaDB is unsupported (CHECK-constraint and trigger semantics
// diverge), and MySQL below 8.0.16 cannot enforce the CHECKs the tree
// relies on. TiDB stays allowed outside production (see
// refuseTiDBProduction); production TiDB is refused there, not here.
func requireSupportedEngine(version string) error {
	lower := strings.ToLower(version)
	if strings.Contains(lower, "mariadb") {
		return fmt.Errorf("unsupported database engine %q: use MySQL 8.4 (MariaDB is unsupported)", version)
	}
	if strings.Contains(lower, "tidb") {
		return nil
	}
	major, minor, patch := parseMySQLVersion(lower)
	if major == 0 && minor == 0 && patch == 0 {
		return fmt.Errorf("unrecognized MySQL version %q: refusing to migrate an unknown engine", version)
	}
	// Floor is 8.0.16 (CHECK enforcement); production target is 8.4.
	supported := major > 8 || (major == 8 && (minor > 0 || patch >= 16))
	if !supported {
		return fmt.Errorf("unsupported MySQL version %q: need >= 8.0.16 (production: 8.4)", version)
	}
	return nil
}

func parseMySQLVersion(lower string) (major, minor, patch int) {
	start := strings.IndexFunc(lower, func(r rune) bool { return r >= '0' && r <= '9' })
	if start < 0 {
		return 0, 0, 0
	}
	_, _ = fmt.Sscanf(lower[start:], "%d.%d.%d", &major, &minor, &patch)
	return major, minor, patch
}

// isTriggerStatement recognizes trigger DDL even when a migration statement
// starts with a SQL comment. Only leading comments are stripped because the
// splitter has already isolated one statement at a time.
func isTriggerStatement(stmt string) bool {
	s := strings.TrimSpace(stmt)
	for len(s) > 0 {
		switch {
		case strings.HasPrefix(s, "--"):
			if index := strings.IndexByte(s, '\n'); index >= 0 {
				s = strings.TrimSpace(s[index+1:])
				continue
			}
			return false
		case strings.HasPrefix(s, "#"):
			if index := strings.IndexByte(s, '\n'); index >= 0 {
				s = strings.TrimSpace(s[index+1:])
				continue
			}
			return false
		case strings.HasPrefix(s, "/*"):
			if index := strings.Index(s[2:], "*/"); index >= 0 {
				s = strings.TrimSpace(s[index+4:])
				continue
			}
			return false
		}
		break
	}
	upper := strings.ToUpper(s)
	return strings.HasPrefix(upper, "CREATE TRIGGER ") || strings.HasPrefix(upper, "DROP TRIGGER ")
}

// guardLegacyHistory refuses an unsafe bootstrap: history empty but other
// tables exist means migrations were applied out-of-band; fail closed
// unless MIGRATION_HISTORY_GUARD_MODE=warn.
func guardLegacyHistory(ctx context.Context, conn *sql.Conn) error {
	var recorded int64
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&recorded); err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	var tables int64
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`).Scan(&tables); err != nil {
		return fmt.Errorf("inspect schema: %w", err)
	}
	if recorded != 0 || tables == 0 {
		return nil
	}
	names, _ := listTables(ctx, conn)
	detail := fmt.Sprintf("unsafe migration bootstrap blocked: schema_migrations is empty but existing tables were found (%s)", strings.Join(names, ", "))
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MIGRATION_HISTORY_GUARD_MODE")), "warn") {
		log.Printf("migrate: WARN MIGRATION_HISTORY_GUARD_MODE=warn allows startup despite missing history; %s", detail)
		return nil
	}
	return fmt.Errorf("%s", detail)
}

func listTables(ctx context.Context, conn *sql.Conn) ([]string, error) {
	rows, err := conn.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// isApplied reports whether filename is recorded; query errors are
// returned (coercing them to false would re-apply migrations).
func isApplied(ctx context.Context, conn *sql.Conn, filename string) (bool, error) {
	var one sql.NullInt32
	if err := conn.QueryRowContext(ctx, `SELECT 1 FROM schema_migrations WHERE filename = ?`, filename).Scan(&one); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("check applied %s: %w", filename, err)
	}
	return one.Valid, nil
}

func recordMigration(ctx context.Context, conn *sql.Conn, filename string) error {
	if _, err := conn.ExecContext(ctx, `INSERT IGNORE INTO schema_migrations (filename) VALUES (?)`, filename); err != nil {
		return fmt.Errorf("record %s: %w", filename, err)
	}
	return nil
}

// hasVersionsTable reports whether the checksum history table exists.
func hasVersionsTable(ctx context.Context, conn *sql.Conn) bool {
	var n int64
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migration_versions'`).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

// verifyChecksums compares sha256(file) against schema_migration_versions
// rows (version=filename, checksum). Missing rows are recorded; mismatches
// fail closed so a tampered migration can never slip through.
func verifyChecksums(ctx context.Context, conn *sql.Conn, dir string) error {
	files, err := loadMigrations(dir)
	if err != nil {
		return err
	}
	for _, f := range files {
		sum := sha256.Sum256([]byte(f.sql))
		want := hex.EncodeToString(sum[:])
		var have sql.NullString
		err := conn.QueryRowContext(ctx, `SELECT checksum FROM schema_migration_versions WHERE version = ?`, f.name).Scan(&have)
		if err == sql.ErrNoRows || (err == nil && !have.Valid) {
			if _, err := conn.ExecContext(ctx, `INSERT IGNORE INTO schema_migration_versions (version, checksum) VALUES (?, ?)`, f.name, want); err != nil {
				return fmt.Errorf("record checksum %s: %w", f.name, err)
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("read checksum %s: %w", f.name, err)
		}
		if have.String != want {
			return fmt.Errorf("checksum mismatch for %s: history %q != file sha256 %q", f.name, have.String, want)
		}
	}
	return nil
}

type migrationFile struct {
	name string
	sql  string
}

func loadMigrations(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %s: %w", dir, err)
	}
	var out []migrationFile
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", e.Name(), err)
		}
		out = append(out, migrationFile{name: e.Name(), sql: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, nil
}

// splitStatements splits SQL on semicolons outside quotes/comments,
// mirroring the Rust split_sql_statements (single/double/backtick quotes,
// -- and # line comments, /* */ blocks, ”/"" escapes, backslash in
// single/double quotes).
func splitStatements(sql string) []string {
	var out []string
	var cur strings.Builder
	runes := []rune(sql)
	var (
		inSingle, inDouble, inBacktick bool
		inLine, inBlock                bool
	)
	isSpace := func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			return true
		}
		return false
	}
	flush := func() {
		if s := strings.TrimSpace(cur.String()); s != "" {
			out = append(out, s)
		}
		cur.Reset()
	}
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		peek := rune(0)
		hasPeek := i+1 < len(runes)
		if hasPeek {
			peek = runes[i+1]
		}
		if inLine {
			cur.WriteRune(ch)
			if ch == '\n' {
				inLine = false
			}
			continue
		}
		if inBlock {
			cur.WriteRune(ch)
			if ch == '*' && hasPeek && peek == '/' {
				cur.WriteRune(peek)
				i++
				inBlock = false
			}
			continue
		}
		if inSingle {
			cur.WriteRune(ch)
			if ch == '\\' && hasPeek {
				cur.WriteRune(peek)
				i++
				continue
			}
			if ch == '\'' {
				if hasPeek && peek == '\'' {
					cur.WriteRune(peek)
					i++
					continue
				}
				inSingle = false
			}
			continue
		}
		if inDouble {
			cur.WriteRune(ch)
			if ch == '\\' && hasPeek {
				cur.WriteRune(peek)
				i++
				continue
			}
			if ch == '"' {
				if hasPeek && peek == '"' {
					cur.WriteRune(peek)
					i++
					continue
				}
				inDouble = false
			}
			continue
		}
		if inBacktick {
			cur.WriteRune(ch)
			if ch == '`' {
				inBacktick = false
			}
			continue
		}
		if ch == '-' && hasPeek && peek == '-' {
			var third rune
			if i+2 < len(runes) {
				third = runes[i+2]
			}
			if third == 0 || isSpace(third) {
				cur.WriteRune(ch)
				cur.WriteRune(peek)
				i++
				inLine = true
				continue
			}
		}
		if ch == '#' {
			cur.WriteRune(ch)
			inLine = true
			continue
		}
		if ch == '/' && hasPeek && peek == '*' {
			cur.WriteRune(ch)
			cur.WriteRune(peek)
			i++
			inBlock = true
			continue
		}
		if ch == '\'' {
			inSingle = true
			cur.WriteRune(ch)
			continue
		}
		if ch == '"' {
			inDouble = true
			cur.WriteRune(ch)
			continue
		}
		if ch == '`' {
			inBacktick = true
			cur.WriteRune(ch)
			continue
		}
		if ch == ';' {
			flush()
			continue
		}
		cur.WriteRune(ch)
	}
	flush()
	return out
}
