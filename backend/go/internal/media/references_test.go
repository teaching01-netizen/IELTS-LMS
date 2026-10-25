package media

import (
	"reflect"
	"testing"
)

func TestManagedAssetIDs(t *testing.T) {
	raw := `{"img":"/api/v1/media/a1/content","html":"<img src=\"https://x.test/api/v1/media/b2/content\">",` +
		`"bad":"/api/v1/media/c 3/content","nested":"/api/v1/media/d/4/content","tail":"/api/v1/media/e5"}`
	got := ManagedAssetIDs(raw)
	if want := []string{"a1", "b2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ManagedAssetIDs = %v, want %v", got, want)
	}
	if got := ManagedAssetIDs(`{"src":"https://drive.google.com/uc?id=1"}`); got != nil {
		t.Fatalf("non-managed URL = %v, want none", got)
	}
}
