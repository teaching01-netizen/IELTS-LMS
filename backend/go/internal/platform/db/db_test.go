package db

import "testing"

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
	if got != "user:p@ss@tcp(db.example.test:4000)/ielts?loc=UTC&multiStatements=true&parseTime=true&time_zone=%27%2B00%3A00%27" {
		t.Fatalf("unexpected normalized DSN: %q", got)
	}
}

func TestNormalizeMySQLDSNRejectsUnsupportedURI(t *testing.T) {
	if _, err := normalizeMySQLDSN("postgres://user:pass@db.example.test/ielts"); err == nil {
		t.Fatal("expected unsupported URI scheme to fail")
	}
}
