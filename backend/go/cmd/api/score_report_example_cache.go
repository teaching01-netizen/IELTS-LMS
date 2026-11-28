package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"example.com/ielts-proctoring/internal/platform/objectstore"
)

// scoreReportExampleCacheVersion must change whenever the print layout or the
// sample view changes in a way that alters the rendered PDF without changing
// the exam revision.
const scoreReportExampleCacheVersion = "2"

const scoreReportExampleCacheRoot = "sat-score-report-example"

// One in-process lock per exam: concurrent teachers share one render, and the
// losers read the winner's artifact right after. Cross-instance duplicates are
// harmless because the object store write is atomic.
var scoreReportExampleLocks sync.Map

func lockScoreReportExample(examID string) func() {
	value, _ := scoreReportExampleLocks.LoadOrStore(examID, &sync.Mutex{})
	mutex := value.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

// scoreReportExampleCacheKey is deliberately cheap: it is built from revisions
// the handler already needs, so a cache hit skips the delivery tree, the answer
// definitions, the Word Vault, the layout resolution and Chromium entirely.
// Every draft content mutation bumps exam_versions.revision; layout saves bump
// their own revision; exam metadata changes bump the entity revision.
func scoreReportExampleCacheKey(examID, versionID string, versionRevision, examRevision, layoutRevision int, title, vaultDigest string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%d\x00%d\x00%d\x00%s\x00%s\x00%s",
		scoreReportExampleCacheVersion, versionID, versionRevision, examRevision, layoutRevision, title, examID, vaultDigest)))
	return hex.EncodeToString(sum[:])
}

func scoreReportExampleCacheKeys(examID string) (keyObject, pdfObject string) {
	base := scoreReportExampleCacheRoot + "/" + examID
	return base + "/key", base + "/example.pdf"
}

func readCachedScoreReportExample(ctx context.Context, store objectstore.Store, examID, key string) ([]byte, bool) {
	if store == nil || key == "" {
		return nil, false
	}
	keyObject, pdfObject := scoreReportExampleCacheKeys(examID)
	recorded, err := store.Get(ctx, keyObject)
	if err != nil || strings.TrimSpace(string(recorded)) != key {
		return nil, false
	}
	pdf, err := store.Get(ctx, pdfObject)
	if err != nil || len(pdf) == 0 {
		return nil, false
	}
	return pdf, true
}

func writeCachedScoreReportExample(ctx context.Context, store objectstore.Store, examID, key string, pdf []byte) {
	if store == nil || key == "" || len(pdf) == 0 {
		return
	}
	keyObject, pdfObject := scoreReportExampleCacheKeys(examID)
	if err := store.Put(ctx, pdfObject, pdf, "application/pdf"); err != nil {
		return
	}
	_ = store.Put(ctx, keyObject, []byte(key), "text/plain")
}
