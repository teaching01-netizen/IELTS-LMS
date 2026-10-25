package media

import "strings"

// ManagedAssetIDs returns the asset ids of every managed-media URL
// (/api/v1/media/{id}/content, relative or absolute) in raw content, in order,
// with duplicates kept. IELTS content and legacy ACT Science HTML reference
// figures this way rather than by structured assetId fields.
func ManagedAssetIDs(raw string) []string {
	const pathPrefix = "/api/v1/media/"
	const contentSuffix = "/content"
	var ids []string
	for {
		prefixIndex := strings.Index(raw, pathPrefix)
		if prefixIndex < 0 {
			return ids
		}
		raw = raw[prefixIndex+len(pathPrefix):]
		suffixIndex := strings.Index(raw, contentSuffix)
		if suffixIndex < 0 {
			return ids
		}
		assetID := raw[:suffixIndex]
		if assetID != "" && !strings.ContainsAny(assetID, "/\\?#\"'<> \t\r\n") {
			ids = append(ids, assetID)
		}
		raw = raw[suffixIndex+len(contentSuffix):]
	}
}
