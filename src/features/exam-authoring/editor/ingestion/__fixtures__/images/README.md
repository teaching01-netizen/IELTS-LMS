# Phase 06 image fixtures

Header-true stubs (magic bytes + padding), NOT full decodable rasters.
`createImageBitmap` is unavailable in jsdom/node, so validation tests inject
a stubbed `BitmapLoader` and the glue tests mock `uploadAssessmentAsset`.
Real decode is exercised in a browser-capable env (manual spot-check in the
phase plan); the fixtures pin the byte-level contract instead:

| File | Bytes | Expectation |
|---|---|---|
| `photo.png` | PNG signature `89 50 4E 47 0D 0A 1A 0A` | magic family `png` |
| `graph.jpg` | JPEG SOI `FF D8 FF` | magic family `jpeg` |
| `diagram.webp` | `RIFF....WEBP` | magic family `webp` |
| `anim.gif` | `GIF89a` | magic family `gif` |
| `mime-spoof.png` | ASCII text, `.png` name / `image/png` MIME | `magic` reject |
| `truncated.jpg` | valid JPEG header, cut body | header classifies, bitmap stage `decode` reject (stubbed loader throw) |
| `tiny-1x1.png` | PNG signature, minimal | smallest accept shape |

Large-dimension rejection (12 000 px strip, 36 MP) is tested with a stubbed
bitmap loader plus synthetic sizes in-test — no 30 MB fixture in repo.
