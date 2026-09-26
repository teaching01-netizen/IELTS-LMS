# SAT spectrum rail — reference crops

The pixel gate for the exam chrome's bottom edge (`bun run e2e:sat-spectrum`)
compares the rendered header regions against the crops in this folder. These
files are the reference: they are never produced by our own run, because a
snapshot of the implementation can only prove the implementation agrees with
itself.

Drop the supplied Bluebook crops here, named exactly:

| file | region |
| --- | --- |
| `top-rail.png` | the main top exam header's bottom rail |
| `question-header-unmarked.png` | the question strip, unmarked |
| `question-header-marked.png` | the question strip, marked for review |
| `question-header-eliminator-on.png` | the question strip, ABC eliminator armed |

Rules the spec relies on:

- **Anchored to the bottom edge.** Each crop is aligned to the bottom of its
  host region, because that is where the rail lives. A 3px rail-only crop and a
  full-strip crop both work; a crop taller than the live region will not.
- **DPR 1, examZoom=1, 1440×900.** The spec asserts all three before comparing
  (screen zoom scales the plane the rail is painted inside).
- **Width is the reference's width.** The spec clips exactly the crop's width and
  height from the live page, so no re-cut is needed after a layout tweak — but a
  crop wider than the live region fails with a message telling you to re-cut.

Any crop that is missing is skipped, with the expected file name in the skip
reason, so an incomplete set never silently locks a provisional rail.

## Regenerating the rail pattern from a crop

The pattern in `src/index.css` (fence: `SAT SPECTRUM RAIL (generated)`) is
written by `scripts/sat-rail-pattern.mjs`. Right now it is a **provisional**
deterministic barcode — fixed pixels, reference palette, real light breaks —
because no crop was available. Feed it the crop and it emits the reference's own
segments instead:

```bash
bun run sat:rail -- --reference e2e/fixtures/sat-rail-reference/top-rail.png --band 0:3
bun run sat:rail -- --reference <crop.png> --row 1 --scale 2   # DPR-2 crop
```

It prints the measured mean colour per cluster (so the palette tokens can be
frozen deliberately) and rewrites only the fenced block. With `--dry-run` it
prints the fence instead of writing it.
