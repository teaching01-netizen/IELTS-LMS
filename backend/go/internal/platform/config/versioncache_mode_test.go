package config

import (
	"testing"
)

// D1 RED: VERSION_CACHE gates the immutable version cache. off (default) =
// today's N+1 LoadSections per bootstrap; on = shared cached trees.
// Unknown values fail closed (never silently uncached at scale... and never
// silently cached when the operator asked off: fail closed = off).
func TestVersionCacheDefaultsOff(t *testing.T) {
	t.Setenv("VERSION_CACHE", "")
	if cfg := Load(); cfg.VersionCacheEnabled {
		t.Fatalf("VERSION_CACHE must default off")
	}
}

func TestVersionCacheOnParses(t *testing.T) {
	for _, v := range []string{"on", "1", "true"} {
		t.Setenv("VERSION_CACHE", v)
		if cfg := Load(); !cfg.VersionCacheEnabled {
			t.Fatalf("VERSION_CACHE=%q must enable", v)
		}
	}
}
