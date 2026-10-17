# SAT answered-exam PDF preparation and delivery

Student and staff report actions send only `{view}` to the authenticated
`/sat-answered-pdf/schedules/{id}/prepare` and `/attempts/{id}/prepare` routes.
The browser mounts no second paper, loads no export figures, and creates no PDF
Blob or object URL. One tap prepares the PDF and automatically requests its
attachment download when ready, without opening a window. A **Download PDF again**
link remains available for a repeated save or browser-blocked download.
Leaving the report aborts preparation and stale responses are ignored. Exam
image URLs are released after the outgoing completed surface unmounts.

The server reuses the authorized answered-exam projection, student delivery
images or staff originals, existing print route, print styles, fitter and
lossless optimizer. A4 landscape, one question per page, fonts, colors, images,
watermarks, score report, answer summary and filenames retain their existing
configuration. Missing media still blocks the entire export.

`Renderer.RenderPrepared` keeps one concurrency slot for media preparation,
rendering and optimization. Chromium produces the authoritative complete PDF first. The
embedded pdfcpu v0.16.2 optimizer then deduplicates resources and writes
compressed PDF objects without resizing or re-encoding images or fonts.

Each operation has its own stateless, offline configuration. Existing document
information and accessibility tags are preserved. Optimization and validation
share a 10-second child deadline within the 90-second render deadline. Only
validated, smaller output replaces the original. An optimization failure uses
the complete original; cancellation of the request returns no file.

Logs contain byte counts, elapsed milliseconds and a status code. Parser error
messages and PDF contents must not be logged.

## Private native downloads

Apply `migrations/0092_sat_pdf_exports.sql` before deploying the new backend.
It is additive: the original binary POST routes remain available for older
clients. New preparation returns `{downloadUrl, filename, sizeBytes, expiresAt}`
as a plain JSON object, after the complete PDF is atomically stored in the
existing object store's private `answered-pdf/` namespace.

Each export has a random, HttpOnly, SameSite Strict cookie scoped to its
unguessable download path. Secure follows the existing cookie configuration.
The database stores only its hash; URLs contain no attempt bearer. Scope
replacement is serialized with the existing attempt row lock, with a unique
scope per owner, attempt and authenticated browser session. A concurrent
preparation returns 429. Preparing again supersedes the prior export without
losing its cleanup record; new files become downloadable only when complete.

GET and HEAD recheck the saved student session/revocation/lease and report
availability, or the current staff session and results scope. They stream via
`http.ServeContent` with attachment disposition, content length, byte ranges,
ETag/If-Range, and private/no-store headers (including range errors). Reading a
file does not consume it. Ready files expire after five minutes, shortened if
the original attempt credential expires earlier. Already-open transfers may
finish; new requests after expiry require preparing again. The report retains
a preparation retry action if a native transfer fails.

Cancellation or failure expires and discards the reserved artifact. Crashed or
abandoned preparations have a two-minute lease. The existing background slow
maintenance cycle deletes expired/superseded objects before deleting their
records, retaining records for a later retry if object deletion fails. On an
idle activity-driven runtime, physical cleanup resumes with maintenance on the
next activation; expired files are inaccessible immediately at their deadline.

Attachment handling can still vary with browser settings; the application does
not launch a preview. See [MDN's download behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download).

## Verification

Run the normal unit suite (including the actual optimization timeout):

```sh
cd backend/go
go test -race ./internal/answeredpdf
```

Build the frontend with `bun run build` at the repository root. Then enable
Chromium integration tests and optional independent fidelity checks:

```sh
ANSWEREDPDF_DIST=/absolute/path/to/repository/dist \
ANSWEREDPDF_FIDELITY=1 \
ANSWEREDPDF_PYTHON=/absolute/path/to/python-with-pypdf \
go test ./internal/answeredpdf -count=1 -timeout=10m -v
```

Native transfer and lifecycle checks:

```sh
# Repository root (isolated test attachment server; Chromium/WebKit/Firefox)
bunx playwright test --config playwright.sat-answered-print.config.ts
bunx vitest run src/features/student-delivery/api/answeredExamPdf.test.ts \
  src/features/student-delivery/ui/transitions/score-report/__tests__

# backend/go; TEST_MYSQL_DSN points to an isolated, migrated test database
# The service concurrency test creates/drops its own scratch schema.
TEST_MYSQL_DSN=... go test -race ./internal/answeredpdf -run TestExportsMySQL -count=1
ANSWEREDPDF_DIST=/absolute/path/to/dist TEST_MYSQL_DSN=... \
  go test ./cmd/api -run TestPreparedPDFRoutesMySQL -count=1 -v
```

The optional checks require Poppler's `pdftoppm` on PATH and Python with
`pypdf`. They compare extracted text and every rendered page at 96 and 200 DPI.
Go checks also compare page geometry and decoded image pixels. Set
`ANSWEREDPDF_FIDELITY_OUT` to an existing directory to retain the full exam's
`original.pdf` and `optimized.pdf` for inspection and device tests.

`testdata/optimization.pdf` is a synthetic two-page tagged PDF with identical
page content streams, duplicate vector marks, document metadata, and deliberate
uncompressed padding. Its subset of the application's KaTeX font is embedded
to avoid system font substitution during verification. The full-exam fixture
is generated independently in `fidelity_test.go`: 98 questions across four modules, long passages, equations,
a Thai candidate name, unanswered questions, repeated transparent PNGs and
JPEGs, both with and without the score report. The server-prepared payload
must equal the legacy projection/report/media payload byte for byte before
rendering. Neither fixture modifies `testdata/payload.json`.

Verified locally on 2026-10-17: the 98-question, 101-page score-report fixture
reduced from 4,129,095 to 3,404,093 bytes (17.6%). All pages were pixel-identical
at both 96 and 200 DPI, with identical extracted text, dimensions and decoded
image pixels. Native downloads completed in Chromium, WebKit and Firefox. One-tap download
checks also delay preparation by 6.5 seconds to exceed transient activation;
they verify that the file arrives without another tap, navigation or popup.
MySQL concurrency checks exercised 20 rounds of eight simultaneous preparations;
the real prepare/download routes covered student/staff access, repeated reads,
revocation, report closure, expiry, missing objects and incomplete media.

## Physical iPad acceptance — pending

Browser automation does not establish compatibility with native notes apps.
Before reporting the import crash as resolved, record the iPad model, iPadOS
version, app versions, file size and import duration for Apple Notes and another
affected notes app. For each app, verify importing, scrolling all pages, zooming
text and figures, adding an annotation, closing, and reopening the document.
Compare against the original on the same device. No physical iPad was available
during automated verification.
