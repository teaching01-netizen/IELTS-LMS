import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = process.argv[2] ?? 'dist/.vite/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
// NOTE: the provider router chunk is keyed by its re-export facade
// (student-delivery/routes/StudentSessionRoute.tsx is a one-line re-export
// of student/routes/StudentSessionRoute.tsx). The real module has no own
// manifest entry — it is bundled via this facade — so the chunk-level
// assertion must use the facade key. The source-level boundary of the real
// module is pinned by studentBundleIsolation.test.ts.
const router = 'src/features/student-delivery/routes/StudentSessionRoute.tsx';
const sat = 'src/features/student/routes/SatStudentDeliveryBranch.tsx';
const ielts = 'src/features/student/routes/IeltsStudentDeliveryBranch.tsx';

function staticImports(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    assert.ok(manifest[current], `Missing manifest entry: ${current}`);
    seen.add(current);
    pending.push(...(manifest[current].imports ?? []));
  }
  return [...seen];
}

const routerImports = staticImports(router);
const satImports = staticImports(sat);
const ieltsImports = staticImports(ielts);
assert.ok(!routerImports.includes(sat) && !routerImports.includes(ielts), 'Provider router statically loads a delivery branch');
assert.ok(
  !satImports.some((entry) => /StudentAppWrapper|IeltsStudentDeliveryBranch|Ielts.*Renderer|IELTS.*Renderer/.test(entry)),
  'SAT branch closure contains the IELTS delivery runtime',
);
// Deep SAT-runtime guard: shared slivers (loading surfaces) may appear in
// both closures, but the SAT delivery runtime must never leak into the IELTS
// chunk graph. Sat-capital shared chunks are allowlisted by prefix so a new
// one forces an explicit decision here instead of merging silently.
const SAT_RUNTIME = /SatStudentSessionRoute|SatExamShell|SatQuestionRenderer|useSatExamController|satDeliveryGateway|SatTemporalRuntime|useSatModuleEntry|SatReviewPage|SatCalculatorPanel|SatReferenceSheetPanel/;
const SHARED_SAT_PREFIXES = ['_SatStateSurfaces-'];
for (const entry of ieltsImports) {
  assert.ok(!SAT_RUNTIME.test(entry), `IELTS branch statically loads SAT runtime: ${entry}`);
  const base = entry.split('/').pop();
  if (base && /^_Sat[A-Z]/.test(base)) {
    assert.ok(
      SHARED_SAT_PREFIXES.some((prefix) => base.startsWith(prefix)),
      `New Sat-capital shared chunk in IELTS closure needs an explicit allowlist decision: ${entry}`,
    );
  }
}
assert.ok((manifest[router].dynamicImports ?? []).includes(sat), 'SAT branch must be lazy');
assert.ok((manifest[router].dynamicImports ?? []).includes(ielts), 'IELTS branch must be lazy');
console.log('Student provider bundle isolation verified.');
