package satpublish

import "testing"

func TestCollectRichContentAssetReferencesWalksLegacyAndRichDocuments(t *testing.T) {
	raw := `{"version":2,"nodes":[{"type":"image","assetId":"legacy-1"}],"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"assetId":"rich-2"}}]}]}}`
	refs := CollectRichContentAssetReferences(raw, "examQuestion:q-1:prompt", "q-1")
	if len(refs) != 2 {
		t.Fatalf("found %d image references, want 2: %+v", len(refs), refs)
	}
	paths := map[string]string{}
	for _, ref := range refs {
		paths[ref.AssetID] = ref.Path
	}
	if paths["legacy-1"] != "examQuestion:q-1:prompt.nodes[0].assetId" {
		t.Fatalf("legacy reference path = %q", paths["legacy-1"])
	}
	if paths["rich-2"] != "examQuestion:q-1:prompt.document.content[0].content[0].attrs.assetId" {
		t.Fatalf("rich reference path = %q", paths["rich-2"])
	}
}

func TestCollectRichContentAssetReferencesIgnoresExternalImages(t *testing.T) {
	refs := CollectRichContentAssetReferences(`{"nodes":[{"type":"image","src":"https://example.com/image.png"}]}`, "prompt", "q-1")
	if len(refs) != 0 {
		t.Fatalf("external source produced managed-asset references: %+v", refs)
	}
}
