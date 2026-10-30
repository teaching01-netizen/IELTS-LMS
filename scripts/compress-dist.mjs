// Writes .br and .gz siblings for compressible build assets; the Go frontend
// handler serves them by Accept-Encoding (backend/go/cmd/api/frontend.go).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = new URL('../dist/assets/', import.meta.url).pathname;
const compressible = /\.(js|mjs|css|json|svg|html|txt|wasm)$/;

let raw = 0;
let br = 0;
for (const name of await readdir(dir)) {
  if (!compressible.test(name)) continue;
  const file = join(dir, name);
  const body = await readFile(file);
  const brotli = brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length },
  });
  const gzip = gzipSync(body, { level: 9 });
  // Tiny files can grow; the handler then falls back to the raw file.
  if (brotli.length < body.length) await writeFile(`${file}.br`, brotli);
  if (gzip.length < body.length) await writeFile(`${file}.gz`, gzip);
  raw += body.length;
  br += Math.min(brotli.length, body.length);
}
console.log(`compress-dist: ${(raw / 1e6).toFixed(1)} MB -> ${(br / 1e6).toFixed(1)} MB brotli`);
