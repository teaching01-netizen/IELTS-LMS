# SAT authoring image policy

This is the contract for image ingestion in the SAT authoring editor. The
browser performs an early check for fast feedback; the media service is the
authoritative enforcement boundary.

- New images from clipboard paste, drag-and-drop, the insert-image dialog, and
  HTTPS HTML/URL import are staged through the managed media pipeline.
- Only PNG, JPEG, WebP, and GIF are accepted. Declared MIME, file magic, and
  decoded image dimensions must agree. SVG and AVIF are rejected. HTTPS is the
  only durable URL-import scheme; `blob:` and `data:` values are never
  persisted as URL references, and the remote fetcher rejects private or unsafe
  targets.
- HTTPS URL insertion downloads the image into managed media before the image
  is persisted in authoring content.
- The source cap is 10 MiB per image, the decoded dimension cap is 8,192 px per
  side, and the decoded pixel cap is 25 megapixels. A paste may contain at
  most five images and 50 MiB in aggregate; remote HTML image fetches are
  bounded by the same per-image cap and a timeout. One copied image is often
  offered twice (an image file and an HTML `<img>` for the same picture); those
  two representations are reconciled into one staged image that keeps the HTML
  position and alt text with the file's bytes, so a single paste inserts and
  uploads a single image. Byte-identical representations reconcile first. When
  the browser re-encodes the clipboard file (PNG built from the page's JPEG, for
  example), the two representations are compared by a 16x16 luminance
  fingerprint — equal decoded dimensions plus tight difference-hash and
  luminance bounds — and a match folds them too; the fold is recorded as the
  `image.representation-reconciled-visual` transformation so a heuristic fold
  stays auditable. Two representations that are neither byte-identical nor
  fingerprint-identical stay two images.
- Accepted source bytes are uploaded unchanged. The client does not silently
  resize, recompress, or transcode an image before upload. The managed asset
  records the original byte size and SHA-256 checksum, and completion succeeds
  only when the stored object matches both values.
- Persisted rich content may reference only a managed asset ID or its durable
  same-origin download path. `blob:` and `data:` URLs are transient preview
  mechanisms only; object URLs are revoked when their preview or upload
  lifecycle ends.
- A rejected image must not replace surrounding text. Partial success keeps
  the original document order, while a failed upload exposes Retry and Remove.
  Undo removes the staged asset, and a late upload rejection must not reinsert
  or leak a removed image.
- The backend revalidates content type, magic bytes, decoded limits, source
  size, and checksum before finalization. Existing finalized managed assets
  remain readable under the same asset-ID contract.
