# SAT Authoring Image Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ("- [ ]") syntax for tracking.

**Goal:** Make SAT authoring image insertion reliable across paste, drop, file upload, and URL insertion while enforcing one image policy, preserving source quality, preventing invalid persistence, and making failures recoverable.

**Architecture:** The Go media service owns the authoritative acceptance policy: PNG, JPEG, WebP, and GIF; 10 MiB per image; 8,192 px maximum side; 25 MP maximum decoded area. The frontend mirrors that policy for early feedback, but the backend remains the final authority. HTML images become positional import nodes instead of a side list that is appended after pasted content. All managed images use the same validation/upload lifecycle; SAT does not silently apply lossy compression to author content.

**Tech Stack:** Bun, TypeScript, Vitest, React, TipTap/ProseMirror, Go, image.DecodeConfig, SQL-mocked media tests, and injected HTTP/object-store dependencies.

---

## Definition of done

The implementation is complete only when all of these are true:

1. A pasted HTML image remains between the same surrounding blocks after insertion, including multiple mixed images.
2. Clipboard, drag/drop, Image dialog file upload, and managed URL import use the same MIME, byte, dimension, and pixel policy.
3. New SAT uploads are rejected above 10 MiB, above 8,192 px on either side, or above 25 MP. Existing finalized assets remain readable.
4. WebP receives the same decoded dimension/pixel checks as PNG, JPEG, and GIF.
5. Accepted SAT source bytes are preserved exactly. No silent lossy re-encoding occurs.
6. data:, blob:, javascript:, http:, and invalid values cannot be persisted as an asset ID.
7. Failed uploads show Retry and Remove controls. Removing or undoing an image releases its File and object URL even when the upload later rejects.
8. The backend rejects an upload whose request content type differs from its upload intent.
9. Paste/drop processing has bounded image count and aggregate byte budgets.
10. Focused tests, Go tests, full typecheck, lint, build, and a real-browser smoke test pass.

The compression decision is intentional: SAT images may contain small printed text, graphs, or answer evidence. Automatic re-encoding can reduce legibility. The first implementation preserves accepted source bytes and rejects over-budget inputs with actionable messages. A display derivative can be added later as a separate performance feature.

## File map

### Create

- src/features/exam-authoring/editor/ingestion/domain/imagePolicy.ts — frontend SAT image policy and durable-source validation.
- src/features/exam-authoring/editor/ingestion/application/imageImport.ts — shared file/URL source orchestration.
- src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts — policy boundary tests.
- src/features/exam-authoring/editor/ingestion/__tests__/imageImport.test.ts — file/URL source tests.
- backend/go/internal/media/remote_fetcher.go — injected bounded remote image fetcher.
- backend/go/internal/media/remote_fetcher_test.go — URL security and bounded-fetch tests.
- backend/go/internal/media/image_policy_test.go — server format/dimension/pixel tests.
- src/features/exam-authoring/editor/ingestion/__tests__/satImageLifecycle.test.tsx — public-path lifecycle matrix.
- docs/sat-authoring-image-policy.md — published contract.

### Modify

- src/features/exam-authoring/editor/ingestion/domain/limits.ts
- src/features/exam-authoring/editor/ingestion/adapters/imageValidation.ts
- src/features/exam-authoring/editor/ingestion/adapters/htmlImageRefs.ts
- src/features/exam-authoring/editor/ingestion/adapters/fetchHtmlImagesAsFiles.ts
- src/features/exam-authoring/editor/ingestion/adapters/htmlSanitizePolicy.ts
- src/features/exam-authoring/editor/ingestion/adapters/textHtml.ts
- src/features/exam-authoring/editor/ingestion/domain/importDocument.ts
- src/features/exam-authoring/editor/ingestion/application/ingestClipboard.ts
- src/features/exam-authoring/editor/ingestion/conversion/importAstToRichDocument.ts
- src/features/exam-authoring/editor/plugins/insertIngestResult.ts
- src/features/exam-authoring/editor/ingestionImagePipe.ts
- src/features/exam-authoring/editor/SatImageExtension.tsx
- src/features/exam-authoring/editor/RichQuestionComposer.tsx
- src/features/exam-authoring/editor/richContent.ts
- src/features/exam-authoring/editor/schema/imageNode.ts
- src/features/exam-authoring/api/assessmentMediaApi.ts
- related ingestion/editor/media tests
- backend/go/internal/media/service.go
- backend/go/internal/media/service_test.go
- backend/go/cmd/api/handlers_media.go
- backend/go/cmd/api/handlers_authoring.go
- the Go composition root that constructs media.Service
- backend/go/go.mod and backend/go/go.sum

## Task 1: Establish one image policy

**Files:**

- Create src/features/exam-authoring/editor/ingestion/domain/imagePolicy.ts.
- Create src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts.
- Modify src/features/exam-authoring/editor/ingestion/adapters/imageValidation.ts.
- Modify backend/go/internal/media/service.go.
- Create backend/go/internal/media/image_policy_test.go.

- [ ] Step 1: Write failing frontend policy tests.

~~~ts
it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
  "allows %s",
  (contentType) => {
    expect(isAllowedSatImageMime(contentType)).toBe(true);
  },
);

it.each(["image/svg+xml", "image/avif", "application/pdf", ""])(
  "rejects %s",
  (contentType) => {
    expect(isAllowedSatImageMime(contentType)).toBe(false);
  },
);

it("uses exact 10 MiB, 8,192 px, and 25 MP boundaries", () => {
  expect(SAT_IMAGE_POLICY.maxBytes).toBe(10 * 1024 * 1024);
  expect(SAT_IMAGE_POLICY.maxDimension).toBe(8_192);
  expect(SAT_IMAGE_POLICY.maxPixels).toBe(25_000_000);
});

it.each([
  "data:image/png;base64,AAAA",
  "blob:https://example.test/id",
  "http://example.test/image.png",
  "javascript:alert(1)",
])("rejects unsafe durable source %s", (source) => {
  expect(validateDurableImageSource(source)).toEqual({
    ok: false,
    code: "source",
  });
});
~~~

- [ ] Step 2: Run the new test and verify it fails.

~~~bash
bun run test:run -- src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts
~~~

Expected: FAIL because the policy module and source validator do not exist.

- [ ] Step 3: Add the frontend policy module.

Reuse INGESTION_LIMITS.fileBytes rather than adding another 10 MiB literal:

~~~ts
import { INGESTION_LIMITS } from "./limits";

export const SAT_IMAGE_POLICY = {
  maxBytes: INGESTION_LIMITS.fileBytes,
  maxDimension: 8_192,
  maxPixels: 25_000_000,
  maxDecodeMs: 5_000,
  maxImagesPerPaste: 5,
  maxPasteBytes: INGESTION_LIMITS.fileBytes * 5,
  allowedMime: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const;

export type SatImageMime = (typeof SAT_IMAGE_POLICY.allowedMime)[number];

export function isAllowedSatImageMime(value: string): value is SatImageMime {
  return (SAT_IMAGE_POLICY.allowedMime as readonly string[]).includes(
    value.toLowerCase(),
  );
}

export function validateDurableImageSource(source: string):
  | { ok: true; kind: "asset" | "https" | "relative" }
  | { ok: false; code: "source" } {
  const value = source.trim();
  if (!value) return { ok: false, code: "source" };
  if (/^https:\/\//i.test(value)) return { ok: true, kind: "https" };
  if (value.startsWith("/")) return { ok: true, kind: "relative" };
  if (/^[a-z0-9_-]{8,}$/i.test(value)) return { ok: true, kind: "asset" };
  return { ok: false, code: "source" };
}
~~~

Replace the asset-ID predicate with the API’s exact ID format if it is stricter. It must not accept arbitrary strings or encoded data.

- [ ] Step 4: Align the Go new-upload policy.

Keep existing finalized rows readable, but make new media uploads use the safer existing frontend/workbook contract:

~~~go
const (
    MaxUploadBytes    int64 = 10 << 20
    MaxDecodedPixels        = 25_000_000
    MaxImageDimension       = 8192
)

var allowedImageContentTypes = map[string]bool{
    "image/png":  true,
    "image/jpeg": true,
    "image/gif":  true,
    "image/webp": true,
}
~~~

Expose read-only policy values through functions or constants so tests cannot mutate them.

- [ ] Step 5: Run and commit the contract.

~~~bash
bun run test:run -- src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts
cd backend/go && go test ./internal/media -run 'Policy|Image' -count=1
~~~

Expected: PASS with identical values.

~~~bash
git add src/features/exam-authoring/editor/ingestion/domain/imagePolicy.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts \
  src/features/exam-authoring/editor/ingestion/domain/limits.ts \
  backend/go/internal/media/service.go \
  backend/go/internal/media/image_policy_test.go
git commit -m "feat: define SAT image policy contract"
~~~

## Task 2: Preserve HTML image position

**Files:**

- Modify htmlImageRefs.ts, fetchHtmlImagesAsFiles.ts, htmlSanitizePolicy.ts, and textHtml.ts.
- Modify importDocument.ts, ingestClipboard.ts, importAstToRichDocument.ts, and insertIngestResult.ts.
- Modify textHtml.test.ts, ingestClipboard.test.ts, and insertIngestResult.test.ts.

- [ ] Step 1: Write the failing positional regression.

~~~ts
it("keeps HTML image order between surrounding blocks", async () => {
  const result = await ingestClipboard({
    html: '<p>before</p><img src="https://example.test/diagram.png" alt="diagram"><p>after</p>',
    text: "",
    files: [],
    deps: htmlFetchDepsReturningPng("diagram-ref"),
  });

  expect(result.document.nodes.map((node) => node.kind)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
  expect(result.document.nodes[1]).toMatchObject({
    kind: "image",
    alt: "diagram",
    blobRef: { id: "diagram-ref" },
  });
});

it("inserts prepared images in AST order", async () => {
  await insertIngestResult(editor, result, target, options);

  expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
});
~~~

- [ ] Step 2: Run it and verify the current failure.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/ingestClipboard.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/insertIngestResult.test.ts
~~~

Expected: FAIL because current HTML image references are held separately and insertIngestResult appends prepared images after all converted content.

- [ ] Step 3: Replace parallel arrays with stable image references.

Add a file reference type outside the domain document:

~~~ts
export interface PendingImage {
  refId: string;
  file: File;
  alt: string;
}
~~~

Set ImportNode.image.blobRef.id equal to PendingImage.refId. Raw File objects must never enter ImportDocument.

- [ ] Step 4: Convert safe internal markers into image nodes.

Before sanitization, replace each extracted img with an internally generated marker containing only a reference ID and escaped alt text. The sanitizer may allow this marker, but must continue removing arbitrary img, src, data:, and event attributes.

The parser should emit:

~~~ts
{
  kind: "image",
  blobRef: { id: refId, mimeType: file.type, sizeBytes: file.size },
  url: null,
  alt,
  caption: null,
  meta: { source: "html", confidence: 2, transformations: [] },
}
~~~

For an image embedded in a paragraph, split the surrounding text into blocks and emit the image at the same relative position. Never concatenate surrounding text while dropping the image.

- [ ] Step 5: Resolve prepared image nodes during pure conversion.

Add an optional resolver without giving the converter editor or network dependencies:

~~~ts
export interface ImportImageResolver {
  resolve(
    node: Extract<ImportNode, { kind: "image" }>,
  ): TipTapJson | null;
}
~~~

Prepare files into Map<refId, PreparedClipboardImageResult>. Pass a resolver from insertIngestResult that returns the prepared transient node for that reference. Normal conversion then determines the final order.

- [ ] Step 6: Make file-only paste behavior explicit.

When clipboard files have no HTML position, append corresponding image nodes to the import document before conversion. This preserves current behavior while making ordering testable.

- [ ] Step 7: Handle table-cell images without silent loss.

If table cells accept block images, preserve them inside the cell. If they do not, insert the image alt text and return an explicit warning/rejection count. Add tests for the supported and unsupported capability paths.

- [ ] Step 8: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/textHtml.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/ingestClipboard.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/insertIngestResult.test.ts \
  src/features/exam-authoring/editor/__tests__/clipboardIntegration.test.tsx
~~~

Expected: PASS for paragraph/image/paragraph order, multiple images, alt text, one undo entry, and table behavior.

~~~bash
git add src/features/exam-authoring/editor/ingestion \
  src/features/exam-authoring/editor/plugins/insertIngestResult.ts
git commit -m "fix: preserve pasted image positions"
~~~

## Task 3: Use one validator for clipboard, drop, and dialog files

**Files:**

- Modify imageValidation.ts, ingestionImagePipe.ts, smartPastePlugin.ts, and smartDropPlugin.ts.
- Modify assessmentMediaApi.ts and RichQuestionComposer.tsx.
- Modify image validation, API, and composer tests.
- Create imageImport.test.ts.

- [ ] Step 1: Add failing cross-path cases.

~~~ts
it.each([
  [SAT_IMAGE_POLICY.maxBytes + 1, "size"],
  [SAT_IMAGE_POLICY.maxBytes, null],
])("uses the same byte boundary for clipboard and dialog files", async (size, code) => {
  const file = makeValidPngFile({ size });
  const clipboard = await validateSatImageFile(file, testBitmapLoader);
  const dialog = await validateImageUploadInput(file, testBitmapLoader);

  expect(clipboard.code ?? null).toBe(code);
  expect(dialog.code ?? null).toBe(code);
});

it("rejects unsupported declared MIME before network upload", async () => {
  const file = makeFile(validPngBytes, "diagram.avif", "image/avif");

  await expect(validateSatImageFile(file, testBitmapLoader)).resolves.toMatchObject({
    ok: false,
    code: "type",
  });
  expect(uploadAssessmentAsset).not.toHaveBeenCalled();
});
~~~

- [ ] Step 2: Rename and generalize the validator.

Rename validateClipboardImage to validateSatImageFile. Keep a temporary compatibility export while all call sites migrate:

~~~ts
export const validateClipboardImage = validateSatImageFile;
~~~

The shared validator must use exact MIME, magic bytes, byte limit, bounded decode, dimension limit, and pixel limit.

- [ ] Step 3: Close bitmap timeout resources.

If the bitmap loader resolves after timeout, close the bitmap before discarding it. Revoke fallback object URLs on timeout, load, and error. Add a deferred-loader test asserting one close() and one revokeObjectURL().

- [ ] Step 4: Add cheap API-wrapper checks.

~~~ts
if (!isAllowedSatImageMime(file.type)) {
  throw new Error("Use PNG, JPEG, WebP, or GIF images.");
}
if (file.size > SAT_IMAGE_POLICY.maxBytes) {
  throw new Error("Images must be 10 MiB or smaller.");
}
~~~

Include sizeBytes: file.size in the intent request. The backend remains authoritative.

- [ ] Step 5: Route ImageDialog file selection through validation.

Do not call uploadAssessmentAsset directly from the dialog handler. Validate first, render the structured error, and only then upload. Revoke preview object URLs on dialog close, replacement, success, and failure.

- [ ] Step 6: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/imagePolicy.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/imageValidation.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/imageImport.test.ts \
  src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx \
  src/features/exam-authoring/api/__tests__/assessmentMediaApi.test.ts
~~~

Expected: PASS with identical rejection codes/messages across paste and dialog paths.

~~~bash
git add src/features/exam-authoring/editor/ingestion \
  src/features/exam-authoring/editor/ingestionImagePipe.ts \
  src/features/exam-authoring/api/assessmentMediaApi.ts \
  src/features/exam-authoring/editor/RichQuestionComposer.tsx
git commit -m "fix: unify SAT image validation paths"
~~~

## Task 4: Make URL insertion durable and safe

**Files:**

- Create imageImport.ts.
- Create backend/go/internal/media/remote_fetcher.go and tests.
- Modify assessmentMediaApi.ts, RichQuestionComposer.tsx, richContent.ts, and imageNode.ts.
- Modify service.go, handlers_media.go, handlers_authoring.go, and the Go composition root.

The existing URL field bypasses managed media limits. Keep the convenience but import HTTPS images into managed media before persistence.

- [ ] Step 1: Write failing URL-source tests.

~~~ts
it("rejects unsafe URL values before persistence", async () => {
  for (const source of [
    "data:image/png;base64,AAAA",
    "blob:https://example.test/id",
    "http://example.test/image.png",
    "javascript:alert(1)",
  ]) {
    await expect(importImageSource({ source, ownerId: "q-1" })).rejects.toMatchObject({
      code: "source",
    });
  }
});

it("imports an HTTPS image as a managed asset", async () => {
  const asset = await importImageSource({
    source: "https://cdn.example.test/diagram.png",
    ownerId: "q-1",
  });

  expect(asset).toMatchObject({ id: "asset-1", contentType: "image/png" });
});
~~~

- [ ] Step 2: Add an injected bounded remote fetcher.

~~~go
type RemoteImageFetcher interface {
    Fetch(ctx context.Context, rawURL string, maxBytes int64) (FetchedImage, error)
}

type FetchedImage struct {
    ContentType string
    FileName    string
    Body        []byte
}
~~~

The production implementation must enforce HTTPS, a 10-second deadline, five redirects maximum, no cookie/authorization forwarding, a 10 MiB plus one byte response limit, exact image content type, and rejection of loopback, link-local, private, multicast, and cloud-metadata IPs after every DNS resolution and redirect. Tests use a fake fetcher and local test servers.

- [ ] Step 3: Add the media-service URL import method.

The service method must:

1. Check owner access exactly as CreateUpload.
2. Fetch bounded bytes through the injected fetcher.
3. Validate MIME, magic, dimensions, and pixels through the same image functions as normal uploads.
4. Store the original bytes and finalize through the existing checksum/size path.
5. Return the managed asset ID and download URL.

Never persist the remote URL as assetId or src.

- [ ] Step 4: Add the endpoint and frontend adapter.

Use this request at POST /v1/media/import-url:

~~~json
{
  "ownerKind": "assessment_question",
  "ownerId": "q-1",
  "url": "https://cdn.example.test/diagram.png"
}
~~~

imageImport.ts returns a managed asset for either an existing asset ID or an imported HTTPS source.

- [ ] Step 5: Remove data/blob persistence.

Update assetSource, isDirectImageSource, and stripTransientImages so durable sources are explicitly one of:

~~~ts
type DurableImageSource =
  | { kind: "asset"; assetId: string }
  | { kind: "https"; url: string }
  | { kind: "relative"; url: string };
~~~

For SAT insertion, use the managed asset variant. Legacy data:/blob: values render as a recoverable broken-image state and are removed or replaced on the next save; they are never preserved inside assetId.

- [ ] Step 6: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/imageImport.test.ts \
  src/features/exam-authoring/editor/__tests__/richContent.test.ts
cd backend/go && go test ./internal/media ./cmd/api -run 'Media|media|Remote|remote' -count=1
~~~

Expected: PASS with managed asset IDs only.

~~~bash
git add src/features/exam-authoring/editor/ingestion/application/imageImport.ts \
  src/features/exam-authoring/api/assessmentMediaApi.ts \
  src/features/exam-authoring/editor/RichQuestionComposer.tsx \
  src/features/exam-authoring/editor/richContent.ts \
  src/features/exam-authoring/editor/schema/imageNode.ts \
  backend/go/internal/media backend/go/cmd/api
git commit -m "fix: make SAT URL images managed assets"
~~~

## Task 5: Harden backend integrity and WebP limits

**Files:**

- Modify backend/go/internal/media/service.go.
- Modify backend/go/internal/media/service_test.go.
- Modify backend/go/go.mod and backend/go/go.sum.
- Modify backend/go/internal/media/image_policy_test.go.

- [ ] Step 1: Add failing backend tests.

~~~go
func TestUploadBytesRejectsContentTypeDifferentFromIntent(t *testing.T) {
    // Seed pending image/png intent.
    // Upload valid JPEG bytes with contentType image/jpeg.
    // Expect CodeValidation and no store.Put call.
}

func TestCompleteUploadRevalidatesStoredBytes(t *testing.T) {
    // Seed pending image/png row and a store containing JPEG bytes.
    // Expect CodeValidation before finalization.
}

func TestWebPDimensionLimitIsEnforced(t *testing.T) {
    // Use a valid WebP fixture over 8,192 px or 25 MP.
    // Expect CodePayloadTooLarge.
}
~~~

Run:

~~~bash
cd backend/go && go test ./internal/media -run 'ContentType|CompleteUpload|WebP' -count=1
~~~

Expected: the new cases fail against the current implementation.

- [ ] Step 2: Bind upload bytes to intent metadata.

In UploadBytes, load the pending asset before validation and require:

~~~go
if normalizeContentType(contentType) != normalizeContentType(asset.ContentType) {
    return validationError("uploaded content type does not match upload intent")
}
~~~

Use the intent’s normalized type for storage metadata.

- [ ] Step 3: Revalidate during completion.

After loading the stored body in CompleteUpload, verify content type, magic bytes, decoded limits, final size, and checksum before changing status to finalized. This closes the gap between local and presigned object-store paths.

- [ ] Step 4: Enable WebP config decoding.

Add the maintained golang.org/x/image/webp dependency and blank-import it so image.DecodeConfig recognizes WebP. Remove the WebP early return from decoded-limit validation. Keep header-only decode; do not full-decode pixels on the API request path.

- [ ] Step 5: Stabilize policy errors.

Use distinct errors for unsupported type, magic mismatch, source too large, dimensions too large, decoded pixels too large, intent mismatch, checksum mismatch, and final-size mismatch. Map them to the frontend’s shared error copy.

- [ ] Step 6: Run and commit.

~~~bash
cd backend/go && gofmt -w internal/media/*.go cmd/api/handlers_media.go cmd/api/handlers_authoring.go
go test ./internal/media ./cmd/api -count=1
~~~

Expected: PASS, including existing magic-byte/SVG/size/checksum/ownership tests plus mismatch and WebP tests.

~~~bash
git add backend/go/go.mod backend/go/go.sum backend/go/internal/media backend/go/cmd/api
git commit -m "fix: enforce media intent and decoded image limits"
~~~

## Task 6: Make upload failures recoverable and cleanup deterministic

**Files:**

- Modify ingestionImagePipe.ts and SatImageExtension.tsx.
- Modify RichQuestionComposer.tsx only if node commands must be passed through.
- Modify ingestionImagePipe.test.ts and clipboardIntegration.test.tsx.

- [ ] Step 1: Add failing late-rejection and UI tests.

~~~ts
it("releases a removed image after a late upload rejection", async () => {
  const upload = deferred<AssessmentMediaAsset>();
  const revoke = vi.fn();

  await pasteClipboardImage(editor, file, "q-1", {
    upload: () => upload.promise,
    createObjectUrl: () => "blob:test",
    revokeObjectUrl: revoke,
  });

  editor.commands.undo();
  upload.reject(new Error("network down"));
  await flushPromises();

  expect(getImageUploadRegistrySize()).toBe(0);
  expect(revoke).toHaveBeenCalledWith("blob:test");
});

it("renders retry and remove actions for a failed staged image", async () => {
  await pasteAndRejectUpload();

  expect(screen.getByRole("button", { name: "Retry image upload" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove image" })).toBeVisible();
});
~~~

- [ ] Step 2: Centralize registry release.

Implement one releaseRegistryEntry(uploadId) path:

- success with live node: swap attributes, release;
- failure with live node: set uploadError, retain for Retry;
- node gone on success or failure: release immediately;
- editor destroy: release every remaining entry exactly once.

- [ ] Step 3: Render accessible failure controls.

The node view must expose:

~~~tsx
<span role="status">Upload failed</span>
<button aria-label="Retry image upload" type="button">Retry</button>
<button aria-label="Remove image" type="button">Remove</button>
~~~

Retry reuses the stored File and current node position. Remove dispatches a delete transaction and releases the registry entry. Background status changes must not create extra undo entries.

- [ ] Step 4: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/ingestionImagePipe.test.ts \
  src/features/exam-authoring/editor/__tests__/clipboardIntegration.test.tsx
~~~

Expected: no tracked entries and no unreleased object URLs after success, remove, undo, late rejection, retry, or destroy.

~~~bash
git add src/features/exam-authoring/editor/ingestionImagePipe.ts \
  src/features/exam-authoring/editor/SatImageExtension.tsx \
  src/features/exam-authoring/editor/ingestion/__tests__/ingestionImagePipe.test.ts \
  src/features/exam-authoring/editor/__tests__/clipboardIntegration.test.tsx
git commit -m "fix: make staged image failures recoverable"
~~~

## Task 7: Bound paste/drop resource usage

**Files:**

- Modify ingestClipboard.ts, htmlImageRefs.ts, and fetchHtmlImagesAsFiles.ts.
- Modify smartPastePlugin.ts and smartDropPlugin.ts only to surface warnings.
- Modify the corresponding ingestion tests.

- [ ] Step 1: Add failing count and aggregate-size cases.

~~~ts
it("accepts at most five images per paste", async () => {
  const result = await ingestClipboard({ files: sixValidImageFiles() });

  expect(result.pendingImages).toHaveLength(5);
  expect(result.rejectedImages).toBe(1);
  expect(result.warnings).toContain("Only 5 images can be inserted at once.");
});

it("rejects aggregate paste bytes above the bounded budget", async () => {
  const result = await ingestClipboard({
    files: filesTotalling(SAT_IMAGE_POLICY.maxPasteBytes + 1),
  });

  expect(result.pendingImages).toHaveLength(0);
  expect(result.warnings).toContain("The pasted images are too large as a group.");
});
~~~

- [ ] Step 2: Enforce limits before fetch/decode work.

Count direct clipboard files and HTML refs together. Do not start more than five HTML fetches. Do not fetch a response whose declared length exceeds the remaining aggregate budget. Use Promise.allSettled so one failure cannot leave other temporary resources unresolved.

- [ ] Step 3: Preserve text on partial image failure.

Text insertion still succeeds when an image fails, but the composer receives a structured warning containing count and reason, never file contents or remote URLs.

- [ ] Step 4: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion/__tests__/ingestClipboard.test.ts \
  src/features/exam-authoring/editor/ingestion/__tests__/fetchHtmlImagesAsFiles.test.ts \
  src/features/exam-authoring/editor/__tests__/clipboardIntegration.test.tsx
~~~

Expected: bounded request count, aggregate bytes, and deterministic partial-failure behavior.

~~~bash
git add src/features/exam-authoring/editor/ingestion src/features/exam-authoring/editor/plugins
git commit -m "fix: bound pasted image resource usage"
~~~

## Task 8: Add the public-path lifecycle matrix and documentation

**Files:**

- Create satImageLifecycle.test.tsx.
- Modify RichQuestionComposer.test.tsx, assessmentMediaApi.test.ts, service_test.go, and API tests.
- Create docs/sat-authoring-image-policy.md.

- [ ] Step 1: Cover the public paths.

| Source | Valid case | Boundary rejection | Persistence assertion |
|---|---|---|---|
| Clipboard file | 10 MiB PNG, 8,192 px, 25 MP | +1 byte, +1 px, +1 pixel over area | managed asset ID only |
| HTML image | valid HTTPS image | body over cap, wrong MIME, timeout | original position retained |
| Drop file | valid JPEG/WebP/GIF | magic mismatch | one upload request |
| Dialog file | valid image | unsupported MIME/dimension | no object URL persisted |
| Dialog URL | managed HTTPS import | HTTP/data/blob/private URL | managed asset ID only |
| Failure | upload rejection | late rejection after undo | Retry/Remove and empty registry |

- [ ] Step 2: Assert byte fidelity.

For accepted PNG and JPEG fixtures, assert the PUT body is the exact original File bytes and the final asset reports the original size/checksum. This verifies the no-lossy-reencoding decision.

- [ ] Step 3: Add the backend matrix.

Run each MIME through magic validation and decoded limits. Include valid and oversized WebP. Test that type mismatch, checksum mismatch, wrong final size, and completion-time invalid bytes never finalize a row.

- [ ] Step 4: Document the contract.

docs/sat-authoring-image-policy.md must state:

~~~md
- New managed SAT images: PNG, JPEG, WebP, or GIF.
- Maximum source size: 10 MiB per image.
- Maximum decoded dimensions: 8,192 px per side and 25 MP total.
- Maximum images per paste: 5; aggregate paste budget: 50 MiB.
- Accepted source bytes are preserved; SAT does not silently re-encode.
- HTTPS URL insertion downloads into managed media before persistence.
- Existing finalized assets remain readable even if they predate this policy.
~~~

- [ ] Step 5: Run and commit.

~~~bash
bun run test:run -- \
  src/features/exam-authoring/editor/ingestion \
  src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx \
  src/features/exam-authoring/editor/__tests__/clipboardIntegration.test.tsx \
  src/features/exam-authoring/api/__tests__/assessmentMediaApi.test.ts
cd backend/go && go test ./internal/media ./cmd/api -count=1
~~~

Expected: all tests pass.

~~~bash
git add src/features/exam-authoring/editor src/features/exam-authoring/api \
  backend/go/internal/media backend/go/cmd/api \
  docs/sat-authoring-image-policy.md
git commit -m "test: cover SAT image lifecycle contract"
~~~

## Task 9: Final quality gates and release safety

- [ ] Step 1: Run formatting, typecheck, lint, build, and all Go tests.

~~~bash
bun run typecheck
bun run lint
bun run build
cd backend/go && gofmt -l internal/media cmd/api
go test ./...
~~~

Expected: typecheck, lint, build, and Go tests pass; gofmt -l prints nothing. Run this in a clean implementation worktree so unrelated student-answer browser-probe errors do not mask image changes. Do not edit or revert those unrelated files.

- [ ] Step 2: Run a real-browser smoke test.

Verify in a browser with createImageBitmap and canvas support:

1. Paste HTML containing text/image/text.
2. Paste a valid WebP.
3. Reject oversized and dimension-invalid images before network upload.
4. Fail an upload and use Retry.
5. Remove/undo while upload is pending.
6. Reload and confirm only managed asset IDs persist.

Record only pass/fail and policy metrics. Do not log image bytes, base64 payloads, or remote URLs.

- [ ] Step 3: Verify legacy migration behavior.

Do not rewrite existing structured content automatically. Legacy data:/blob: images render as a recoverable broken-image state with Remove/Replace controls, not silent deletion. The next save persists only valid managed assets.

- [ ] Step 4: Review the final diff.

~~~bash
git status --short
git diff --check
git log --oneline -10
~~~

Expected: only image-pipeline files and image-policy documentation are in the implementation branch; unrelated pre-existing worktree edits remain untouched.

## Final acceptance checklist

- [ ] HTML image placement regression passes.
- [ ] Clipboard, drop, dialog, and URL use one policy.
- [ ] Backend is authoritative and revalidates at completion.
- [ ] WebP dimensions are bounded.
- [ ] MIME intent mismatch is rejected.
- [ ] SAT source bytes are not silently re-encoded.
- [ ] Oversized and invalid images get actionable errors.
- [ ] data: and blob: cannot become durable asset IDs.
- [ ] Failed uploads show Retry/Remove.
- [ ] Late rejection releases File and object URL resources.
- [ ] Paste count and aggregate byte budgets are enforced.
- [ ] Full tests, typecheck, lint, build, Go tests, and browser smoke pass.
- [ ] Existing finalized assets remain readable.

