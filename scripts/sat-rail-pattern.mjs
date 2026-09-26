#!/usr/bin/env node
/**
 * The SAT spectrum rail's single source of truth.
 *
 * The rail is ONE fixed-pixel barcode shared by the top bar and the question
 * header: short gray / light-gray / blue / yellow segments separated by real
 * light breaks, at a fixed pixel scale, tiled with `repeat-x`. It is written
 * into `src/index.css` between the RAIL fence markers, so no host can repaint
 * it and both read the identical pattern.
 *
 * WHY A GENERATOR: the acceptance gate is the reference crop, not our own
 * output. Feed it the crop and the emitted segments ARE the reference pixels
 * (run-length encoded at the crop's own resolution); nothing is tuned by eye.
 *
 *   bun run sat:rail                                  # provisional barcode
 *   bun run sat:rail --reference <crop.png> --band 0:3
 *   bun run sat:rail --reference <crop.png> --band 0:3 --scale 2   # DPR-2 crop
 *
 * Flags
 *   --reference <png>  the supplied reference crop (full path)
 *   --row <n>          measure this single row
 *   --band <y0:y1>     measure the middle row of this band (default: auto-detect)
 *   --scale <n>        divide measured widths by n (crop captured at DPR n)
 *   --write-palette    also freeze the measured mean colour of each cluster as
 *                      the token value (off by default: a report is printed so
 *                      the palette can be reviewed before it is frozen)
 *   --dry-run          print the fence that would be written, touch nothing
 *
 * The PNG reader below is deliberately dependency-free (node:zlib only), so
 * this script cannot break when a transitive dev dependency moves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const INDEX_CSS = new URL("../src/index.css", import.meta.url).pathname;
const BEGIN = "/* >>> SAT SPECTRUM RAIL (generated) >>> */";
const END = "/* <<< SAT SPECTRUM RAIL (generated) <<< */";

/** Reference palette. Values come from the supplied crop; weights decide the
 *  provisional mix only (a measured crop ignores the weights entirely). */
const PALETTE = [
  { token: "--sat-rail-gray", hex: "#808080", weight: 62, min: 3, max: 14 },
  { token: "--sat-rail-light", hex: "#D0D0D0", weight: 22, min: 2, max: 9 },
  { token: "--sat-rail-blue", hex: "#70B7E1", weight: 9, min: 3, max: 11 },
  { token: "--sat-rail-yellow", hex: "#FAE570", weight: 7, min: 3, max: 9 },
];
/** The light breaks: the host's own surface showing through, not a colour. */
const GAP = { token: "transparent", weight: 46, min: 1, max: 4 };
const PATTERN_LENGTH = 1104;
const RAIL_HEIGHT = "3px";
const SEED = 0x5a17;

// ── arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

// ── tiny PNG reader (8-bit RGB/RGBA, non-interlaced) ─────────────────────────
function readPng(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG.`);
  let offset = 8;
  let width;
  let height;
  let colorType;
  let interlace;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${bitDepth}-bit).`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported; re-save the crop.");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Only true-color PNGs are supported (colour type ${colorType}).`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 1: line[x] = (line[x] + left) & 0xff; break;
        case 2: line[x] = (line[x] + up) & 0xff; break;
        case 3: line[x] = (line[x] + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          line[x] = (line[x] + predictor) & 0xff;
          break;
        }
        default: break;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, height, channels, pixels };
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const rgbToHex = ([r, g, b]) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** A palette entry is referenced through its token, never as a loose hex: the
 *  fence owns the values, and a host may not repaint the rail. A break is the
 *  literal `transparent`, because it is the host's own surface showing through. */
const paint = (token) => (token.startsWith("--") ? `var(${token})` : token);

/** Adjacent runs of the same paint are one segment, not two stops. */
function coalesce(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.token === run.token) last.to = run.to;
    else merged.push({ ...run });
  }
  return merged;
}

/** Nearest palette entry (or a lighter-than-paper break) for one pixel. */
function classify(rgb) {
  let best = { token: GAP.token, distance: Infinity };
  for (const entry of [...PALETTE, { token: GAP.token, hex: "#FFFFFF" }]) {
    const [r, g, b] = hexToRgb(entry.hex);
    const distance = (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2;
    if (distance < best.distance) best = { token: entry.token, distance, hex: entry.hex };
  }
  return best.token;
}

function measure(path, options) {
  const png = readPng(path);
  const scale = Number(options.scale ?? 1);
  const at = (x, y) => {
    const offset = (png.width * y + x) * png.channels;
    return [png.pixels[offset], png.pixels[offset + 1], png.pixels[offset + 2]];
  };

  let row = options.row === undefined ? undefined : Number(options.row);
  if (row === undefined && options.band) {
    const [y0, y1] = String(options.band).split(":").map(Number);
    row = Math.floor((y0 + y1) / 2);
  }
  if (row === undefined) {
    // Auto-detect: the rail is the most segmented row in the upper part of a
    // crop (the chrome lives at the top) — count colour changes per row.
    let best = { row: 0, changes: -1 };
    for (let y = 0; y < Math.max(1, Math.floor(png.height * 0.4)); y += 1) {
      let changes = 0;
      let previous = classify(at(0, y));
      for (let x = 1; x < png.width; x += 1) {
        const current = classify(at(x, y));
        if (current !== previous) changes += 1;
        previous = current;
      }
      if (changes > best.changes) best = { row: y, changes };
    }
    row = best.row;
  }

  // Quantize + run-length encode, then merge 1px specks into the run before
  // them: a crop that was resampled leaves single-pixel blends that are not
  // segments of the pattern.
  const runs = [];
  const sums = new Map();
  for (let x = 0; x < png.width; x += 1) {
    const rgb = at(x, row);
    const token = classify(rgb);
    const totals = sums.get(token) ?? { r: 0, g: 0, b: 0, n: 0 };
    totals.r += rgb[0];
    totals.g += rgb[1];
    totals.b += rgb[2];
    totals.n += 1;
    sums.set(token, totals);
    const last = runs[runs.length - 1];
    if (last && last.token === token) last.to += 1 / scale;
    else runs.push({ token, from: (last?.to ?? 0), to: (last?.to ?? 0) + 1 / scale });
  }
  const merged = runs.filter((run, index) => !(run.to - run.from < 1.5 && index > 0));
  for (const run of merged) run.from = Math.round(run.from * 100) / 100;

  const measured = [...sums.entries()]
    .filter(([, totals]) => totals.n > 0)
    .map(([token, totals]) => ({
      token,
      mean: rgbToHex([totals.r / totals.n, totals.g / totals.n, totals.b / totals.n]),
      pixels: totals.n,
      share: totals.n / png.width,
    }));
  return { row, width: png.width, runs: coalesce(merged), measured, scale };
}

// ── provisional barcode (deterministic: same seed, same rail) ────────────────
function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function provisional(length) {
  const random = mulberry32(SEED);
  const pick = () => {
    const pool = [...PALETTE.map((entry) => ({ ...entry, weight: entry.weight })), { ...GAP }];
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    for (const entry of pool) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return pool[pool.length - 1];
  };
  const runs = [];
  // Both ends of the pattern are a break, so the `repeat-x` seam reads as one
  // more gap instead of two inks butted together.
  runs.push({ token: GAP.token, from: 0, to: 2 });
  let x = 2;
  while (x < length - 2) {
    const entry = pick();
    const width = Math.max(entry.min, Math.round(entry.min + random() * (entry.max - entry.min)));
    const to = Math.min(x + width, length - 2);
    if (to <= x) break;
    runs.push({ token: entry.token, from: x, to });
    x = to;
  }
  runs.push({ token: GAP.token, from: x, to: length });
  return { row: null, width: length, runs: coalesce(runs), measured: null, scale: 1 };
}

// ── emit ─────────────────────────────────────────────────────────────────────
const STOPS_PER_LINE = 4;

function emitFence(rail, { provenance, palette }) {
  const stops = rail.runs.map((run) => `${paint(run.token)} ${run.from}px ${run.to}px`);
  const lines = [];
  for (let index = 0; index < stops.length; index += STOPS_PER_LINE) {
    lines.push(`      ${stops.slice(index, index + STOPS_PER_LINE).join(",\n      ")}`);
  }
  const patternLength = Math.round(rail.width * 100) / 100;
  const paletteLines = palette
    .map((entry) => `  ${entry.token}: ${entry.hex};`)
    .join("\n");
  return `${BEGIN}
  /* Written by scripts/sat-rail-pattern.mjs — do not hand-edit inside the fence.
   * ${provenance}
   * ${rail.runs.length} segments over ${patternLength}px, fixed pixels and never
   * percentages, so the top bar and the question header wear the identical
   * barcode at the identical scale. Breaks are transparent on purpose: they are
   * the reference's light breaks, and each host's own surface shows through. */
${paletteLines}
  --sat-rail-height: ${RAIL_HEIGHT};
  --sat-rail-pattern-length: ${patternLength}px;
  --sat-rail-pattern:
    linear-gradient(
      90deg,
${lines.join(",\n")}
    );
${END}`;
}

function writeFence(fence) {
  const css = readFileSync(INDEX_CSS, "utf8");
  const start = css.indexOf(BEGIN);
  const end = css.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`Rails fence not found in src/index.css — add:\n${BEGIN}\n${END}`);
  }
  const next = `${css.slice(0, start)}${fence}${css.slice(end + END.length)}`;
  writeFileSync(INDEX_CSS, next);
}

const reference = flag("reference");
const rail = reference ? measure(reference, {
  row: flag("row"),
  band: flag("band"),
  scale: flag("scale"),
}) : provisional(PATTERN_LENGTH);

const palette = PALETTE.map((entry) => {
  if (!has("write-palette") || !rail.measured) return { token: entry.token, hex: entry.hex };
  const hit = rail.measured.find((item) => item.token === entry.token);
  return { token: entry.token, hex: hit ? hit.mean : entry.hex };
});

const provenance = reference
  ? `${reference}${rail.row === null ? "" : ` row ${rail.row}`}${
      Number(flag("scale") ?? 1) !== 1 ? ` scale 1/${flag("scale")}` : ""
    }`
  : `PROVISIONAL (no reference crop supplied), seed 0x${SEED.toString(16)}, palette from the written spec`;

const fence = emitFence(rail, { provenance, palette });

if (rail.measured) {
  console.log(`measured ${reference} row ${rail.row} (${rail.width}px at scale ${rail.scale})`);
  for (const item of rail.measured.sort((a, b) => b.share - a.share)) {
    console.log(`  ${item.token.padEnd(18)} mean ${item.mean}  ${(item.share * 100).toFixed(1)}%`);
  }
  const width = (run) => run.to - run.from;
  const ink = rail.runs.filter((run) => run.token !== GAP.token && run.token !== "transparent");
  const gaps = rail.runs.filter((run) => run.token === GAP.token || run.token === "transparent");
  console.log(
    `  segments: ${rail.runs.length} (${ink.length} ink, ${gaps.length} breaks, ` +
      `avg ink ${(ink.reduce((sum, run) => sum + width(run), 0) / ink.length).toFixed(1)}px, ` +
      `avg break ${(gaps.reduce((sum, run) => sum + width(run), 0) / gaps.length).toFixed(1)}px)`,
  );
}

if (has("dry-run")) {
  console.log(`\n${fence}`);
} else {
  writeFence(fence);
  console.log(`\nwrote the rail fence in src/index.css (${rail.runs.length} segments)`);
  if (!reference && !rail.measured) {
    console.log(
      "note: PROVISIONAL — the segment cadence is a deterministic stand-in. " +
        "Re-run with --reference <crop> to lock the reference's own pixels.",
    );
  }
}
