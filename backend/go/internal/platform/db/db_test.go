package db

import (
	"testing"

	mysql "github.com/go-sql-driver/mysql"
)

func TestNormalizeMySQLDSNEnforcesUTCForNativeDSN(t *testing.T) {
	got, err := normalizeMySQLDSN("root:root@tcp(127.0.0.1:3306)/ielts?parseTime=true&multiStatements=true")
	if err != nil {
		t.Fatal(err)
	}
	if got != "root:root@tcp(127.0.0.1:3306)/ielts?loc=UTC&multiStatements=true&parseTime=true&time_zone=%27%2B00%3A00%27" {
		t.Fatalf("unexpected normalized native DSN: %q", got)
	}
}

func TestNormalizeMySQLDSNConvertsURI(t *testing.T) {
	got, err := normalizeMySQLDSN("mysql://user:p%40ss@db.example.test:4000/ielts?parseTime=true&multiStatements=true")
	if err != nil {
		t.Fatal(err)
	}
	if got != "user:p@ss@tcp(db.example.test:4000)/ielts?loc=UTC&parseTime=true&multiStatements=true&time_zone=%27%2B00%3A00%27" {
		t.Fatalf("unexpected normalized DSN: %q", got)
	}
}

// Round 75 (live rehearsal): booting with DATABASE_URL='root@/dbname'
// (native DSN, no parseTime param) left ParseTime off, so DATETIME
// arrived as []uint8 and every *time.Time scan failed with a raw error
// that escaped WriteError as a silent 500 (entry mint's locked schedule
// scan). The comment on normalizeMySQLDSN already promises "parseTime
// is forced on" — this test pins that promise for the native branch.
func TestNormalizeMySQLDSNForcesParseTimeForBareNativeDSN(t *testing.T) {
	got, err := normalizeMySQLDSN("root@/ielts_go_fresh")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := mysql.ParseDSN(got)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.ParseTime {
		t.Fatalf("bare native DSN must normalize with parseTime=true, got %q", got)
	}
}

func TestNormalizeMySQLDSNRejectsUnsupportedURI(t *testing.T) {
	if _, err := normalizeMySQLDSN("postgres://user:pass@db.example.test/ielts"); err == nil {
		t.Fatal("expected unsupported URI scheme to fail")
	}
}

// interpolateParams is a driver option, not a session variable: in both DSN
// forms it must reach the connector config (newPool re-parses the normalized
// DSN) while the enforced UTC session settings stay intact and nothing turns
// on multi-statements. A URI parameter copied into Params alone would instead
// be sent as `SET interpolateParams=...` and fail every new connection.
func TestNormalizeMySQLDSNKeepsInterpolateParamsAsDriverOption(t *testing.T) {
	for _, raw := range []string{
		"root:root@tcp(127.0.0.1:3306)/ielts?interpolateParams=true",
		"mysql://user:p%2Fss@db.example.test:4000/ielts?interpolateParams=true",
	} {
		got, err := normalizeMySQLDSN(raw)
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := mysql.ParseDSN(got)
		if err != nil {
			t.Fatal(err)
		}
		if !cfg.InterpolateParams || cfg.MultiStatements || !cfg.ParseTime || cfg.Loc.String() != "UTC" {
			t.Fatalf("%s -> %q: interpolate=%v multi=%v parseTime=%v loc=%v", raw, got, cfg.InterpolateParams, cfg.MultiStatements, cfg.ParseTime, cfg.Loc)
		}
		if len(cfg.Params) != 1 || cfg.Params["time_zone"] != "'+00:00'" {
			t.Fatalf("%s -> %q: session variables must be only time_zone, got %v", raw, got, cfg.Params)
		}
	}
}
