package outbox

// Plan B4.3: WithClaim normalization is the multi-consumer safety
// contract. partitions<1 -> 1 (never zero-division in MOD); negative or
// over-range index wraps mod N (consumers always hold a valid disjoint
// lease); mode preserved verbatim (unknown fails closed at ClaimBatch).
// Pure constructor, no DB. RED: all shapes.
import (
	"testing"
)

func TestWithClaimNormalization(t *testing.T) {
	r := NewRepository(nil).WithClaim(0, 5, ClaimUpdate)
	if got := r.partitionPredicate(); got != "" {
		t.Fatalf("partitions<1 must normalize to single consumer, got %q", got)
	}
	r = NewRepository(nil).WithClaim(4, 6, ClaimUpdate)
	if got := r.partitionPredicate(); got != "\n\t  AND MOD(CRC32(aggregate_id), 4) = 2" {
		t.Fatalf("index 6 mod 4 must wrap to 2, got %q", got)
	}
	r = NewRepository(nil).WithClaim(4, -1, ClaimUpdate)
	if got := r.partitionPredicate(); got != "\n\t  AND MOD(CRC32(aggregate_id), 4) = 3" {
		t.Fatalf("index -1 mod 4 must wrap to 3, got %q", got)
	}
	// Disjointness: N=4 renders four distinct predicates.
	seen := map[string]bool{}
	for i := 0; i < 4; i++ {
		p := NewRepository(nil).WithClaim(4, i, ClaimUpdate).partitionPredicate()
		if seen[p] {
			t.Fatalf("partition %d collides: %q", i, p)
		}
		seen[p] = true
	}
	// Mode preserved verbatim for the fail-closed at ClaimBatch.
	if m := NewRepository(nil).WithClaim(1, 0, ClaimMode("bogus")).claimMode; m != "bogus" {
		t.Fatalf("mode must be preserved verbatim, got %q", m)
	}
}
